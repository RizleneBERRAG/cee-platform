import { utilisateurConnecte } from '../../../lib/auth.js'
import {
  rechercherTout, colonnesVisibles, COLONNES, COLONNES_PAR_DEFAUT, CRITERES, compter,
} from '../../../lib/recherche.js'
import { calculDossier } from '../../../lib/queries.js'
import { completude } from '../../../lib/documents.js'

export const dynamic = 'force-dynamic'

/**
 * Export CSV du résultat de recherche courant.
 *
 * Deux points de vigilance :
 *
 * - **Les colonnes de montants sont retirées côté serveur**, pas cachées. Sans le droit
 *   `marge.voir`, elles ne sont ni calculées ni écrites — une route de téléchargement
 *   contourne tout l'affichage, elle porte donc sa propre garde.
 * - **La portée est celle de l'utilisateur.** Les mêmes filtres que l'écran, plus le
 *   cloisonnement par unité d'affaire, appliqués par la même fonction : l'export ne peut
 *   pas montrer plus que la liste.
 */
export async function GET(request) {
  const u = await utilisateurConnecte()
  if (!u) return new Response('Non authentifié.', { status: 401 })
  if (!u.permissions.includes('dossier.voir')) {
    return new Response('Accès refusé.', { status: 403 })
  }

  const voitMarge = u.permissions.includes('marge.voir')
  const portee = u.permissions.includes('dossier.tous') ? {} : { uniteId: u.uniteId ?? '—aucune—' }
  const sp = new URL(request.url).searchParams

  const valeurs = {}
  for (const cle of [...Object.keys(CRITERES), 'q']) {
    const v = sp.get(cle)
    if (v != null && v.trim() !== '') valeurs[cle] = v
  }

  const tri = sp.get('tri') || 'numero'
  const sens = sp.get('sens') === 'asc' ? 'asc' : 'desc'
  const choisies = sp.getAll('col')
  const colonnes = colonnesVisibles(choisies.length ? choisies : COLONNES_PAR_DEFAUT, voitMarge)

  // Garde-fou : au-delà, le fichier devient ingérable et la requête trop longue.
  const total = compter(valeurs, portee)
  const PLAFOND = 20000
  const lignes = rechercherTout(valeurs, portee, { tri, sens, plafond: PLAFOND })

  const entete = colonnes.map((c) => COLONNES[c].libelle)
  const corps = lignes.map((d) => {
    const calc = calculDossier(d, { tauxApporteur: 8 })
    return colonnes.map((cle) => valeurPour(cle, d, calc))
  })

  // Point-virgule et BOM UTF-8 : Excel en français ouvre le fichier sans boîte de dialogue.
  const csv = '﻿' + [entete, ...corps].map((l) => l.map(echapper).join(';')).join('\r\n')
  const horodatage = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const nom = `dossiers-${horodatage}.csv`

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nom}"`,
      // L'écran affiche le compte réel ; si l'export a été tronqué, on le dit dans l'en-tête
      // HTTP plutôt que de laisser croire au fichier qu'il est complet.
      'X-Total-Resultats': String(total),
      'X-Lignes-Exportees': String(lignes.length),
    },
  })
}

function valeurPour(cle, d, calc) {
  switch (cle) {
    case 'numero': return d.numero
    case 'ref_externe': return d.ref_externe
    case 'beneficiaire': return d.raison_sociale
    case 'siret': return d.siret
    case 'contact': return [d.benef_prenom, d.benef_nom].filter(Boolean).join(' ')
    case 'telephone': return d.telephone
    case 'ville': return d.ville
    case 'code_postal': return d.code_postal
    case 'departement': return d.departement
    case 'zone': return d.zone_climatique
    case 'qpv': return d.qpv ? 'oui' : 'non'
    case 'fiche': return d.fiche_code
    case 'version': return d.fv_version
    case 'quantite': return nb(d.quantite)
    case 'statut': return d.statut_libelle
    case 'etape': return d.etape_libelle
    case 'cofrac': return d.cofrac_libelle
    case 'eligibilite': return calc.eligibilite.applicable ? 'éligible' : `hors validité — ${calc.eligibilite.motif || ''}`
    case 'pieces': {
      const c = completude(d)
      return c.sansLiasse ? '' : `${c.tauxComplet} %`
    }
    case 'unite': return d.unite_nom
    case 'delegataire': return d.delegataire_nom
    case 'lot': return d.lot_numero
    case 'engagement': return d.date_engagement
    case 'pose': return d.date_pose
    case 'depot': return d.date_depot
    case 'cumac': return calc.eligibilite.applicable ? nb(calc.cumac.cumac / 1000) : ''
    case 'ca': return nb(d.prime_delegataire)
    case 'prime': return nb(d.prime_beneficiaire)
    case 'marge': return calc.valorisation ? nb(calc.valorisation.margeNette) : ''
    default: return ''
  }
}

/** Virgule décimale : sans elle, Excel en français lit « 1234.5 » comme du texte. */
function nb(v) {
  if (v == null || v === '') return ''
  return String(Math.round(Number(v) * 100) / 100).replace('.', ',')
}

function echapper(v) {
  const s = v == null ? '' : String(v)
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
