/**
 * Le tableau récapitulatif d'un lot, au format du dépôt.
 *
 * Deux sorties, et la différence compte :
 *
 * - sans paramètre, le fichier ne part QUE si toutes les lignes sont complètes. Sinon la
 *   route répond en texte clair avec la liste des dossiers et des champs manquants. Un
 *   fichier incomplet téléchargé par erreur finit déposé, et revient des semaines plus tard.
 * - avec `?incomplet=1`, le fichier sort quand même, pour travailler dessus. Le nom du
 *   fichier ne le dit pas : l'en-tête `X-Depot-Incomplet` et la réponse, si.
 */
import { utilisateurConnecte } from '../../../../lib/auth.js'
import { db as ouvrir } from '../../../../lib/db.js'
import { csvDepot, tableauDepot } from '../../../../lib/emmy.js'

export const dynamic = 'force-dynamic'

const texte = (corps, status) =>
  new Response(corps, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })

export async function GET(request, { params }) {
  const u = await utilisateurConnecte()
  if (!u) return texte('Non authentifié.', 401)
  // Le tableau porte les montants : même garde que l'export du lot.
  if (!u.permissions.includes('lot.gerer') || !u.permissions.includes('marge.voir')) {
    return texte("Accès refusé : le tableau de dépôt contient les montants.", 403)
  }

  const { id } = await params
  const sp = new URL(request.url).searchParams
  const db = ouvrir()

  // `?controle=1` ne télécharge rien : il répond ce qui manque, lisible à l'écran.
  if (sp.get('controle')) {
    const t = tableauDepot(db, id)
    if (!t) return texte('Lot introuvable.', 404)
    const lignes = [
      `Lot ${t.lot.numero} — ${t.lignes.length} dossier(s)`,
      `Gabarit : ${t.gabarit.source === 'GABARIT' ? t.delegataire.nom : 'intitulés de l\'annexe 6'}`,
      ...t.avertissements.map((a) => `⚠ ${a}`),
      '',
    ]
    for (const l of t.lignes) {
      if (!l.manquants.length && !l.anomalies.length) continue
      lignes.push(`${l.numero}`)
      for (const m of l.manquants) lignes.push(`  manque : ${m.libelle}${m.aide ? ` — ${m.aide}` : ''}`)
      for (const a of l.anomalies) lignes.push(`  ${a.libelle} : ${a.motif}`)
    }
    if (t.deposable) lignes.push('Toutes les lignes sont complètes.')
    return texte(lignes.join('\n'), 200)
  }

  const r = csvDepot(db, id, { incompletAutorise: !!sp.get('incomplet') })
  if (!r.ok) return texte(`Export refusé :\n${r.motifs.join('\n')}`, 422)

  return new Response(r.contenu, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${r.nomFichier}"`,
      'X-Depot-Incomplet': r.incomplet ? 'oui' : 'non',
    },
  })
}
