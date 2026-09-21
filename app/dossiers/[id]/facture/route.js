/**
 * La facture d'un dossier, en HTML prêt à imprimer.
 *
 * ── Pourquoi GET ne peut RIEN écrire ici ──
 *
 * Un GET est rejoué par un rafraîchissement, un préchargement de navigateur, un robot
 * d'indexation. Si l'émission vivait sur GET, une facture partirait au premier F5 et le
 * compteur avancerait tout seul. GET ne fait donc que lire : soit l'aperçu — filigrané,
 * sans numéro —, soit une facture déjà émise, réimprimée à l'identique.
 *
 * L'émission et l'avoir sont en POST. Ce sont les deux seuls gestes qui consomment un
 * numéro, et ils ne se produisent que si quelqu'un les demande explicitement.
 */
import { utilisateurConnecte } from '../../../../lib/auth.js'
import { db as ouvrir } from '../../../../lib/db.js'
import { apercuFacture, emettreFacture, emettreAvoir, lireFacture } from '../../../../lib/facture.js'
import { factureHtml } from '../../../../lib/facture-html.js'

export const dynamic = 'force-dynamic'

const html = (corps, status = 200) =>
  new Response(corps, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })

const texte = (corps, status) =>
  new Response(corps, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

/** La dernière facture du dossier qui n'a pas été annulée par un avoir. */
function factureVivante(db, dossierId) {
  return db.prepare(`
    SELECT f.id FROM facture f
     WHERE f.dossier_id = ? AND f.type = 'FACTURE'
       AND NOT EXISTS (SELECT 1 FROM facture a WHERE a.annule_facture_id = f.id)
     ORDER BY f.cree_le DESC LIMIT 1`).get(dossierId)
}

export async function GET(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return texte('Non authentifié.', 401)
  if (!u.permissions.includes('dossier.voir')) return texte('Accès refusé.', 403)

  const { id } = await params
  const demandee = new URL(request.url).searchParams.get('facture')
  const db = ouvrir()

  // Une facture nommée est réimprimée telle quelle — y compris un avoir, y compris une
  // facture annulée : c'est justement quand une pièce a été corrigée qu'on a besoin de
  // pouvoir relire l'originale.
  const cible = demandee || factureVivante(db, id)?.id
  if (cible) {
    const f = lireFacture(db, cible)
    if (!f) return texte('Facture introuvable.', 404)
    if (f.dossier_id !== id) return texte('Cette facture appartient à un autre dossier.', 403)
    return html(factureHtml(f))
  }

  const a = apercuFacture(db, id)
  if (!a) return texte('Dossier introuvable.', 404)
  if (!a.facture) {
    return texte("Aucune société émettrice n'est rattachée à ce dossier, ni définie par défaut.", 422)
  }
  return html(factureHtml(a.facture))
}

export async function POST(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return texte('Non authentifié.', 401)
  if (!u.permissions.includes('dossier.modifier')) {
    return texte("Accès refusé : l'émission d'une facture engage la société.", 403)
  }

  const { id } = await params
  const avoirDe = new URL(request.url).searchParams.get('avoir')
  const db = ouvrir()

  if (avoirDe) {
    const source = lireFacture(db, avoirDe)
    if (!source) return texte('Facture introuvable.', 404)
    if (source.dossier_id !== id) return texte('Cette facture appartient à un autre dossier.', 403)

    const r = emettreAvoir(db, avoirDe, { utilisateurId: u.id })
    if (!r.ok) return texte(`Avoir refusé :\n${r.motifs.map((m) => `- ${m}`).join('\n')}`, 409)
    return html(factureHtml(lireFacture(db, r.id)))
  }

  const r = emettreFacture(db, id, { utilisateurId: u.id })
  if (!r.ok) {
    // Le motif est renvoyé en clair : il dit quoi renseigner, pas seulement que ça a raté.
    return texte(`Émission refusée :\n${r.motifs.map((m) => `- ${m}`).join('\n')}`, 422)
  }
  return html(factureHtml(lireFacture(db, r.id)))
}
