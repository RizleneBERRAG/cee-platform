/**
 * Le planning : lecture et écriture des interventions.
 *
 * Toutes les fonctions reçoivent la base en paramètre — pas d'import de `db.js` ici — pour
 * être testables sur une base jetable, comme la facturation. Les actions serveur
 * (actions-planning.js) y ajoutent le contrôle de droit et de portée.
 *
 * ── Les dates ──
 *
 * Les heures sont locales et sans fuseau (« 2026-10-01T08:30 ») : c'est l'heure du chantier,
 * pas un instant absolu. Tout le calcul de jours se fait donc sur les CHAÎNES, en UTC, pour
 * qu'un passage à l'heure d'été ne décale jamais une pose d'un jour.
 */
import { STATUTS_INTERVENTION, DATE_DOSSIER_PAR_TYPE } from './referentiels-planning.js'

const uid = () => crypto.randomUUID()

// ── Jours ──────────────────────────────────────────────────────
const enDate = (jour) => new Date(`${jour}T00:00:00Z`)
const enJour = (d) => d.toISOString().slice(0, 10)
export const ajouterJours = (jour, n) => enJour(new Date(enDate(jour).getTime() + n * 86400000))
export const ecartJours = (a, b) => Math.round((enDate(b) - enDate(a)) / 86400000)
export const jourDe = (horodatage) => (horodatage ? horodatage.slice(0, 10) : null)
export const heureDe = (horodatage) => (horodatage && horodatage.length > 10 ? horodatage.slice(11, 16) : null)
/** 0 = lundi … 6 = dimanche. */
export const jourSemaine = (jour) => (enDate(jour).getUTCDay() + 6) % 7

/** Les jours affichés : la semaine du lundi au dimanche, ou le mois civil. */
export function periode(vue, reference) {
  if (vue === 'mois') {
    const debut = `${reference.slice(0, 7)}-01`
    const suivant = enDate(debut); suivant.setUTCMonth(suivant.getUTCMonth() + 1)
    const n = ecartJours(debut, enJour(suivant))
    return Array.from({ length: n }, (_, i) => ajouterJours(debut, i))
  }
  const lundi = ajouterJours(reference, -jourSemaine(reference))
  return Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i))
}

const FORMAT_HORODATAGE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
export function horodatageValide(v) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!FORMAT_HORODATAGE.test(s)) throw new Error(`Date invalide : « ${s} ».`)
  return s
}

// ── Lecture ────────────────────────────────────────────────────
export function typesIntervention(db, { tous = false } = {}) {
  return db.prepare(`SELECT * FROM type_intervention ${tous ? '' : 'WHERE actif = 1'} ORDER BY ordre, libelle`).all()
}

const SELECT = `
  SELECT i.*, t.code AS type_code, t.libelle AS type_libelle, t.couleur AS type_couleur,
         d.numero, d.unite_affaire_id,
         COALESCE(b.raison_sociale, TRIM(COALESCE(b.prenom, '') || ' ' || COALESCE(b.nom, ''))) AS client,
         b.telephone, s.adresse, s.code_postal, s.ville,
         st.libelle AS statut_dossier,
         u.prenom AS attribuee_prenom, u.nom AS attribuee_nom
  FROM intervention i
  JOIN type_intervention t ON t.id = i.type_id
  JOIN dossier d ON d.id = i.dossier_id
  JOIN beneficiaire b ON b.id = d.beneficiaire_id
  JOIN site s ON s.id = d.site_id
  LEFT JOIN statut st ON st.id = d.statut_dossier_id
  LEFT JOIN utilisateur u ON u.id = i.attribuee_a`

/**
 * Filtres communs. `uniteId` : portée des dossiers (undefined = toutes). `attribueeA` :
 * un utilisateur, ou null pour tout le monde. `typeId` : un calendrier, ou null pour tous.
 */
function filtres({ uniteId, attribueeA = null, typeId = null } = {}) {
  const conds = ['d.supprime_le IS NULL'], params = []
  if (uniteId !== undefined) { conds.push('d.unite_affaire_id IS ?'); params.push(uniteId) }
  if (attribueeA) { conds.push('i.attribuee_a = ?'); params.push(attribueeA) }
  if (typeId) { conds.push('i.type_id = ?'); params.push(typeId) }
  return { conds, params }
}

/** Interventions planifiées qui touchent la période [premier, dernier] (jours inclus). */
export function interventionsPeriode(db, premier, dernier, opts = {}) {
  const { conds, params } = filtres(opts)
  conds.push('i.debut IS NOT NULL', "i.statut <> 'ANNULEE'",
    'substr(i.debut, 1, 10) <= ?', 'substr(COALESCE(i.fin, i.debut), 1, 10) >= ?')
  params.push(dernier, premier)
  return db.prepare(`${SELECT} WHERE ${conds.join(' AND ')} ORDER BY i.debut`).all(...params)
}

/** Interventions sans date : la liste « à planifier ». */
export function interventionsAPlanifier(db, opts = {}) {
  const { conds, params } = filtres(opts)
  conds.push('i.debut IS NULL', "i.statut NOT IN ('ANNULEE', 'REALISEE')")
  return db.prepare(`${SELECT} WHERE ${conds.join(' AND ')} ORDER BY i.cree_le`).all(...params)
}

export function interventionsDossier(db, dossierId) {
  return db.prepare(`${SELECT} WHERE i.dossier_id = ?
    ORDER BY (i.debut IS NULL) DESC, i.debut DESC`).all(dossierId)
}

export function lireIntervention(db, id) {
  return db.prepare(`${SELECT} WHERE i.id = ?`).get(id)
}

/**
 * Les lignes du planning : les intervenants, regroupés par rôle. On y ajoute toute personne
 * qui porte une intervention de la période même si son compte a été désactivé depuis —
 * sinon ses rendez-vous disparaîtraient de l'écran sans que personne ne les réattribue.
 */
export function ressources(db, interventions = [], { seulement = null } = {}) {
  const actifs = db.prepare(`
    SELECT u.id, u.prenom, u.nom, COALESCE(r.nom, 'Sans rôle') AS role
    FROM utilisateur u LEFT JOIN role r ON r.id = u.role_id
    WHERE u.actif = 1 ${seulement ? 'AND u.id = ?' : ''}
    ORDER BY role, u.prenom, u.nom`).all(...(seulement ? [seulement] : []))
  const connus = new Set(actifs.map((u) => u.id))
  const manquants = [...new Set(interventions.map((i) => i.attribuee_a).filter((id) => id && !connus.has(id)))]
  for (const id of manquants) {
    const u = db.prepare('SELECT id, prenom, nom FROM utilisateur WHERE id = ?').get(id)
    if (u) actifs.push({ ...u, role: 'Comptes désactivés' })
  }
  return actifs
}

/** Compteurs par type sur la période, pour les onglets de calendrier. */
export function comptesParType(db, premier, dernier, opts = {}) {
  const liste = interventionsPeriode(db, premier, dernier, { ...opts, typeId: null })
  const aPlanifier = interventionsAPlanifier(db, { ...opts, typeId: null })
  const n = {}
  for (const i of [...liste, ...aPlanifier]) n[i.type_id] = (n[i.type_id] || 0) + 1
  return n
}

// ── Écriture ───────────────────────────────────────────────────
function exigerModifiable(i) {
  if (!i) throw new Error('Intervention introuvable.')
  if (!STATUTS_INTERVENTION[i.statut]?.modifiable) {
    throw new Error(`Cette intervention est ${STATUTS_INTERVENTION[i.statut]?.libelle.toLowerCase() || i.statut} : elle ne se modifie plus.`)
  }
}

function exigerOrdre(debut, fin) {
  if (debut && fin && fin < debut) throw new Error('La fin est avant le début.')
  if (!debut && fin) throw new Error('Une fin sans début : indiquez d\'abord le début.')
}

export function creerIntervention(db, { dossierId, typeId, debut = null, fin = null, attribueeA = null, commentaire = null, par = null }) {
  const type = db.prepare('SELECT id, actif FROM type_intervention WHERE id = ?').get(typeId)
  if (!type || !type.actif) throw new Error('Type d\'intervention inconnu.')
  debut = horodatageValide(debut); fin = horodatageValide(fin)
  exigerOrdre(debut, fin)
  const id = uid()
  db.prepare(`INSERT INTO intervention (id, dossier_id, type_id, debut, fin, attribuee_a, statut, commentaire, cree_par)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, dossierId, typeId, debut, fin, attribueeA || null, debut ? 'PLANIFIEE' : 'A_PLANIFIER', commentaire || null, par)
  return id
}

/**
 * Le glisser-déposer : amène l'intervention sur un jour et une personne. L'heure et la
 * durée sont conservées ; une intervention à planifier arrive à 8 h.
 */
export function deplacerIntervention(db, id, { jour, attribueeA = null }) {
  const i = db.prepare('SELECT * FROM intervention WHERE id = ?').get(id)
  exigerModifiable(i)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour || '')) throw new Error('Jour invalide.')
  let debut, fin
  if (i.debut) {
    const decalage = ecartJours(jourDe(i.debut), jour)
    debut = `${jour}${i.debut.slice(10)}`
    fin = i.fin ? `${ajouterJours(jourDe(i.fin), decalage)}${i.fin.slice(10)}` : null
  } else {
    debut = `${jour}T08:00`
    fin = null
  }
  // Un rendez-vous confirmé qu'on déplace n'est plus confirmé : le client a dit oui à une
  // autre date. Le laisser « confirmé » ferait partir un poseur chez quelqu'un qui n'attend
  // personne ce jour-là.
  const change = debut !== i.debut
  const statut = i.statut === 'A_PLANIFIER' || (i.statut === 'CONFIRMEE' && change) ? 'PLANIFIEE' : i.statut
  db.prepare(`UPDATE intervention SET debut = ?, fin = ?, attribuee_a = ?, statut = ?,
              confirmee_par = CASE WHEN ? = 'PLANIFIEE' THEN NULL ELSE confirmee_par END,
              confirmee_le = CASE WHEN ? = 'PLANIFIEE' THEN NULL ELSE confirmee_le END
              WHERE id = ?`).run(debut, fin, attribueeA || null, statut, statut, statut, id)
  return { debut, fin, statut }
}

/** Modification complète depuis un formulaire : dates, personne, commentaire. */
export function modifierIntervention(db, id, { debut = null, fin = null, attribueeA = null, commentaire = null }) {
  const i = db.prepare('SELECT * FROM intervention WHERE id = ?').get(id)
  exigerModifiable(i)
  debut = horodatageValide(debut); fin = horodatageValide(fin)
  exigerOrdre(debut, fin)
  const statut = !debut ? 'A_PLANIFIER' : i.statut === 'A_PLANIFIER' || (i.statut === 'CONFIRMEE' && debut !== i.debut) ? 'PLANIFIEE' : i.statut
  db.prepare(`UPDATE intervention SET debut = ?, fin = ?, attribuee_a = ?, commentaire = ?, statut = ?
              WHERE id = ?`).run(debut, fin, attribueeA || null, commentaire || null, statut, id)
}

export function confirmerIntervention(db, id, { par = null } = {}) {
  const i = db.prepare('SELECT * FROM intervention WHERE id = ?').get(id)
  exigerModifiable(i)
  if (!i.debut) throw new Error('On ne confirme pas un rendez-vous sans date.')
  db.prepare(`UPDATE intervention SET statut = 'CONFIRMEE', confirmee_par = ?, confirmee_le = datetime('now') WHERE id = ?`).run(par, id)
}

export function annulerIntervention(db, id, { motif = null } = {}) {
  const i = db.prepare('SELECT * FROM intervention WHERE id = ?').get(id)
  exigerModifiable(i)
  db.prepare(`UPDATE intervention SET statut = 'ANNULEE', compte_rendu = ? WHERE id = ?`).run(motif || null, id)
}

/**
 * Réalisée. Renseigne la date correspondante du dossier si elle est vide, et renvoie ce qui
 * a été renseigné — l'appelant le journalise.
 */
export function realiserIntervention(db, id, { compteRendu = null } = {}) {
  const i = db.prepare(`SELECT i.*, t.code AS type_code FROM intervention i
                        JOIN type_intervention t ON t.id = i.type_id WHERE i.id = ?`).get(id)
  exigerModifiable(i)
  if (!i.debut) throw new Error('Une intervention sans date ne peut pas être réalisée : planifiez-la d\'abord.')
  db.prepare(`UPDATE intervention SET statut = 'REALISEE', realisee_le = datetime('now'), compte_rendu = ? WHERE id = ?`)
    .run(compteRendu || null, id)
  const cible = DATE_DOSSIER_PAR_TYPE[i.type_code]
  if (!cible) return null
  const [colonne, libelle] = cible
  const valeur = jourDe(i.fin || i.debut)
  const avant = db.prepare(`SELECT ${colonne} AS v FROM dossier WHERE id = ?`).get(i.dossier_id)?.v
  if (avant) return null
  db.prepare(`UPDATE dossier SET ${colonne} = ? WHERE id = ?`).run(valeur, i.dossier_id)
  return { dossierId: i.dossier_id, champ: libelle, nouvelle: valeur }
}

/** Revenir en arrière sur une réalisation ou une annulation saisie par erreur. */
export function rouvrirIntervention(db, id) {
  const i = db.prepare('SELECT * FROM intervention WHERE id = ?').get(id)
  if (!i) throw new Error('Intervention introuvable.')
  db.prepare(`UPDATE intervention SET statut = ?, realisee_le = NULL WHERE id = ?`).run(i.debut ? 'PLANIFIEE' : 'A_PLANIFIER', id)
}
