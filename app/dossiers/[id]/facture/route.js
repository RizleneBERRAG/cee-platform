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
import { exigerPortee } from '../../../../lib/garde.js'
import { db as ouvrir } from '../../../../lib/db.js'
import { apercuFacture, emettreFacture, emettreAvoir, lireFacture, preparerAcompte, emettreAcompte } from '../../../../lib/facture.js'
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
  // Le droit ne suffit pas : le dossier doit être dans la portée de l'appelant. Même
  // réponse que pour un dossier inexistant, pour ne pas révéler celui d'une autre unité.
  try { exigerPortee(u, id) } catch { return texte('Dossier introuvable.', 404) }
  const url = new URL(request.url)
  const demandee = url.searchParams.get('facture')
  const db = ouvrir()

  // Aperçu d'un acompte (?acompte&pourcentage=30, ou ?acompte&montant=1500) : filigrané,
  // sans numéro. Mêmes champs que le formulaire d'émission, qui poste sur ?acompte.
  if (url.searchParams.has('acompte')) {
    // Un montant saisi l'emporte sur le pourcentage, pré-rempli par défaut.
    const montant = url.searchParams.get('montant') || null
    const pa = preparerAcompte(db, id, {
      pourcentage: montant ? null : url.searchParams.get('pourcentage') || null,
      montantTtc: montant,
    })
    if (!pa) return texte('Dossier introuvable.', 404)
    const base = apercuFacture(db, id)?.facture
    if (!base) return texte("Aucune société émettrice n'est rattachée à ce dossier, ni définie par défaut.", 422)
    if (!pa.emettable) {
      return texte(`Acompte impossible :\n${pa.anomalies.filter((a) => a.niveau === 'BLOQUANT').map((a) => `- ${a.message}`).join('\n')}`, 422)
    }
    return html(factureHtml({
      ...base, type: 'ACOMPTE', lignes: pa.lignes, date_prestation: null,
      total_ht: pa.totauxAcompte.ht, total_tva: pa.totauxAcompte.tva, total_ttc: pa.totauxAcompte.ttc,
      prime_deduite: null, acomptes_ttc: null, acomptes_detail: null, reste_a_payer: pa.totauxAcompte.ttc,
    }))
  }

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
  try { exigerPortee(u, id) } catch { return texte('Dossier introuvable.', 404) }
  const url = new URL(request.url)
  const avoirDe = url.searchParams.get('avoir')
  const db = ouvrir()

  // Facture d'acompte : pourcentage du net à payer, ou montant TTC.
  if (url.searchParams.has('acompte')) {
    const form = await request.formData().catch(() => null)
    const montant = form?.get('montant') || null
    const r = emettreAcompte(db, id, {
      pourcentage: montant ? null : form?.get('pourcentage') || null,
      montantTtc: montant,
      utilisateurId: u.id,
    })
    if (!r.ok) return texte(`Acompte refusé :\n${r.motifs.map((m) => `- ${m}`).join('\n')}`, 422)
    return html(factureHtml(lireFacture(db, r.id)))
  }

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
