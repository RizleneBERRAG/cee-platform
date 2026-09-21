import { all, get } from './db.js'
import { calculerCumac, ficheApplicable, conditionsLisibles } from './cumac.js'
import { calculerValorisation, dealApplicable } from './marge.js'

const SELECT_DOSSIER = `
  SELECT d.*,
         b.raison_sociale, b.siret, b.regime_revenu, b.email, b.telephone,
         -- ── Les champs du site que le FORMULAIRE affiche ──
         --
         -- Le formulaire de la fiche dossier lit ces colonnes pour préremplir ses champs,
         -- puis renvoie TOUT ce qu'il affiche. Une colonne oubliée ici arrivait donc vide à
         -- l'écran, et repartait vide en base : l'adresse du chantier faisait planter
         -- l'enregistrement (elle est obligatoire), l'âge du bâtiment et le chauffage
         -- étaient effacés en silence. Ce qui s'affiche et ce qui s'enregistre doivent
         -- porter sur la même liste.
         s.adresse, s.ville, s.code_postal, s.departement, s.zone_climatique,
         s.secteur_activite, s.surface, s.qpv, s.age_batiment, s.age_batiment_tranche,
         s.type_chauffage, s.parcelle_cadastrale,
         f.code AS fiche_code, f.libelle AS fiche_libelle, f.secteur AS fiche_secteur,
         fv.version AS fv_version, fv.date_effet AS fv_date_effet, fv.date_fin AS fv_date_fin,
         fv.arrete_reference AS fv_arrete, fv.motif_fin AS fv_motif_fin,
         fv.formule_type, fv.unite_variable, fv.coefficients, fv.conditions,
         st.libelle AS statut_libelle, st.couleur AS statut_couleur, st.perdu AS statut_perdu,
         e.libelle AS etape_libelle, e.couleur AS etape_couleur,
         sc.libelle AS cofrac_libelle,
         sa.libelle AS admin_libelle,
         u.nom AS unite_nom,
         dg.nom AS delegataire_nom
  FROM dossier d
  JOIN beneficiaire b ON b.id = d.beneficiaire_id
  JOIN site s ON s.id = d.site_id
  JOIN fiche f ON f.id = d.fiche_id
  JOIN fiche_version fv ON fv.id = d.fiche_version_id
  LEFT JOIN statut st ON st.id = d.statut_dossier_id
  LEFT JOIN etape e ON e.id = st.etape_id
  LEFT JOIN statut sc ON sc.id = d.statut_cofrac_id
  LEFT JOIN statut sa ON sa.id = d.statut_admin_id
  LEFT JOIN unite_affaire u ON u.id = d.unite_affaire_id
  LEFT JOIN delegataire dg ON dg.id = d.delegataire_id
`

/**
 * `uniteId` est la portée de lecture de l'utilisateur : quand elle est fournie, le
 * cloisonnement est appliqué par le SQL. Un utilisateur restreint qui tape une URL
 * ne verra rien de plus — c'est la requête qui refuse, pas l'affichage.
 */
function filtres({ statut, fiche, uniteId }) {
  const where = []
  const params = []
  if (statut) { where.push('st.libelle = ?'); params.push(statut) }
  if (fiche) { where.push('f.code = ?'); params.push(fiche) }
  if (uniteId !== undefined) { where.push('d.unite_affaire_id IS ?'); params.push(uniteId) }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
}

export function listeDossiers({ statut, fiche, uniteId, limite = 200, decalage = 0 } = {}) {
  const { clause, params } = filtres({ statut, fiche, uniteId })
  return all(
    `${SELECT_DOSSIER} ${clause} ORDER BY d.created_at DESC, d.numero DESC LIMIT ${Number(limite)} OFFSET ${Number(decalage)}`,
    params
  )
}

/** Compte réel derrière un filtre, pour ne jamais présenter une page comme un total. */
export function compterDossiers({ statut, fiche, uniteId } = {}) {
  const { clause, params } = filtres({ statut, fiche, uniteId })
  return get(
    `SELECT COUNT(*) AS n FROM dossier d
       JOIN beneficiaire b ON b.id = d.beneficiaire_id
       JOIN site s ON s.id = d.site_id
       JOIN fiche f ON f.id = d.fiche_id
       JOIN fiche_version fv ON fv.id = d.fiche_version_id
       LEFT JOIN statut st ON st.id = d.statut_dossier_id
     ${clause}`,
    params
  ).n
}

/**
 * Tous les dossiers vivants, sans plafond.
 *
 * Les totaux du tableau de bord se calculaient sur les 500 premières lignes : sur un portefeuille
 * de 2 600 dossiers, la marge annoncée était celle d'un cinquième du portefeuille, présentée
 * comme le total. Un chiffre faux sans le dire est pire que pas de chiffre.
 */
export function dossiersVivants({ uniteId } = {}) {
  const cond = uniteId === undefined ? '' : ' AND d.unite_affaire_id IS ?'
  return all(`${SELECT_DOSSIER} WHERE COALESCE(st.perdu, 0) = 0${cond}`, uniteId === undefined ? [] : [uniteId])
}

/**
 * Un dossier, éventuellement restreint à une unité d'affaire.
 * Renvoie null si le dossier existe mais sort de la portée : l'appelant affiche alors
 * « introuvable », ce qui ne révèle pas l'existence d'un dossier d'une autre régie.
 */
export function dossier(id, { uniteId } = {}) {
  const cond = uniteId === undefined ? '' : ' AND d.unite_affaire_id IS ?'
  return get(`${SELECT_DOSSIER} WHERE d.id = ?${cond}`, uniteId === undefined ? [id] : [id, uniteId])
}

export function deals() {
  return all(`SELECT dl.*, dg.nom AS delegataire_nom FROM deal dl JOIN delegataire dg ON dg.id = dl.delegataire_id WHERE dl.actif = 1 ORDER BY dl.par_defaut DESC, dl.libelle`)
}

export function deal(id) {
  return get(`SELECT dl.*, dg.nom AS delegataire_nom FROM deal dl JOIN delegataire dg ON dg.id = dl.delegataire_id WHERE dl.id = ?`, [id])
}

export function fichesAvecVersions() {
  return all(`
    SELECT f.code, f.secteur, f.libelle, fv.id AS version_id, fv.version, fv.date_effet, fv.date_fin,
           fv.arrete_reference, fv.motif_fin, fv.formule_type, fv.unite_variable, fv.coefficients, fv.conditions,
           (SELECT COUNT(*) FROM dossier d WHERE d.fiche_id = f.id) AS nb_dossiers
    FROM fiche f JOIN fiche_version fv ON fv.fiche_id = f.id
    ORDER BY f.secteur, f.code`)
}

export function pipeline({ uniteId } = {}) {
  const jointure = uniteId === undefined
    ? 'LEFT JOIN dossier d ON d.statut_dossier_id = st.id'
    : 'LEFT JOIN dossier d ON d.statut_dossier_id = st.id AND d.unite_affaire_id IS ?'
  return all(`
    SELECT e.libelle AS etape, e.couleur, st.libelle AS statut, st.perdu, COUNT(d.id) AS n
    FROM statut st
    LEFT JOIN etape e ON e.id = st.etape_id
    ${jointure}
    WHERE st.axe = 'DOSSIER'
    GROUP BY st.id
    ORDER BY e.ordre, st.ordre`, uniteId === undefined ? [] : [uniteId])
}

/**
 * Radar de conformité — le différenciateur.
 * Croise le taux de contrôles non satisfaisants avec le plafond réglementaire
 * (14 % en 2026, 12 % en 2027, 10 % en 2028, arrêté du 27 juillet 2026).
 */
export function radarConformite(portee = {}) {
  return radarPar('unite', portee)
}

export function radarPar(dimension = 'unite', { uniteId } = {}) {
  const col = dimension === 'fiche' ? 'f.code' : 'u.nom'
  const cond = uniteId === undefined ? '' : 'WHERE d.unite_affaire_id IS ?'
  const lignes = all(`
    SELECT ${col} AS cle,
           SUM(CASE WHEN sc.libelle = 'Non satisfaisant' THEN 1 ELSE 0 END) AS ko,
           SUM(CASE WHEN sc.libelle IN ('Satisfaisant','Non satisfaisant') THEN 1 ELSE 0 END) AS controles
    FROM dossier d
    JOIN fiche f ON f.id = d.fiche_id
    LEFT JOIN unite_affaire u ON u.id = d.unite_affaire_id
    LEFT JOIN statut sc ON sc.id = d.statut_cofrac_id
    ${cond}
    GROUP BY ${col}
    HAVING controles > 0
    ORDER BY (CAST(ko AS REAL) / controles) DESC`, uniteId === undefined ? [] : [uniteId])
  const PLAFOND = 14
  return lignes.map((l) => {
    const taux = (l.ko / l.controles) * 100
    return { ...l, taux: Math.round(taux * 10) / 10, plafond: PLAFOND, depasse: taux > PLAFOND }
  })
}

/**
 * Alertes réglementaires : dossiers engagés après la date de fin de validité
 * de leur fiche. C'est le contrôle qui manque aux deux produits du marché.
 */
export function alertesReglementaires({ uniteId } = {}) {
  const cond = uniteId === undefined ? '' : ' AND d.unite_affaire_id IS ?'
  const lignes = all(`
    SELECT d.id, d.numero, d.date_engagement, f.code AS fiche_code, f.libelle AS fiche_libelle,
           fv.date_fin, fv.arrete_reference, fv.motif_fin, b.raison_sociale
    FROM dossier d
    JOIN fiche f ON f.id = d.fiche_id
    JOIN fiche_version fv ON fv.id = d.fiche_version_id
    JOIN beneficiaire b ON b.id = d.beneficiaire_id
    WHERE fv.date_fin IS NOT NULL AND d.date_engagement >= fv.date_fin${cond}
    ORDER BY d.date_engagement DESC`, uniteId === undefined ? [] : [uniteId])
  return lignes
}

export function statutsParAxe(axe) {
  return all(
    `SELECT s.id, s.libelle, s.couleur, e.libelle AS etape
     FROM statut s LEFT JOIN etape e ON e.id = s.etape_id
     WHERE s.axe = ? ORDER BY e.ordre, s.ordre`,
    [axe]
  )
}

export function unites() {
  return all('SELECT id, nom, type FROM unite_affaire WHERE actif = 1 ORDER BY nom')
}

export function delegataires() {
  return all('SELECT id, nom, oblige FROM delegataire WHERE actif = 1 ORDER BY nom')
}

export function fichesDisponibles() {
  return all(`
    SELECT f.id, f.code, f.libelle, f.secteur,
           (SELECT fv.date_fin FROM fiche_version fv WHERE fv.fiche_id = f.id ORDER BY fv.date_effet DESC LIMIT 1) AS date_fin
    FROM fiche f ORDER BY f.code`)
}

export function journalDossier(dossierId) {
  return all(`
    SELECT j.*, u.prenom, u.nom
    FROM journal_champ j LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
    WHERE j.dossier_id = ? ORDER BY j.created_at DESC, j.rowid DESC LIMIT 50`, [dossierId])
}

export function notesDossier(dossierId) {
  return all(`
    SELECT n.*, u.prenom, u.nom
    FROM note n LEFT JOIN utilisateur u ON u.id = n.utilisateur_id
    WHERE n.dossier_id = ? ORDER BY n.created_at DESC LIMIT 50`, [dossierId])
}

/** Calcul complet d'un dossier : cumac, éligibilité, valorisation, marge. */
export function calculDossier(d, { dealId = null, coutPose = 0, tauxApporteur = 0 } = {}) {
  const fv = {
    version: d.fv_version, date_effet: d.fv_date_effet, date_fin: d.fv_date_fin,
    arrete_reference: d.fv_arrete, motif_fin: d.fv_motif_fin,
    formule_type: d.formule_type, unite_variable: d.unite_variable,
    coefficients: d.coefficients, conditions: d.conditions,
  }
  const contexte = { secteurActivite: d.secteur_activite, zoneClimatique: d.zone_climatique, charte: d.charte }
  const cumac = calculerCumac({ ficheVersion: fv, quantite: d.quantite, contexte })
  const eligibilite = ficheApplicable(fv, d.date_engagement || new Date().toISOString())

  const dl = dealId ? deal(dealId) : (d.deal_id ? deal(d.deal_id) : null)
  let valorisation = null
  let dealOk = null
  if (dl) {
    dealOk = dealApplicable(dl, d.date_engagement || new Date().toISOString())
    valorisation = calculerValorisation({
      cumac: cumac.cumac, deal: dl,
      regime: d.regime_revenu === 'PRECAIRE' ? 'PRECAIRE' : 'CLASSIQUE',
      avecMpr: !!d.avec_mpr, coutPose, tauxApporteur,
      destinatairePrime: d.destinataire_prime,
    })
  }
  return { cumac, eligibilite, deal: dl, dealOk, valorisation, conditions: conditionsLisibles(d.conditions) }
}

// ── Lots de dépôt ────────────────────────────────────────────

export function lots() {
  return all(`
    SELECT l.*,
           (SELECT COUNT(*) FROM dossier d WHERE d.lot_id = l.id) AS nb_dossiers,
           (SELECT COALESCE(SUM(d.volume_cumac),0) FROM dossier d WHERE d.lot_id = l.id) AS cumac,
           (SELECT COALESCE(SUM(d.prime_delegataire),0) FROM dossier d WHERE d.lot_id = l.id) AS ca
    FROM lot l ORDER BY l.numero DESC`)
}

export function lot(id) {
  return get('SELECT * FROM lot WHERE id = ?', [id])
}

export function dossiersDuLot(lotId) {
  return all(`${SELECT_DOSSIER} WHERE d.lot_id = ?`, [lotId])
}

/** Dossiers prêts à partir : en phase Valorisation, éligibles, pas déjà dans un lot. */
export function dossiersDeposables() {
  return all(`${SELECT_DOSSIER} WHERE d.lot_id IS NULL AND st.libelle IN ('À traiter','Déposé') ORDER BY d.created_at DESC`)
}
