import { all, get } from './db.js'

/**
 * Rappels client — lecture.
 *
 * Trois paniers, comme l'équipe les lit le matin : en retard (avant aujourd'hui), du jour,
 * à venir. Le découpage se fait sur la **date** seule : un rappel de 9 h non fait à 11 h
 * reste « du jour », il ne passe en retard que le lendemain. Sinon le panier du jour se
 * viderait dans la matinée sans que rien n'ait été fait.
 *
 * La portée suit celle des dossiers : un rappel est visible si son dossier l'est.
 */

export const MOTIFS = [
  'Rappeler le client',
  'Relance devis',
  'Confirmer le rendez-vous',
  'Pièce manquante',
  'Relance signature AH',
  'Relance paiement',
  'Autre',
]

export const PANIERS = {
  retard: 'En retard',
  jour: 'Du jour',
  avenir: 'À venir',
  faits: 'Faits',
}

/** Date locale du serveur au format AAAA-MM-JJ : c'est « aujourd'hui » pour le bureau. */
export function aujourdhui(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const SELECT = `
  SELECT r.*, d.numero, d.id AS dossier_id,
         COALESCE(b.raison_sociale, TRIM(COALESCE(b.prenom, '') || ' ' || COALESCE(b.nom, ''))) AS client,
         b.telephone, s.code_postal, s.ville,
         ua.prenom AS attribue_prenom, ua.nom AS attribue_nom,
         uc.prenom AS cree_prenom, uc.nom AS cree_nom
  FROM rappel r
  JOIN dossier d ON d.id = r.dossier_id
  JOIN beneficiaire b ON b.id = d.beneficiaire_id
  JOIN site s ON s.id = d.site_id
  LEFT JOIN utilisateur ua ON ua.id = r.attribue_a
  LEFT JOIN utilisateur uc ON uc.id = r.cree_par`

function conditionPanier(panier, params, jour) {
  switch (panier) {
    case 'retard': params.push(jour); return 'r.fait_le IS NULL AND substr(r.date_rappel, 1, 10) < ?'
    case 'jour': params.push(jour); return 'r.fait_le IS NULL AND substr(r.date_rappel, 1, 10) = ?'
    case 'avenir': params.push(jour); return 'r.fait_le IS NULL AND substr(r.date_rappel, 1, 10) > ?'
    case 'faits': return 'r.fait_le IS NOT NULL'
    default: return 'r.fait_le IS NULL'
  }
}

/**
 * Liste filtrée. `attribueA` = identifiant d'utilisateur, ou « personne » pour les
 * rappels que personne n'a pris.
 */
export function listerRappels({ panier = 'jour', attribueA = null, motif = null, q = null, uniteId } = {}) {
  const params = []
  const conds = [conditionPanier(panier, params, aujourdhui()), 'd.supprime_le IS NULL']
  if (uniteId !== undefined) { conds.push('d.unite_affaire_id IS ?'); params.push(uniteId) }
  if (attribueA === 'personne') conds.push('r.attribue_a IS NULL')
  else if (attribueA) { conds.push('r.attribue_a = ?'); params.push(attribueA) }
  if (motif) { conds.push('r.motif = ?'); params.push(motif) }
  if (q) {
    conds.push(`(d.numero LIKE ? OR b.raison_sociale LIKE ? OR b.nom LIKE ? OR s.ville LIKE ? OR s.code_postal LIKE ? OR r.commentaire LIKE ?)`)
    for (let i = 0; i < 6; i++) params.push(`%${q}%`)
  }
  const ordre = panier === 'faits' ? 'r.fait_le DESC' : 'r.date_rappel ASC'
  return all(`${SELECT} WHERE ${conds.join(' AND ')} ORDER BY ${ordre} LIMIT 500`, params)
}

/** Compteurs des trois paniers ouverts, pour les onglets et le menu. */
export function compteurs({ attribueA = null, uniteId } = {}) {
  const params = [aujourdhui(), aujourdhui(), aujourdhui()]
  const conds = ['r.fait_le IS NULL', 'd.supprime_le IS NULL']
  if (uniteId !== undefined) { conds.push('d.unite_affaire_id IS ?'); params.push(uniteId) }
  if (attribueA) { conds.push('r.attribue_a = ?'); params.push(attribueA) }
  return get(`
    SELECT COALESCE(SUM(substr(r.date_rappel, 1, 10) < ?), 0) AS retard,
           COALESCE(SUM(substr(r.date_rappel, 1, 10) = ?), 0) AS jour,
           COALESCE(SUM(substr(r.date_rappel, 1, 10) > ?), 0) AS avenir
    FROM rappel r JOIN dossier d ON d.id = r.dossier_id
    WHERE ${conds.join(' AND ')}`, params)
}

export function rappelsDossier(dossierId) {
  return all(`${SELECT} WHERE r.dossier_id = ? ORDER BY (r.fait_le IS NOT NULL), r.date_rappel ASC LIMIT 50`, [dossierId])
}

export function utilisateursActifs() {
  return all(`SELECT id, prenom, nom FROM utilisateur WHERE actif = 1 ORDER BY prenom, nom`)
}
