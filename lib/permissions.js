/**
 * Catalogue des permissions.
 *
 * Deux d'entre elles portent tout l'enjeu commercial, et méritent d'être nommées :
 *
 * - `marge.voir` — la grille de ratios est le secret de l'affaire. Un apporteur qui découvre
 *   qu'il touche 2 €/MWh sur une opération qui en rapporte 12 renégocie le lendemain.
 *   Sans cette permission, tous les montants de valorisation sont retirés de la réponse
 *   du serveur, pas seulement masqués à l'écran.
 * - `dossier.tous` — sans elle, un utilisateur ne voit que les dossiers de son unité
 *   d'affaire. C'est ce qui permet d'ouvrir l'outil à une régie sans lui ouvrir le portefeuille.
 */
export const PERMISSIONS = {
  'dossier.voir': 'Consulter les dossiers',
  'dossier.tous': 'Voir les dossiers de toutes les unités d\'affaire',
  'dossier.creer': 'Créer un dossier',
  'dossier.modifier': 'Modifier un dossier',
  'dossier.importer': 'Importer des dossiers en masse',
  'dossier.verrouiller': 'Verrouiller et déverrouiller un dossier',
  'dossier.supprimer': 'Mettre un dossier à la corbeille, le récupérer ou le supprimer définitivement',
  'marge.voir': 'Voir les montants et la marge',
  'deal.gerer': 'Gérer les deals et leurs ratios',
  'referentiel.gerer': 'Modifier le référentiel des fiches',
  'piece.deposer': 'Ajouter des pièces à un dossier',
  'piece.valider': 'Valider une pièce au nom du délégataire',
  'lot.gerer': 'Constituer des lots de dépôt',
  'lot.deposer': 'Déposer un lot',
  'planning.tous': "Voir et organiser le planning de toute l'équipe",
  'utilisateur.gerer': 'Gérer les comptes et les rôles',
}

export const TOUTES = Object.keys(PERMISSIONS)

/** Rôles livrés par défaut. Modifiables ensuite depuis l'écran des comptes. */
export const ROLES_PAR_DEFAUT = [
  {
    code: 'GERANT',
    nom: 'Gérant',
    description: 'Accès complet, y compris les ratios de marge et les comptes.',
    permissions: TOUTES,
  },
  {
    code: 'ADV',
    nom: 'ADV',
    description: 'Pilote les dossiers de bout en bout et voit la marge, sans toucher aux ratios ni aux comptes.',
    permissions: [
      'dossier.voir', 'dossier.tous', 'dossier.creer', 'dossier.modifier', 'dossier.importer',
      'dossier.verrouiller', 'dossier.supprimer', 'marge.voir', 'piece.deposer', 'piece.valider',
      'lot.gerer', 'lot.deposer', 'planning.tous',
    ],
  },
  {
    code: 'REGIE',
    nom: 'Régie',
    description: 'Saisit et suit les dossiers de sa seule unité d\'affaire. Ne voit aucun montant.',
    permissions: ['dossier.voir', 'dossier.creer', 'dossier.modifier', 'piece.deposer'],
  },
  {
    code: 'APPORTEUR',
    nom: 'Apporteur',
    description: 'Consulte l\'avancement de ses propres dossiers. Lecture seule, sans montants.',
    permissions: ['dossier.voir'],
  },
]

/** Un utilisateur a-t-il ce droit ? Tout refus doit être décidé côté serveur. */
export function peut(utilisateur, permission) {
  if (!utilisateur) return false
  const liste = utilisateur.permissions
  return Array.isArray(liste) && liste.includes(permission)
}
