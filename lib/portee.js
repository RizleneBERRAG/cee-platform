import { get } from './db.js'

/**
 * Refuse si le dossier visé sort de la portée de l'appelant.
 *
 * Masquer un bouton n'est pas une protection : une action serveur est une adresse HTTP
 * qu'on peut appeler directement, avec l'identifiant d'un dossier qu'on n'a pas le droit
 * de voir. C'est ce contrôle-ci qui fait foi, et il doit être le **même** partout — d'où
 * sa place ici plutôt qu'une copie par fichier d'actions. Deux copies d'un contrôle de
 * sécurité finissent toujours par diverger, et c'est la copie oubliée qui ouvre la porte.
 *
 * Le refus emprunte le message « Dossier introuvable » du cas où le dossier n'existe pas :
 * distinguer les deux dirait à l'appelant que le dossier existe mais ne lui appartient pas.
 */
export function exigerPortee(u, dossierId, { corbeille = false } = {}) {
  const d = get('SELECT unite_affaire_id, supprime_le FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (!u.permissions.includes('dossier.tous') && (d.unite_affaire_id ?? null) !== (u.uniteId ?? null)) {
    throw new Error('Dossier introuvable.')
  }
  // Un dossier à la corbeille ne se modifie plus, par aucune action : l'écran le met en
  // lecture seule, et ce contrôle-ci empêche d'y écrire en appelant l'action directement.
  // Seules les actions de la corbeille elle-même passent `corbeille: true`.
  if (d.supprime_le && !corbeille) throw new Error('Ce dossier est dans la corbeille : récupérez-le avant de le modifier.')
}
