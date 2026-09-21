/**
 * Moteur de calcul des kWh cumac.
 *
 * Principe : la formule n'est pas codée en dur, elle est décrite en données dans
 * fiche_version.coefficients. Ajouter une fiche ou appliquer un arrêté ne demande
 * donc pas de redéploiement — c'est exactement ce que ni Pixel ni beTool ne font.
 *
 * formule_type :
 *   FORFAIT_PAR_UNITE  cumac = coefficient × quantité   (ex. kWh cumac/W pour l'éclairage)
 *   FORFAIT_PAR_M2     cumac = coefficient × surface
 *   FORFAIT_FIXE       cumac = coefficient
 */

/** Sélectionne le coefficient dont tous les critères correspondent au contexte. */
/**
 * Le barème d'une fiche, sous la forme que le moteur sait lire.
 *
 * ── Pourquoi cette vérification existe ──
 *
 * Le référentiel officiel a été chargé avec les barèmes écrits en OBJET imbriqué
 * (`{"forfait": 710}`, `{"irc_inferieur_90": {"HOTELLERIE": {...}}}`), alors que le moteur
 * attend un TABLEAU de `{criteres, valeur}`. Résultat : `coefficients.filter is not a
 * function` — le calcul plantait sur les quatre fiches, et personne ne l'avait vu parce
 * que les dossiers repris portaient des montants figés qu'on ne recalculait jamais.
 *
 * Le premier dossier créé à la main aurait fait tomber l'écran. D'où deux décisions :
 * le référentiel est réécrit au bon format, ET le moteur refuse désormais proprement au
 * lieu de lever une exception. Une fiche mal formée doit donner « non calculable, voici
 * pourquoi », jamais une page blanche.
 */
/**
 * Les conditions d'une fiche, ramenées à une liste affichable.
 *
 * ── Pourquoi cette fonction existe ──
 *
 * Le référentiel stocke les conditions sous DEUX formes selon la fiche : un tableau de
 * `{code, libelle}` pour celles qui ont été ressaisies à la main, un objet
 * `{cle: valeur}` pour toutes les autres. La fiche du dossier appelait `.map()` dessus :
 * sur une fiche de la seconde famille — c'est-à-dire la plupart — la page entière tombait
 * en erreur 500, sans rien dire de ce qui manquait.
 *
 * On accepte donc les deux formes, et une clé inconnue devient une ligne lisible plutôt
 * qu'une exception. Une condition mal rangée doit gêner la lecture, pas fermer le dossier.
 */
export function conditionsLisibles(brut) {
  let v = brut
  if (typeof v === 'string') {
    try { v = JSON.parse(v || '[]') } catch { return [] }
  }
  if (!v) return []

  if (Array.isArray(v)) {
    return v
      .map((c, i) => (c && typeof c === 'object')
        ? { code: c.code || `c${i}`, libelle: c.libelle || c.code || String(c) }
        : { code: `c${i}`, libelle: String(c) })
      .filter((c) => c.libelle)
  }

  if (typeof v === 'object') {
    return Object.entries(v)
      // Les clés commençant par « _ » sont des notes internes du référentiel, pas des
      // conditions opposables : elles n'ont rien à faire dans la liste montrée au gérant.
      .filter(([cle]) => !cle.startsWith('_'))
      .map(([cle, valeur]) => ({
        code: cle,
        libelle: `${cle.replace(/_/g, ' ')} : ${
          Array.isArray(valeur) ? valeur.join(', ') : String(valeur)}`,
      }))
  }

  return []
}

export function baremeLisible(coefficients) {
  if (Array.isArray(coefficients)) return { ok: true, bareme: coefficients }
  if (coefficients && typeof coefficients === 'object') {
    return {
      ok: false,
      motif: 'Le barème de cette fiche n\'est pas au format attendu (tableau de critères). '
        + 'Il doit être rechargé depuis le référentiel.',
    }
  }
  return { ok: false, motif: 'Cette fiche ne porte aucun barème.' }
}

export function choisirCoefficient(coefficients, contexte) {
  const lisible = baremeLisible(coefficients)
  if (!lisible.ok) return null
  const candidats = lisible.bareme.filter((c) => {
    const criteres = c.criteres || {}
    return Object.entries(criteres).every(([cle, valeur]) => {
      if (valeur === null || valeur === undefined || valeur === '*') return true
      return String(contexte[cle] ?? '') === String(valeur)
    })
  })
  if (candidats.length === 0) return null
  // Le plus spécifique gagne : celui qui contraint le plus de critères.
  candidats.sort((a, b) => Object.keys(b.criteres || {}).length - Object.keys(a.criteres || {}).length)
  return candidats[0]
}

export function calculerCumac({ ficheVersion, quantite, contexte = {} }) {
  // Un barème illisible ne doit JAMAIS lever d'exception : l'écran d'un dossier afficherait
  // une page blanche, et la cause — un référentiel mal formé — serait introuvable.
  let coefficients
  try {
    coefficients = JSON.parse(ficheVersion.coefficients || '[]')
  } catch {
    return { cumac: 0, coefficient: null, complet: false,
      detail: 'Le barème de cette fiche est illisible (JSON invalide).' }
  }

  const lisible = baremeLisible(coefficients)
  if (!lisible.ok) {
    return { cumac: 0, coefficient: null, complet: false, detail: lisible.motif }
  }

  const coef = choisirCoefficient(coefficients, contexte)

  if (!coef) {
    // On dit CE QUI manque, pas seulement que ça a raté. Les critères attendus par la
    // fiche sont connus : les lister épargne une demi-heure de recherche.
    const attendus = [...new Set(lisible.bareme.flatMap((c) => Object.keys(c.criteres || {})))]
    return {
      cumac: 0,
      coefficient: null,
      complet: false,
      detail: attendus.length
        ? `Aucun barème ne correspond. Cette fiche distingue : ${attendus.join(', ')}. `
          + `Reçu : ${attendus.map((a) => `${a}=${contexte[a] ?? '—'}`).join(', ')}.`
        : 'Aucun coefficient ne correspond au contexte.',
      criteresAttendus: attendus,
    }
  }

  let cumac = 0
  switch (ficheVersion.formule_type) {
    case 'FORFAIT_FIXE':
      cumac = coef.valeur
      break
    case 'FORFAIT_PAR_M2':
    case 'FORFAIT_PAR_UNITE':
    default:
      cumac = coef.valeur * (Number(quantite) || 0)
  }

  return {
    cumac: Math.round(cumac),
    coefficient: coef.valeur,
    detail: `${coef.valeur} kWh cumac/${ficheVersion.unite_variable || 'unité'} × ${quantite} ${ficheVersion.unite_variable || ''}`.trim(),
    complet: true,
  }
}

/**
 * Vérifie qu'une version de fiche est applicable à une date d'engagement donnée.
 * C'est le contrôle que personne ne fait et qui fait rejeter des dossiers entiers :
 * une fiche supprimée par arrêté ne couvre pas un devis signé après sa date d'effet.
 */
export function ficheApplicable(ficheVersion, dateEngagement) {
  const d = new Date(dateEngagement)
  const debut = new Date(ficheVersion.date_effet)
  const fin = ficheVersion.date_fin ? new Date(ficheVersion.date_fin) : null

  if (d < debut) {
    return { applicable: false, motif: `La version ${ficheVersion.version} ne prend effet que le ${debut.toLocaleDateString('fr-FR')}.` }
  }
  if (fin && d >= fin) {
    return {
      applicable: false,
      motif: `Fiche non applicable depuis le ${fin.toLocaleDateString('fr-FR')}${ficheVersion.arrete_reference ? ` (${ficheVersion.arrete_reference})` : ''}.`,
      supprimee: ficheVersion.motif_fin === 'suppression',
    }
  }
  return { applicable: true }
}
