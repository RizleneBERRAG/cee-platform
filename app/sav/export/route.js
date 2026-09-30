/**
 * Export CSV des S.A.V, avec les filtres de l'écran. Séparateur « ; » et BOM : c'est ce
 * qu'Excel ouvre sans assistant sur un poste français.
 */
import { utilisateurConnecte } from '../../../lib/auth.js'
import { db } from '../../../lib/db.js'
import { listerSav } from '../../../lib/sav.js'

export const dynamic = 'force-dynamic'

const cellule = (v) => {
  const s = v === null || v === undefined ? '' : String(v)
  // Une cellule qui commence par = + - @ serait exécutée comme formule par le tableur.
  const sur = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[";\n\r]/.test(sur) ? `"${sur.replace(/"/g, '""')}"` : sur
}

export async function GET(request) {
  const u = await utilisateurConnecte()
  if (!u) return new Response('Non authentifié.', { status: 401 })
  if (!u.permissions.includes('dossier.voir')) return new Response('Accès refusé.', { status: 403 })
  const sp = new URL(request.url).searchParams
  const portee = u.permissions.includes('dossier.tous') ? {} : { uniteId: u.uniteId ?? '—aucune—' }
  const etat = ['ouverts', 'clos', 'tous'].includes(sp.get('etat')) ? sp.get('etat') : 'ouverts'
  const liste = listerSav(db(), {
    etat, statutId: sp.get('statut') || null, typeId: sp.get('type') || null, motifId: sp.get('motif') || null,
    attribueA: sp.get('qui') === 'moi' ? u.id : sp.get('qui') || null, q: sp.get('q') || null, ...portee,
  })
  const colonnes = [
    ['numero', 'N° S.A.V'], ['dossier_numero', 'Dossier'], ['client', 'Client'], ['code_postal', 'CP'], ['ville', 'Ville'],
    ['statut_dossier', 'Statut dossier'], ['type_libelle', 'Type'], ['statut_libelle', 'Statut S.A.V'], ['motif_libelle', 'Motif'],
    ['attribue', 'Attribué à'], ['ouvert_le', 'Ouvert le'], ['intervention', 'Intervention'], ['regle_le', 'Réglé le'],
    ['cloture', 'Clôturé'], ['probleme', 'Problème'], ['observation', 'Observation'],
  ]
  const lignes = liste.map((v) => ({
    ...v, attribue: v.attribue_prenom ? `${v.attribue_prenom} ${v.attribue_nom}` : '',
    intervention: v.intervention_debut || v.date_intervention || '', cloture: v.cloture ? 'oui' : 'non',
  }))
  const csv = '﻿' + [colonnes.map(([, l]) => l), ...lignes.map((v) => colonnes.map(([k]) => v[k]))]
    .map((r) => r.map(cellule).join(';')).join('\r\n')
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sav-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}
