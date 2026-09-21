/**
 * Les contrôles de cohérence d'un dossier avant dépôt.
 *
 * ── Pourquoi des règles et pas une IA ──
 *
 * « La date de pose est-elle postérieure au devis ? », « le RGE était-il valide ce jour-là ? »,
 * « la fiche est-elle abrogée à cette date ? » sont des questions à réponse certaine. Une
 * règle y répond toujours pareil, explique sa décision, ne coûte rien et ne fait sortir
 * aucune donnée de chez vous. Un modèle y répondrait presque toujours pareil — et c'est le
 * « presque » qui se retrouve dans un dépôt rejeté.
 *
 * L'IA garde son intérêt pour ce qu'une règle ne sait pas faire : lire une attestation
 * scannée et dire si elle est signée. Ce module ne fait pas ça, et ne prétend pas le faire.
 *
 * ── Trois niveaux, et ce qu'ils engagent ──
 *
 * - `BLOQUANT` : le dépôt sera rejeté, ou la prime n'est pas due. On ne dépose pas.
 * - `AVERTISSEMENT` : c'est probablement une erreur, mais un cas légitime existe.
 * - `INFORMATION` : à savoir, sans action obligatoire.
 *
 * Le module **ne corrige rien et ne bloque rien**. Il constate et explique. Décider revient
 * à la personne qui dépose : un contrôle qui bloque de lui-même finit par être contourné,
 * et c'est alors tout le contrôle qu'on perd.
 *
 * ── Ce que chaque anomalie doit porter ──
 *
 * Un code stable (pour compter et filtrer), un niveau, une phrase qui dit ce qui ne va pas,
 * et **de quoi le vérifier soi-même** : les valeurs en cause. « Incohérence de dates » est
 * inutile ; « pose le 12/03, devis le 20/04 » se vérifie en trois secondes.
 */
import { CODES_ZONES, CODES_AGES, CODES_CHAUFFAGE } from './referentiels-site.js'

/** Les pièces qu'un dossier doit porter pour être déposable. */
export const PIECES_ATTENDUES = [
  { code: 'AH', libelle: "attestation sur l'honneur", niveau: 'BLOQUANT' },
  { code: 'DEVIS', libelle: 'devis signé', niveau: 'BLOQUANT' },
  { code: 'FACTURE', libelle: 'facture', niveau: 'BLOQUANT' },
  { code: 'AFT', libelle: 'attestation de fin de travaux', niveau: 'AVERTISSEMENT' },
  { code: 'RGE', libelle: 'certificat RGE de l\'installateur', niveau: 'AVERTISSEMENT' },
]

/** Au-delà de ce ratio, une prime est jugée invraisemblable au regard du volume. */
export const PRIME_MAX_EUR_PAR_MWH = 30

const jour = (v) => (v ? String(v).slice(0, 10) : null)
const avant = (a, b) => a && b && jour(a) < jour(b)

/**
 * Passe un dossier au crible.
 *
 * @param {object} db     base ouverte
 * @param {string} id     identifiant du dossier
 * @returns {{numero, anomalies: Array, bloquantes: number}}
 */
export function controlerDossier(db, id) {
  const un = (s, p = []) => db.prepare(s).get(...p)
  const tous = (s, p = []) => db.prepare(s).all(...p)

  const d = un(`SELECT d.*, s.zone_climatique, s.age_batiment_tranche, s.type_chauffage,
                       s.code_postal, i.raison_sociale AS installateur_nom
                FROM dossier d
                LEFT JOIN site s ON s.id = d.site_id
                LEFT JOIN installateur_rge i ON i.id = d.installateur_id
                WHERE d.id = ?`, [id])
  if (!d) return { numero: null, anomalies: [{ code: 'DOSSIER_INTROUVABLE', niveau: 'BLOQUANT', message: 'Dossier introuvable.' }], bloquantes: 1 }

  const a = []
  const signaler = (code, niveau, message, detail = null) => a.push({ code, niveau, message, detail })

  // ── 1. Chronologie ──
  // L'ordre devis → pose → achèvement → contrôle n'est pas une convention interne : une
  // facture antérieure au devis, c'est un dossier qu'un contrôleur retourne sans le lire.
  const etapes = [
    ['date_signature', 'signature du devis'],
    ['date_pose', 'pose'],
    ['date_achevement', 'achèvement'],
    ['date_controle', 'contrôle'],
    ['date_depot', 'dépôt'],
  ].filter(([c]) => d[c])
  for (let i = 1; i < etapes.length; i++) {
    const [cPrec, lPrec] = etapes[i - 1]
    const [cSuiv, lSuiv] = etapes[i]
    if (avant(d[cSuiv], d[cPrec])) {
      signaler('CHRONOLOGIE', 'BLOQUANT',
        `La ${lSuiv} précède la ${lPrec}.`,
        `${lSuiv} le ${jour(d[cSuiv])}, ${lPrec} le ${jour(d[cPrec])}`)
    }
  }
  if (d.date_proposition && d.date_signature && avant(d.date_signature, d.date_proposition)) {
    signaler('DEVIS_SIGNE_AVANT_PROPOSITION', 'BLOQUANT',
      'Le devis est signé avant d\'avoir été proposé.',
      `signature le ${jour(d.date_signature)}, proposition le ${jour(d.date_proposition)}`)
  }

  // ── 2. La fiche est-elle applicable à la date de l'opération ? ──
  // C'est le contrôle qui manquait en juin 2026 : AGRI-TH-117 a été abrogée sans que rien
  // ne le signale sur les dossiers en cours.
  const reference = jour(d.date_engagement) || jour(d.date_signature) || jour(d.date_pose)
  for (const o of tous(`SELECT o.id, o.date_calcul, f.code, fv.version, fv.date_effet, fv.date_fin, fv.motif_fin
                        FROM operation o
                        JOIN fiche f ON f.id = o.fiche_id
                        JOIN fiche_version fv ON fv.id = o.fiche_version_id
                        WHERE o.dossier_id = ?`, [id])) {
    if (o.code === 'SANS-CODE-REPRISE') {
      signaler('FICHE_NON_IDENTIFIEE', 'BLOQUANT',
        'Une opération n\'a pas de code de fiche : elle ne peut pas être déposée.',
        'code « SANS-CODE-REPRISE », à reclasser')
      continue
    }
    if (!reference) {
      signaler('DATE_MANQUANTE', 'AVERTISSEMENT',
        `Aucune date d'engagement, de signature ni de pose : l'applicabilité de la fiche ${o.code} ne peut pas être vérifiée.`)
      continue
    }
    if (o.date_fin && jour(o.date_fin) <= reference) {
      const abrogee = /abrog/i.test(o.motif_fin || '')
      signaler(abrogee ? 'FICHE_ABROGEE' : 'FICHE_VERSION_PERIMEE',
        abrogee ? 'BLOQUANT' : 'AVERTISSEMENT',
        abrogee
          ? `La fiche ${o.code} est abrogée depuis le ${jour(o.date_fin)}.`
          : `La version ${o.version} de la fiche ${o.code} n'était plus applicable le ${reference}.`,
        `opération datée du ${reference}, version valable jusqu'au ${jour(o.date_fin)}`)
    }
    if (o.date_effet && reference < jour(o.date_effet)) {
      signaler('FICHE_PAS_ENCORE_APPLICABLE', 'AVERTISSEMENT',
        `La version ${o.version} de la fiche ${o.code} n'était pas encore applicable le ${reference}.`,
        `entrée en vigueur le ${jour(o.date_effet)}`)
    }
  }

  // ── 3. Le RGE de l'installateur couvrait-il la date des travaux ? ──
  const dateTravaux = jour(d.date_pose) || reference
  if (d.installateur_id && dateTravaux) {
    const certs = tous('SELECT libelle, numero, date_debut, date_fin FROM certification_rge WHERE installateur_id = ?',
      [d.installateur_id])
    if (certs.length === 0) {
      signaler('RGE_ABSENT', 'AVERTISSEMENT',
        `Aucune certification RGE enregistrée pour ${d.installateur_nom || 'l\'installateur'}.`)
    } else {
      const couvrante = certs.find((c) =>
        (!c.date_debut || jour(c.date_debut) <= dateTravaux) &&
        (!c.date_fin || dateTravaux <= jour(c.date_fin)))
      if (!couvrante) {
        const derniere = certs.map((c) => jour(c.date_fin)).filter(Boolean).sort().at(-1)
        signaler('RGE_PERIME', 'BLOQUANT',
          `Aucune certification RGE de ${d.installateur_nom || 'l\'installateur'} ne couvre le ${dateTravaux}.`,
          derniere ? `dernière validité connue jusqu'au ${derniere}` : 'aucune date de validité renseignée')
      }
    }
  }

  // ── 4. Vraisemblance des montants ──
  // Le rapport prime/volume est le contrôle qui a révélé les montants ×246 dans les exports
  // de l'ancien logiciel. Un écart d'un facteur dix ne se voit pas à l'œil sur une ligne.
  if (d.volume_cumac > 0 && d.prime_beneficiaire != null) {
    const ratio = d.prime_beneficiaire / (d.volume_cumac / 1000)
    if (ratio > PRIME_MAX_EUR_PAR_MWH) {
      signaler('PRIME_INVRAISEMBLABLE', 'BLOQUANT',
        `La prime représente ${ratio.toFixed(0)} €/MWh cumac, au-delà du plafond de vraisemblance de ${PRIME_MAX_EUR_PAR_MWH}.`,
        `${d.prime_beneficiaire} € pour ${d.volume_cumac} kWh cumac`)
    }
  }
  if (d.volume_cumac != null && d.volume_cumac <= 0) {
    signaler('VOLUME_NUL', 'BLOQUANT', 'Le volume cumac du dossier est nul ou négatif.',
      `${d.volume_cumac} kWh cumac`)
  }

  // Le total du dossier doit être la somme de ses opérations figées — c'est la règle de gel.
  const somme = un(`SELECT ROUND(SUM(volume_cumac), 2) v FROM operation
                    WHERE dossier_id = ? AND date_calcul IS NOT NULL`, [id]).v
  if (somme != null && d.volume_cumac != null && Math.abs(somme - d.volume_cumac) > 0.5) {
    signaler('TOTAL_DESYNCHRONISE', 'BLOQUANT',
      'Le total du dossier ne correspond pas à la somme de ses opérations figées.',
      `dossier ${d.volume_cumac}, somme des opérations ${somme}`)
  }

  // ── 5. Données du site qui conditionnent l'éligibilité ──
  for (const [champ, liste, libelle] of [
    ['zone_climatique', CODES_ZONES, 'La zone climatique'],
    ['age_batiment_tranche', CODES_AGES, "L'âge du bâtiment"],
    ['type_chauffage', CODES_CHAUFFAGE, 'Le type de chauffage'],
  ]) {
    const v = d[champ]
    if (v == null || v === '') {
      signaler('SITE_INCOMPLET', 'AVERTISSEMENT',
        `${libelle} du site n'est pas renseigné — cette donnée conditionne l'éligibilité de plusieurs fiches.`,
        champ)
    } else if (!liste.includes(v)) {
      signaler('SITE_VALEUR_HORS_LISTE', 'BLOQUANT',
        `${libelle} porte une valeur hors référentiel.`, `valeur « ${v} »`)
    }
  }

  // ── 6. Pièces du dossier ──
  const presentes = new Set(tous(`SELECT DISTINCT t.code FROM document_dossier dd
                                  JOIN type_document t ON t.id = dd.type_document_id
                                  WHERE dd.dossier_id = ?`, [id]).map((r) => r.code))
  for (const p of PIECES_ATTENDUES) {
    if (!presentes.has(p.code)) {
      signaler('PIECE_MANQUANTE', p.niveau, `Pièce absente : ${p.libelle}.`, `type ${p.code}`)
    }
  }

  // ── 7. Contrôle COFRAC, quand il est requis ──
  const ctrl = un('SELECT resultat, date FROM controle WHERE dossier_id = ? ORDER BY date DESC LIMIT 1', [id])
  if (ctrl && /non.?satisfaisant|negatif|négatif/i.test(ctrl.resultat || '')) {
    signaler('CONTROLE_NEGATIF', 'BLOQUANT',
      'Le dernier contrôle est non satisfaisant.', `${ctrl.resultat} le ${jour(ctrl.date)}`)
  }

  // ── 8. Gel ──
  if (!d.date_calcul) {
    signaler('NON_FIGE', 'AVERTISSEMENT',
      "Le dossier n'est pas valorisé : ses montants ne sont pas figés.")
  }

  // Plusieurs opérations d'un même dossier produisent souvent l'anomalie identique, mot
  // pour mot. La répéter ne dit rien de plus et noie les autres : on la compte.
  const vues = new Map()
  for (const an of a) {
    const cle = `${an.code}|${an.message}|${an.detail ?? ''}`
    if (vues.has(cle)) { vues.get(cle).occurrences++ ; continue }
    vues.set(cle, { ...an, occurrences: 1 })
  }
  const uniques = [...vues.values()]

  return {
    numero: d.numero,
    anomalies: uniques,
    bloquantes: uniques.filter((x) => x.niveau === 'BLOQUANT').length,
  }
}

/** Passe au crible un ensemble de dossiers et agrège. */
export function controlerLot(db, ids) {
  const resultats = ids.map((id) => ({ id, ...controlerDossier(db, id) }))
  const parCode = {}
  for (const r of resultats) {
    for (const an of r.anomalies) {
      parCode[an.code] = parCode[an.code] || { niveau: an.niveau, n: 0, exemples: [] }
      parCode[an.code].n++
      if (parCode[an.code].exemples.length < 3) {
        parCode[an.code].exemples.push(`${r.numero} — ${an.detail || an.message}`)
      }
    }
  }
  return {
    dossiers: resultats.length,
    deposables: resultats.filter((r) => r.bloquantes === 0).length,
    bloques: resultats.filter((r) => r.bloquantes > 0).length,
    parCode,
    resultats,
  }
}
