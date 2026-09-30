/**
 * Le S.A.V : lecture et écriture. Reçoit la base en paramètre, comme la facturation et le
 * planning, pour se tester sur une base jetable.
 *
 * Un S.A.V se clôt de deux façons qui disent la même chose : cocher « clôturé », ou choisir
 * un statut de clôture (« Réglé »). Les deux sont tenus ensemble — un S.A.V « Réglé » mais
 * ouvert, ou clôturé mais « En cours », fausserait les compteurs sans que personne le voie.
 */
import { creerIntervention } from './planning.js'

const uid = () => crypto.randomUUID()
const aujourdhui = () => new Date().toISOString().slice(0, 10)

export function referentielSav(db, categorie, { tous = false } = {}) {
  return db.prepare(`SELECT * FROM sav_referentiel WHERE categorie = ? ${tous ? '' : 'AND actif = 1'} ORDER BY ordre, libelle`).all(categorie)
}

const SELECT = `
  SELECT v.*, d.numero AS dossier_numero, d.unite_affaire_id,
         COALESCE(b.raison_sociale, TRIM(COALESCE(b.prenom, '') || ' ' || COALESCE(b.nom, ''))) AS client,
         b.telephone, s.code_postal, s.ville,
         st.libelle AS statut_dossier,
         rt.libelle AS type_libelle, rm.libelle AS motif_libelle, rs.libelle AS statut_libelle,
         u.prenom AS attribue_prenom, u.nom AS attribue_nom,
         i.debut AS intervention_debut, i.statut AS intervention_statut
    FROM sav v
    JOIN dossier d ON d.id = v.dossier_id
    JOIN beneficiaire b ON b.id = d.beneficiaire_id
    JOIN site s ON s.id = d.site_id
    LEFT JOIN statut st ON st.id = d.statut_dossier_id
    LEFT JOIN sav_referentiel rt ON rt.id = v.type_id
    LEFT JOIN sav_referentiel rm ON rm.id = v.motif_id
    LEFT JOIN sav_referentiel rs ON rs.id = v.statut_id
    LEFT JOIN utilisateur u ON u.id = v.attribue_a
    LEFT JOIN intervention i ON i.id = v.intervention_id`

/** `etat` : 'ouverts' (défaut), 'clos' ou 'tous'. Les dossiers à la corbeille n'y sont pas. */
export function listerSav(db, { etat = 'ouverts', statutId = null, typeId = null, motifId = null, attribueA = null, q = null, uniteId } = {}) {
  const conds = ['d.supprime_le IS NULL'], params = []
  if (etat === 'ouverts') conds.push('v.cloture = 0')
  if (etat === 'clos') conds.push('v.cloture = 1')
  if (statutId) { conds.push('v.statut_id = ?'); params.push(statutId) }
  if (typeId) { conds.push('v.type_id = ?'); params.push(typeId) }
  if (motifId) { conds.push('v.motif_id = ?'); params.push(motifId) }
  if (attribueA === 'personne') conds.push('v.attribue_a IS NULL')
  else if (attribueA) { conds.push('v.attribue_a = ?'); params.push(attribueA) }
  if (uniteId !== undefined) { conds.push('d.unite_affaire_id IS ?'); params.push(uniteId) }
  if (q) {
    conds.push('(v.numero LIKE ? OR d.numero LIKE ? OR b.raison_sociale LIKE ? OR b.nom LIKE ? OR s.ville LIKE ? OR v.probleme LIKE ?)')
    for (let k = 0; k < 6; k++) params.push(`%${q}%`)
  }
  return db.prepare(`${SELECT} WHERE ${conds.join(' AND ')} ORDER BY v.cloture, v.ouvert_le DESC, v.numero DESC LIMIT 1000`).all(...params)
}

/** Compteurs par statut (S.A.V ouverts seulement), pour les onglets. */
export function comptesSav(db, { uniteId } = {}) {
  const params = []
  let cond = 'd.supprime_le IS NULL AND v.cloture = 0'
  if (uniteId !== undefined) { cond += ' AND d.unite_affaire_id IS ?'; params.push(uniteId) }
  const parStatut = {}
  let ouverts = 0
  for (const r of db.prepare(`SELECT v.statut_id, COUNT(*) AS n FROM sav v JOIN dossier d ON d.id = v.dossier_id WHERE ${cond} GROUP BY v.statut_id`).all(...params)) {
    parStatut[r.statut_id || ''] = r.n
    ouverts += r.n
  }
  return { parStatut, ouverts }
}

export function lireSav(db, id) { return db.prepare(`${SELECT} WHERE v.id = ?`).get(id) }
export function savDossier(db, dossierId) { return db.prepare(`${SELECT} WHERE v.dossier_id = ? ORDER BY v.cloture, v.ouvert_le DESC`).all(dossierId) }

function prochainNumero(db) {
  const annee = new Date().getFullYear()
  const dernier = db.prepare('SELECT numero FROM sav WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1').get(`SAV-${annee}-%`)
  return `SAV-${annee}-${String(dernier ? Number(dernier.numero.split('-')[2]) + 1 : 1).padStart(4, '0')}`
}

function verifierReference(db, categorie, id) {
  if (!id) return null
  const r = db.prepare('SELECT id, categorie, cloture FROM sav_referentiel WHERE id = ?').get(id)
  if (!r || r.categorie !== categorie) throw new Error(`Valeur inconnue pour « ${categorie.toLowerCase()} ».`)
  return r
}

export function creerSav(db, { dossierId, typeId = null, motifId = null, statutId = null, attribueA = null, probleme = null, par = null }) {
  verifierReference(db, 'TYPE', typeId); verifierReference(db, 'MOTIF', motifId)
  // Sans statut choisi, le premier de la liste — « À traiter » par défaut.
  const statut = statutId ? verifierReference(db, 'STATUT', statutId) : referentielSav(db, 'STATUT').find((s) => !s.cloture) || null
  const id = uid()
  const clos = statut?.cloture ? 1 : 0
  db.prepare(`INSERT INTO sav (id, numero, dossier_id, type_id, motif_id, statut_id, attribue_a, probleme, cloture, regle_le, cree_par)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, prochainNumero(db), dossierId, typeId, motifId, statut?.id || null, attribueA, probleme, clos, clos ? aujourdhui() : null, par)
  return id
}

/**
 * Modification complète. Renvoie la liste des champs changés, pour le journal.
 * La clôture suit le statut, et inversement (voir en-tête).
 */
export function modifierSav(db, id, champs) {
  const avant = db.prepare('SELECT * FROM sav WHERE id = ?').get(id)
  if (!avant) throw new Error('S.A.V introuvable.')
  verifierReference(db, 'TYPE', champs.typeId); verifierReference(db, 'MOTIF', champs.motifId)
  let statut = champs.statutId ? verifierReference(db, 'STATUT', champs.statutId) : null
  const ouvert = () => referentielSav(db, 'STATUT').find((s) => !s.cloture) || statut
  const ferme = () => referentielSav(db, 'STATUT').find((s) => s.cloture) || statut
  let cloture
  if (avant.cloture && !champs.cloture) {
    // Case décochée : on rouvre, et un statut de clôture laissé tel quel repasse au premier
    // statut ouvert — sinon le S.A.V se refermerait aussitôt.
    cloture = 0
    if (statut?.cloture) statut = ouvert()
  } else if (champs.cloture || statut?.cloture) {
    // Case cochée, ou statut de clôture choisi : les deux vont ensemble.
    cloture = 1
    if (!statut?.cloture) statut = ferme()
  } else {
    cloture = 0
  }
  const regle = cloture ? (champs.regleLe || avant.regle_le || aujourdhui()) : null
  const apres = {
    type_id: champs.typeId || null, motif_id: champs.motifId || null, statut_id: statut?.id || null,
    attribue_a: champs.attribueA || null, probleme: champs.probleme || null, observation: champs.observation || null,
    date_intervention: champs.dateIntervention || avant.date_intervention || null, cloture, regle_le: regle,
  }
  const changes = Object.keys(apres).filter((k) => String(avant[k] ?? '') !== String(apres[k] ?? ''))
  if (changes.length) {
    db.prepare(`UPDATE sav SET ${changes.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...changes.map((k) => apres[k]), id)
  }
  return changes
}

/**
 * Planifie l'intervention S.A.V du planning pour ce dossier et la rattache. Sans date, elle
 * attend dans la colonne « à planifier ».
 */
export function planifierInterventionSav(db, id, { debut = null, attribueA = null, par = null } = {}) {
  const v = db.prepare('SELECT * FROM sav WHERE id = ?').get(id)
  if (!v) throw new Error('S.A.V introuvable.')
  if (v.intervention_id) throw new Error('Une intervention est déjà rattachée à ce S.A.V.')
  const type = db.prepare("SELECT id FROM type_intervention WHERE code = 'SAV'").get()
  if (!type) throw new Error("Le type d'intervention « S.A.V » n'existe pas au planning.")
  const interventionId = creerIntervention(db, {
    dossierId: v.dossier_id, typeId: type.id, debut, attribueeA: attribueA || v.attribue_a,
    commentaire: `${v.numero}${v.probleme ? ` — ${v.probleme.slice(0, 200)}` : ''}`, par,
  })
  db.prepare('UPDATE sav SET intervention_id = ?, date_intervention = ? WHERE id = ?').run(interventionId, debut ? debut.slice(0, 10) : null, id)
  return interventionId
}
