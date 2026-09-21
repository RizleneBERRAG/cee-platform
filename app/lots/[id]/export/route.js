import { csvDuLot } from '../../../../lib/export.js'
import { utilisateurConnecte } from '../../../../lib/auth.js'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  // Une route de téléchargement contourne tout l'affichage : elle porte donc sa propre garde.
  // L'export contient les montants figés, il est réservé à qui a le droit de voir la marge.
  const u = await utilisateurConnecte()
  if (!u) return new Response('Non authentifié.', { status: 401 })
  if (!u.permissions.includes('lot.gerer') || !u.permissions.includes('marge.voir')) {
    return new Response('Accès refusé : l\'export d\'un lot contient les montants.', { status: 403 })
  }

  const { id } = await params
  const { nomFichier, contenu } = csvDuLot(id)
  return new Response(contenu, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nomFichier}"`,
    },
  })
}
