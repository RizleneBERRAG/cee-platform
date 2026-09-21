/**
 * Moteur de valorisation et de marge.
 *
 * Trois régimes (grande précarité / précaire / classique), trois parties (délégataire /
 * bénéficiaire / installateur), chacune déclinée avec et sans MaPrimeRénov'. Les ratios
 * sont exprimés en €/MWh cumac.
 *
 * ── Comment les trois lignes se combinent : c'est le contrat qui le dit ──
 *
 * Il n'y a pas de règle universelle, et les douze contrats relevés dans l'ancien logiciel
 * l'ont montré : sur onze d'entre eux, « prime cédée » + « commission installateur »
 * dépasse ce que verse le délégataire. Les deux lectures existent donc pour de bon —
 * soit les deux lignes se cumulent, soit elles sont deux tarifs au choix selon qui touche
 * la prime. Chaque contrat porte désormais son mode (`mode_reversement`).
 *
 * **Tant qu'un contrat n'a pas de mode, aucune marge n'est calculée sur lui.** La fonction
 * renvoie `indetermine: true` et des montants à `null`, jamais à zéro. C'est le point
 * important : une marge fausse sur tout un portefeuille ne se voit pas, alors qu'une marge
 * absente se voit immédiatement. Le doute doit coûter un écran vide, pas un chiffre faux.
 *
 * Règle d'or : le résultat est FIGÉ sur le dossier à la date de calcul.
 * Modifier un deal ne recalcule jamais les dossiers existants — il faut une action
 * explicite de recalcul, dossier par dossier.
 */

/** Les façons dont les trois lignes d'un contrat se combinent. */
export const MODES_REVERSEMENT = [
  {
    code: 'CUMULE',
    libelle: 'Cumulés',
    aide: 'Le bénéficiaire ET l\'installateur sont payés. La marge est ce qui reste : '
      + 'versé par le délégataire − prime cédée − commission installateur.',
  },
  {
    code: 'ALTERNATIF',
    libelle: 'Au choix, selon qui touche la prime',
    aide: 'Une seule des deux lignes s\'applique par dossier : celle du bénéficiaire, ou '
      + 'celle de l\'installateur. La marge est le versement du délégataire moins cette ligne.',
  },
]

export const LIBELLES_MODE = Object.fromEntries(MODES_REVERSEMENT.map((m) => [m.code, m.libelle]))

const CLES = {
  GRANDE_PRECARITE: {
    sansMpr: { deleg: 'r_deleg_grande_precarite_sans_mpr', cede: 'r_cede_grande_precarite_sans_mpr', garde: 'r_garde_grande_precarite_sans_mpr' },
    avecMpr: { deleg: 'r_deleg_grande_precarite_avec_mpr', cede: 'r_cede_grande_precarite_avec_mpr', garde: 'r_garde_grande_precarite_avec_mpr' },
  },
  PRECAIRE: {
    sansMpr: { deleg: 'r_deleg_precaire_sans_mpr', cede: 'r_cede_precaire_sans_mpr', garde: 'r_garde_precaire_sans_mpr' },
    avecMpr: { deleg: 'r_deleg_precaire_avec_mpr', cede: 'r_cede_precaire_avec_mpr', garde: 'r_garde_precaire_avec_mpr' },
  },
  CLASSIQUE: {
    sansMpr: { deleg: 'r_deleg_classique_sans_mpr', cede: 'r_cede_classique_sans_mpr', garde: 'r_garde_classique_sans_mpr' },
    avecMpr: { deleg: 'r_deleg_classique_avec_mpr', cede: 'r_cede_classique_avec_mpr', garde: 'r_garde_classique_avec_mpr' },
  },
}

export function ratiosApplicables(deal, { regime, avecMpr }) {
  const bloc = CLES[regime] || CLES.CLASSIQUE
  const cles = avecMpr ? bloc.avecMpr : bloc.sansMpr
  // `null` reste `null` : une case vide veut dire « tarif non renseigné », pas « gratuit ».
  const lu = (k) => (deal[k] === null || deal[k] === undefined || deal[k] === '' ? null : Number(deal[k]))
  return {
    delegataire: lu(cles.deleg),
    cedeBeneficiaire: lu(cles.cede),
    gardeInstallateur: lu(cles.garde),
    cles,
  }
}

export function calculerValorisation({
  cumac, deal, regime = 'CLASSIQUE', avecMpr = false, coutPose = 0, tauxApporteur = 0,
  destinatairePrime = null,
}) {
  const mwh = (Number(cumac) || 0) / 1000
  const r = ratiosApplicables(deal, { regime, avecMpr })
  const mode = deal?.mode_reversement || null

  const commun = { mwh, regime, avecMpr, ratios: r, mode }

  // ── Les deux refus de calculer ──
  //
  // Ni l'un ni l'autre n'est un incident : ce sont deux façons de dire « on ne sait pas
  // encore ». Renvoyer 0 € de marge serait un chiffre, et un chiffre se croit.
  if (!mode) {
    return {
      ...commun, indetermine: true,
      motif: 'Le mode de reversement de ce contrat n\'est pas choisi : la marge ne peut pas être calculée.',
      caDelegataire: null, primeBeneficiaire: null, commissionInstallateur: null,
      commissionApporteur: null, coutPose: arrondi(coutPose),
      margeBrute: null, margeNette: null, tauxMarge: null,
    }
  }
  if (r.delegataire === null) {
    return {
      ...commun, indetermine: true,
      motif: 'Le tarif versé par le délégataire n\'est pas renseigné pour cette combinaison régime × MaPrimeRénov\'.',
      caDelegataire: null, primeBeneficiaire: null, commissionInstallateur: null,
      commissionApporteur: null, coutPose: arrondi(coutPose),
      margeBrute: null, margeNette: null, tauxMarge: null,
    }
  }

  const caDelegataire = mwh * r.delegataire
  const primeBeneficiaire = mwh * (r.cedeBeneficiaire ?? 0)
  const commissionInstallateur = mwh * (r.gardeInstallateur ?? 0)
  const commissionApporteur = caDelegataire * (Number(tauxApporteur) || 0) / 100

  // ── Ce qui est réellement déduit ──
  //
  // En mode cumulé, les deux. En mode alternatif, une seule : celle qui correspond au
  // destinataire de la prime sur CE dossier. Faute d'indication, on retient le
  // bénéficiaire — c'est le cas courant en CEE, et le choix est affiché, pas caché.
  const versInstallateur = mode === 'ALTERNATIF' && destinatairePrime === 'INSTALLATEUR'
  const deduitBeneficiaire = mode === 'CUMULE' || !versInstallateur
  const deduitInstallateur = mode === 'CUMULE' || versInstallateur

  const margeBrute = caDelegataire
    - (deduitBeneficiaire ? primeBeneficiaire : 0)
    - (deduitInstallateur ? commissionInstallateur : 0)
  const margeNette = margeBrute - commissionApporteur - (Number(coutPose) || 0)

  return {
    ...commun,
    indetermine: false,
    destinatairePrime: mode === 'ALTERNATIF' ? (destinatairePrime || 'BENEFICIAIRE') : null,
    deduitBeneficiaire,
    deduitInstallateur,
    caDelegataire: arrondi(caDelegataire),
    primeBeneficiaire: arrondi(primeBeneficiaire),
    commissionInstallateur: arrondi(commissionInstallateur),
    commissionApporteur: arrondi(commissionApporteur),
    coutPose: arrondi(coutPose),
    margeBrute: arrondi(margeBrute),
    margeNette: arrondi(margeNette),
    tauxMarge: caDelegataire > 0 ? arrondi((margeNette / caDelegataire) * 100, 1) : 0,
  }
}

/** Le deal est-il en vigueur à la date d'engagement ? */
export function dealApplicable(deal, dateEngagement) {
  const d = new Date(dateEngagement)
  if (!deal.actif) return { applicable: false, motif: 'Deal désactivé.' }
  if (d < new Date(deal.date_debut)) {
    return { applicable: false, motif: `Contrat non encore en vigueur (début le ${new Date(deal.date_debut).toLocaleDateString('fr-FR')}).` }
  }
  if (deal.date_fin && d > new Date(deal.date_fin)) {
    return { applicable: false, motif: `Contrat expiré le ${new Date(deal.date_fin).toLocaleDateString('fr-FR')}.` }
  }
  return { applicable: true }
}

function arrondi(n, d = 2) {
  const f = Math.pow(10, d)
  return Math.round((Number(n) || 0) * f) / f
}

/**
 * ── Un montant inconnu s'affiche « — », jamais « 0 € » ──
 *
 * `Number(null) || 0` donnait un zéro parfaitement présentable à l'écran. Depuis que la
 * marge peut légitimement être INDÉTERMINÉE — contrat dont le mode de reversement n'est
 * pas choisi, tarif délégataire non renseigné — ce zéro mentirait à chaque ligne. Un
 * tiret se remarque et fait poser la question ; un zéro se croit.
 *
 * Un zéro RÉEL, lui, s'affiche toujours « 0 € » : c'est une information, pas une absence.
 */
const inconnu = (n) => n === null || n === undefined || n === ''

export const euros = (n) => (inconnu(n) ? '—'
  : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n) || 0))

export const nombre = (n) => (inconnu(n) ? '—'
  : new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0)))

/**
 * Montant au centime. Les ratios d'un deal valent quelques euros par MWh :
 * arrondis à l'euro, une grille de 7,20 € et une de 6,50 € s'affichent toutes deux « 7 € ».
 */
export const eurosPrecis = (n) => (inconnu(n) ? '—'
  : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n) || 0))
