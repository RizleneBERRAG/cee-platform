/**
 * Listes du S.A.V posées au premier démarrage, reprises de Pixel. Paramétrables ensuite.
 * Aucune dépendance : lu aussi par les étapes de migration.
 */
export const SAV_TYPES = ['Administratif', 'Commercial', 'Technique', 'Reliquat', 'Autre']

/** [libellé, clôture] — choisir un statut de clôture ferme le S.A.V. */
export const SAV_STATUTS = [
  ['À traiter', 0],
  ['À traiter - organisme à déplacer', 0],
  ['Cofrac', 0],
  ['Contrôle PNCEE', 0],
  ['Décision à prendre', 0],
  ['En cours', 0],
  ['Non envoyé', 0],
  ['Réception contrôle qualité', 0],
  ['Réglé', 1],
]

export const SAV_MOTIFS = [
  'Problème CEE', 'Parcelle cadastrale', "Avis d'impôt", 'Incohérence photos', 'Incohérence chauffage',
  'Arbitrage organisme', 'Contrôle chantier admin', 'Refus organisme', 'Refus', 'Incohérence CSV',
  'Contrôle chantier tech', 'Justificatif de domicile', 'Contrôle PNCEE', 'Surface non éligible',
]

export const CATEGORIES_SAV = { TYPE: 'Types', STATUT: 'Statuts', MOTIF: 'Motifs' }
