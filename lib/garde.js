import { redirect } from 'next/navigation'
import { utilisateurConnecte } from './auth.js'
import { get } from './db.js'

/**
 * Garde d'écran. À appeler en première ligne de chaque page protégée.
 *
 * Elle renvoie aussi la **portée de lecture** : `{ uniteId }` pour qui n'a pas le droit
 * `dossier.tous`, `{}` sinon. Toutes les requêtes de liste la prennent en paramètre,
 * de sorte que le cloisonnement soit fait par le SQL et non par un filtre d'affichage
 * qu'on peut contourner en changeant l'URL.
 */
export async function garde(permission = null) {
  const u = await utilisateurConnecte()
  if (!u) redirect('/connexion')
  if (u.doitChangerMdp) redirect('/compte?premier=1')
  if (permission && !u.permissions.includes(permission)) {
    redirect(`/refus?p=${encodeURIComponent(permission)}`)
  }
  return { u, portee: u.permissions.includes('dossier.tous') ? {} : { uniteId: u.uniteId ?? '—aucune—' } }
}

/** Raccourci de lecture, pour les conditions d'affichage. */
export const a = (u, permission) => !!u && u.permissions.includes(permission)

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
export function exigerPortee(u, dossierId) {
  if (u.permissions.includes('dossier.tous')) return
  const d = get('SELECT unite_affaire_id FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if ((d.unite_affaire_id ?? null) !== (u.uniteId ?? null)) throw new Error('Dossier introuvable.')
}
