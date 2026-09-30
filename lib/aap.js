/**
 * Appels à paiement : ce que le délégataire doit, facturé, puis encaissé.
 *
 * Le trajet est celui de Pixel — en création, validé, paiement en attente, paiement reçu —
 * avec deux choses en plus, qui sont la raison d'être de l'écran :
 *
 * 1. **L'écart entre déposé et validé.** Chaque ligne garde le volume et la prime figés sur
 *    le dossier, et reçoit ce que le délégataire valide réellement. Un délégataire qui rogne
 *    un volume ou applique un autre prix le fait sans prévenir ; l'écart le montre.
 * 2. **L'écart entre facturé et reçu.** Un virement plus faible que la facture est
 *    signalé à l'encaissement, pas découvert au bilan.
 *
 * La facture adressée au délégataire est une facture : son numéro est pris dans la série de
 * la société, au moment de l'émission et pas avant, avec les mêmes contrôles de mentions
 * légales que les factures clients. S'il a été émis par un autre logiciel, on le saisit.
 *
 * Toutes les fonctions reçoivent la base : elles se testent sur une base jetable.
 */
import { arrondi } from './montants.js'
import { attribuerNumeroFacture, controlerFacture } from './facture.js'
import { coordonneesBancaires } from './listes.js'

export const STATUTS_AAP = {
  EN_CREATION: { libelle: 'En cours de création', couleur: '#d97706' },
  VALIDE: { libelle: 'Validé', couleur: '#2563eb' },
  PAIEMENT_ATTENDU: { libelle: 'Paiement en attente', couleur: '#7c3aed' },
  PAYE: { libelle: 'Paiement reçu', couleur: '#059669' },
}

const uid = () => crypto.randomUUID()
const lire = (db, id) => db.prepare('SELECT * FROM appel_paiement WHERE id = ?').get(id)
function exigerStatut(a, ...permis) {
  if (!a) throw new Error('Appel à paiement introuvable.')
  if (!permis.includes(a.statut)) {
    throw new Error(`Cet appel est « ${STATUTS_AAP[a.statut]?.libelle || a.statut} » : l'opération n'est plus possible.`)
  }
}

function prochainNumero(db, aujourdhui = new Date()) {
  const annee = aujourdhui.getFullYear()
  const dernier = db.prepare('SELECT numero FROM appel_paiement WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1').get(`AAP-${annee}-%`)
  const n = dernier ? Number(dernier.numero.split('-')[2]) + 1 : 1
  return `AAP-${annee}-${String(n).padStart(3, '0')}`
}

/** Le délégataire d'un lot : son identifiant, ou à défaut celui dont le nom est l'organisme saisi. */
export function delegataireDuLot(db, lotId) {
  const l = db.prepare('SELECT delegataire_id, organisme FROM lot WHERE id = ?').get(lotId)
  if (!l) return null
  if (l.delegataire_id) return l.delegataire_id
  return db.prepare('SELECT id FROM delegataire WHERE nom = ?').get(l.organisme || '')?.id || null
}

// ── Lecture ────────────────────────────────────────────────────

/**
 * Les dossiers qu'on peut appeler : du délégataire, valorisés (montants figés), et dans aucun
 * autre appel. Un dossier non figé n'a pas de prime arrêtée — l'appeler, ce serait facturer
 * un montant qui peut encore changer.
 */
export function dossiersAppelables(db, delegataireId, { lotId = null } = {}) {
  return db.prepare(`
    SELECT d.id, d.numero, d.volume_cumac, d.prime_delegataire, d.date_calcul, d.lot_id,
           l.numero AS lot_numero, f.code AS fiche_code,
           COALESCE(b.raison_sociale, TRIM(COALESCE(b.prenom, '') || ' ' || COALESCE(b.nom, ''))) AS client
      FROM dossier d
      JOIN beneficiaire b ON b.id = d.beneficiaire_id
      JOIN fiche f ON f.id = d.fiche_id
      LEFT JOIN lot l ON l.id = d.lot_id
     WHERE d.delegataire_id = ? AND d.date_calcul IS NOT NULL AND d.supprime_le IS NULL
       AND NOT EXISTS (SELECT 1 FROM appel_paiement_ligne x WHERE x.dossier_id = d.id)
       ${lotId ? 'AND d.lot_id = ?' : ''}
     ORDER BY l.numero, d.numero`).all(...(lotId ? [delegataireId, lotId] : [delegataireId]))
}

export function lignesAppel(db, appelId) {
  return db.prepare(`
    SELECT x.*, d.numero, d.lot_id, l.numero AS lot_numero, f.code AS fiche_code,
           COALESCE(b.raison_sociale, TRIM(COALESCE(b.prenom, '') || ' ' || COALESCE(b.nom, ''))) AS client,
           b.siret
      FROM appel_paiement_ligne x
      JOIN dossier d ON d.id = x.dossier_id
      JOIN beneficiaire b ON b.id = d.beneficiaire_id
      JOIN fiche f ON f.id = d.fiche_id
      LEFT JOIN lot l ON l.id = d.lot_id
     WHERE x.appel_id = ? ORDER BY d.numero`).all(appelId)
}

/** Totaux calculés sur les lignes. Une fois la facture émise, ce sont les totaux figés qui font foi. */
export function totauxAppel(db, appelId) {
  const a = lire(db, appelId)
  const lignes = lignesAppel(db, appelId)
  const somme = (k) => arrondi(lignes.reduce((s, l) => s + (Number(l[k]) || 0), 0))
  const ht = somme('prime_ht')
  const tva = arrondi(ht * (Number(a?.taux_tva) || 0) / 100)
  const cumac = lignes.reduce((s, l) => s + (Number(l.cumac_valide) || 0), 0)
  const cumacDepose = lignes.reduce((s, l) => s + (Number(l.cumac_depose) || 0), 0)
  const primeAttendue = somme('prime_attendue')
  return {
    nb: lignes.length, cumac, cumacDepose, ht, tva, ttc: arrondi(ht + tva), primeAttendue,
    ecartCumac: cumac - cumacDepose,
    ecartPrime: arrondi(ht - primeAttendue),
    prixMwh: cumac > 0 ? arrondi(ht / (cumac / 1000)) : null,
    lignesEcart: lignes.filter((l) => Number(l.cumac_valide) !== Number(l.cumac_depose) || arrondi(l.prime_ht) !== arrondi(l.prime_attendue)).length,
  }
}

export function lireAppel(db, id) {
  const a = db.prepare(`
    SELECT a.*, dg.nom AS delegataire_nom, dg.oblige AS delegataire_oblige, dg.siren AS delegataire_siren,
           l.numero AS lot_numero, e.raison_sociale AS entite_nom
      FROM appel_paiement a
      JOIN delegataire dg ON dg.id = a.delegataire_id
      LEFT JOIN lot l ON l.id = a.lot_id
      LEFT JOIN entite_emettrice e ON e.id = a.entite_id
     WHERE a.id = ?`).get(id)
  if (!a) return null
  return { ...a, lignes: lignesAppel(db, id), totaux: totauxAppel(db, id) }
}

export function listerAppels(db, { statut = null, delegataireId = null, lotId = null, q = null } = {}) {
  const conds = [], params = []
  if (statut) { conds.push('a.statut = ?'); params.push(statut) }
  if (delegataireId) { conds.push('a.delegataire_id = ?'); params.push(delegataireId) }
  if (lotId) { conds.push('(a.lot_id = ? OR EXISTS (SELECT 1 FROM appel_paiement_ligne x JOIN dossier d ON d.id = x.dossier_id WHERE x.appel_id = a.id AND d.lot_id = ?))'); params.push(lotId, lotId) }
  if (q) { conds.push('(a.numero LIKE ? OR a.num_aaf LIKE ? OR a.numero_facture LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const liste = db.prepare(`
    SELECT a.*, dg.nom AS delegataire_nom, l.numero AS lot_numero
      FROM appel_paiement a JOIN delegataire dg ON dg.id = a.delegataire_id LEFT JOIN lot l ON l.id = a.lot_id
      ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY a.cree_le DESC`).all(...params)
  // Tant que la facture n'est pas émise, les totaux sont ceux des lignes ; ensuite, les figés.
  return liste.map((a) => {
    const t = totauxAppel(db, a.id)
    const fige = a.total_ht !== null && a.total_ht !== undefined
    return { ...a, nb: t.nb, cumac: fige ? a.total_cumac : t.cumac, ht: fige ? a.total_ht : t.ht,
      tva: fige ? a.total_tva : t.tva, ttc: fige ? a.total_ttc : t.ttc, ecartPrime: t.ecartPrime }
  })
}

export function comptesParStatut(db) {
  const n = Object.fromEntries(Object.keys(STATUTS_AAP).map((k) => [k, 0]))
  for (const r of db.prepare('SELECT statut, COUNT(*) AS n FROM appel_paiement GROUP BY statut').all()) n[r.statut] = r.n
  return n
}

// ── Écriture ───────────────────────────────────────────────────

export function creerAppel(db, { delegataireId, lotId = null, entiteId = null, par = null, aujourdhui = new Date() }) {
  if (lotId && !delegataireId) delegataireId = delegataireDuLot(db, lotId)
  if (!delegataireId || !db.prepare('SELECT 1 AS x FROM delegataire WHERE id = ?').get(delegataireId)) {
    throw new Error(lotId ? "Le délégataire de ce lot n'est pas identifié : choisissez-le." : 'Délégataire inconnu.')
  }
  const entite = entiteId || db.prepare('SELECT id FROM entite_emettrice WHERE par_defaut = 1 AND actif = 1').get()?.id || null
  const id = uid()
  db.prepare(`INSERT INTO appel_paiement (id, numero, delegataire_id, entite_id, lot_id, cree_par) VALUES (?,?,?,?,?,?)`)
    .run(id, prochainNumero(db, aujourdhui), delegataireId, entite, lotId, par)
  if (lotId) ajouterDossiers(db, id, dossiersAppelables(db, delegataireId, { lotId }).map((d) => d.id))
  return id
}

/** Ajoute des dossiers. Ceux qui ne peuvent pas l'être sont renvoyés avec leur motif, pas ignorés. */
export function ajouterDossiers(db, appelId, dossierIds) {
  const a = lire(db, appelId)
  exigerStatut(a, 'EN_CREATION')
  const ajoutes = [], refuses = []
  const ins = db.prepare(`INSERT INTO appel_paiement_ligne (id, appel_id, dossier_id, cumac_depose, prime_attendue, cumac_valide, prime_ht)
                          VALUES (?,?,?,?,?,?,?)`)
  for (const dossierId of dossierIds) {
    const d = db.prepare('SELECT id, numero, delegataire_id, volume_cumac, prime_delegataire, date_calcul FROM dossier WHERE id = ?').get(dossierId)
    const ailleurs = db.prepare(`SELECT a.numero FROM appel_paiement_ligne x JOIN appel_paiement a ON a.id = x.appel_id WHERE x.dossier_id = ?`).get(dossierId)
    const motif = !d ? 'dossier introuvable'
      : d.delegataire_id !== a.delegataire_id ? "d'un autre délégataire"
        : !d.date_calcul ? 'montants non figés'
          : ailleurs ? `déjà dans ${ailleurs.numero}` : null
    if (motif) { refuses.push({ numero: d?.numero || dossierId, motif }); continue }
    ins.run(uid(), appelId, dossierId, d.volume_cumac, d.prime_delegataire, d.volume_cumac, d.prime_delegataire)
    ajoutes.push(d.numero)
  }
  return { ajoutes, refuses }
}

export function retirerDossier(db, appelId, dossierId) {
  exigerStatut(lire(db, appelId), 'EN_CREATION')
  db.prepare('DELETE FROM appel_paiement_ligne WHERE appel_id = ? AND dossier_id = ?').run(appelId, dossierId)
}

/** Ce que le délégataire a validé pour un dossier. Vide = identique au déposé. */
export function majLigne(db, ligneId, { cumacValide = null, primeHt = null }) {
  const l = db.prepare('SELECT * FROM appel_paiement_ligne WHERE id = ?').get(ligneId)
  if (!l) throw new Error('Ligne introuvable.')
  exigerStatut(lire(db, l.appel_id), 'EN_CREATION')
  const c = cumacValide === null || cumacValide === '' ? l.cumac_depose : Number(cumacValide)
  const p = primeHt === null || primeHt === '' ? l.prime_attendue : arrondi(primeHt)
  if (!(c >= 0) || !(p >= 0)) throw new Error('Volume et prime validés doivent être positifs.')
  db.prepare('UPDATE appel_paiement_ligne SET cumac_valide = ?, prime_ht = ? WHERE id = ?').run(c, p, ligneId)
}

export function majEntete(db, id, { numAaf = null, dateAaf = null, tauxTva = null, commentaire = null, entiteId = null }) {
  const a = lire(db, id)
  if (!a) throw new Error('Appel à paiement introuvable.')
  // Après émission de la facture, seuls l'AAF et le commentaire restent modifiables : la
  // société émettrice et la TVA sont sur un document parti.
  const facture = a.statut === 'PAIEMENT_ATTENDU' || a.statut === 'PAYE'
  const taux = tauxTva === null || tauxTva === '' ? a.taux_tva : Number(tauxTva)
  if (!(taux >= 0 && taux <= 100)) throw new Error('Taux de TVA invalide.')
  db.prepare(`UPDATE appel_paiement SET num_aaf = ?, date_aaf = ?, commentaire = ?, taux_tva = ?, entite_id = ? WHERE id = ?`)
    .run(numAaf || null, dateAaf || null, commentaire || null, facture ? a.taux_tva : taux, facture ? a.entite_id : (entiteId || a.entite_id), id)
}

export function validerAppel(db, id) {
  const a = lire(db, id)
  exigerStatut(a, 'EN_CREATION')
  if (!totauxAppel(db, id).nb) throw new Error('Un appel sans dossier ne se valide pas.')
  db.prepare("UPDATE appel_paiement SET statut = 'VALIDE' WHERE id = ?").run(id)
}

export function rouvrirAppel(db, id) {
  exigerStatut(lire(db, id), 'VALIDE')
  db.prepare("UPDATE appel_paiement SET statut = 'EN_CREATION' WHERE id = ?").run(id)
}

/**
 * Émet la facture au délégataire. `numeroExterne` : le numéro d'une facture émise ailleurs —
 * aucun numéro de la série n'est alors consommé. Sinon, le numéro est pris dans la série des
 * factures de la société, dans la même transaction que l'écriture : un échec ne troue pas
 * la série.
 */
export function emettreFactureAppel(db, id, { numeroExterne = null, aujourdhui = new Date() } = {}) {
  const a = lire(db, id)
  exigerStatut(a, 'VALIDE')
  const t = totauxAppel(db, id)
  const externe = numeroExterne ? String(numeroExterne).trim() : null
  if (!externe) {
    const entite = a.entite_id ? db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(a.entite_id) : null
    if (!entite) return { ok: false, motifs: ["Aucune société émettrice n'est choisie pour cet appel."] }
    const bloquants = controlerFacture(entite, []).filter((x) => x.niveau === 'BLOQUANT')
    if (bloquants.length) return { ok: false, motifs: bloquants.map((x) => x.message) }
  } else if (db.prepare('SELECT 1 AS x FROM appel_paiement WHERE numero_facture = ? AND id <> ?').get(externe, id)) {
    return { ok: false, motifs: [`Le numéro ${externe} est déjà porté par un autre appel.`] }
  }

  db.exec('BEGIN')
  try {
    const numero = externe || attribuerNumeroFacture(db, a.entite_id, aujourdhui)
    db.prepare(`UPDATE appel_paiement SET statut = 'PAIEMENT_ATTENDU', numero_facture = ?, date_facture = ?,
                total_cumac = ?, total_ht = ?, total_tva = ?, total_ttc = ? WHERE id = ?`)
      .run(numero, aujourdhui.toISOString().slice(0, 10), t.cumac, t.ht, t.tva, t.ttc, id)
    const c = coordonneesBancaires(db, a.entite_id)
    if (c) db.prepare('UPDATE appel_paiement SET reglement_banque = ?, reglement_iban = ?, reglement_bic = ? WHERE id = ?')
      .run(c.reglement_banque, c.reglement_iban, c.reglement_bic, id)
    db.exec('COMMIT')
    return { ok: true, numero }
  } catch (e) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [`Émission interrompue, aucun numéro consommé : ${e.message}`] }
  }
}

/** Le virement reçu. Renvoie l'écart avec la facture, négatif si le délégataire a moins payé. */
export function enregistrerPaiement(db, id, { date, montant }) {
  const a = lire(db, id)
  exigerStatut(a, 'PAIEMENT_ATTENDU', 'PAYE')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('Date de paiement invalide.')
  const m = arrondi(montant)
  if (!(m > 0)) throw new Error('Le montant reçu doit être positif.')
  db.prepare("UPDATE appel_paiement SET statut = 'PAYE', date_paiement = ?, montant_recu = ? WHERE id = ?").run(date, m, id)
  return arrondi(m - Number(a.total_ttc || 0))
}

/** Supprimer n'a de sens qu'en création : ensuite, l'appel porte une facture. */
export function supprimerAppel(db, id) {
  exigerStatut(lire(db, id), 'EN_CREATION')
  db.prepare('DELETE FROM appel_paiement_ligne WHERE appel_id = ?').run(id)
  db.prepare('DELETE FROM appel_paiement WHERE id = ?').run(id)
}
