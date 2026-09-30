/**
 * La facture d'un appel à paiement, en HTML imprimable. GET ne fait que lire : l'émission,
 * qui consomme un numéro, passe par l'action « Émettre la facture » de la fiche de l'appel.
 */
import { utilisateurConnecte } from '../../../../lib/auth.js'
import { db } from '../../../../lib/db.js'
import { lireAppel } from '../../../../lib/aap.js'
import { appelHtml } from '../../../../lib/aap-html.js'
import { coordonneesBancaires } from '../../../../lib/listes.js'

export const dynamic = 'force-dynamic'

const texte = (corps, status) => new Response(corps, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

export async function GET(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return texte('Non authentifié.', 401)
  if (!u.permissions.includes('lot.gerer') || !u.permissions.includes('marge.voir')) return texte('Accès refusé.', 403)
  const { id } = await params
  const x = lireAppel(db(), id)
  if (!x) return texte('Appel à paiement introuvable.', 404)
  const entite = x.entite_id ? db().prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(x.entite_id) : null
  // Émise : les coordonnées figées. Aperçu : celles du compte actuel de la société.
  const reglement = x.numero_facture ? {} : coordonneesBancaires(db(), x.entite_id) || {}
  return new Response(appelHtml({ ...x, ...reglement }, entite), { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
