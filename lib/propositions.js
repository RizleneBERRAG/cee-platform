/**
 * Les propositions du client : une copie qu'il modifie, que le gérant arbitre.
 *
 * ── Le principe, et pourquoi il est tenu jusqu'au bout ──
 *
 * Le client ne modifie **jamais** son dossier. Il soumet une proposition : une liste de
 * couples (champ, valeur souhaitée) posée à côté du dossier, qui ne le touche pas. Le
 * gérant tranche ensuite **ligne par ligne** — accepter, amender, refuser — et c'est cette
 * décision-là, et elle seule, qui écrit dans le dossier.
 *
 * Cette séparation n'est pas de la prudence d'usage. Un dossier CEE déposé est un dossier
 * dont chaque valeur a été vérifiée et figée ; un client qui corrigerait son adresse trois
 * semaines après le dépôt désaccorderait la plateforme de ce qui a été envoyé au
 * délégataire, sans que personne ne le sache.
 *
 * ── La liste blanche ──
 *
 * Les champs modifiables sont énumérés ici, en dur. Pas de liste noire, pas de « tout sauf
 * les montants » : une liste noire oublie toujours le champ ajouté le mois suivant. Ce qui
 * n'est pas dans `CHAMPS_CLIENT` est refusé à l'entrée, avant même d'être enregistré comme
 * proposition — un champ interdit ne doit pas exister sous forme de ligne en attente, où
 * il finirait par être accepté d'un clic.
 *
 * Ce que le client ne peut jamais toucher, et qui n'est donc pas dans la liste : les
 * montants, les volumes cumac, la fiche d'opération, le délégataire, le deal, les statuts,
 * les dates de jalon, et l'état du devis.
 */
import {
  champsClientQualification, normaliserReponse, definitionQualification,
} from './fiche-qualification.js'

/**
 * Ce qu'un client peut proposer de corriger sur son propre dossier.
 *
 * Chaque entrée : la clé « table.colonne », le libellé affiché, le type de saisie, et
 * éventuellement la liste fermée des valeurs admises.
 */
export const CHAMPS_CLIENT = [
  { champ: 'beneficiaire.nom', libelle: 'Nom', type: 'texte', max: 120 },
  { champ: 'beneficiaire.prenom', libelle: 'Prénom', type: 'texte', max: 120 },
  { champ: 'beneficiaire.raison_sociale', libelle: 'Raison sociale', type: 'texte', max: 200 },
  { champ: 'beneficiaire.telephone', libelle: 'Téléphone', type: 'tel', max: 30 },
  { champ: 'beneficiaire.email', libelle: 'Adresse e-mail', type: 'email', max: 200 },

  { champ: 'site.adresse', libelle: 'Adresse des travaux', type: 'texte', max: 250 },
  { champ: 'site.code_postal', libelle: 'Code postal', type: 'texte', max: 10 },
  { champ: 'site.ville', libelle: 'Ville', type: 'texte', max: 120 },
  { champ: 'site.surface', libelle: 'Surface (m²)', type: 'nombre' },
  { champ: 'site.parcelle_cadastrale', libelle: 'Parcelle cadastrale', type: 'texte', max: 60 },
]

/**
 * Les champs de la fiche de qualification, présentés comme des champs proposables.
 *
 * Ils suivent exactement le même chemin que l'adresse ou le téléphone : le client propose,
 * le gérant arbitre. Rien de particulier n'a été inventé pour eux — et c'est le but. Une
 * fiche de qualification décide du dimensionnement, donc du prix : elle mérite la même
 * relecture que le reste, pas un raccourci parce qu'elle est longue.
 */
function champsQualification() {
  return champsClientQualification().map((c) => ({
    champ: `qualification.${c.cle}`,
    libelle: `${c.section}. ${c.sectionTitre} — ${c.libelle}`,
    type: 'qualification',
    definition: c,
  }))
}

/** Les champs dont la liste de valeurs est fermée, ajoutés à l'exécution. */
export function champsClient(referentiels = {}) {
  const fermes = []
  if (referentiels.agesBatiment) {
    fermes.push({
      champ: 'site.age_batiment_tranche', libelle: 'Âge du bâtiment', type: 'liste',
      valeurs: referentiels.agesBatiment.map((a) => ({ code: a.code, libelle: a.libelle })),
    })
  }
  if (referentiels.typesChauffage) {
    fermes.push({
      champ: 'site.type_chauffage', libelle: 'Type de chauffage', type: 'liste',
      valeurs: referentiels.typesChauffage.map((t) => ({ code: t.code, libelle: t.libelle })),
    })
  }
  return [...CHAMPS_CLIENT, ...fermes, ...champsQualification()]
}

/** La définition d'un champ autorisé, ou null s'il ne l'est pas. */
export function definitionChamp(champ, referentiels = {}) {
  return champsClient(referentiels).find((c) => c.champ === champ) || null
}

/**
 * Découpe « site.adresse » en { table, colonne }, en refusant tout le reste.
 *
 * La validation est faite sur la liste blanche AVANT d'arriver ici ; ce découpage refuse
 * quand même ce qui ne ressemble pas à un couple table/colonne. Deux verrous valent mieux
 * qu'un quand le résultat sert à construire du SQL.
 */
export function cible(champ) {
  const m = /^([a-z_]+)\.([a-z_]+)$/.exec(String(champ || ''))
  return m ? { table: m[1], colonne: m[2] } : null
}

/** Normalise une valeur selon le type déclaré. Renvoie `{ok, valeur, motif}`. */
export function normaliser(def, brut) {
  // Les champs de la fiche de qualification ont leurs propres règles : listes à choix
  // multiple, bornes de pourcentage, « Oui / Non ». On délègue plutôt que de les
  // réécrire ici — deux jeux de règles pour une même donnée finissent par diverger.
  if (def.type === 'qualification') return normaliserReponse(def.definition, brut)

  const s = brut === null || brut === undefined ? '' : String(brut).trim()
  if (s === '') return { ok: true, valeur: null }

  if (def.type === 'nombre') {
    const n = Number(s.replace(',', '.'))
    if (!Number.isFinite(n) || n < 0) return { ok: false, motif: `« ${def.libelle} » doit être un nombre positif.` }
    return { ok: true, valeur: n }
  }
  if (def.type === 'liste') {
    const v = def.valeurs.find((x) => x.code === s)
    if (!v) return { ok: false, motif: `« ${def.libelle} » : valeur hors liste.` }
    return { ok: true, valeur: v.code }
  }
  if (def.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    return { ok: false, motif: "L'adresse e-mail ne ressemble pas à une adresse valide." }
  }
  if (def.max && s.length > def.max) {
    return { ok: false, motif: `« ${def.libelle} » dépasse ${def.max} caractères.` }
  }
  return { ok: true, valeur: s }
}

/** La valeur actuelle d'un champ du dossier, telle que le client la voit. */
export function valeurActuelle(db, dossierId, champ) {
  // Les réponses de qualification vivent dans leur propre table, en (clé, valeur).
  if (String(champ).startsWith('qualification.')) {
    const cle = String(champ).slice('qualification.'.length)
    const r = db.prepare('SELECT valeur FROM reponse_qualification WHERE dossier_id = ? AND cle = ?')
      .get(dossierId, cle)
    return r ? r.valeur : null
  }

  const c = cible(champ)
  if (!c) return null
  const liens = {
    beneficiaire: 'SELECT b.<col> AS v FROM dossier d JOIN beneficiaire b ON b.id = d.beneficiaire_id WHERE d.id = ?',
    site: 'SELECT s.<col> AS v FROM dossier d JOIN site s ON s.id = d.site_id WHERE d.id = ?',
  }
  const modele = liens[c.table]
  if (!modele) return null
  const r = db.prepare(modele.replace('<col>', c.colonne)).get(dossierId)
  return r ? r.v : null
}

/**
 * Enregistre une proposition.
 *
 * ── Ce qui est refusé, et ce qui est simplement ignoré ──
 *
 * Un champ hors liste blanche fait **échouer** la soumission : ce n'est pas une maladresse
 * de saisie, c'est une requête fabriquée, et l'avaler en silence reviendrait à ne pas la
 * voir. Une valeur identique à l'existante, elle, est ignorée sans bruit — le client a
 * renvoyé le formulaire sans rien changer sur cette ligne, ce n'est pas un incident.
 *
 * @returns {{ok:boolean, id?:string, champs?:number, motifs?:string[]}}
 */
export function soumettre(db, { dossierId, accesId, valeurs, message = null, referentiels = {} }) {
  const motifs = []
  const lignes = []

  for (const [champ, brut] of Object.entries(valeurs || {})) {
    const def = definitionChamp(champ, referentiels)
    if (!def) {
      motifs.push(`Le champ « ${champ} » n'est pas modifiable depuis l'espace client.`)
      continue
    }
    const n = normaliser(def, brut)
    if (!n.ok) { motifs.push(n.motif); continue }

    const avant = valeurActuelle(db, dossierId, champ)
    const memeValeur = String(avant ?? '') === String(n.valeur ?? '')
    if (memeValeur) continue

    lignes.push({ champ, avant, proposee: n.valeur })
  }

  if (motifs.length) return { ok: false, motifs }
  if (lignes.length === 0) return { ok: false, motifs: ['Aucune modification à soumettre.'] }

  const id = crypto.randomUUID()
  db.exec('BEGIN')
  try {
    db.prepare(`INSERT INTO proposition (id, dossier_id, acces_client_id, statut, message)
                VALUES (?,?,?,'EN_ATTENTE',?)`).run(id, dossierId, accesId, message)
    const ins = db.prepare(`INSERT INTO proposition_champ
      (id, proposition_id, champ, valeur_avant, valeur_proposee) VALUES (?,?,?,?,?)`)
    for (const l of lignes) {
      ins.run(crypto.randomUUID(), id, l.champ,
        l.avant === null || l.avant === undefined ? null : String(l.avant),
        l.proposee === null || l.proposee === undefined ? null : String(l.proposee))
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [err.message] }
  }

  return { ok: true, id, champs: lignes.length }
}

/** Les propositions en attente, avec leur détail. */
export function enAttente(db, dossierId = null) {
  const props = dossierId
    ? db.prepare(`SELECT p.*, d.numero FROM proposition p JOIN dossier d ON d.id = p.dossier_id
                  WHERE p.dossier_id = ? AND p.statut = 'EN_ATTENTE' ORDER BY p.soumise_le`).all(dossierId)
    : db.prepare(`SELECT p.*, d.numero FROM proposition p JOIN dossier d ON d.id = p.dossier_id
                  WHERE p.statut = 'EN_ATTENTE' ORDER BY p.soumise_le`).all()

  const detail = db.prepare('SELECT * FROM proposition_champ WHERE proposition_id = ?')
  return props.map((p) => ({ ...p, champs: detail.all(p.id) }))
}

/**
 * Applique l'arbitrage du gérant.
 *
 * `decisions` : { <id du champ>: { decision: 'ACCEPTE'|'AMENDE'|'REFUSE', valeur?, motif? } }
 *
 * ── Le dossier verrouillé ──
 *
 * Un dossier verrouillé ne se modifie pas, même par une proposition acceptée. Le verrou
 * existe précisément pour dire « ce dossier est parti, on n'y touche plus ». L'arbitrage
 * est alors refusé en entier, avec son motif — plutôt qu'à moitié appliqué.
 *
 * ── La valeur qui a bougé entre-temps ──
 *
 * Entre la soumission du client et la décision du gérant, le champ a pu être modifié en
 * interne. On le détecte en comparant à `valeur_avant`, et on le **signale** au lieu
 * d'écraser : le gérant décide en connaissance de cause. Une modification interne écrasée
 * en silence par une proposition vieille de trois semaines est exactement le genre de
 * régression que personne ne relie jamais à sa cause.
 */
export function arbitrer(db, propositionId, decisions, utilisateurId = null, { forcer = false } = {}) {
  const p = db.prepare('SELECT * FROM proposition WHERE id = ?').get(propositionId)
  if (!p) return { ok: false, motifs: ['Proposition introuvable.'] }
  if (p.statut !== 'EN_ATTENTE') return { ok: false, motifs: ['Cette proposition a déjà été traitée.'] }

  const dossier = db.prepare('SELECT id, verrouille FROM dossier WHERE id = ?').get(p.dossier_id)
  if (!dossier) return { ok: false, motifs: ['Dossier introuvable.'] }
  if (dossier.verrouille) {
    return { ok: false, motifs: ['Ce dossier est verrouillé : aucune modification ne peut y être appliquée.'] }
  }

  const champs = db.prepare('SELECT * FROM proposition_champ WHERE proposition_id = ?').all(propositionId)
  const appliques = []
  const conflits = []

  db.exec('BEGIN')
  try {
    for (const c of champs) {
      const d = decisions?.[c.id] || { decision: 'REFUSE', motif: 'Non traité.' }
      const retenue = d.decision === 'ACCEPTE' ? c.valeur_proposee
        : d.decision === 'AMENDE' ? (d.valeur ?? null)
        : null

      db.prepare(`UPDATE proposition_champ SET decision = ?, valeur_retenue = ?, motif = ?
                  WHERE id = ?`).run(d.decision, retenue, d.motif ?? null, c.id)

      if (d.decision === 'REFUSE') continue

      // Une réponse de qualification ne va pas dans `beneficiaire` ni dans `site` : elle
      // a sa propre table. Le chemin d'écriture diffère, la règle d'arbitrage non.
      if (String(c.champ).startsWith('qualification.')) {
        const cle = String(c.champ).slice('qualification.'.length)
        if (!definitionQualification(cle)) {
          conflits.push(`« ${c.champ} » ne fait plus partie de la fiche de qualification : ignoré.`)
          continue
        }
        const actuelleQ = valeurActuelle(db, p.dossier_id, c.champ)
        if (String(actuelleQ ?? '') !== String(c.valeur_avant ?? '') && !forcer) {
          conflits.push(
            `« ${c.champ} » a changé depuis la soumission. La proposition n'a pas été appliquée sur ce champ.`)
          continue
        }
        db.prepare('DELETE FROM reponse_qualification WHERE dossier_id = ? AND cle = ?')
          .run(p.dossier_id, cle)
        if (retenue !== null && retenue !== '') {
          db.prepare(`INSERT INTO reponse_qualification (id, dossier_id, cle, valeur, saisi_par, saisi_le)
                      VALUES (?,?,?,?,?,datetime('now'))`)
            .run(crypto.randomUUID(), p.dossier_id, cle, retenue, utilisateurId)
        }
        appliques.push({ champ: c.champ, valeur: retenue })
        continue
      }

      const cb = cible(c.champ)
      const def = definitionChamp(c.champ, { agesBatiment: [], typesChauffage: [] })
        || champsClient({}).find((x) => x.champ === c.champ)
      // Le champ est revérifié contre la liste blanche AU MOMENT D'ÉCRIRE, et pas seulement
      // à la soumission : une ligne a pu être créée sous une version antérieure de la liste.
      if (!cb || !/^(beneficiaire|site)$/.test(cb.table) || !estAutorise(c.champ)) {
        conflits.push(`« ${c.champ} » n'est pas (ou plus) un champ modifiable : ignoré.`)
        continue
      }

      const actuelle = valeurActuelle(db, p.dossier_id, c.champ)
      if (String(actuelle ?? '') !== String(c.valeur_avant ?? '') && !forcer) {
        conflits.push(
          `« ${c.champ} » a changé depuis la soumission (« ${c.valeur_avant ?? ''} » → ` +
          `« ${actuelle ?? ''} »). La proposition n'a pas été appliquée sur ce champ.`)
        continue
      }

      const sql = cb.table === 'beneficiaire'
        ? `UPDATE beneficiaire SET ${cb.colonne} = ? WHERE id = (SELECT beneficiaire_id FROM dossier WHERE id = ?)`
        : `UPDATE site SET ${cb.colonne} = ? WHERE id = (SELECT site_id FROM dossier WHERE id = ?)`
      db.prepare(sql).run(retenue, p.dossier_id)
      appliques.push({ champ: c.champ, valeur: retenue })
    }

    db.prepare(`UPDATE proposition SET statut = 'TRAITEE', traitee_le = datetime('now'), traitee_par = ?
                WHERE id = ?`).run(utilisateurId, propositionId)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [err.message] }
  }

  return { ok: true, appliques, conflits }
}

/** Un champ figure-t-il dans la liste blanche, listes fermées comprises ? */
function estAutorise(champ) {
  if (CHAMPS_CLIENT.some((c) => c.champ === champ)) return true
  if (String(champ).startsWith('qualification.')) {
    return !!definitionQualification(String(champ).slice('qualification.'.length))
  }
  return champ === 'site.age_batiment_tranche' || champ === 'site.type_chauffage'
}

/**
 * Les étapes que le client voit, et rien d'autre.
 *
 * Les statuts internes — « LISTE AGRI TH 117 », « ILORAL TOTAL (PAS COFRAC) » — mélangent
 * étape, deal et liste de travail. Les montrer au client l'informerait mal et exposerait
 * l'organisation interne. On dérive donc un parcours à partir des JALONS, qui sont des
 * faits datés : ce qui a eu lieu a eu lieu.
 */
export const ETAPES_CLIENT = [
  { code: 'DEVIS', libelle: 'Devis établi', champ: 'date_proposition' },
  { code: 'SIGNATURE', libelle: 'Devis signé', champ: 'date_signature' },
  { code: 'POSE', libelle: 'Travaux réalisés', champ: 'date_pose' },
  { code: 'CONTROLE', libelle: 'Contrôle effectué', champ: 'date_controle' },
  { code: 'ACHEVEMENT', libelle: 'Chantier achevé', champ: 'date_achevement' },
  { code: 'DEPOT', libelle: 'Dossier déposé', champ: 'date_depot' },
]

export function suiviClient(dossier) {
  let derniereFaite = -1
  const etapes = ETAPES_CLIENT.map((e, i) => {
    const date = dossier?.[e.champ] || null
    if (date) derniereFaite = i
    return { ...e, date, faite: !!date }
  })
  return {
    etapes,
    // L'étape « en cours » est celle qui suit la dernière franchie. Rien d'inventé : si
    // aucune date n'est posée, le parcours n'a pas commencé, et on le dit ainsi.
    enCours: derniereFaite + 1 < etapes.length ? etapes[derniereFaite + 1].code : null,
    termine: derniereFaite === etapes.length - 1,
  }
}
