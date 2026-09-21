/**
 * Listes fermées des blocs réglementaires du dossier.
 *
 * Elles vivent hors des fichiers « use server » (qui ne peuvent exporter que des fonctions
 * asynchrones) pour que l'écran et les actions lisent la même liste. Une valeur absente de
 * ces listes est refusée à l'enregistrement : un champ libre finit toujours par contenir
 * trois orthographes du même mot, et une recherche par statut ne retrouve plus rien.
 */

/**
 * Statut du dossier au regard d'un réseau public de chaleur.
 *
 * Sur les opérations de chauffage, l'absence de raccordement doit être **justifiée** :
 * c'est une pièce du dossier, pas un commentaire. Les cinq valeurs couvrent les cas
 * admis ; le libellé long est celui qui sera lu par le contrôleur.
 */
export const RESEAU_STATUTS = [
  ['RACCORDE', 'Déjà raccordé au réseau'],
  ['RACCORDEMENT_POSSIBLE', 'Possibilité de raccordement'],
  ['INEXISTANT', 'Inexistence de réseau'],
  ['IMPOSSIBLE', 'Raccordement techniquement ou économiquement impossible'],
  ['PAS_ENR', "Réseau non alimenté majoritairement par des énergies renouvelables"],
]

/** Un raccordement possible et non réalisé demande une explication écrite. */
export const RESEAU_A_JUSTIFIER = new Set(['RACCORDEMENT_POSSIBLE'])

export const TYPES_AUDIT = [
  ['INCITATIF', 'Incitatif'],
  ['REGLEMENTAIRE', 'Réglementaire'],
]

export const ETATS_RAPPORT = [
  ['A_REALISER', 'À réaliser'],
  ['INCOMPLET', 'Incomplet'],
  ['VALIDE', 'Validé'],
]

/**
 * Moteurs de calcul admis pour un audit énergétique.
 *
 * Le moteur doit être identifié **et versionné** : un rapport produit avec un moteur non
 * reconnu est refusé, et deux versions d'un même moteur ne donnent pas le même résultat.
 * C'est la raison d'être des champs `logiciel` / `version_logiciel` qui l'accompagnent.
 */
export const MOTEURS_CALCUL = [
  ['TH_C_E_EX', 'TH-C-E-ex'],
  ['3CL_DPE_2021', '3CL-DPE-2021'],
  ['3CL', '3CL'],
  ['TRIBU_ENERGIE', 'TribuEnergie'],
  ['BBS_SLAMA', 'Moteur BBS Slama'],
  ['AUTRE', 'Autre moteur (à préciser dans le logiciel)'],
]

/** Modalités de contrôle. */
export const MODALITES_CONTROLE = [
  ['SUR_SITE', 'Sur site'],
  ['A_DISTANCE', 'À distance'],
  ['TELEPHONIQUE', 'Contact téléphonique'],
]

export const RESULTATS_CONTROLE = [
  ['CONFORME', 'Conforme'],
  ['NON_CONFORME', 'Non conforme'],
  ['SANS_SUITE', 'Sans suite'],
]

/** Les deux passages possibles : contrôle initial, puis contre-contrôle. */
export const PASSAGES = [
  [1, 'Premier passage'],
  [2, 'Contre-contrôle'],
]

const libelle = (liste, v) => liste.find(([k]) => k === v)?.[1] ?? null
export const libelleReseau = (v) => libelle(RESEAU_STATUTS, v)
export const libelleMoteur = (v) => libelle(MOTEURS_CALCUL, v)
export const libelleResultat = (v) => libelle(RESULTATS_CONTROLE, v)
export const libelleModalite = (v) => libelle(MODALITES_CONTROLE, v)

/** Valide une valeur contre une liste fermée. Renvoie null plutôt qu'une valeur inventée. */
export function valeurDe(liste, v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  return liste.some(([k]) => k === s) ? s : null
}

/**
 * Le contrôle est-il couvert par l'accréditation du bureau ?
 *
 * Un contrôle réalisé après l'échéance d'accréditation du bureau ne vaut rien : le dossier
 * est rejeté au dépôt, des mois plus tard, quand plus personne ne fait le lien entre le
 * rejet et une date d'accréditation périmée. La vérification se fait donc à la saisie.
 *
 * @returns {{etat:'OK'|'PERIMEE'|'INCONNUE', message:string|null}}
 */
export function accreditationCouvre(bureau, dateControle) {
  if (!bureau) return { etat: 'INCONNUE', message: null }
  const fin = String(bureau.date_fin_accreditation || '').slice(0, 10)
  const date = String(dateControle || '').slice(0, 10)
  if (!fin) {
    return {
      etat: 'INCONNUE',
      message: `L'accréditation de « ${bureau.nom} » n'a pas de date de fin renseignée : ` +
        `elle ne peut pas être vérifiée.`,
    }
  }
  if (!date) return { etat: 'INCONNUE', message: null }
  if (date > fin) {
    return {
      etat: 'PERIMEE',
      message: `L'accréditation de « ${bureau.nom} » s'est terminée le ` +
        `${fin.split('-').reverse().join('/')}, avant le contrôle du ` +
        `${date.split('-').reverse().join('/')}. Un contrôle réalisé hors accréditation ` +
        `n'est pas opposable : le dossier sera rejeté au dépôt.`,
    }
  }
  return { etat: 'OK', message: null }
}
