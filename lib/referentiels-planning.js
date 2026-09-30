/**
 * Référentiels du planning. Aucune dépendance : lu aussi par les étapes de migration.
 */

/** Les sept calendriers de Pixel, dans l'ordre de vie d'un dossier. [code, libellé, couleur] */
export const TYPES_INTERVENTION_PAR_DEFAUT = [
  ['RDV_COMMERCIAL', 'Rendez-vous commercial', '#2563eb'],
  ['PREVISITE', 'Prévisite technique', '#7c3aed'],
  ['AUDIT', 'Audit énergétique', '#0891b2'],
  ['OUVERTURE_CHANTIER', 'Ouverture de chantier', '#d97706'],
  ['POSE', 'Pose', '#059669'],
  ['FIN_POSE', 'Fin de pose', '#15803d'],
  ['SAV', 'S.A.V', '#dc2626'],
]

export const STATUTS_INTERVENTION = {
  A_PLANIFIER: { libelle: 'À planifier', couleur: '#94a3b8', modifiable: true },
  PLANIFIEE: { libelle: 'Planifiée', couleur: '#2563eb', modifiable: true },
  CONFIRMEE: { libelle: 'Confirmée', couleur: '#059669', modifiable: true },
  REALISEE: { libelle: 'Réalisée', couleur: '#475569', modifiable: false },
  ANNULEE: { libelle: 'Annulée', couleur: '#be123c', modifiable: false },
}

/**
 * Une intervention réalisée renseigne la date correspondante du dossier — si elle est vide.
 * On ne réécrit jamais une date déjà saisie : elle a pu être corrigée à la main, et c'est
 * elle qui compte au contrôle.
 */
export const DATE_DOSSIER_PAR_TYPE = {
  RDV_COMMERCIAL: ['date_rdv_visite', 'Date du rendez-vous (visite)'],
  POSE: ['date_pose', 'Date de pose'],
  FIN_POSE: ['date_achevement', "Date d'achèvement"],
}
