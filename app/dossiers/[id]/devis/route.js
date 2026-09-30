/**
 * Le devis d'un dossier, en HTML prêt à imprimer.
 *
 * ── Prévisualiser ne consomme pas de numéro ──
 *
 * Par défaut, cette route ne modifie RIEN : elle rend le devis avec le filigrane
 * PROVISOIRE et sans numéro. On peut la rafraîchir cent fois. L'émission — qui attribue un
 * numéro définitif pris dans la série de la société — demande `?emettre=1` et une méthode
 * POST, parce qu'un lien qu'on ouvre par curiosité ne doit jamais trouer une suite de
 * numéros que le fisc peut demander à voir.
 */
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { utilisateurConnecte } from '../../../../lib/auth.js'
import { exigerPortee } from '../../../../lib/garde.js'
import { donneesDevis, attribuerNumero } from '../../../../lib/devis.js'
import { devisHtml } from '../../../../lib/devis-html.js'

export const dynamic = 'force-dynamic'

function ouvrir() {
  return new DatabaseSync(process.env.CEE_DB_PATH || path.join(process.cwd(), 'db', 'cee.db'))
}

export async function GET(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return new Response('Non authentifié.', { status: 401 })
  if (!u.permissions.includes('dossier.voir')) {
    return new Response('Accès refusé.', { status: 403 })
  }

  const { id } = await params
  // Le droit ne suffit pas : le dossier doit être dans la portée de l'appelant. Même
  // réponse que pour un dossier inexistant, pour ne pas révéler celui d'une autre unité.
  try { exigerPortee(u, id) } catch { return new Response('Dossier introuvable.', { status: 404 }) }
  const db = ouvrir()
  const donnees = donneesDevis(db, id)
  if (!donnees) return new Response('Dossier introuvable.', { status: 404 })

  // Un devis déjà émis garde SON numéro : on ne le renumérote pas à la réimpression.
  const numero = donnees.dossier.num_devis || null

  return new Response(devisHtml(donnees, numero), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export async function POST(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return new Response('Non authentifié.', { status: 401 })
  if (!u.permissions.includes('dossier.modifier')) {
    return new Response("Accès refusé : l'émission d'un devis engage la société.", { status: 403 })
  }

  const { id } = await params
  // Le droit ne suffit pas : le dossier doit être dans la portée de l'appelant. Même
  // réponse que pour un dossier inexistant, pour ne pas révéler celui d'une autre unité.
  try { exigerPortee(u, id) } catch { return new Response('Dossier introuvable.', { status: 404 }) }
  const db = ouvrir()
  const donnees = donneesDevis(db, id)
  if (!donnees) return new Response('Dossier introuvable.', { status: 404 })

  if (donnees.dossier.num_devis) {
    return new Response(`Ce dossier porte déjà le devis ${donnees.dossier.num_devis}.`, { status: 409 })
  }

  // ── Le refus d'émettre ──
  //
  // Mieux vaut un devis qui ne sort pas qu'un devis irrégulier signé par un client. Les
  // motifs sont renvoyés en clair : ils disent quoi renseigner, pas seulement que ça a raté.
  const bloquants = donnees.anomalies.filter((a) => a.niveau === 'BLOQUANT')
  if (bloquants.length) {
    return new Response(
      `Émission refusée :\n${bloquants.map((b) => `- ${b.message}`).join('\n')}`,
      { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }

  const entiteId = donnees.entite.id
  db.exec('BEGIN')
  let numero
  try {
    numero = attribuerNumero(db, entiteId)
    db.prepare(`UPDATE dossier SET num_devis = ?, entite_id = ?,
                date_proposition = COALESCE(date_proposition, date('now')),
                etat_devis = COALESCE(etat_devis, 'A_SIGNER')
                WHERE id = ?`).run(numero, entiteId, id)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    return new Response(`Émission interrompue : ${err.message}`, { status: 500 })
  }

  return new Response(devisHtml({ ...donnees, dossier: { ...donnees.dossier, num_devis: numero } }, numero), {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
