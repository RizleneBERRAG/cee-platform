import { utilisateurConnecte } from '../../../lib/auth.js'
import { get } from '../../../lib/db.js'
import { lire, APERCU, nomPropre } from '../../../lib/fichiers.js'

export const dynamic = 'force-dynamic'

/**
 * Sert une pièce jointe.
 *
 * C'est la seule porte vers les fichiers : le répertoire de stockage est hors de
 * l'arborescence servie, et rien n'y est accessible par une URL devinable. Cette route
 * refait donc l'intégralité des contrôles, parce qu'un lien de téléchargement contourne
 * tout l'affichage :
 *
 * - session valide ;
 * - droit de consulter les dossiers ;
 * - **portée** — la pièce d'un dossier d'une autre unité d'affaire ressort « introuvable »,
 *   sans révéler qu'elle existe ;
 * - l'empreinte relue doit correspondre, sinon on refuse plutôt que de servir un fichier altéré.
 *
 * Les en-têtes comptent autant que les contrôles. `Content-Disposition: attachment` par
 * défaut, `inline` seulement pour les types dont l'affichage est sans danger ; `nosniff`
 * pour que le navigateur n'aille pas deviner un type plus permissif que celui annoncé ;
 * et une politique de sécurité qui interdit tout script au cas où un format nous aurait échappé.
 */
export async function GET(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return new Response('Non authentifié.', { status: 401 })
  if (!u.permissions.includes('dossier.voir')) return new Response('Accès refusé.', { status: 403 })

  const { id } = await params
  const doc = get(
    `SELECT dd.*, d.unite_affaire_id, td.libelle AS type_libelle
       FROM document_dossier dd
       JOIN dossier d ON d.id = dd.dossier_id
       JOIN type_document td ON td.id = dd.type_document_id
      WHERE dd.id = ?`,
    [id]
  )
  if (!doc) return new Response('Pièce introuvable.', { status: 404 })

  // Même réponse qu'une pièce inexistante : ne pas révéler l'existence du dossier d'autrui.
  if (!u.permissions.includes('dossier.tous') && (doc.unite_affaire_id ?? null) !== (u.uniteId ?? null)) {
    return new Response('Pièce introuvable.', { status: 404 })
  }

  if (!doc.empreinte) {
    return new Response(
      'Cette pièce a été enregistrée par son nom seulement, avant la mise en place du stockage des fichiers. Redéposez-la.',
      { status: 404 }
    )
  }

  const f = lire(doc.empreinte, doc.extension)
  if (!f) return new Response('Le fichier est absent du stockage.', { status: 410 })
  if (f.altere) {
    return new Response(
      'Le fichier sur disque ne correspond plus à son empreinte : il a été altéré ou corrompu. Il n\'est pas servi.',
      { status: 409 }
    )
  }

  const enLigne = String(new URL(request.url).searchParams.get('apercu')) === '1' && APERCU.has(doc.type_mime)
  const nom = nomPropre(doc.nom_fichier)

  return new Response(f.contenu, {
    headers: {
      'Content-Type': doc.type_mime || 'application/octet-stream',
      'Content-Length': String(f.contenu.length),
      'Content-Disposition': `${enLigne ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(nom)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; object-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=0, must-revalidate',
    },
  })
}
