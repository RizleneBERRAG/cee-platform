/**
 * Recherche multi-critères sur les dossiers.
 *
 * L'écran de recherche est celui où l'ADV passe sa journée : c'est lui qui décide si l'outil
 * est adopté ou subi. Trois règles le gouvernent.
 *
 * 1. **Les critères sont déclarés, pas codés.** Chaque critère dit quelle colonne il vise et
 *    comment il compare. Ajouter un filtre est une ligne de données, et l'écran, l'export et
 *    la barre de filtres actifs le reprennent tout seuls.
 * 2. **Tout passe par des paramètres liés.** Aucune valeur saisie n'est concaténée dans le SQL.
 *    Les seuls fragments interpolés — colonne de tri, sens, limite — sont validés contre une
 *    liste fermée avant de servir.
 * 3. **Le cloisonnement n'est pas un critère.** Il est ajouté après coup, toujours, et ne peut
 *    pas être retiré par ce qui vient de l'URL.
 */
import { all, get } from './db.js'
import { CODES_ZONES, CODES_AGES, TYPES_CHAUFFAGE } from './referentiels-site.js'

// ── Catalogue des critères ───────────────────────────────────

/**
 * `col`      colonne SQL visée
 * `type`     texte | exact | date_min | date_max | nombre_min | nombre_max | booleen | liste
 * `libelle`  ce que l'utilisateur lit, y compris dans la barre de filtres actifs
 * `section`  regroupement à l'écran
 */
export const CRITERES = {
  // — Identification
  numero:        { col: 'd.numero',            type: 'texte',  libelle: 'N° de dossier',        section: 'Identification' },
  ref_externe:   { col: 'd.ref_externe',       type: 'texte',  libelle: 'Référence externe',    section: 'Identification' },
  source:        { col: 'd.source',            type: 'texte',  libelle: 'Source',               section: 'Identification' },
  cree_du:       { col: 'd.created_at',        type: 'date_min', libelle: 'Créé à partir du',   section: 'Identification' },
  cree_au:       { col: 'd.created_at',        type: 'date_max', libelle: 'Créé jusqu\'au',     section: 'Identification' },
  verrouille:    { col: 'd.verrouille',        type: 'booleen', libelle: 'Verrouillé',          section: 'Identification' },

  // — Parcours commercial
  // « Source » restait un champ libre historique : on le garde pour ne pas perdre ce qui a
  // déjà été saisi, mais `type_lead` est la liste fermée sur laquelle on peut compter.
  type_lead:     { col: 'd.type_lead',         type: 'exact',  libelle: 'Type de lead',         section: 'Parcours commercial' },
  source_lead:   { col: 'd.source_lead',       type: 'texte',  libelle: 'Source du lead',       section: 'Parcours commercial' },
  campagne:      { col: 'd.campagne',          type: 'texte',  libelle: 'Campagne',             section: 'Parcours commercial' },
  etat_devis:    { col: 'd.etat_devis',        type: 'exact',  libelle: 'État du devis',        section: 'Parcours commercial' },
  num_devis:     { col: 'd.num_devis',         type: 'texte',  libelle: 'N° de devis',          section: 'Parcours commercial' },
  signe_du:      { col: 'd.date_signature',    type: 'date_min', libelle: 'Signé à partir du',  section: 'Parcours commercial' },
  signe_au:      { col: 'd.date_signature',    type: 'date_max', libelle: 'Signé jusqu\'au',    section: 'Parcours commercial' },
  rdv_confirme:  { col: 'd.rdv_confirme',      type: 'booleen', libelle: 'RDV confirmé',        section: 'Parcours commercial' },
  // Cherche parmi TOUS les intervenants du dossier, quel que soit leur rôle, qu'ils aient
  // un compte ou non. Sans cela, « les dossiers de Karim » resterait incalculable.
  intervenant:   { col: null,                  type: 'intervenant', libelle: 'Intervenant',     section: 'Parcours commercial' },
  role_tenu:     { col: null,                  type: 'role',   libelle: 'Rôle présent',         section: 'Parcours commercial' },

  // — Bénéficiaire
  beneficiaire:  { col: 'b.raison_sociale',    type: 'texte',  libelle: 'Bénéficiaire',         section: 'Bénéficiaire' },
  siret:         { col: 'b.siret',             type: 'texte',  libelle: 'SIRET',                section: 'Bénéficiaire' },
  nom:           { col: 'b.nom',               type: 'texte',  libelle: 'Nom du contact',       section: 'Bénéficiaire' },
  email:         { col: 'b.email',             type: 'texte',  libelle: 'E-mail',               section: 'Bénéficiaire' },
  telephone:     { col: 'b.telephone',         type: 'texte',  libelle: 'Téléphone',            section: 'Bénéficiaire' },
  regime:        { col: 'b.regime_revenu',     type: 'exact',  libelle: 'Régime de revenus',    section: 'Bénéficiaire' },

  // — Site et données réglementaires
  ville:         { col: 's.ville',             type: 'texte',  libelle: 'Ville',                section: 'Site et données réglementaires' },
  code_postal:   { col: 's.code_postal',       type: 'texte',  libelle: 'Code postal',          section: 'Site et données réglementaires' },
  departement:   { col: 's.departement',       type: 'exact',  libelle: 'Département',          section: 'Site et données réglementaires' },
  zone:          { col: 's.zone_climatique',   type: 'exact',  libelle: 'Zone climatique',      section: 'Site et données réglementaires' },
  secteur_act:   { col: 's.secteur_activite',  type: 'exact',  libelle: 'Secteur d\'activité',  section: 'Site et données réglementaires' },
  qpv:           { col: 's.qpv',               type: 'booleen', libelle: 'En QPV',              section: 'Site et données réglementaires' },
  chauffage:     { col: 's.type_chauffage',    type: 'exact',  libelle: 'Type de chauffage',    section: 'Site et données réglementaires' },
  // La tranche remplace les bornes en années : c'est la tranche qui ouvre un droit, donc
  // c'est sur elle qu'on cherche. Les deux bornes restent pour l'historique des sites déjà
  // saisis en années.
  age_tranche:   { col: 's.age_batiment_tranche', type: 'exact',   libelle: 'Âge du bâtiment',            section: 'Site et données réglementaires' },
  age_min:       { col: 's.age_batiment',      type: 'nombre_min', libelle: 'Bâtiment d\'au moins (ans)', section: 'Site et données réglementaires' },
  age_max:       { col: 's.age_batiment',      type: 'nombre_max', libelle: 'Bâtiment d\'au plus (ans)',  section: 'Site et données réglementaires' },

  // — Opération
  fiche:         { col: 'f.code',              type: 'exact',  libelle: 'Fiche d\'opération',   section: 'Opération' },
  secteur_fiche: { col: 'f.secteur',           type: 'exact',  libelle: 'Secteur de la fiche',  section: 'Opération' },
  charte:        { col: 'd.charte',            type: 'exact',  libelle: 'Charte',               section: 'Opération' },
  avec_mpr:      { col: 'd.avec_mpr',          type: 'booleen', libelle: 'Avec MaPrimeRénov\'', section: 'Opération' },
  qte_min:       { col: 'd.quantite',          type: 'nombre_min', libelle: 'Quantité minimum', section: 'Opération' },
  qte_max:       { col: 'd.quantite',          type: 'nombre_max', libelle: 'Quantité maximum', section: 'Opération' },
  cumac_min:     { col: 'd.volume_cumac',      type: 'nombre_min', libelle: 'Cumac minimum (kWh)', section: 'Opération' },
  cumac_max:     { col: 'd.volume_cumac',      type: 'nombre_max', libelle: 'Cumac maximum (kWh)', section: 'Opération' },

  // — Chaîne CEE
  delegataire:   { col: 'd.delegataire_id',    type: 'exact',  libelle: 'Délégataire',          section: 'Chaîne CEE' },
  installateur:  { col: 'd.installateur_id',   type: 'exact',  libelle: 'Installateur RGE',     section: 'Chaîne CEE' },
  unite:         { col: 'd.unite_affaire_id',  type: 'exact',  libelle: 'Unité d\'affaire',     section: 'Chaîne CEE' },
  deal:          { col: 'd.deal_id',           type: 'exact',  libelle: 'Deal',                 section: 'Chaîne CEE' },
  lot:           { col: 'd.lot_id',            type: 'exact',  libelle: 'Lot de dépôt',         section: 'Chaîne CEE' },
  sans_lot:      { col: 'd.lot_id',            type: 'est_nul', libelle: 'Hors lot de dépôt',   section: 'Chaîne CEE' },

  // — Statuts
  statut:        { col: 'st.libelle',          type: 'exact',  libelle: 'Statut du dossier',    section: 'Statuts et jalons' },
  etape:         { col: 'e.libelle',           type: 'exact',  libelle: 'Étape',                section: 'Statuts et jalons' },
  statut_admin:  { col: 'sa.libelle',          type: 'exact',  libelle: 'Statut administratif', section: 'Statuts et jalons' },
  cofrac:        { col: 'sc.libelle',          type: 'exact',  libelle: 'Contrôle COFRAC',      section: 'Statuts et jalons' },

  // — Jalons
  engage_du:     { col: 'd.date_engagement',   type: 'date_min', libelle: 'Engagé à partir du', section: 'Statuts et jalons' },
  engage_au:     { col: 'd.date_engagement',   type: 'date_max', libelle: 'Engagé jusqu\'au',   section: 'Statuts et jalons' },
  pose_du:       { col: 'd.date_pose',         type: 'date_min', libelle: 'Posé à partir du',   section: 'Statuts et jalons' },
  pose_au:       { col: 'd.date_pose',         type: 'date_max', libelle: 'Posé jusqu\'au',     section: 'Statuts et jalons' },
  depot_du:      { col: 'd.date_depot',        type: 'date_min', libelle: 'Déposé à partir du', section: 'Statuts et jalons' },
  depot_au:      { col: 'd.date_depot',        type: 'date_max', libelle: 'Déposé jusqu\'au',   section: 'Statuts et jalons' },
}

/** Les sections, dans l'ordre d'affichage. */
export const SECTIONS = [
  'Identification', 'Bénéficiaire', 'Site et données réglementaires',
  'Opération', 'Parcours commercial', 'Chaîne CEE', 'Statuts et jalons',
]

// ── Colonnes affichables ─────────────────────────────────────

/** `marge: true` signale une colonne retirée pour qui n'a pas le droit de voir les montants. */
export const COLONNES = {
  numero:       { libelle: 'N° dossier',      tri: 'd.numero',            defaut: true },
  ref_externe:  { libelle: 'Réf. externe',    tri: 'd.ref_externe' },
  beneficiaire: { libelle: 'Bénéficiaire',    tri: 'b.raison_sociale',    defaut: true },
  siret:        { libelle: 'SIRET',           tri: 'b.siret' },
  contact:      { libelle: 'Contact',         tri: 'b.nom' },
  telephone:    { libelle: 'Téléphone',       tri: 'b.telephone' },
  ville:        { libelle: 'Ville',           tri: 's.ville',             defaut: true },
  code_postal:  { libelle: 'CP',              tri: 's.code_postal' },
  departement:  { libelle: 'Dépt',            tri: 's.departement' },
  zone:         { libelle: 'Zone',            tri: 's.zone_climatique' },
  qpv:          { libelle: 'QPV',             tri: 's.qpv' },
  fiche:        { libelle: 'Fiche',           tri: 'f.code',              defaut: true },
  version:      { libelle: 'Version',         tri: 'fv.version' },
  quantite:     { libelle: 'Quantité',        tri: 'd.quantite',          num: true },
  statut:       { libelle: 'Statut',          tri: 'st.libelle',          defaut: true },
  etape:        { libelle: 'Étape',           tri: 'e.ordre' },
  cofrac:       { libelle: 'COFRAC',          tri: 'sc.libelle' },
  eligibilite:  { libelle: 'Éligibilité',     defaut: true },
  pieces:       { libelle: 'Pièces' },
  unite:        { libelle: 'Unité',           tri: 'u.nom' },
  delegataire:  { libelle: 'Délégataire',     tri: 'dg.nom' },
  lot:          { libelle: 'Lot',             tri: 'lt.numero' },
  engagement:   { libelle: 'Engagement',      tri: 'd.date_engagement',   defaut: true },
  pose:         { libelle: 'Pose',            tri: 'd.date_pose' },
  depot:        { libelle: 'Dépôt',           tri: 'd.date_depot' },
  cumac:        { libelle: 'Cumac (MWh)',     tri: 'd.volume_cumac',      num: true, defaut: true },
  ca:           { libelle: 'CA délégataire',  tri: 'd.prime_delegataire', num: true, marge: true },
  prime:        { libelle: 'Prime bénéf.',    tri: 'd.prime_beneficiaire', num: true, marge: true },
  marge:        { libelle: 'Marge nette',     tri: 'd.marge_nette',       num: true, marge: true, defaut: true },
}

export const COLONNES_PAR_DEFAUT = Object.entries(COLONNES).filter(([, c]) => c.defaut).map(([k]) => k)

/** Colonnes visibles pour cet utilisateur, dans l'ordre du catalogue. */
export function colonnesVisibles(choisies, voitMarge) {
  const demandees = (Array.isArray(choisies) && choisies.length ? choisies : COLONNES_PAR_DEFAUT)
    .filter((k) => k in COLONNES)
  const ordre = Object.keys(COLONNES)
  return ordre.filter((k) => demandees.includes(k) && (voitMarge || !COLONNES[k].marge))
}

// ── Construction de la requête ───────────────────────────────

const JOINTURES = `
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
  LEFT JOIN installateur_rge ir ON ir.id = d.installateur_id
  LEFT JOIN lot lt ON lt.id = d.lot_id
  LEFT JOIN deal dl ON dl.id = d.deal_id
`

const CHAMPS = `
  d.*,
  b.raison_sociale, b.siret, b.nom AS benef_nom, b.prenom AS benef_prenom,
  b.email, b.telephone, b.regime_revenu,
  s.adresse, s.ville, s.code_postal, s.departement, s.zone_climatique,
  s.secteur_activite, s.surface, s.qpv, s.age_batiment, s.age_batiment_tranche, s.type_chauffage,
  f.code AS fiche_code, f.libelle AS fiche_libelle, f.secteur AS fiche_secteur,
  fv.version AS fv_version, fv.date_effet AS fv_date_effet, fv.date_fin AS fv_date_fin,
  fv.arrete_reference AS fv_arrete, fv.motif_fin AS fv_motif_fin,
  fv.formule_type, fv.unite_variable, fv.coefficients, fv.conditions,
  st.libelle AS statut_libelle, st.couleur AS statut_couleur, st.perdu AS statut_perdu,
  e.libelle AS etape_libelle, e.couleur AS etape_couleur,
  sc.libelle AS cofrac_libelle, sa.libelle AS admin_libelle,
  u.nom AS unite_nom, dg.nom AS delegataire_nom, ir.raison_sociale AS installateur_nom,
  lt.numero AS lot_numero, dl.libelle AS deal_libelle
`

/**
 * Traduit les critères renseignés en clause WHERE.
 * Renvoie aussi `actifs` : la liste lisible des filtres appliqués, pour que l'écran puisse
 * les afficher et en retirer un seul sans reconstruire la requête à la main.
 */
export function construireFiltres(valeurs = {}, portee = {}) {
  const clauses = []
  const params = []
  const actifs = []

  for (const [cle, def] of Object.entries(CRITERES)) {
    const brut = valeurs[cle]
    if (brut === undefined || brut === null || String(brut).trim() === '') continue
    const v = String(brut).trim()

    switch (def.type) {
      case 'texte':
        clauses.push(`${def.col} LIKE ?`)
        params.push(`%${v}%`)
        actifs.push({ cle, libelle: def.libelle, valeur: v })
        break
      case 'exact':
        clauses.push(`${def.col} = ?`)
        params.push(v)
        actifs.push({ cle, libelle: def.libelle, valeur: v })
        break
      case 'date_min':
        clauses.push(`${def.col} >= ?`)
        params.push(v)
        actifs.push({ cle, libelle: def.libelle, valeur: fr(v) })
        break
      case 'date_max':
        // Inclut la journée entière quand la colonne porte un horodatage.
        clauses.push(`${def.col} <= ?`)
        params.push(v.length === 10 ? `${v} 23:59:59` : v)
        actifs.push({ cle, libelle: def.libelle, valeur: fr(v) })
        break
      case 'nombre_min': {
        const n = Number(v.replace(',', '.'))
        if (!Number.isFinite(n)) break
        clauses.push(`${def.col} >= ?`)
        params.push(n)
        actifs.push({ cle, libelle: def.libelle, valeur: v })
        break
      }
      case 'nombre_max': {
        const n = Number(v.replace(',', '.'))
        if (!Number.isFinite(n)) break
        clauses.push(`${def.col} <= ?`)
        params.push(n)
        actifs.push({ cle, libelle: def.libelle, valeur: v })
        break
      }
      case 'booleen':
        // « non » doit pouvoir être demandé explicitement : on distingue 0 de « pas de filtre ».
        clauses.push(`COALESCE(${def.col}, 0) = ?`)
        params.push(v === 'oui' || v === '1' ? 1 : 0)
        actifs.push({ cle, libelle: def.libelle, valeur: v === 'oui' || v === '1' ? 'oui' : 'non' })
        break
      case 'est_nul':
        clauses.push(`${def.col} IS NULL`)
        actifs.push({ cle, libelle: def.libelle, valeur: 'oui' })
        break
      case 'intervenant':
        // EXISTS plutôt qu'une jointure : une jointure dupliquerait le dossier autant de
        // fois qu'il a d'intervenants, et fausserait à la fois le comptage et les totaux.
        clauses.push(`EXISTS (
          SELECT 1 FROM dossier_intervenant di
          LEFT JOIN utilisateur ui ON ui.id = di.utilisateur_id
          WHERE di.dossier_id = d.id
            AND (di.nom LIKE ? OR ui.nom LIKE ? OR ui.prenom LIKE ?
                 OR (ui.prenom || ' ' || ui.nom) LIKE ?))`)
        for (let i = 0; i < 4; i++) params.push(`%${v}%`)
        actifs.push({ cle, libelle: def.libelle, valeur: v })
        break
      case 'role':
        clauses.push(`EXISTS (SELECT 1 FROM dossier_intervenant di
                              WHERE di.dossier_id = d.id AND di.role = ?)`)
        params.push(v)
        actifs.push({ cle, libelle: def.libelle, valeur: v })
        break
      default:
        break
    }
  }

  // Recherche libre : un seul champ qui balaie ce qu'on tape le plus souvent.
  const q = String(valeurs.q || '').trim()
  if (q) {
    clauses.push(`(d.numero LIKE ? OR d.ref_externe LIKE ? OR b.raison_sociale LIKE ?
                   OR b.siret LIKE ? OR s.ville LIKE ? OR f.code LIKE ?)`)
    for (let i = 0; i < 6; i++) params.push(`%${q}%`)
    actifs.push({ cle: 'q', libelle: 'Recherche libre', valeur: q })
  }

  // La corbeille non plus n'est pas un filtre qu'on retire : un dossier supprimé ne sort
  // plus dans une recherche ni dans un export. Il se consulte depuis la corbeille.
  clauses.push('d.supprime_le IS NULL')

  // Le cloisonnement est ajouté en dernier et n'apparaît pas dans les filtres actifs :
  // ce n'est pas un choix de l'utilisateur, et il ne doit pas pouvoir le retirer.
  if (portee.uniteId !== undefined) {
    clauses.push('d.unite_affaire_id IS ?')
    params.push(portee.uniteId)
  }

  return { where: clauses.length ? 'WHERE ' + clauses.join(' AND ') : '', params, actifs }
}

const TRIS = new Map(
  Object.entries(COLONNES).filter(([, c]) => c.tri).map(([cle, c]) => [cle, c.tri])
)

/** Le tri vient de l'URL : il n'est jamais interpolé sans passer par cette liste fermée. */
export function ordreSql(tri, sens) {
  const col = TRIS.get(tri) || 'd.created_at'
  const dir = String(sens).toLowerCase() === 'asc' ? 'ASC' : 'DESC'
  // `numero` est unique : il départage les ex æquo et rend la pagination stable.
  return `ORDER BY ${col} ${dir}, d.numero DESC`
}

export function rechercher(valeurs = {}, portee = {}, { tri, sens, limite = 50, decalage = 0 } = {}) {
  const { where, params } = construireFiltres(valeurs, portee)
  return all(
    `SELECT ${CHAMPS} ${JOINTURES} ${where} ${ordreSql(tri, sens)} LIMIT ? OFFSET ?`,
    [...params, Math.min(Number(limite) || 50, 500), Math.max(Number(decalage) || 0, 0)]
  )
}

export function compter(valeurs = {}, portee = {}) {
  const { where, params } = construireFiltres(valeurs, portee)
  return get(`SELECT COUNT(*) AS n ${JOINTURES} ${where}`, params).n
}

/** Totaux du résultat entier, pas seulement de la page affichée. */
export function totaux(valeurs = {}, portee = {}) {
  const { where, params } = construireFiltres(valeurs, portee)
  return get(
    `SELECT COALESCE(SUM(d.volume_cumac),0) AS cumac,
            COALESCE(SUM(d.prime_delegataire),0) AS ca,
            COALESCE(SUM(d.marge_nette),0) AS marge,
            COUNT(*) AS n
     ${JOINTURES} ${where}`,
    params
  )
}

/** Tout le résultat, sans pagination — réservé à l'export. */
export function rechercherTout(valeurs = {}, portee = {}, { tri, sens, plafond = 20000 } = {}) {
  const { where, params } = construireFiltres(valeurs, portee)
  return all(
    `SELECT ${CHAMPS} ${JOINTURES} ${where} ${ordreSql(tri, sens)} LIMIT ?`,
    [...params, plafond]
  )
}

/** Valeurs proposées dans les listes déroulantes, lues en base plutôt que codées en dur. */
export function optionsRecherche(portee = {}) {
  const dist = (sql) => all(sql).map((r) => r.v).filter((v) => v != null && v !== '')
  return {
    fiches: all('SELECT DISTINCT code AS v FROM fiche ORDER BY code').map((r) => r.v),
    secteurs: dist('SELECT DISTINCT secteur AS v FROM fiche ORDER BY secteur'),
    statuts: dist("SELECT DISTINCT libelle AS v FROM statut WHERE axe = 'DOSSIER' ORDER BY libelle"),
    etapes: dist('SELECT DISTINCT libelle AS v FROM etape ORDER BY ordre'),
    statutsAdmin: dist("SELECT DISTINCT libelle AS v FROM statut WHERE axe = 'ADMIN' ORDER BY libelle"),
    cofrac: dist("SELECT DISTINCT libelle AS v FROM statut WHERE axe = 'COFRAC' ORDER BY libelle"),
    departements: dist('SELECT DISTINCT departement AS v FROM site ORDER BY departement'),
    villes: dist('SELECT DISTINCT ville AS v FROM site ORDER BY ville'),
    secteursActivite: dist('SELECT DISTINCT secteur_activite AS v FROM site ORDER BY secteur_activite'),
    // Listes fermées : on sert le référentiel, pas ce qui traîne dans la table. Un filtre
    // construit à partir des valeurs présentes ne propose jamais une valeur légitime encore
    // jamais saisie — et propose au contraire les fautes de frappe du passé.
    chauffages: TYPES_CHAUFFAGE.map((c) => c.code),
    zones: CODES_ZONES,
    agesBatiment: CODES_AGES,
    delegataires: all('SELECT id, nom FROM delegataire ORDER BY nom'),
    installateurs: all('SELECT id, raison_sociale AS nom FROM installateur_rge ORDER BY raison_sociale'),
    unites: all('SELECT id, nom FROM unite_affaire ORDER BY nom'),
    deals: all('SELECT id, libelle AS nom FROM deal ORDER BY libelle'),
    lots: all('SELECT id, numero AS nom FROM lot ORDER BY numero DESC'),
  }
}

function fr(d) {
  if (!d) return ''
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? d : x.toLocaleDateString('fr-FR')
}
