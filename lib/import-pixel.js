/**
 * Reprise des données du logiciel précédent.
 *
 * ── Les sources, et pourquoi il en faut plusieurs ──
 *
 * Aucun des treize modèles d'export du logiciel précédent ne sort un dossier complet : ce
 * sont des exports « à destination » (un bilan comptable, un dépôt au registre, un format
 * délégataire). On en recoupe donc trois :
 *
 *   COFRAC  — la source principale. Une ligne par opération : client, adresse, installateur
 *             et SIRET, fiche, quantité, cumac, produit posé, montants, dates.
 *   DEPOT   — la liste des dossiers. Elle seule porte le NUMÉRO DE DOSSIER.
 *   BILAN   — le délégataire et le statut d'origine.
 *
 * ── La jointure, et sa limite ──
 *
 * Le numéro d'opération de COFRAC commence par le numéro de dossier : `EPC-2026-2934-…`.
 * On rattache donc chaque opération au plus long numéro de dossier connu qui la préfixe —
 * plutôt que de deviner une règle de découpage qui casserait sur les formes irrégulières.
 * Vérifié : 3 304 opérations sur 3 304 se rattachent.
 *
 * Le BILAN, lui, n'a AUCUN identifiant. On ne peut le recoller que par
 * (raison sociale, cumac, fiche) — et 101 de ces clés sont ambiguës. **On ne rattache donc
 * que les clés uniques des deux côtés**, et on laisse le délégataire vide ailleurs.
 * Attribuer le mauvais délégataire à un dossier fausserait sa marge sans que rien ne le
 * signale ; une case vide, elle, se voit.
 *
 * ── Ce qui est importé, et ce qui ne l'est pas ──
 *
 * Les montants arrivent **figés**, tels que le logiciel précédent les portait. Mais son
 * export ne contient ni le prix d'achat du délégataire ni la marge : ces deux colonnes
 * restent donc vides, et le diront. Elles se rempliront au premier recalcul, une fois les
 * deals rattachés — pas avant, et jamais en inventant une valeur.
 *
 * ── Rejouable ──
 *
 * Un dossier déjà présent (même numéro) est ignoré, pas dupliqué ni écrasé. Tout se joue
 * dans une seule transaction : en cas d'échec, la base revient exactement à son état
 * d'avant. Un import à moitié fait serait pire qu'un import raté.
 */
import fs from 'node:fs'
import { arrondi } from './montants.js'

// ══ Lecture des fichiers ═══════════════════════════════════════

/**
 * ⚠ L'en-tête de l'export COFRAC MENT.
 *
 * Il déclare 65 colonnes ; chaque ligne de données en contient 46. Et le décalage n'est pas
 * en fin de ligne : à partir de la 19ᵉ colonne, chaque étiquette désigne la valeur SUIVANTE.
 * Lire ce fichier par nom de colonne — la façon évidente — importe la date de devis comme
 * date de pose, la référence de facture comme prime, et le montant de TVA comme reste à
 * charge. Rien ne plante : on obtient 1 677 dossiers d'apparence normale et entièrement faux.
 *
 * La preuve du décalage est arithmétique et tient sur une ligne : ce que l'en-tête appelle
 * « Montant reste à charge » vaut 1 524,32, et 27 714,88 + 1 524,32 = 29 239,20 — le TTC.
 * C'est la TVA, décalée d'un rang.
 *
 * L'origine probable : le logiciel émet l'étiquette « Cumac Précaire » ET « Cumac Classique »
 * mais ne sort qu'une seule valeur, celle du régime du dossier. Un en-tête de trop, et tout
 * ce qui suit glisse.
 *
 * On lit donc **par position**, avec la table ci-dessous, et on VÉRIFIE l'alignement sur
 * chaque ligne avant d'écrire quoi que ce soit.
 */
export const COLONNES_COFRAC = [
  'numero_operation', 'installateur_nom', 'installateur_siret',
  'sous_traitant_nom', 'sous_traitant_siret',
  'client_nom', 'client_prenom', 'client_adresse', 'client_cp', 'client_ville',
  'client_tel1', 'client_tel2', 'client_mail', 'client_precarite',
  'fiche', 'precision', 'quantite',
  // Une seule colonne de cumac est émise : celle du régime du dossier.
  'cumac',
  'produit_marque', 'produit_reference', 'produit_epaisseur', 'produit_resistance',
  'fiscal_revenu', 'fiscal_nb_foyer', 'fiscal_nb_personne',
  'avis_num_1', 'avis_ref_1', 'avis_num_2', 'avis_ref_2',
  'avis_num_3', 'avis_ref_3', 'avis_num_4', 'avis_ref_4',
  'prime', 'reference_facture', 'date_devis', 'date_pose',
  'montant_devis_ht', 'montant_facture_ht', 'montant_remise_cee', 'total_remise_mpr',
  'montant_reste_a_charge', 'montant_tva', 'total_ht_facture', 'total_ttc_facture',
  'surface_habitable',
]

/**
 * Vérifie l'alignement par une identité comptable : HT + TVA = TTC.
 *
 * Si la table de positions est juste, l'identité tient sur la quasi-totalité des lignes.
 * Si elle est fausse, elle ne tient sur aucune. C'est un contrôle que le fichier se fait
 * à lui-même — bien plus solide qu'une lecture d'en-tête à laquelle on a déjà vu mentir.
 *
 * @returns {{verifiees:number, coherentes:number, taux:number}}
 */
export function verifierAlignement(lignes) {
  let verifiees = 0
  let coherentes = 0
  for (const l of lignes) {
    const ht = nombre(l.total_ht_facture)
    const tva = nombre(l.montant_tva)
    const ttc = nombre(l.total_ttc_facture)
    if (ht == null || tva == null || ttc == null) continue
    verifiees++
    if (Math.abs(ht + tva - ttc) <= 0.02) coherentes++
  }
  return { verifiees, coherentes, taux: verifiees ? coherentes / verifiees : 0 }
}

/**
 * Les exports sont en ISO-8859-1 avec des fins de ligne Windows.
 * Les lire en UTF-8 transforme silencieusement les accents en caractères de remplacement —
 * et « Saint-Léonard » devient « Saint-L?onard » dans la base, pour toujours.
 *
 * @param {string} chemin
 * @param {string[]|null} positions  noms à donner aux colonnes PAR POSITION.
 *                                   null = on fait confiance à l'en-tête (cas du dépôt et du bilan,
 *                                   dont l'en-tête et les lignes ont le même nombre de champs).
 */
export function lireCsv(chemin, positions = null) {
  const brut = fs.readFileSync(chemin)
  const texte = new TextDecoder('iso-8859-1').decode(brut)
  const lignes = decouperLignes(texte)
  if (lignes.length === 0) return { colonnes: [], lignes: [], entete: [] }

  const entete = lignes[0].map((c) => c.trim())
  const corps = lignes.slice(1).filter((l) => l.some((c) => c.trim() !== ''))
  const colonnes = positions || entete

  return {
    entete,
    colonnes,
    lignes: corps.map((l) => {
      const o = {}
      colonnes.forEach((c, i) => { o[c] = (l[i] ?? '').trim() })
      return o
    }),
  }
}

/** Découpage CSV point-virgule, avec guillemets — un champ peut contenir un retour ligne. */
function decouperLignes(texte) {
  const out = []
  let ligne = []
  let champ = ''
  let dansGuillemets = false

  for (let i = 0; i < texte.length; i++) {
    const c = texte[i]
    if (dansGuillemets) {
      if (c === '"') {
        if (texte[i + 1] === '"') { champ += '"'; i++ } else dansGuillemets = false
      } else champ += c
      continue
    }
    if (c === '"') { dansGuillemets = true; continue }
    if (c === ';') { ligne.push(champ); champ = ''; continue }
    if (c === '\n') { ligne.push(champ); out.push(ligne); ligne = []; champ = ''; continue }
    if (c === '\r') continue
    champ += c
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); out.push(ligne) }
  return out
}

// ══ Conversions ════════════════════════════════════════════════

/** « 115003,8 » → 115003.8. Une valeur illisible renvoie null, jamais 0 : zéro serait un mensonge. */
export function nombre(v) {
  // Le fichier mélange deux notations : « 115003,8 » et « 27 714.88 ». On retire donc
  // les espaces (y compris insécables) AVANT de décider du séparateur décimal.
  const s = String(v ?? '').trim().replace(/[\s\u00a0]/g, '')
  if (s === '') return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** « 16/09/2026 » ou « 2026-09-16 » → « 2026-09-16 ». Refuse une date impossible. */
export function jour(v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  let a, mo, j
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) { [, a, mo, j] = m } else {
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
    if (!m) return null
    ;[, j, mo, a] = m
  }
  const an = +a, mois = +mo, jr = +j
  if (mois < 1 || mois > 12 || jr < 1 || jr > 31) return null
  const d = new Date(Date.UTC(an, mois - 1, jr))
  if (d.getUTCFullYear() !== an || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jr) return null
  return `${an}-${String(mois).padStart(2, '0')}-${String(jr).padStart(2, '0')}`
}

const texte = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }

/**
 * Au-delà de ce prix par MWh cumac, le montant de l'export n'est pas croyable.
 *
 * Pourquoi un seuil, et pourquoi celui-là. Sur les trois familles de fiches majoritaires,
 * la prime observée tient entre 2,40 et 9,20 €/MWh (médiane 4,60) — cohérent avec les
 * grilles de deal relevées, qui vont de 3,50 à 7 €/MWh. Une quatrième famille sort à
 * 619 €/MWh de médiane. Vérification faite sur un dossier dont on connaît la valeur réelle,
 * lue à l'écran : l'export annonce 35 204 698,87 € là où le logiciel affiche 143 108,53 €.
 * Le rapport est exactement 246 — la quantité de l'opération, que l'export écrit par
 * ailleurs « 1 ». Leur export multiplie donc le montant par la quantité et perd la quantité.
 *
 * On ne corrige pas en divisant : la quantité réelle n'est PAS dans le fichier, et la
 * reconstituer serait deviner. On écarte le montant, on garde tout le reste de l'opération,
 * et on le compte pour pouvoir le dire. Une case vide se répare ; un chiffre faux, non.
 *
 * 30 €/MWh — environ quatre fois le haut de la fourchette observée — laisse passer tout ce
 * qui est plausible, y compris les petites opérations au ratio élevé.
 */
export const PRIME_MAX_EUR_PAR_MWH = 30

/** Le montant est-il crédible au regard du volume ? */
export function primeCredible(prime, cumac) {
  if (prime == null || cumac == null || cumac <= 0) return true
  return prime / (cumac / 1000) <= PRIME_MAX_EUR_PAR_MWH
}

/** Le département se déduit du code postal. La Corse a besoin d'un cas à part. */
export function departement(cp) {
  const s = String(cp ?? '').trim()
  if (!/^\d{5}$/.test(s)) return null
  if (s.startsWith('20')) return Number(s) < 20200 ? '2A' : '2B'
  return s.slice(0, 2)
}

/**
 * Secteur et domaine se lisent dans le code de fiche : `AGRI-TH-117` → AGRI, TH.
 * C'est la nomenclature officielle ; l'inventer autrement créerait un second vocabulaire.
 */
export function decomposerCode(code) {
  const m = /^([A-Z]+)-([A-Z]+)-(\d+)/.exec(String(code || '').trim().toUpperCase())
  return m ? { secteur: m[1], domaine: m[2], numero: m[3] } : null
}

// ══ Rattachement des opérations aux dossiers ═══════════════════

/**
 * Le plus long numéro de dossier connu qui préfixe ce numéro d'opération.
 *
 * On part des numéros réellement existants plutôt que d'une règle de découpage : les
 * numéros ont plusieurs formes (`AAA-NNNN-NNNN`, `AAA-NNNN-NNNNN`, `AAA-NNNN-NNNN-NN`),
 * et une règle qui marche sur la première casserait sur les deux autres.
 */
export function rattacher(numeroOperation, dossiersConnus) {
  const n = String(numeroOperation || '').trim()
  if (!n) return null
  if (dossiersConnus.has(n)) return n
  for (let k = n.length - 1; k >= 7; k--) {
    if (n[k] !== '-') continue
    const candidat = n.slice(0, k)
    if (dossiersConnus.has(candidat)) return candidat
  }
  return null
}

/**
 * Index du BILAN par (raison sociale, cumac, fiche) — **uniquement les clés uniques**.
 * Une clé portée par deux lignes est écartée des deux côtés : mieux vaut pas de délégataire
 * qu'un délégataire faux.
 */
export function indexerBilan(lignesBilan) {
  const compte = new Map()
  for (const l of lignesBilan) {
    const k = cleBilan(l['Raison Sociale'], l['Cumac Opération'], l['Operation CEE'])
    compte.set(k, (compte.get(k) || 0) + 1)
  }
  const index = new Map()
  for (const l of lignesBilan) {
    const k = cleBilan(l['Raison Sociale'], l['Cumac Opération'], l['Operation CEE'])
    if (compte.get(k) !== 1) continue
    index.set(k, l)
  }
  return index
}

const cleBilan = (rs, cumac, fiche) =>
  `${String(rs ?? '').trim().toUpperCase()}|${nombre(cumac) ?? ''}|${String(fiche ?? '').trim().toUpperCase()}`

// ══ Import ═════════════════════════════════════════════════════

/**
 * @param {object} db            base ouverte (node:sqlite)
 * @param {object} fichiers      { cofrac, depot, bilan } : chemins des CSV
 * @param {object} options       { uniteId, statutEntreeId, etapeId }
 * @returns rapport détaillé
 */
export function importerPixel(db, fichiers, options = {}) {
  const t0 = Date.now()
  const rapport = {
    lus: { cofrac: 0, depot: 0, bilan: 0 },
    dossiers: { crees: 0, ignores: 0 },
    operations: { creees: 0, orphelines: 0, sansFiche: 0, primesEcartees: 0 },
    primesEcarteesParFiche: {},
    chantiers: 0,
    referentiels: { fiches: 0, installateurs: 0, produits: 0, delegataires: 0 },
    bilan: { rattaches: 0, ambigus: 0 },
    avertissements: [],
    ms: 0,
  }

  const cofrac = lireCsv(fichiers.cofrac, COLONNES_COFRAC)
  const depot = lireCsv(fichiers.depot)
  const bilan = fichiers.bilan ? lireCsv(fichiers.bilan) : { lignes: [] }
  rapport.lus = { cofrac: cofrac.lignes.length, depot: depot.lignes.length, bilan: bilan.lignes.length }

  // ── La garde qui décide si l'on a le droit d'écrire ──
  // L'en-tête du fichier est faux (voir COLONNES_COFRAC). On ne peut donc pas s'y fier pour
  // savoir si notre table de positions est la bonne : on le demande au fichier lui-même, par
  // l'identité HT + TVA = TTC. Si elle ne tient pas, la table a glissé et l'import serait
  // faux SANS jamais lever d'erreur. On refuse alors d'écrire.
  const align = verifierAlignement(cofrac.lignes)
  rapport.alignement = align

  // Deux façons d'échouer, et les deux doivent bloquer.
  //
  // 1. L'identité ne tient pas → la table de positions a glissé.
  // 2. L'identité n'a pu être vérifiée sur AUCUNE ligne → les colonnes de montants ne sont
  //    pas là où on les croit, donc on ne sait rien. C'est exactement ce qui s'est produit
  //    au premier essai : un contrôle qui ne vérifie rien passait pour un contrôle réussi.
  //    Un garde-fou muet est pire que pas de garde-fou : il rassure à tort.
  const couverture = cofrac.lignes.length ? align.verifiees / cofrac.lignes.length : 0
  if (cofrac.lignes.length > 0 && couverture < 0.5) {
    throw new Error(
      `Alignement invérifiable : l'identité HT + TVA = TTC n'a pu être évaluée que sur ` +
      `${align.verifiees}/${cofrac.lignes.length} lignes. Les colonnes de montants ne sont ` +
      `pas à la position attendue — import refusé, base inchangée.`)
  }
  if (align.taux < 0.95) {
    throw new Error(
      `Alignement des colonnes faux : HT + TVA = TTC ne tient que sur ` +
      `${align.coherentes}/${align.verifiees} lignes (${Math.round(align.taux * 100)} %). ` +
      `La structure de l'export a changé — import refusé, base inchangée.`)
  }

  const dossiersConnus = new Set(depot.lignes.map((l) => l['Numéro de dossier']).filter(Boolean))
  const infoDossier = new Map(depot.lignes.map((l) => [l['Numéro de dossier'], l]))
  const indexBilan = indexerBilan(bilan.lignes)
  rapport.bilan.ambigus = bilan.lignes.length - indexBilan.size

  // Regroupement des opérations par dossier, dans l'ordre du fichier.
  const parDossier = new Map()
  for (const op of cofrac.lignes) {
    const num = rattacher(op.numero_operation, dossiersConnus)
    if (!num) { rapport.operations.orphelines++; continue }
    if (!parDossier.has(num)) parDossier.set(num, [])
    parDossier.get(num).push(op)
  }

  const uid = () => crypto.randomUUID()
  const get = (sql, p = []) => db.prepare(sql).get(...p)
  const run = (sql, p = []) => db.prepare(sql).run(...p)

  // ── Caches de référentiel : une entrée créée une seule fois ──
  const cacheFiche = new Map()
  const cacheInstallateur = new Map()
  const cacheProduit = new Map()
  const cacheDelegataire = new Map()

  /**
   * Fiche et version « de reprise ».
   *
   * On ne connaît ni le forfait ni les conditions : la version créée porte donc des
   * coefficients VIDES et le dit dans son motif. Conséquence assumée et voulue : ces
   * opérations gardent les montants repris, et un recalcul donnerait zéro tant que le
   * vrai référentiel n'est pas chargé. C'est la bonne façon d'échouer — visiblement.
   */
  function fiche(code) {
    if (cacheFiche.has(code)) return cacheFiche.get(code)
    let f = get('SELECT id FROM fiche WHERE code = ?', [code])
    if (!f) {
      const d = decomposerCode(code) || { secteur: 'AUTRE', domaine: 'AUTRE' }
      const id = uid()
      run('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
        [id, code, d.secteur, d.domaine, `${code} — libellé à compléter`])
      f = { id }
      rapport.referentiels.fiches++
    }
    let v = get('SELECT id FROM fiche_version WHERE fiche_id = ? ORDER BY date_effet DESC LIMIT 1', [f.id])
    if (!v) {
      const vid = uid()
      run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, motif_fin,
                                      formule_type, unite_variable, coefficients, conditions)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        [vid, f.id, 'REPRISE', '2000-01-01',
         'Version de reprise : forfait et conditions inconnus, aucun recalcul possible.',
         'FORFAIT_PAR_UNITE', 'U', '[]', '[]'])
      v = { id: vid }
    }
    const r = { ficheId: f.id, versionId: v.id }
    cacheFiche.set(code, r)
    return r
  }

  function installateur(raisonSociale, siret) {
    const cle = (siret || raisonSociale || '').trim().toUpperCase()
    if (!cle) return null
    if (cacheInstallateur.has(cle)) return cacheInstallateur.get(cle)
    let i = siret
      ? get('SELECT id FROM installateur_rge WHERE siret = ?', [siret])
      : get('SELECT id FROM installateur_rge WHERE raison_sociale = ?', [raisonSociale])
    if (!i) {
      const id = uid()
      run('INSERT INTO installateur_rge (id, raison_sociale, siret, actif) VALUES (?,?,?,1)',
        [id, raisonSociale || siret, siret])
      i = { id }
      rapport.referentiels.installateurs++
    }
    cacheInstallateur.set(cle, i.id)
    return i.id
  }

  function produit(marque, reference, epaisseur, resistance) {
    const m = texte(marque), r = texte(reference)
    if (!m && !r) return null
    const cle = `${m || ''}|${r || ''}`.toUpperCase()
    if (cacheProduit.has(cle)) return cacheProduit.get(cle)
    let p = get('SELECT id FROM produit WHERE COALESCE(marque,\'\') = ? AND COALESCE(reference,\'\') = ?',
      [m || '', r || ''])
    if (!p) {
      const id = uid()
      const details = [epaisseur ? `épaisseur ${epaisseur}` : null, resistance ? `R = ${resistance}` : null]
        .filter(Boolean).join(', ')
      run('INSERT INTO produit (id, marque, reference, designation, description, actif) VALUES (?,?,?,?,?,1)',
        [id, m, r, [m, r].filter(Boolean).join(' ') || 'Produit repris', details || null])
      p = { id }
      rapport.referentiels.produits++
    }
    cacheProduit.set(cle, p.id)
    return p.id
  }

  /** « ILORAL VISION - TOTALENERGIES » → mandataire ILORAL VISION, obligé TOTALENERGIES. */
  function delegataire(libelle) {
    const l = texte(libelle)
    if (!l) return null
    if (cacheDelegataire.has(l)) return cacheDelegataire.get(l)
    let d = get('SELECT id FROM delegataire WHERE nom = ? OR (nom || \' - \' || COALESCE(oblige, \'\')) = ?', [l, l])
    if (!d) {
      const sep = l.indexOf(' - ')
      const nom = sep > 0 ? l.slice(0, sep).trim() : l
      const oblige = sep > 0 ? l.slice(sep + 3).trim() : null
      const id = uid()
      run('INSERT INTO delegataire (id, nom, oblige, actif) VALUES (?,?,?,1)', [id, nom, oblige])
      d = { id }
      rapport.referentiels.delegataires++
    }
    cacheDelegataire.set(l, d.id)
    return d.id
  }

  // ── Transaction unique ──
  db.exec('BEGIN')
  try {
    for (const [numero, ops] of parDossier) {
      if (get('SELECT id FROM dossier WHERE numero = ?', [numero])) {
        rapport.dossiers.ignores++
        continue
      }

      const tete = ops[0]
      const info = infoDossier.get(numero) || {}

      // Bénéficiaire : la raison sociale vient de la liste des dossiers, le contact de COFRAC.
      const benefId = uid()
      run(`INSERT INTO beneficiaire (id, type, raison_sociale, nom, prenom, email, telephone, regime_revenu)
           VALUES (?,?,?,?,?,?,?,?)`,
        [benefId, 'SOCIETE', texte(info['Raison Sociale']) || texte(tete.client_nom),
         texte(tete.client_nom), texte(tete.client_prenom),
         texte(tete.client_mail),
         texte(tete.client_tel1) || texte(tete.client_tel2),
         String(tete.client_precarite || '').toUpperCase().startsWith('PREC') ? 'PRECAIRE' : 'CLASSIQUE'])

      // Un site par adresse distincte du dossier — c'est ce qui fait les chantiers multiples.
      const sitesParAdresse = new Map()
      const siteDe = (op) => {
        const cp = texte(op.client_cp) || ''
        const cle = `${texte(op.client_adresse) || ''}|${cp}|${texte(op.client_ville) || ''}`.toUpperCase()
        if (sitesParAdresse.has(cle)) return sitesParAdresse.get(cle)
        const id = uid()
        run(`INSERT INTO site (id, adresse, code_postal, ville, departement, secteur_activite, surface, qpv)
             VALUES (?,?,?,?,?,?,?,0)`,
          [id, texte(op.client_adresse) || '—', cp || '—', texte(op.client_ville) || '—',
           departement(cp), null,
           nombre(op.surface_habitable)])
        sitesParAdresse.set(cle, id)
        return id
      }

      const siteprincipalId = siteDe(tete)

      // La fiche du dossier suit son opération principale.
      const codeTete = texte(tete.fiche)
      const fTete = fiche(codeTete || 'SANS-CODE-REPRISE')

      const dossierId = uid()
      const bilanTete = indexBilan.get(cleBilan(info['Raison Sociale'], tete.cumac, codeTete))
      if (bilanTete) rapport.bilan.rattaches++

      run(`INSERT INTO dossier (id, numero, ref_externe, unite_affaire_id, beneficiaire_id, site_id,
                                fiche_id, fiche_version_id, delegataire_id, installateur_id,
                                charte, avec_mpr, quantite, source, statut_origine,
                                statut_dossier_id, etape_id, date_pose, num_devis, date_proposition)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [dossierId, numero, texte(tete.numero_operation), options.uniteId ?? null, benefId, siteprincipalId,
         fTete.ficheId, fTete.versionId,
         bilanTete ? delegataire(bilanTete['Délégataire CEE']) : null,
         installateur(tete.installateur_nom, tete.installateur_siret),
         'HORS_CDP', 0, nombre(tete.quantite) ?? 0, 'Reprise',
         bilanTete ? texte(bilanTete['Statut']) : null,
         options.statutEntreeId ?? null, options.etapeId ?? null,
         jour(tete.date_pose), texte(tete.reference_facture), jour(tete.date_devis)])

      rapport.dossiers.crees++

      // ── Chantiers et opérations ──
      const chantiersCrees = new Map()
      const chantierDe = (siteId, principal, ordre) => {
        if (chantiersCrees.has(siteId)) return chantiersCrees.get(siteId)
        const id = uid()
        run(`INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
             VALUES (?,?,?,?,?,?)`,
          [id, dossierId, siteId, principal ? 1 : 0,
           principal ? 'Chantier principal' : `Chantier ${ordre}`, ordre])
        chantiersCrees.set(siteId, id)
        rapport.chantiers++
        return id
      }
      chantierDe(siteprincipalId, true, 1)

      ops.forEach((op, i) => {
        const siteId = siteDe(op)
        const chantierId = chantierDe(siteId, false, chantiersCrees.size + 1)

        const code = texte(op.fiche)
        if (!code) rapport.operations.sansFiche++
        const f = fiche(code || 'SANS-CODE-REPRISE')

        const quantite = nombre(op.quantite) ?? 0
        const devisHt = nombre(op.montant_devis_ht)
        // Le prix unitaire n'est pas exporté : on le déduit du devis, et seulement
        // si la quantité le permet. Diviser par zéro donnerait un infini stocké en base.
        const puv = devisHt != null && quantite > 0 ? Math.round((devisHt / quantite) * 100) / 100 : null

        const cumac = nombre(op.cumac)
        let prime = nombre(op.prime) ?? nombre(op.montant_remise_cee)
        if (!primeCredible(prime, cumac)) {
          rapport.operations.primesEcartees++
          const k = code || '(sans code)'
          rapport.primesEcarteesParFiche[k] = (rapport.primesEcarteesParFiche[k] || 0) + 1
          prime = null
        }

        run(`INSERT INTO operation (id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id,
                                    charte, produit_id, installateur_id, quantite, unite, puv,
                                    cout_pose, taux_apporteur, volume_cumac, prime_beneficiaire, date_calcul)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?,?)`,
          [uid(), dossierId, chantierId, i + 1, f.ficheId, f.versionId, 'HORS_CDP',
           produit(op.produit_marque, op.produit_reference,
                   op.produit_epaisseur, op.produit_resistance),
           installateur(op.installateur_nom, op.installateur_siret),
           quantite, 'U', puv,
           cumac, prime,
           // Figée : ces montants viennent du logiciel précédent et ne doivent pas bouger.
           // `prime_delegataire` et `marge_nette` restent nulles — l'export ne les contient pas.
           cumac != null ? new Date().toISOString() : null])

        rapport.operations.creees++
      })
    }

    // ── Projection des totaux sur les dossiers ──
    // Même règle que lib/operations.js : le total d'un dossier est la somme de ses
    // opérations FIGÉES, et d'elles seules. On l'applique ici en SQL plutôt que ligne à
    // ligne — 1 677 dossiers, une seule instruction — mais c'est bien la même règle, et
    // un contrôle la rejoue après coup pour s'assurer qu'elles ne divergent pas.
    //
    // L'arrondi n'est pas cosmétique, et il se fait en JS et non en SQL. Additionner des
    // euros en virgule flottante donne 73 432,79999999999 là où la projection arrondit au
    // centime ; et `ROUND()` de SQLite ne départage pas les demis comme `Math.round`. Tant
    // que les deux côtés n'arrondissaient pas avec la MÊME fonction, chaque resynchronisation
    // déplaçait des totaux d'un centime et le contrôle de stabilité restait rouge — donc
    // finissait par n'être plus lu. On appelle donc ici l'`arrondi` de la projection.
    //
    // Les montants des OPÉRATIONS, eux, ne sont pas touchés : ils viennent de l'export, qui
    // stocke des primes au dixième de centime (1 605,5585 €). Les arrondir éloignerait la
    // plateforme de sa source. On n'arrondit que ce qu'on calcule soi-même.
    db.exec(`
      UPDATE dossier SET
        date_calcul = (SELECT MAX(o.date_calcul) FROM operation o
                       WHERE o.dossier_id = dossier.id AND o.date_calcul IS NOT NULL)
      WHERE EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = dossier.id)`)

    const TOTAUX = ['volume_cumac', 'prime_beneficiaire', 'cout_pose']
    const majTotaux = db.prepare(
      `UPDATE dossier SET ${TOTAUX.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
    // `SUM` ignore les valeurs vides et renvoie NULL si aucune ligne n'est renseignée :
    // c'est la règle de la projection — on n'invente pas un 0 là où la donnée manque.
    for (const l of db.prepare(`
      SELECT d.id, ${TOTAUX.map((c) => `(SELECT SUM(o.${c}) FROM operation o
         WHERE o.dossier_id = d.id AND o.date_calcul IS NOT NULL) AS ${c}`).join(', ')}
      FROM dossier d
      WHERE EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = d.id)`).all()) {
      majTotaux.run(...TOTAUX.map((c) => (l[c] == null ? null : arrondi(l[c]))), l.id)
    }

    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* transaction déjà refermée */ }
    throw new Error(`Import interrompu, base inchangée : ${e.message}`)
  }

  if (rapport.operations.orphelines > 0) {
    rapport.avertissements.push(
      `${rapport.operations.orphelines} opération(s) n'ont pu être rattachées à aucun dossier connu.`)
  }
  if (rapport.operations.sansFiche > 0) {
    rapport.avertissements.push(
      `${rapport.operations.sansFiche} opération(s) sans code de fiche : rattachées à une fiche « SANS-CODE-REPRISE » à corriger.`)
  }
  if (rapport.operations.primesEcartees > 0) {
    const detail = Object.entries(rapport.primesEcarteesParFiche)
      .sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f} : ${n}`).join(', ')
    rapport.avertissements.push(
      `${rapport.operations.primesEcartees} montant(s) de prime écarté(s) comme non crédibles ` +
      `(au-delà de ${PRIME_MAX_EUR_PAR_MWH} €/MWh cumac) — ${detail}. ` +
      `L'opération est importée, seul le montant reste vide.`)
  }
  rapport.avertissements.push(
    'Le prix d\'achat délégataire et la marge ne figurent dans aucun export : ces colonnes restent vides ' +
    'jusqu\'au premier recalcul, une fois les deals rattachés.')

  rapport.ms = Date.now() - t0
  return rapport
}
