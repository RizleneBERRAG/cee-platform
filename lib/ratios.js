/**
 * Les dix-huit ratios d'un deal, en €/MWh cumac.
 *
 * Trois régimes (grande précarité / précaire / classique) × avec ou sans MaPrimeRénov'
 * × trois parties : ce que verse le délégataire, ce qui est cédé au bénéficiaire, ce qui
 * revient à l'installateur. La marge est ce qui reste.
 *
 * ── Pourquoi trois régimes et non deux ──
 *
 * La grille n'en portait que deux. L'ancien logiciel, lui, en distingue trois, et les
 * tarifs y diffèrent réellement : sur le contrat ILORAL TOTAL, le bénéficiaire reçoit
 * 5,40 €/MWh en précarité simple et 4,60 en grande précarité. Confondre les deux, c'était
 * se tromper de 0,80 € par MWh sur toute une catégorie de ménages.
 *
 * ── Une case vide n'est pas un zéro ──
 *
 * `null` veut dire « ce tarif n'est pas renseigné » ; `0` voudrait dire « ce tarif est
 * nul », donc gratuit. Les fonctions de ce fichier maintiennent la distinction : elles
 * ignorent ce qui n'est pas renseigné plutôt que de le compter pour rien.
 *
 * Cette liste vit dans son propre fichier parce qu'un fichier « use server » ne peut
 * exporter que des fonctions asynchrones : l'écran et les actions doivent pouvoir la
 * lire tous les deux sans la dupliquer.
 */
export const RATIOS = [
  ['r_deleg_grande_precarite_sans_mpr', 'Versé par le délégataire', 'GRANDE_PRECARITE', 'sans MPR'],
  ['r_cede_grande_precarite_sans_mpr', 'Prime cédée au bénéficiaire', 'GRANDE_PRECARITE', 'sans MPR'],
  ['r_garde_grande_precarite_sans_mpr', 'Commission installateur', 'GRANDE_PRECARITE', 'sans MPR'],
  ['r_deleg_grande_precarite_avec_mpr', 'Versé par le délégataire', 'GRANDE_PRECARITE', 'avec MPR'],
  ['r_cede_grande_precarite_avec_mpr', 'Prime cédée au bénéficiaire', 'GRANDE_PRECARITE', 'avec MPR'],
  ['r_garde_grande_precarite_avec_mpr', 'Commission installateur', 'GRANDE_PRECARITE', 'avec MPR'],
  ['r_deleg_precaire_sans_mpr', 'Versé par le délégataire', 'PRECAIRE', 'sans MPR'],
  ['r_cede_precaire_sans_mpr', 'Prime cédée au bénéficiaire', 'PRECAIRE', 'sans MPR'],
  ['r_garde_precaire_sans_mpr', 'Commission installateur', 'PRECAIRE', 'sans MPR'],
  ['r_deleg_precaire_avec_mpr', 'Versé par le délégataire', 'PRECAIRE', 'avec MPR'],
  ['r_cede_precaire_avec_mpr', 'Prime cédée au bénéficiaire', 'PRECAIRE', 'avec MPR'],
  ['r_garde_precaire_avec_mpr', 'Commission installateur', 'PRECAIRE', 'avec MPR'],
  ['r_deleg_classique_sans_mpr', 'Versé par le délégataire', 'CLASSIQUE', 'sans MPR'],
  ['r_cede_classique_sans_mpr', 'Prime cédée au bénéficiaire', 'CLASSIQUE', 'sans MPR'],
  ['r_garde_classique_sans_mpr', 'Commission installateur', 'CLASSIQUE', 'sans MPR'],
  ['r_deleg_classique_avec_mpr', 'Versé par le délégataire', 'CLASSIQUE', 'avec MPR'],
  ['r_cede_classique_avec_mpr', 'Prime cédée au bénéficiaire', 'CLASSIQUE', 'avec MPR'],
  ['r_garde_classique_avec_mpr', 'Commission installateur', 'CLASSIQUE', 'avec MPR'],
]

/** Les six combinaisons régime × MPR, dans l'ordre d'affichage. */
export const COMBINAISONS = [
  ['GRANDE_PRECARITE', 'sans MPR'], ['GRANDE_PRECARITE', 'avec MPR'],
  ['PRECAIRE', 'sans MPR'], ['PRECAIRE', 'avec MPR'],
  ['CLASSIQUE', 'sans MPR'], ['CLASSIQUE', 'avec MPR'],
]

/** Le nom lisible d'un régime. */
export const NOMS_REGIME = {
  GRANDE_PRECARITE: 'Grande précarité',
  PRECAIRE: 'Précaire',
  CLASSIQUE: 'Classique',
}

export const LIGNES = ['Versé par le délégataire', 'Prime cédée au bénéficiaire', 'Commission installateur']

/** Retrouve la colonne correspondant à (ligne, régime, MPR). */
export function colonne(ligne, regime, mpr) {
  return RATIOS.find(([, l, r, m]) => l === ligne && r === regime && m === mpr)?.[0]
}

/**
 * Anomalies de saisie dans la grille des douze ratios.
 *
 * ── Pourquoi ce contrôle existe ──
 * Les douze valeurs sont saisies à la main, dans un tableau, en euros par MWh cumac. Une
 * faute de frappe — 3,5 tapé 35, une virgule oubliée — ne provoque aucune erreur : la grille
 * s'enregistre, les dossiers se calculent, et la marge de **tous** les dossiers du deal est
 * fausse. Personne ne s'en aperçoit avant la réconciliation, des mois plus tard, quand les
 * dossiers sont figés et que la correction ne les rattrape plus.
 *
 * ── Ce qu'on ne contrôle PAS, et pourquoi ──
 * On pourrait croire à un invariant « versé = cédé + commission ». C'est vrai chez un
 * confrère dont la société est elle-même l'installateur : la commission installateur EST
 * son revenu, et le reste est nul par construction. Ce n'est pas notre modèle. Chez nous
 * l'installateur est un tiers, et le reliquat — la marge brute — nous revient. Imposer
 * l'égalité interdirait le cas normal. On ne la contrôle donc pas.
 *
 * ── Et pourquoi le reliquat négatif n'est qu'un DOUTE ──
 *
 * Cette fonction a d'abord traité « cédé + commission > versé » comme une erreur de
 * saisie. Les douze contrats relevés sur l'ancien logiciel ont montré que c'était faux :
 * ONZE d'entre eux sont dans ce cas. Sur DEAL ILORAL DÉSHU TOTAL, le bénéficiaire et
 * l'installateur affichent 4,55 chacun pour 6,50 versés — et surtout, ils affichent la
 * MÊME valeur, ce qui suggère deux tarifs alternatifs (selon qui touche la prime) plutôt
 * que deux prélèvements simultanés. Sur d'autres contrats — LSF SCAPED, 2,40 + 3,60 = 6,00
 * exactement — la somme retombe juste, donc les deux lectures coexistent dans les données.
 *
 * Tant que le sens exact de la ligne « installateur » n'est pas tranché par le gérant, la
 * seule attitude honnête est de signaler l'écart sans le qualifier d'erreur. Un contrôle
 * qui crie à la faute sur onze contrats sur douze ne serait pas un contrôle : il serait
 * un bruit qu'on apprend à ignorer, et il masquerait la vraie faute le jour où elle
 * arrivera.
 *
 * Restent donc, comme ERREUR, les seules valeurs qui n'ont aucune lecture métier : les
 * tarifs négatifs. Tout le reste — reliquat négatif, tarif manquant, valeur hors d'échelle
 * (la signature d'une virgule perdue) — est un DOUTE : quelque chose à regarder, pas un
 * verdict.
 *
 * Une combinaison entièrement vide n'est pas renseignée : elle n'est pas signalée. Et une
 * case vide au milieu de deux cases remplies n'est pas lue comme un zéro — on ne peut pas
 * conclure sur un reliquat dont un terme manque. On le dit, et on s'arrête là.
 *
 * @param {object} valeurs  un deal, ou tout objet portant les dix-huit colonnes
 * @returns {Array<{gravite:'ERREUR'|'DOUTE', regime, mpr, ligne, message}>}
 */
export function anomaliesRatios(valeurs, mode = null) {
  // Le mode de reversement change le SENS de l'écart, donc le niveau de l'alerte :
  //   CUMULE     → les deux lignes se soustraient : un reliquat négatif est une vraie erreur.
  //   ALTERNATIF → une seule s'applique : le cumul n'a pas à tomber juste, rien à signaler.
  //   non choisi → on ne sait pas : on montre le calcul et on laisse trancher.
  const modeGrille = mode ?? valeurs?.mode_reversement ?? null
  // `null` quand la case est vide — à ne jamais confondre avec 0.
  const lu = (ligne, regime, mpr) => {
    const brut = valeurs?.[colonne(ligne, regime, mpr)]
    if (brut === null || brut === undefined || brut === '') return null
    const v = Number(brut)
    return Number.isFinite(v) ? v : null
  }
  const eur = (n) => `${Number(n).toFixed(2).replace('.', ',')} €`
  const nomRegime = (r) => NOMS_REGIME[r] || r

  const out = []

  for (const [regime, mpr] of COMBINAISONS) {
    const delegataire = lu(LIGNES[0], regime, mpr)
    const cede = lu(LIGNES[1], regime, mpr)
    const garde = lu(LIGNES[2], regime, mpr)
    if (delegataire === null && cede === null && garde === null) continue

    for (const [ligne, v] of [[LIGNES[0], delegataire], [LIGNES[1], cede], [LIGNES[2], garde]]) {
      if (v !== null && v < 0) {
        out.push({
          gravite: 'ERREUR', regime, mpr, ligne,
          message: `${nomRegime(regime)}, ${mpr} — « ${ligne} » vaut ${eur(v)}. Un tarif négatif n'a pas de sens.`,
        })
      }
    }

    // ── Le reliquat, quand il est calculable ──
    //
    // Il faut les trois termes. S'il en manque un, la soustraction n'a pas de sens : la
    // faire en traitant le vide comme un zéro inventerait un déficit — c'est exactement
    // ce qui arrive sur les contrats repris de l'ancien logiciel, qui n'a aucun champ
    // pour le tarif délégataire en précaire hors MaPrimeRénov'.
    if (delegataire === null && (cede !== null || garde !== null)) {
      out.push({
        gravite: 'DOUTE', regime, mpr, ligne: LIGNES[0],
        message: `${nomRegime(regime)}, ${mpr} — le tarif du délégataire n'est pas renseigné, ` +
          `alors que le reversement l'est. La marge de cette combinaison reste incalculable.`,
      })
      continue
    }
    if (delegataire === null) continue

    // En mode alternatif, seule une des deux lignes s'applique : comparer leur somme au
    // versement du délégataire n'aurait aucun sens. On vérifie alors que CHACUNE, prise
    // seule, reste sous ce versement — c'est là que se cache la vraie erreur de saisie.
    if (modeGrille === 'ALTERNATIF') {
      for (const [ligne, v] of [[LIGNES[1], cede], [LIGNES[2], garde]]) {
        if (v !== null && v - delegataire > 0.005) {
          out.push({
            gravite: 'ERREUR', regime, mpr, ligne,
            message: `${nomRegime(regime)}, ${mpr} — « ${ligne} » vaut ${eur(v)}, plus que les ` +
              `${eur(delegataire)} versés par le délégataire. Chaque dossier de ce deal perdrait de l'argent.`,
          })
        }
      }
      continue
    }

    const reliquat = Math.round((delegataire - (cede ?? 0) - (garde ?? 0)) * 100) / 100
    if (reliquat < -0.005) {
      out.push({
        gravite: modeGrille === 'CUMULE' ? 'ERREUR' : 'DOUTE', regime, mpr, ligne: null,
        message: `${nomRegime(regime)}, ${mpr} — ${eur(cede ?? 0)} cédés + ${eur(garde ?? 0)} de commission = ` +
          `${eur((cede ?? 0) + (garde ?? 0))}, pour ${eur(delegataire)} reçus du délégataire, ` +
          `soit ${eur(Math.abs(reliquat))} de plus par MWh cumac. ` +
          (modeGrille === 'CUMULE'
            ? `Ce contrat est réglé sur « cumulés » : chaque dossier perd donc réellement cette somme.`
            : `Si ces deux lignes se cumulent, chaque dossier perd de l'argent ; si elles sont deux ` +
              `tarifs au choix, tout va bien. Choisissez le mode de reversement du contrat pour trancher.`),
      })
    }
  }

  // Une virgule perdue se voit en comparant une valeur à ses voisines de la même ligne :
  // les six combinaisons d'une même ligne sont presque toujours du même ordre de grandeur.
  for (const ligne of LIGNES) {
    const valeurs4 = COMBINAISONS
      .map(([r, m]) => ({ regime: r, mpr: m, v: lu(ligne, r, m) }))
      .filter((x) => x.v !== null && x.v > 0)
    if (valeurs4.length < 2) continue

    const triees = [...valeurs4].map((x) => x.v).sort((a, b) => a - b)
    const mediane = triees[Math.floor(triees.length / 2)]
    for (const x of valeurs4) {
      if (mediane > 0 && x.v >= mediane * 8) {
        out.push({
          gravite: 'DOUTE', regime: x.regime, mpr: x.mpr, ligne,
          message: `${nomRegime(x.regime)}, ${x.mpr} — « ${ligne} » vaut ${eur(x.v)}, ` +
            `très au-dessus des autres colonnes de la même ligne (${eur(mediane)}). Virgule oubliée ?`,
        })
      }
    }
  }

  return out
}
