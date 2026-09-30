import { redirect } from 'next/navigation'
import { utilisateurConnecte } from './auth.js'

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

// Le contrôle de portée des actions vit dans portee.js, sans dépendance à Next, pour être
// testé seul. Réexporté ici : les actions continuent de l'importer depuis garde.js.
export { exigerPortee } from './portee.js'
