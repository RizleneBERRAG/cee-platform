/**
 * Jeu de données de démarrage.
 *
 * Les paramètres réglementaires (dates d'arrêté, coefficients) sont réels et sourcés.
 * Les dossiers, sociétés et régies sont synthétiques : aucune donnée client réelle.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const DB_PATH = process.env.CEE_DB_PATH || path.join(process.cwd(), 'db', 'cee.db')
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH)

const db = new DatabaseSync(DB_PATH)
db.exec('PRAGMA foreign_keys = ON')
db.exec(fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8'))

const id = () => crypto.randomUUID()
const ins = (sql, params) => db.prepare(sql).run(...params)

// ── Unités d'affaire ────────────────────────────────────────
const unites = [
  ['Siège', 'SIEGE'], ['Régie Nord', 'REGIE'], ['Régie Sud', 'REGIE'],
  ['Apporteur Alpha', 'REGIE'], ['Apporteur Bêta', 'REGIE'], ['Pose & Co', 'INSTALLATEUR'],
].map(([nom, type]) => {
  const uid = id()
  ins('INSERT INTO unite_affaire (id, nom, type) VALUES (?,?,?)', [uid, nom, type])
  return { id: uid, nom, type }
})

// ── Rôles et permissions ────────────────────────────────────
// Les quatre rôles livrés, avec leurs droits. La définition vit dans lib/permissions.js :
// la dupliquer ici serait le meilleur moyen de la voir diverger.
const { ROLES_PAR_DEFAUT } = await import('../lib/permissions.js')
const roles = {}
for (const r of ROLES_PAR_DEFAUT) {
  const rid = id()
  ins('INSERT INTO role (id, nom, code, permissions) VALUES (?,?,?,?)',
    [rid, r.nom, r.code, JSON.stringify(r.permissions)])
  roles[r.code] = rid
}

// Un compte gérant SANS mot de passe : il existe pour porter le journal du jeu de
// démonstration, mais il ne peut pas servir à se connecter. Au premier lancement,
// l'application demande de créer le vrai compte — aucun « admin/admin » n'existe jamais.
ins('INSERT INTO utilisateur (id, email, nom, prenom, role_id, unite_affaire_id, mot_de_passe) VALUES (?,?,?,?,?,?,NULL)',
  [id(), 'admin@exemple.fr', 'Admin', 'Compte', roles.GERANT, unites[0].id])

// ── Référentiel des fiches ──────────────────────────────────
// Sources : arrêtés publiés au JO. Les dates de fin marquent les suppressions réelles.
const FICHES = [
  {
    code: 'BAT-EQ-127', secteur: 'BAT', domaine: 'EQ',
    libelle: "Luminaire d'éclairage général à modules LED (tertiaire)",
    versions: [{
      version: 'v40', dateEffet: '2021-01-01',
      dateFin: '2026-02-25', arrete: 'Arrêté du 23 février 2026 (JO du 24/02/2026)', motifFin: 'suppression',
      formule: 'FORFAIT_PAR_UNITE', unite: 'W',
      coefficients: [
        { criteres: { secteurActivite: 'HOTEL_RESTAURANT' }, valeur: 31 },
        { criteres: { secteurActivite: 'COMMERCE' }, valeur: 36 },
        { criteres: { secteurActivite: 'BUREAUX' }, valeur: 35 },
        { criteres: { secteurActivite: 'SANTE' }, valeur: 38 },
        { criteres: { secteurActivite: 'ENSEIGNEMENT' }, valeur: 24 },
        { criteres: {}, valeur: 24 },
      ],
      conditions: [
        { code: 'EFFICACITE_LUMINEUSE', libelle: 'Efficacité lumineuse ≥ 120 lm/W (≥ 90 lm/W si IK10)' },
        { code: 'DUREE_VIE', libelle: 'Durée de vie ≥ 50 000 h (35 000 h pour hôtellerie, restauration et commerces < 400 m²)' },
        { code: 'FLUX_INITIAL', libelle: 'Flux lumineux initial ≥ 3 000 lumens' },
        { code: 'FACTEUR_PUISSANCE', libelle: 'Facteur de puissance > 0,9' },
        { code: 'SECURITE_PHOTOBIO', libelle: 'Groupe de risque 0 selon NF EN 62471' },
      ],
    }],
  },
  {
    code: 'BAR-EQ-110', secteur: 'BAR', domaine: 'EQ',
    libelle: 'Luminaire à modules LED (parties communes résidentiel)',
    versions: [{ version: 'v20', dateEffet: '2021-01-01', dateFin: '2026-02-25',
      arrete: 'Arrêté du 23 février 2026 (JO du 24/02/2026)', motifFin: 'suppression',
      formule: 'FORFAIT_PAR_UNITE', unite: 'W',
      coefficients: [{ criteres: {}, valeur: 28 }], conditions: [] }],
  },
  {
    code: 'IND-BA-116', secteur: 'IND', domaine: 'BA',
    libelle: 'Luminaire à modules LED (industrie)',
    versions: [{ version: 'v30', dateEffet: '2021-01-01', dateFin: '2026-02-25',
      arrete: 'Arrêté du 23 février 2026 (JO du 24/02/2026)', motifFin: 'suppression',
      formule: 'FORFAIT_PAR_UNITE', unite: 'W',
      coefficients: [{ criteres: {}, valeur: 42 }], conditions: [] }],
  },
  {
    code: 'BAR-SE-109', secteur: 'BAR', domaine: 'SE',
    libelle: "Désembouage d'un réseau de chauffage",
    versions: [{ version: 'v10', dateEffet: '2020-01-01', dateFin: '2026-02-09',
      arrete: 'Arrêté du 5 février 2026 (JO du 08/02/2026)', motifFin: 'suppression',
      formule: 'FORFAIT_FIXE', unite: 'logement',
      coefficients: [{ criteres: {}, valeur: 12000 }], conditions: [] }],
  },
  {
    code: 'BAT-TH-122', secteur: 'BAT', domaine: 'TH',
    libelle: 'Système de variation électronique de vitesse sur moteur asynchrone',
    versions: [{ version: 'v20', dateEffet: '2022-01-01', dateFin: null, arrete: null, motifFin: null,
      formule: 'FORFAIT_PAR_UNITE', unite: 'kW',
      coefficients: [
        { criteres: { zoneClimatique: 'H1' }, valeur: 9400 },
        { criteres: { zoneClimatique: 'H2' }, valeur: 8700 },
        { criteres: { zoneClimatique: 'H3' }, valeur: 7500 },
        { criteres: {}, valeur: 8700 },
      ],
      conditions: [{ code: 'RGE', libelle: 'Installateur titulaire d\'une qualification RGE en cours de validité' }] }],
  },
  {
    code: 'AGRI-EQ-110', secteur: 'AGRI', domaine: 'EQ',
    libelle: 'Système de récupération de chaleur (élevage)',
    versions: [{ version: 'v10', dateEffet: '2023-01-01', dateFin: null, arrete: null, motifFin: null,
      formule: 'FORFAIT_PAR_UNITE', unite: 'unité',
      coefficients: [{ criteres: {}, valeur: 64000 }], conditions: [] }],
  },
  {
    code: 'TRA-SE-104', secteur: 'TRA', domaine: 'SE',
    libelle: 'Formation à l\'écoconduite',
    versions: [{ version: 'v30', dateEffet: '2022-06-01', dateFin: null, arrete: null, motifFin: null,
      formule: 'FORFAIT_PAR_UNITE', unite: 'conducteur',
      coefficients: [{ criteres: {}, valeur: 47800 }], conditions: [] }],
  },
  {
    code: 'BAR-TH-160', secteur: 'BAR', domaine: 'TH',
    libelle: 'Isolation de réseaux hydrauliques de chauffage ou d\'ECS (calorifugeage)',
    versions: [{ version: 'v30', dateEffet: '2021-01-01', dateFin: null,
      arrete: 'Suppression annoncée — date d\'effet à confirmer', motifFin: null,
      formule: 'FORFAIT_PAR_M2', unite: 'ml',
      coefficients: [{ criteres: {}, valeur: 3800 }],
      conditions: [{ code: 'A_VERIFIER', libelle: 'Suppression annoncée par arrêté : vérifier la date d\'effet avant tout engagement.' }] }],
  },
]

const ficheIds = {}
const ficheVersionIds = {}
for (const f of FICHES) {
  const fid = id()
  ficheIds[f.code] = fid
  ins('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
    [fid, f.code, f.secteur, f.domaine, f.libelle])
  for (const v of f.versions) {
    const vid = id()
    ficheVersionIds[f.code] = vid
    ins(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, arrete_reference, motif_fin, formule_type, unite_variable, coefficients, conditions)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [vid, fid, v.version, v.dateEffet, v.dateFin, v.arrete, v.motifFin, v.formule, v.unite,
       JSON.stringify(v.coefficients), JSON.stringify(v.conditions)])
  }
}

// ── Délégataires & installateurs ────────────────────────────
const delegs = [
  ['Délégataire A', 'TotalEnergies'], ['Délégataire B', 'Esso'], ['Délégataire C', 'TotalEnergies'],
].map(([nom, oblige]) => {
  const did = id(); ins('INSERT INTO delegataire (id, nom, oblige) VALUES (?,?,?)', [did, nom, oblige])
  return { id: did, nom }
})

const instal = id()
ins('INSERT INTO installateur_rge (id, raison_sociale, siret) VALUES (?,?,?)', [instal, 'Pose & Co', '00000000000000'])
ins('INSERT INTO certification_rge (id, installateur_id, libelle, numero, date_debut, date_fin) VALUES (?,?,?,?,?,?)',
  [id(), instal, 'RGE Qualibat 7131', 'Q-7131-0001', '2025-01-01', '2026-12-31'])

// ── Deal : la grille de ratios ──────────────────────────────
const dealId = id()
ins(`INSERT INTO deal (id, libelle, version, delegataire_id, type_beneficiaire, volume_cumac,
      date_debut, date_fin, num_contrat_standard, num_contrat_cdp, num_contrat_mpr, par_defaut, actif,
      r_deleg_precaire_sans_mpr, r_deleg_precaire_avec_mpr, r_cede_precaire_sans_mpr, r_cede_precaire_avec_mpr,
      r_garde_precaire_sans_mpr, r_garde_precaire_avec_mpr,
      r_deleg_classique_sans_mpr, r_deleg_classique_avec_mpr, r_cede_classique_sans_mpr, r_cede_classique_avec_mpr,
      r_garde_classique_sans_mpr, r_garde_classique_avec_mpr)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [dealId, 'Deal standard — Délégataire A', 'V1', delegs[0].id, 'B2B_B2C', 50000000,
   '2026-01-01', '2026-12-31', 'STD-2026-001', 'CDP-2026-001', 'MPR-2026-001', 1, 1,
   // précaire : sans MPR / avec MPR
   7.20, 6.50, 4.55, 4.10, 1.15, 1.00,
   // classique : sans MPR / avec MPR
   6.50, 5.90, 4.00, 3.60, 1.05, 0.95])

const dealId2 = id()
ins(`INSERT INTO deal (id, libelle, version, delegataire_id, type_beneficiaire, date_debut, date_fin, par_defaut, actif,
      r_deleg_precaire_sans_mpr, r_cede_precaire_sans_mpr, r_garde_precaire_sans_mpr,
      r_deleg_classique_sans_mpr, r_cede_classique_sans_mpr, r_garde_classique_sans_mpr)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [dealId2, 'Deal « 1 € » — Délégataire B', 'V2', delegs[1].id, 'B2C', '2026-01-01', '2026-12-31', 0, 1,
   6.50, 4.55, 1.95, 6.50, 4.55, 1.95])

for (const code of ['BAT-EQ-127', 'BAT-TH-122', 'AGRI-EQ-110', 'TRA-SE-104', 'BAR-TH-160']) {
  ins('INSERT INTO deal_fiche (id, deal_id, fiche_id, charte) VALUES (?,?,?,?)',
    [id(), dealId, ficheIds[code], 'HORS_CDP'])
}

// ── Workflow : étapes, puis statuts multi-axes ──────────────
const ETAPES = [
  ['Confirmation', '#f59e0b'], ['Devis', '#3b82f6'], ['Installation', '#8b5cf6'],
  ['Contrôle', '#ec4899'], ['Valorisation', '#10b981'],
]
const etapeIds = {}
ETAPES.forEach(([libelle, couleur], i) => {
  const eid = id(); etapeIds[libelle] = eid
  ins('INSERT INTO etape (id, libelle, ordre, couleur) VALUES (?,?,?,?)', [eid, libelle, i + 1, couleur])
})

const STATUTS_DOSSIER = [
  ['Confirmation', 'À confirmer', '#f59e0b', 0], ['Confirmation', 'À reconfirmer', '#f59e0b', 0],
  ['Confirmation', 'Manque infos', '#f97316', 0], ['Confirmation', 'En attente', '#eab308', 0],
  ['Confirmation', 'Non éligible', '#ef4444', 1], ['Confirmation', 'Pas intéressé', '#ef4444', 1],
  ['Confirmation', 'Annulé', '#dc2626', 1],
  ['Devis', 'Devis à faire', '#3b82f6', 0], ['Devis', 'Devis envoyé', '#2563eb', 0],
  ['Installation', 'À planifier', '#8b5cf6', 0], ['Installation', 'Planifié', '#7c3aed', 0],
  ['Installation', 'En commande', '#6d28d9', 0], ['Installation', 'Livré', '#5b21b6', 0],
  ['Contrôle', 'À contrôler', '#ec4899', 0], ['Contrôle', 'Contrôle OK', '#22c55e', 0],
  ['Contrôle', 'Contrôle négatif', '#ef4444', 1],
  ['Valorisation', 'À traiter', '#10b981', 0], ['Valorisation', 'Déposé', '#059669', 0],
  ['Valorisation', 'AAF', '#047857', 0],
]
const statutIds = {}
STATUTS_DOSSIER.forEach(([etape, libelle, couleur, perdu], i) => {
  const sid = id(); statutIds[libelle] = sid
  ins('INSERT INTO statut (id, libelle, ordre, couleur, axe, perdu, etape_id) VALUES (?,?,?,?,?,?,?)',
    [sid, libelle, i, couleur, 'DOSSIER', perdu, etapeIds[etape]])
})
const autresAxes = [
  ['ADMIN', ['En attente délégataire', 'Validé délégataire', 'Problème liste']],
  ['FACTURATION', ['Non facturé', 'Facturé', 'AAF']],
  ['INSTALLATION', ['Non installé', 'Installé', 'SAV']],
  ['COFRAC', ['Non contrôlé', 'Satisfaisant', 'Non satisfaisant']],
]
for (const [axe, libelles] of autresAxes) {
  libelles.forEach((l, i) => {
    const sid = id(); statutIds[`${axe}:${l}`] = sid
    ins('INSERT INTO statut (id, libelle, ordre, couleur, axe, perdu) VALUES (?,?,?,?,?,?)',
      [sid, l, i, '#64748b', axe, l === 'Non satisfaisant' ? 1 : 0])
  })
}

// ── Types de documents et liasses ───────────────────────────
const TYPES_DOC = [
  ['AH', "Attestation sur l'honneur"], ['DEVIS', 'Devis signé'], ['FACTURE', 'Facture'],
  ['AFT', 'Attestation de fin de travaux'], ['DOSSIER_CEE', 'Dossier CEE'],
  ['CADRE_CONTRIB', 'Cadre de contribution'], ['FICHE_TECH', 'Fiche technique produit'],
  ['PHOTOS', 'Photos de chantier'], ['RGE', 'Certificat RGE'], ['KBIS', 'Kbis / justificatif société'],
  ['CNI', "Pièce d'identité"], ['COFRAC', 'Rapport de contrôle COFRAC'],
]
const typeDocIds = {}
for (const [code, libelle] of TYPES_DOC) {
  const tid = id(); typeDocIds[code] = tid
  ins('INSERT INTO type_document (id, code, libelle) VALUES (?,?,?)', [tid, code, libelle])
}

// Une liasse par défaut pour chaque fiche, plus une liasse renforcée propre au Délégataire A.
const SOCLE = ['AH', 'DEVIS', 'FACTURE', 'AFT', 'CADRE_CONTRIB', 'FICHE_TECH', 'RGE', 'KBIS']
const liasseIds = {}
for (const code of ['BAT-TH-122', 'AGRI-EQ-110', 'TRA-SE-104', 'BAR-TH-160', 'BAT-EQ-127']) {
  const lid = id()
  liasseIds[code] = lid
  ins('INSERT INTO liasse (id, libelle, delegataire_id, fiche_code) VALUES (?,?,?,?)',
    [lid, `Liasse standard — ${code}`, null, code])
  SOCLE.forEach((c, i) => {
    ins('INSERT INTO liasse_item (id, liasse_id, type_document_id, obligatoire, ordre) VALUES (?,?,?,?,?)',
      [id(), lid, typeDocIds[c], 1, i])
  })
  ins('INSERT INTO liasse_item (id, liasse_id, type_document_id, obligatoire, ordre) VALUES (?,?,?,?,?)',
    [id(), lid, typeDocIds['PHOTOS'], 0, SOCLE.length])
}

// Le Délégataire A exige deux pièces de plus sur BAT-TH-122 : c'est tout l'intérêt
// d'une liasse par couple délégataire / fiche.
const liasseRenforcee = id()
ins('INSERT INTO liasse (id, libelle, delegataire_id, fiche_code) VALUES (?,?,?,?)',
  [liasseRenforcee, 'Liasse renforcée — Délégataire A / BAT-TH-122', delegs[0].id, 'BAT-TH-122'])
;[...SOCLE, 'PHOTOS', 'COFRAC'].forEach((c, i) => {
  ins('INSERT INTO liasse_item (id, liasse_id, type_document_id, obligatoire, ordre) VALUES (?,?,?,?,?)',
    [id(), liasseRenforcee, typeDocIds[c], 1, i])
})

// ── Dossiers synthétiques ───────────────────────────────────
const SECTEURS = ['BUREAUX', 'COMMERCE', 'SANTE', 'ENSEIGNEMENT', 'HOTEL_RESTAURANT', 'AUTRE']
const ZONES = ['H1', 'H2', 'H3']
const VILLES = [['Lyon', '69003', '69'], ['Grenoble', '38000', '38'], ['Chambéry', '73000', '73'],
  ['Valence', '26000', '26'], ['Saint-Étienne', '42000', '42'], ['Annecy', '74000', '74']]

// Répartition inspirée de la réalité d'un portefeuille CEE : forte déperdition en amont.
const REPARTITION = [
  ['Annulé', 36], ['Non éligible', 12], ['Pas intéressé', 9], ['À confirmer', 6],
  ['Devis envoyé', 5], ['À planifier', 8], ['Livré', 7], ['À contrôler', 3],
  ['À traiter', 4], ['Déposé', 6], ['AAF', 4],
]
const poolStatuts = REPARTITION.flatMap(([s, n]) => Array(n).fill(s))

const codesFiches = ['BAT-EQ-127', 'BAT-TH-122', 'AGRI-EQ-110', 'TRA-SE-104', 'BAR-TH-160']
let compteur = 1

/**
 * Résultat de contrôle COFRAC. On force une dispersion réaliste entre unités :
 * une régie décroche nettement, ce qui est précisément ce que le radar doit faire voir.
 */
const TAUX_KO_PAR_UNITE = { 'Régie Nord': 0.06, 'Régie Sud': 0.09, 'Apporteur Alpha': 0.27, 'Apporteur Bêta': 0.11 }
function cofracPour(i, unite) {
  if (i % 10 < 3) return 'Non contrôlé' // 30 % pas encore contrôlés
  const seuil = TAUX_KO_PAR_UNITE[unite] ?? 0.1
  // Pseudo-aléatoire déterministe pour un jeu de données reproductible
  const r = ((i * 2654435761) % 1000) / 1000
  return r < seuil ? 'Non satisfaisant' : 'Satisfaisant'
}

function dateAleatoire(debut, fin) {
  const d = new Date(debut).getTime() + Math.random() * (new Date(fin).getTime() - new Date(debut).getTime())
  return new Date(d).toISOString().slice(0, 10)
}

for (let i = 0; i < 120; i++) {
  const statutLib = poolStatuts[i % poolStatuts.length]
  const code = codesFiches[i % codesFiches.length]
  const [ville, cp, dep] = VILLES[i % VILLES.length]
  const secteur = SECTEURS[i % SECTEURS.length]
  const zone = ZONES[i % ZONES.length]
  const regime = i % 4 === 0 ? 'PRECAIRE' : 'CLASSIQUE'

  const bid = id()
  ins('INSERT INTO beneficiaire (id, type, raison_sociale, siret, code_ape, email, telephone, regime_revenu) VALUES (?,?,?,?,?,?,?,?)',
    [bid, 'SOCIETE', `Société démo ${String(i + 1).padStart(3, '0')}`, `${100000000 + i}00012`, '43.29A',
     `contact${i + 1}@exemple.fr`, '01 00 00 00 00', regime])

  const sid = id()
  const surface = 200 + ((i * 137) % 4000)
  ins('INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique, secteur_activite, age_batiment, surface, qpv) VALUES (?,?,?,?,?,?,?,?,?,?)',
    [sid, `${1 + (i % 90)} rue de la Démo`, cp, ville, dep, zone, secteur, 15 + (i % 40), surface, i % 11 === 0 ? 1 : 0])

  const quantite = code === 'BAT-EQ-127' ? 1200 + ((i * 97) % 5000)
    : code === 'BAT-TH-122' ? 5 + (i % 30)
    : code === 'BAR-TH-160' ? 50 + ((i * 13) % 400)
    : 1 + (i % 6)

  // Date d'engagement répartie sur 2025-2026 : certains dossiers LED tombent
  // volontairement après la date de suppression, pour que l'alerte se déclenche.
  const dateEng = dateAleatoire('2025-06-01', '2026-09-01')

  const did = id()
  ins(`INSERT INTO dossier (id, numero, unite_affaire_id, beneficiaire_id, site_id, fiche_id, fiche_version_id,
        deal_id, delegataire_id, installateur_id, charte, avec_mpr, quantite, source,
        etape_id, statut_dossier_id, statut_admin_id, statut_installation_id, statut_cofrac_id,
        date_engagement, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [did, `D-2026-${String(compteur++).padStart(5, '0')}`, unites[1 + (i % 4)].id, bid, sid,
     ficheIds[code], ficheVersionIds[code], dealId, delegs[i % 3].id, instal,
     'HORS_CDP', i % 5 === 0 ? 1 : 0, quantite, ['Web', 'Téléprospection', 'Apporteur', 'Recommandation'][i % 4],
     null, statutIds[statutLib],
     statutIds['ADMIN:' + (i % 3 === 0 ? 'Validé délégataire' : 'En attente délégataire')],
     statutIds['INSTALLATION:' + (i % 4 === 0 ? 'Installé' : 'Non installé')],
     statutIds['COFRAC:' + cofracPour(i, unites[1 + (i % 4)].nom)],
     dateEng, dateEng])

  // Pièces déjà fournies, proportionnelles à l'avancement du dossier :
  // un dossier en Valorisation a presque tout, un dossier en Confirmation n'a rien.
  const avancement = ['À traiter', 'Déposé', 'AAF'].includes(statutLib) ? 'complet'
    : ['À contrôler', 'Livré', 'À planifier'].includes(statutLib) ? 'partiel'
    : ['Devis envoyé'].includes(statutLib) ? 'debut' : 'aucun'

  if (avancement !== 'aucun') {
    const aFournir = avancement === 'complet' ? SOCLE
      : avancement === 'partiel' ? SOCLE.slice(0, 5)
      : ['AH', 'DEVIS']
    // Un dossier sur sept garde une pièce obligatoire manquante : c'est le cas réel
    // que le contrôle de complétude doit faire remonter avant le dépôt.
    const liste = (avancement === 'complet' && i % 7 === 0) ? aFournir.slice(0, -1) : aFournir
    liste.forEach((code, k) => {
      ins('INSERT INTO document_dossier (id, dossier_id, type_document_id, nom_fichier, valide_par_delegataire) VALUES (?,?,?,?,?)',
        [id(), did, typeDocIds[code], `${code.toLowerCase()}-${String(i + 1).padStart(3, '0')}.pdf`,
         avancement === 'complet' && k % 3 !== 2 ? 1 : 0])
    })
  }
}

// ── Figeage des montants pour les dossiers avancés ──────────
// Un dossier arrivé en Contrôle ou en Valorisation a forcément été calculé :
// on fige ses montants comme le ferait le bouton « Calculer et figer ».
const { calculerCumac, ficheApplicable } = await import('../lib/cumac.js')
const { calculerValorisation } = await import('../lib/marge.js')

const aFiger = db.prepare(`
  SELECT d.*, b.regime_revenu, s.secteur_activite, s.zone_climatique,
         fv.version AS fv_version, fv.date_effet, fv.date_fin, fv.arrete_reference, fv.motif_fin,
         fv.formule_type, fv.unite_variable, fv.coefficients, fv.conditions
  FROM dossier d
  JOIN beneficiaire b ON b.id = d.beneficiaire_id
  JOIN site s ON s.id = d.site_id
  JOIN fiche_version fv ON fv.id = d.fiche_version_id
  JOIN statut st ON st.id = d.statut_dossier_id
  JOIN etape e ON e.id = st.etape_id
  WHERE e.libelle IN ('Contrôle','Valorisation')`).all()

const dealFige = db.prepare('SELECT * FROM deal WHERE id = ?')
let figes = 0
for (const d of aFiger) {
  const fv = {
    version: d.fv_version, date_effet: d.date_effet, date_fin: d.date_fin,
    arrete_reference: d.arrete_reference, motif_fin: d.motif_fin,
    formule_type: d.formule_type, unite_variable: d.unite_variable,
    coefficients: d.coefficients, conditions: d.conditions,
  }
  const elig = ficheApplicable(fv, d.date_engagement)
  const cu = calculerCumac({
    ficheVersion: fv, quantite: d.quantite,
    contexte: { secteurActivite: d.secteur_activite, zoneClimatique: d.zone_climatique },
  })
  const dl = d.deal_id ? dealFige.get(d.deal_id) : null
  if (!dl) continue
  const v = calculerValorisation({
    cumac: elig.applicable ? cu.cumac : 0, deal: dl,
    regime: d.regime_revenu === 'PRECAIRE' ? 'PRECAIRE' : 'CLASSIQUE',
    avecMpr: !!d.avec_mpr, coutPose: 0, tauxApporteur: 8,
  })
  ins(`UPDATE dossier SET volume_cumac=?, prime_delegataire=?, prime_beneficiaire=?,
         commission_installateur=?, commission_apporteur=?, cout_pose=?, marge_nette=?, date_calcul=?
       WHERE id=?`,
    [elig.applicable ? cu.cumac : 0, v.caDelegataire, v.primeBeneficiaire, v.commissionInstallateur,
     v.commissionApporteur, 0, v.margeNette, new Date().toISOString(), d.id])
  figes++
}

// ── Lots de dépôt de démonstration ───────────────────────────
// Un lot déjà déposé (dossiers verrouillés) et un lot en cours de constitution,
// pour que l'écran /lots montre les deux états dès la première ouverture.
const deposables = db.prepare(`
  SELECT d.id, d.volume_cumac, d.prime_delegataire
  FROM dossier d
  JOIN statut st ON st.id = d.statut_dossier_id
  WHERE d.lot_id IS NULL AND st.libelle IN ('Déposé', 'À traiter')
  ORDER BY st.libelle DESC, d.numero`).all()

const lotDepose = deposables.slice(0, 4)
const lotOuvert = deposables.slice(4, 8)
const annee = new Date().getFullYear()
let lotsCrees = 0

const creerLotDemo = ({ numero, organisme, statut, dateDepot, contenu }) => {
  if (contenu.length === 0) return
  const lid = id()
  const cumacLot = contenu.reduce((s, d) => s + (d.volume_cumac || 0), 0)
  const caLot = contenu.reduce((s, d) => s + (d.prime_delegataire || 0), 0)
  ins(`INSERT INTO lot (id, numero, organisme, statut, date_depot, volume_cumac, chiffre_affaire)
       VALUES (?,?,?,?,?,?,?)`,
    [lid, numero, organisme, statut, dateDepot, cumacLot, caLot])
  for (const d of contenu) {
    ins('UPDATE dossier SET lot_id = ?, verrouille = ?, date_depot = COALESCE(date_depot, ?) WHERE id = ?',
      [lid, statut === 'DEPOSE' ? 1 : 0, dateDepot, d.id])
  }
  lotsCrees++
}

const ilYA = (jours) => {
  const d = new Date()
  d.setDate(d.getDate() - jours)
  return d.toISOString().slice(0, 10)
}

creerLotDemo({
  numero: `LOT-${annee}-001`, organisme: 'Délégataire A', statut: 'DEPOSE',
  dateDepot: ilYA(21), contenu: lotDepose,
})
creerLotDemo({
  numero: `LOT-${annee}-002`, organisme: 'Délégataire A', statut: 'EN_CONSTITUTION',
  dateDepot: null, contenu: lotOuvert,
})

console.log('Base initialisée :', DB_PATH)
console.log('  fiches            :', db.prepare('SELECT COUNT(*) n FROM fiche').get().n)
console.log('  versions de fiche :', db.prepare('SELECT COUNT(*) n FROM fiche_version').get().n)
console.log('  deals             :', db.prepare('SELECT COUNT(*) n FROM deal').get().n)
console.log('  statuts           :', db.prepare('SELECT COUNT(*) n FROM statut').get().n)
console.log('  dossiers          :', db.prepare('SELECT COUNT(*) n FROM dossier').get().n)
console.log('  montants figés    :', figes)
console.log('  pièces jointes    :', db.prepare('SELECT COUNT(*) n FROM document_dossier').get().n)
console.log('  lots de dépôt     :', lotsCrees)
