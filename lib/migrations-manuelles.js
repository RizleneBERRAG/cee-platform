/**
 * Transformations structurelles — celles que la mise à niveau automatique refuse de faire.
 *
 * `lib/migrations.js` est volontairement additive : elle ajoute des tables et des colonnes,
 * et ne touche jamais à ce qui existe. C'est ce qui la rend sûre à lancer à chaque démarrage.
 * Mais SQLite ne sait pas modifier une contrainte en place : changer un `UNIQUE` impose de
 * reconstruire la table. C'est une opération destructrice, et la règle posée dans
 * `migrations.js` est explicite — « une transformation destructrice doit rester une décision
 * humaine, écrite à la main ». Ce fichier est l'endroit où ces décisions s'écrivent.
 *
 * Trois garanties, sans lesquelles ce mécanisme serait plus dangereux que le problème :
 *
 * 1. **Chaque étape est nommée et enregistrée.** Une étape appliquée ne se rejoue jamais,
 *    même si sa condition redevient vraie par accident.
 * 2. **Chaque étape dit elle-même si elle est nécessaire.** On lit l'état réel de la base,
 *    pas un numéro de version — une base restaurée depuis une sauvegarde ancienne est
 *    rattrapée correctement.
 * 3. **Aucune ligne n'est perdue sans le dire.** Une reconstruction compte les lignes avant
 *    et après ; si le compte ne tombe pas juste, on annule et on laisse la table d'origine
 *    en place. Mieux vaut une contrainte non corrigée qu'une donnée disparue en silence.
 */
import { arrondi } from './montants.js'
import { TYPES_INTERVENTION_PAR_DEFAUT } from './referentiels-planning.js'
import { SAV_TYPES, SAV_STATUTS, SAV_MOTIFS } from './referentiels-sav.js'

/**
 * Reconstruit une table pour lui donner une nouvelle définition.
 *
 * SQLite n'a pas d'`ALTER TABLE … ALTER CONSTRAINT`. Le chemin officiel est : créer la
 * nouvelle table à côté, recopier, supprimer l'ancienne, renommer. Les colonnes recopiées
 * sont l'intersection des deux définitions — une colonne ajoutée par la nouvelle définition
 * reste donc à sa valeur par défaut, et une colonne disparue est abandonnée volontairement.
 *
 * @param {object} db
 * @param {string} nom            table à reconstruire
 * @param {string} creationSql    CREATE TABLE de la table provisoire (nom : `<nom>__nouveau`)
 * @returns {{lignes:number}}
 * @throws si le nombre de lignes ne se conserve pas
 */
export function reconstruireTable(db, nom, creationSql) {
  const provisoire = `${nom}__nouveau`

  // Une reconstruction interrompue a pu laisser la table provisoire derrière elle.
  db.exec(`DROP TABLE IF EXISTS ${provisoire}`)
  db.exec(creationSql)

  const colonnes = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name)
  const anciennes = new Set(colonnes(nom))
  const communes = colonnes(provisoire).filter((c) => anciennes.has(c))
  if (communes.length === 0) {
    db.exec(`DROP TABLE ${provisoire}`)
    throw new Error(`${nom} : aucune colonne commune entre l'ancienne et la nouvelle définition.`)
  }

  const avant = db.prepare(`SELECT COUNT(*) AS n FROM ${nom}`).get().n
  const liste = communes.join(', ')
  db.exec(`INSERT INTO ${provisoire} (${liste}) SELECT ${liste} FROM ${nom}`)
  const apres = db.prepare(`SELECT COUNT(*) AS n FROM ${provisoire}`).get().n

  if (apres !== avant) {
    // On ne remplace pas une table par une copie incomplète. L'appelant annulera la
    // transaction ; la table d'origine reste intacte et l'incident est signalé.
    db.exec(`DROP TABLE ${provisoire}`)
    throw new Error(`${nom} : ${avant} ligne(s) avant, ${apres} après — reconstruction annulée.`)
  }

  db.exec(`DROP TABLE ${nom}`)
  db.exec(`ALTER TABLE ${provisoire} RENAME TO ${nom}`)
  return { lignes: apres }
}

/** Le CREATE TABLE tel que SQLite l'a enregistré, ou null si la table n'existe pas. */
function definition(db, nom) {
  const r = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom)
  return r ? String(r.sql) : null
}

/**
 * Les étapes, dans l'ordre. Une étape ajoutée ici s'applique au démarrage suivant.
 *
 * `necessaire` doit être une lecture de l'état réel, jamais une supposition.
 */
export const ETAPES = [
  {
    nom: '2026-09-16-deal-fiche-charte',
    raison:
      "La même fiche peut être portée deux fois par un deal — hors coup de pouce et en coup " +
      "de pouce. UNIQUE (deal_id, fiche_id) rejetait la seconde.",
    necessaire(db) {
      const d = definition(db, 'deal_fiche')
      if (!d) return false
      // Nécessaire tant que la contrainte ne mentionne pas la charte.
      return /UNIQUE\s*\(\s*deal_id\s*,\s*fiche_id\s*\)/i.test(d)
    },
    appliquer(db) {
      reconstruireTable(db, 'deal_fiche', `
        CREATE TABLE deal_fiche__nouveau (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL REFERENCES deal(id),
          fiche_id TEXT NOT NULL REFERENCES fiche(id),
          charte TEXT NOT NULL DEFAULT 'HORS_CDP',
          actif INTEGER NOT NULL DEFAULT 1,
          UNIQUE (deal_id, fiche_id, charte)
        )`)
    },
  },
  {
    nom: '2026-09-16-controle-passage',
    raison:
      "Les contrôles existants sont tous des premiers passages : on les numérote pour que " +
      "le contre-contrôle puisse s'ajouter sans les écraser.",
    necessaire(db) {
      if (!definition(db, 'controle')) return false
      const cols = db.prepare('PRAGMA table_info(controle)').all().map((r) => r.name)
      if (!cols.includes('passage')) return false      // la colonne arrive par la voie additive
      return db.prepare('SELECT COUNT(*) AS n FROM controle WHERE passage IS NULL OR passage < 1').get().n > 0
    },
    appliquer(db) {
      db.exec('UPDATE controle SET passage = 1 WHERE passage IS NULL OR passage < 1')
    },
  },
  {
    nom: '2026-09-16-reprise-operations',
    raison:
      "Chaque dossier existant devient un dossier à une opération sur un chantier principal, " +
      "montants figés repris à l'identique.",
    necessaire(db) {
      if (!definition(db, 'operation') || !definition(db, 'chantier')) return false
      // Nécessaire tant qu'il reste un dossier sans opération.
      return db.prepare(`SELECT COUNT(*) AS n FROM dossier d
                         WHERE NOT EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = d.id)`).get().n > 0
    },
    appliquer(db) {
      reprendreDossiersEnOperations(db)
    },
  },
  {
    nom: '2026-09-17-arrondi-centime',
    raison:
      "Les totaux repris étaient des sommes en virgule flottante non arrondies " +
      "(73 432,79999999999 €). La projection, elle, arrondit au centime : les deux " +
      "écritures divergeaient à chaque resynchronisation. Seuls les TOTAUX sont " +
      "arrondis — les montants des opérations viennent de l'export et n'y touche pas.",
    necessaire(db) {
      if (!definition(db, 'dossier')) return false
      return db.prepare(`
        SELECT COUNT(*) AS n FROM dossier
        WHERE (volume_cumac       IS NOT NULL AND volume_cumac       <> ROUND(volume_cumac, 2))
           OR (prime_delegataire  IS NOT NULL AND prime_delegataire  <> ROUND(prime_delegataire, 2))
           OR (prime_beneficiaire IS NOT NULL AND prime_beneficiaire <> ROUND(prime_beneficiaire, 2))
           OR (commission_installateur IS NOT NULL AND commission_installateur <> ROUND(commission_installateur, 2))
           OR (commission_apporteur    IS NOT NULL AND commission_apporteur    <> ROUND(commission_apporteur, 2))
           OR (cout_pose          IS NOT NULL AND cout_pose          <> ROUND(cout_pose, 2))
           OR (marge_nette        IS NOT NULL AND marge_nette        <> ROUND(marge_nette, 2))`).get().n > 0
    },
    appliquer(db) {
      // ── On n'arrondit QUE ce qu'on a calculé soi-même ──
      //
      // Les montants des opérations viennent tels quels de l'export du logiciel précédent,
      // qui stocke des primes au dixième de centime : `1 605,5585 €`. Les arrondir
      // éloignerait la plateforme de sa source de 16 centimes sur le portefeuille, et
      // afficherait sur chaque opération un chiffre que l'autre logiciel n'affiche pas.
      // On les laisse donc intacts. **On ne corrige pas les données de quelqu'un d'autre.**
      //
      // Le total du dossier, lui, est NOTRE arithmétique : c'est là, et là seulement, qu'on
      // arrondit — avec la fonction même qu'emploie la projection, pour que les deux
      // écritures ne se battent pas d'un centime à chaque resynchronisation.
      const COLONNES = ['volume_cumac', 'prime_delegataire', 'prime_beneficiaire',
        'commission_installateur', 'commission_apporteur', 'cout_pose', 'marge_nette']
      const presentes = (table) => {
        const d = definition(db, table)
        return d ? COLONNES.filter((c) => new RegExp(`\\b${c}\\b`).test(d)) : []
      }

      const surDossier = presentes('dossier')
      const surOperation = presentes('operation')
      if (surDossier.length === 0) return

      if (surOperation.length === 0) {
        db.exec(`UPDATE dossier SET ${surDossier.map((c) => `${c} = ROUND(${c}, 2)`).join(', ')}`)
        return
      }

      // Les sommes sont faites en SQL, l'arrondi en JS : `SUM` ignore les valeurs vides et
      // renvoie NULL si AUCUNE ligne n'est renseignée — exactement la règle de la projection,
      // qui n'invente pas un 0 là où la donnée manque. Et seules les opérations FIGÉES comptent.
      const champs = surDossier.filter((c) => surOperation.includes(c))
      const lignes = db.prepare(`
        SELECT d.id, ${champs.map((c) => `(SELECT SUM(o.${c}) FROM operation o
           WHERE o.dossier_id = d.id AND o.date_calcul IS NOT NULL) AS ${c}`).join(', ')}
        FROM dossier d
        WHERE EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = d.id)`).all()

      const maj = db.prepare(
        `UPDATE dossier SET ${champs.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      for (const l of lignes) {
        maj.run(...champs.map((c) => (l[c] == null ? null : arrondi(l[c]))), l.id)
      }
    },
  },
  {
    nom: '2026-09-17-site-listes-fermees',
    raison:
      "Âge du bâtiment, zone climatique et type de chauffage conditionnent l'éligibilité " +
      "de plusieurs fiches. L'âge était un entier libre là où les fiches raisonnent par " +
      "tranches, la zone ignorait H1 Île-de-France, et le chauffage portait sept valeurs " +
      "inventées pour trois réelles.",
    necessaire(db) {
      const d = definition(db, 'site')
      if (!d) return false
      // Nécessaire tant que l'âge est stocké en entier.
      return /age_batiment\s+INTEGER/i.test(d)
    },
    appliquer(db) {
      // ── L'âge : d'un entier à une tranche ──
      //
      // On ne réécrit pas la colonne en place : SQLite ne sait pas changer un type. On
      // ajoute la colonne cible, on convertit, et on laisse l'ancienne en lecture seule
      // le temps que le code bascule. Supprimer tout de suite une colonne dont il reste
      // peut-être une lecture quelque part, c'est perdre la donnée pour gagner une ligne.
      const colonnes = db.prepare('PRAGMA table_info(site)').all().map((c) => c.name)
      if (!colonnes.includes('age_batiment_tranche')) {
        db.exec('ALTER TABLE site ADD COLUMN age_batiment_tranche TEXT')
      }
      db.exec(`
        UPDATE site SET age_batiment_tranche = CASE
          WHEN age_batiment IS NULL THEN NULL
          WHEN age_batiment < 2  THEN 'MOINS_2_ANS'
          WHEN age_batiment < 15 THEN 'DE_2_A_15_ANS'
          ELSE 'PLUS_15_ANS'
        END
        WHERE age_batiment_tranche IS NULL`)

      // ── Le chauffage : sept valeurs vers trois ──
      //
      // Seuls les libellés qu'on reconnaît franchement sont convertis. Le reste est mis à
      // vide plutôt que rangé dans « combustible » par défaut : une valeur vide se voit et
      // se corrige, une valeur fausse décide d'une éligibilité en silence.
      db.exec(`
        UPDATE site SET type_chauffage = CASE
          WHEN type_chauffage IS NULL OR TRIM(type_chauffage) = '' THEN NULL
          WHEN UPPER(type_chauffage) IN ('COMBUSTIBLE','ELECTRIQUE','HYBRIDE') THEN UPPER(type_chauffage)
          WHEN LOWER(type_chauffage) LIKE '%hybride%' THEN 'HYBRIDE'
          WHEN LOWER(type_chauffage) LIKE '%lectri%' THEN 'ELECTRIQUE'
          WHEN LOWER(type_chauffage) LIKE '%gaz%' OR LOWER(type_chauffage) LIKE '%fioul%'
            OR LOWER(type_chauffage) LIKE '%bois%' OR LOWER(type_chauffage) LIKE '%granul%'
            OR LOWER(type_chauffage) LIKE '%propane%' OR LOWER(type_chauffage) LIKE '%charbon%'
            OR LOWER(type_chauffage) LIKE '%combustible%' THEN 'COMBUSTIBLE'
          ELSE NULL
        END`)

      // ── La zone : l'Île-de-France séparée de H1 ──
      //
      // Un site francilien déjà marqué H1 devient H1_IDF. La zone d'un site jamais
      // renseignée n'est PAS déduite ici : déduire au passage d'une migration, c'est
      // fabriquer de la donnée que personne n'a saisie ni relue.
      db.exec(`
        UPDATE site SET zone_climatique = 'H1_IDF'
        WHERE zone_climatique = 'H1'
          AND substr(replace(code_postal, ' ', ''), 1, 2) IN ('75','77','78','91','92','93','94','95')`)
    },
  },
  {
    nom: '2026-09-17-deal-grille-18-ratios',
    raison:
      "La grille des deals n'avait que douze cases, pour deux régimes. L'ancien logiciel " +
      "en porte dix-huit : il distingue la GRANDE PRÉCARITÉ de la précarité simple, et " +
      "les tarifs y diffèrent réellement. Les six cases manquantes sont ajoutées. Au " +
      "passage, les ratios cessent d'être NOT NULL DEFAULT 0 : une case vide doit rester " +
      "« non renseigné », pas devenir « gratuit ».",
    necessaire(db) {
      const d = definition(db, 'deal')
      if (!d) return false
      // Nécessaire tant que la grande précarité manque, ou qu'un zéro par défaut
      // continue de se faire passer pour un tarif.
      return !/r_deleg_grande_precarite_sans_mpr/i.test(d)
        || /r_deleg_precaire_sans_mpr\s+REAL\s+NOT\s+NULL/i.test(d)
    },
    appliquer(db) {
      // ── Pourquoi une reconstruction, et pourquoi elle est sans risque ici ──
      //
      // Six colonnes s'ajouteraient bien avec ALTER TABLE ADD COLUMN. Mais retirer le
      // `NOT NULL DEFAULT 0` des douze anciennes impose de refaire la table : SQLite ne
      // sait pas relâcher une contrainte en place. `reconstruireTable` recopie ligne à
      // ligne et refuse de continuer si le compte ne tombe pas juste.
      //
      // Un zéro déjà écrit dans une base existante reste un zéro : on ne le transforme
      // pas en NULL. Rien ne permet de distinguer après coup un tarif réellement nul
      // d'un défaut jamais rempli, et deviner ici reviendrait à effacer une saisie.
      // La règle nouvelle vaut pour ce qui s'écrit désormais.
      reconstruireTable(db, 'deal', `
        CREATE TABLE deal__nouveau (
          id TEXT PRIMARY KEY,
          libelle TEXT NOT NULL,
          version TEXT NOT NULL DEFAULT 'V1',
          delegataire_id TEXT NOT NULL REFERENCES delegataire(id),
          type_beneficiaire TEXT NOT NULL DEFAULT 'B2B_B2C',
          volume_cumac REAL,
          date_debut TEXT NOT NULL,
          date_fin TEXT,
          num_contrat_standard TEXT,
          num_contrat_cdp TEXT,
          num_contrat_mpr TEXT,
          date_fin_facturation TEXT,
          par_defaut INTEGER NOT NULL DEFAULT 0,
          actif INTEGER NOT NULL DEFAULT 1,
          r_deleg_grande_precarite_sans_mpr REAL,
          r_deleg_grande_precarite_avec_mpr REAL,
          r_cede_grande_precarite_sans_mpr REAL,
          r_cede_grande_precarite_avec_mpr REAL,
          r_garde_grande_precarite_sans_mpr REAL,
          r_garde_grande_precarite_avec_mpr REAL,
          r_deleg_precaire_sans_mpr REAL,
          r_deleg_precaire_avec_mpr REAL,
          r_cede_precaire_sans_mpr REAL,
          r_cede_precaire_avec_mpr REAL,
          r_garde_precaire_sans_mpr REAL,
          r_garde_precaire_avec_mpr REAL,
          r_deleg_classique_sans_mpr REAL,
          r_deleg_classique_avec_mpr REAL,
          r_cede_classique_sans_mpr REAL,
          r_cede_classique_avec_mpr REAL,
          r_garde_classique_sans_mpr REAL,
          r_garde_classique_avec_mpr REAL,
          source TEXT,
          source_ref TEXT
        )`)
    },
  },
  {
    nom: '2026-09-30-types-intervention',
    raison:
      "Les sept calendriers du planning, repris de Pixel : rendez-vous commercial, prévisite, " +
      "ouverture de chantier, pose, fin de pose, audit énergétique, S.A.V.",
    necessaire(db) {
      if (!definition(db, 'type_intervention')) return false
      // Une seule fois, sur une table vide : un type retiré ensuite ne doit pas revenir.
      return db.prepare('SELECT COUNT(*) AS n FROM type_intervention').get().n === 0
    },
    appliquer(db) {
      const ins = db.prepare('INSERT INTO type_intervention (id, code, libelle, couleur, ordre) VALUES (?,?,?,?,?)')
      TYPES_INTERVENTION_PAR_DEFAUT.forEach(([code, libelle, couleur], i) => ins.run(crypto.randomUUID(), code, libelle, couleur, i + 1))
    },
  },
  {
    nom: '2026-09-30-permission-planning',
    raison:
      "Nouveau droit « planning.tous » : voir et organiser le planning de toute l'équipe. " +
      "Donné aux rôles qui voient déjà tous les dossiers ; les autres ne voient que leurs interventions.",
    necessaire(db) {
      if (!definition(db, 'role')) return false
      return db.prepare('SELECT permissions FROM role').all().some((r) => {
        const p = JSON.parse(r.permissions || '[]')
        return p.includes('dossier.tous') && !p.includes('planning.tous')
      })
    },
    appliquer(db) {
      const maj = db.prepare('UPDATE role SET permissions = ? WHERE id = ?')
      for (const r of db.prepare('SELECT id, permissions FROM role').all()) {
        const p = JSON.parse(r.permissions || '[]')
        if (p.includes('dossier.tous') && !p.includes('planning.tous')) maj.run(JSON.stringify([...p, 'planning.tous']), r.id)
      }
    },
  },
  {
    nom: '2026-09-30-referentiel-sav',
    raison: 'Types, statuts et motifs du S.A.V, repris de Pixel.',
    necessaire(db) {
      if (!definition(db, 'sav_referentiel')) return false
      return db.prepare('SELECT COUNT(*) AS n FROM sav_referentiel').get().n === 0
    },
    appliquer(db) {
      const ins = db.prepare('INSERT INTO sav_referentiel (id, categorie, libelle, ordre, cloture) VALUES (?,?,?,?,?)')
      SAV_TYPES.forEach((l, i) => ins.run(crypto.randomUUID(), 'TYPE', l, i + 1, 0))
      SAV_STATUTS.forEach(([l, c], i) => ins.run(crypto.randomUUID(), 'STATUT', l, i + 1, c))
      SAV_MOTIFS.forEach((l, i) => ins.run(crypto.randomUUID(), 'MOTIF', l, i + 1, 0))
    },
  },
  {
    nom: '2026-09-30-permission-suppression',
    raison:
      "Nouveau droit « dossier.supprimer » (corbeille). Donné aux rôles qui voient tous les dossiers " +
      "et peuvent les verrouiller — gérant et ADV —, pas aux régies ni aux apporteurs.",
    necessaire(db) {
      if (!definition(db, 'role')) return false
      return db.prepare('SELECT permissions FROM role').all().some((r) => {
        const p = JSON.parse(r.permissions || '[]')
        return p.includes('dossier.tous') && p.includes('dossier.verrouiller') && !p.includes('dossier.supprimer')
      })
    },
    appliquer(db) {
      const maj = db.prepare('UPDATE role SET permissions = ? WHERE id = ?')
      for (const r of db.prepare('SELECT id, permissions FROM role').all()) {
        const p = JSON.parse(r.permissions || '[]')
        if (p.includes('dossier.tous') && p.includes('dossier.verrouiller') && !p.includes('dossier.supprimer')) {
          maj.run(JSON.stringify([...p, 'dossier.supprimer']), r.id)
        }
      }
    },
  },
]

/**
 * Reprise des dossiers existants dans le modèle chantiers/opérations.
 *
 * Ce que cette étape doit garantir, et qui compte plus que sa rapidité :
 *
 * 1. **Aucun montant figé ne bouge.** Les résultats du dossier sont RECOPIÉS dans son
 *    opération, pas recalculés. Un recalcul donnerait des chiffres différents dès qu'une
 *    grille a changé depuis — et réécrirait des montants déjà facturés.
 * 2. **`date_calcul` suit.** Une opération figée reste figée ; un dossier jamais calculé
 *    donne une opération non valorisée. C'est ce qui fait que la somme des opérations
 *    figées retombe exactement sur les totaux du dossier.
 * 3. **Rejouable sans doublon.** Seuls les dossiers dépourvus d'opération sont repris :
 *    une reprise interrompue se termine au démarrage suivant sans rien dupliquer.
 *
 * Les champs qui n'existaient pas (produit, P.U.V, unité) restent vides : les inventer
 * serait fabriquer de la donnée que personne n'a saisie.
 *
 * @returns {{chantiers:number, operations:number}}
 */
export function reprendreDossiersEnOperations(db) {
  const dossiers = db.prepare(`
    SELECT d.id, d.site_id, d.fiche_id, d.fiche_version_id, d.charte, d.quantite,
           d.installateur_id, d.volume_cumac, d.prime_delegataire, d.prime_beneficiaire,
           d.commission_installateur, d.commission_apporteur, d.cout_pose, d.marge_nette,
           d.date_calcul, fv.unite_variable
    FROM dossier d
    LEFT JOIN fiche_version fv ON fv.id = d.fiche_version_id
    WHERE NOT EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = d.id)`).all()

  const insChantier = db.prepare(`
    INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
    VALUES (?, ?, ?, 1, 'Chantier principal', 1)`)

  const insOperation = db.prepare(`
    INSERT INTO operation (
      id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id, charte,
      installateur_id, quantite, unite, cout_pose, taux_apporteur,
      volume_cumac, prime_delegataire, prime_beneficiaire, commission_installateur,
      commission_apporteur, marge_nette, date_calcul
    ) VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)

  let chantiers = 0
  let operations = 0

  for (const d of dossiers) {
    // Un dossier sans site n'aurait pas pu être créé, mais la reprise ne doit pas
    // s'interrompre sur une ligne abîmée : on la saute et les autres passent.
    if (!d.site_id || !d.fiche_id || !d.fiche_version_id) continue

    const chantierId = crypto.randomUUID()
    insChantier.run(chantierId, d.id, d.site_id)
    chantiers++

    // Le taux d'apporteur n'était stocké nulle part : on ne peut pas le retrouver.
    // On le remet à 0 plutôt que d'en inventer un — la commission déjà figée, elle,
    // est recopiée telle quelle et reste donc juste.
    insOperation.run(
      crypto.randomUUID(), d.id, chantierId,
      d.fiche_id, d.fiche_version_id, d.charte || 'HORS_CDP',
      d.installateur_id, d.quantite ?? 0, d.unite_variable,
      d.cout_pose ?? 0, 0,
      d.volume_cumac, d.prime_delegataire, d.prime_beneficiaire,
      d.commission_installateur, d.commission_apporteur, d.marge_nette, d.date_calcul
    )
    operations++
  }

  return { chantiers, operations }
}

/**
 * Applique les étapes non encore passées.
 *
 * Chaque étape est enveloppée dans sa propre transaction : l'échec de l'une laisse la base
 * telle qu'elle était avant elle, et n'empêche pas les suivantes d'être tentées.
 *
 * @returns {{appliquees:string[], ignorees:string[], erreurs:string[]}}
 */
export function appliquerManuelles(db) {
  const rapport = { appliquees: [], ignorees: [], erreurs: [] }

  db.exec(`CREATE TABLE IF NOT EXISTS migration_manuelle (
    nom TEXT PRIMARY KEY,
    applique_le TEXT NOT NULL DEFAULT (datetime('now')),
    detail TEXT
  )`)

  const deja = new Set(db.prepare('SELECT nom FROM migration_manuelle').all().map((r) => r.nom))

  for (const etape of ETAPES) {
    if (deja.has(etape.nom)) continue

    let besoin
    try {
      besoin = etape.necessaire(db)
    } catch (e) {
      rapport.erreurs.push(`${etape.nom} : état illisible — ${e.message}`)
      continue
    }

    if (!besoin) {
      // Rien à faire — et on le note, pour ne pas réexaminer la question à chaque démarrage.
      db.prepare('INSERT INTO migration_manuelle (nom, detail) VALUES (?, ?)')
        .run(etape.nom, 'sans objet sur cette base')
      rapport.ignorees.push(etape.nom)
      continue
    }

    try {
      db.exec('BEGIN')
      etape.appliquer(db)
      db.prepare('INSERT INTO migration_manuelle (nom, detail) VALUES (?, ?)')
        .run(etape.nom, etape.raison)
      db.exec('COMMIT')
      rapport.appliquees.push(etape.nom)
    } catch (e) {
      try { db.exec('ROLLBACK') } catch { /* transaction déjà refermée */ }
      rapport.erreurs.push(`${etape.nom} : ${e.message}`)
    }
  }

  return rapport
}
