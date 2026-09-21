/**
 * Contrôles du module de contrôle avant dépôt.
 *
 * On ne se contente pas de le lancer sur la base réelle : un module qui ne trouve rien sur
 * des données propres a l'air de marcher. On lui fabrique donc des dossiers volontairement
 * fautifs — une pose avant le devis, un RGE périmé de la veille, une opération datée du
 * lendemain de l'abrogation — et on vérifie qu'il les attrape, avec le bon niveau.
 *
 * Et symétriquement, on lui donne un dossier irréprochable : **un contrôle qui crie au loup
 * sur un dossier sain est pire qu'absent**, parce qu'on cesse de le lire.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.CEE_FICHIERS = fs.mkdtempSync(path.join(os.tmpdir(), 'fichiers-test-'))

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const { appliquerManuelles } = await import('./lib/migrations-manuelles.js')
const { controlerDossier, controlerLot, PRIME_MAX_EUR_PAR_MWH } = await import('./lib/controles-depot.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
// Une base minuscule, entièrement fabriquée : on maîtrise chaque valeur.
const CIBLE = path.join(os.tmpdir(), 'controles-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())
appliquerManuelles(db)

const uid = () => crypto.randomUUID()
const run = (s, p = []) => db.prepare(s).run(...p)

// Référentiels
const ficheId = uid(), versionId = uid()
run("INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)",
  [ficheId, 'TEST-EQ-001', 'TERTIAIRE', 'EQUIPEMENT', 'Fiche de test'])
run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, motif_fin,
     formule_type, unite_variable, coefficients, conditions) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [versionId, ficheId, 'v1', '2025-01-01', null, null, 'FORFAIT_PAR_UNITE', 'U', '{"forfait":1000}', '{}'])

const ficheAbrogeeId = uid(), versionAbrogeeId = uid()
run("INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)",
  [ficheAbrogeeId, 'TEST-TH-999', 'AGRICULTURE', 'THERMIQUE', 'Fiche abrogée de test'])
run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, motif_fin,
     formule_type, unite_variable, coefficients, conditions) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [versionAbrogeeId, ficheAbrogeeId, 'v1', '2025-01-01', '2026-06-03',
   'Fiche abrogée par arrêté du 29 mai 2026.', 'FORFAIT_PAR_UNITE', 'U', '{"forfait":710}', '{}'])

const instId = uid()
run('INSERT INTO installateur_rge (id, raison_sociale, siret, actif) VALUES (?,?,?,1)',
  [instId, 'POSEUR TEST', '12345678900011'])
run(`INSERT INTO certification_rge (id, installateur_id, libelle, numero, date_debut, date_fin)
     VALUES (?,?,?,?,?,?)`, [uid(), instId, 'QUALIBAT', 'Q-1', '2024-01-01', '2026-01-31'])

for (const [code, libelle] of [['AH', "Attestation sur l'honneur"], ['DEVIS', 'Devis'],
  ['FACTURE', 'Facture'], ['AFT', 'AFT'], ['RGE', 'RGE']]) {
  run('INSERT INTO type_document (id, code, libelle) VALUES (?,?,?)', [uid(), code, libelle])
}

/** Fabrique un dossier complet, puis applique les écarts demandés. */
function fabriquer(numero, ecarts = {}) {
  const siteId = uid(), dossierId = uid(), chantierId = uid(), benefId = uid()
  run('INSERT INTO beneficiaire (id, raison_sociale) VALUES (?,?)', [benefId, 'CLIENT TEST'])
  run(`INSERT INTO site (id, adresse, code_postal, ville, zone_climatique,
       age_batiment_tranche, type_chauffage) VALUES (?,?,?,?,?,?,?)`,
    [siteId, '1 rue du Test', ecarts.codePostal ?? '69003', 'LYON',
     ecarts.zone !== undefined ? ecarts.zone : 'H1',
     ecarts.age !== undefined ? ecarts.age : 'PLUS_15_ANS',
     ecarts.chauffage !== undefined ? ecarts.chauffage : 'COMBUSTIBLE'])

  run(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, installateur_id, fiche_id, fiche_version_id,
       quantite, volume_cumac, prime_beneficiaire, date_calcul,
       date_signature, date_pose, date_achevement)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [dossierId, numero, benefId, siteId, ecarts.sansInstallateur ? null : instId,
     ecarts.ficheId ?? ficheId, ecarts.versionId ?? versionId,
     1, ecarts.volume ?? 100000, ecarts.prime ?? 400,
     ecarts.nonFige ? null : '2026-01-20',
     ecarts.dateSignature ?? '2025-06-01',
     ecarts.datePose ?? '2025-07-15',
     ecarts.dateAchevement ?? '2025-07-20'])

  run('INSERT INTO chantier (id, dossier_id, site_id, ordre, principal) VALUES (?,?,?,1,1)',
    [chantierId, dossierId, siteId])
  run(`INSERT INTO operation (id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id,
       charte, quantite, unite, volume_cumac, date_calcul) VALUES (?,?,?,1,?,?,?,?,?,?,?)`,
    [uid(), dossierId, chantierId, ecarts.ficheId ?? ficheId, ecarts.versionId ?? versionId,
     'HORS_CDP', 1, 'U', ecarts.volume ?? 100000, ecarts.nonFige ? null : '2026-01-20'])

  for (const code of (ecarts.pieces ?? ['AH', 'DEVIS', 'FACTURE', 'AFT', 'RGE'])) {
    const t = db.prepare('SELECT id FROM type_document WHERE code = ?').get(code)
    run(`INSERT INTO document_dossier (id, dossier_id, type_document_id, nom_fichier,
         empreinte, taille, type_mime, extension) VALUES (?,?,?,?,?,?,?,?)`,
      [uid(), dossierId, t.id, code + '.pdf', uid().replace(/-/g, ''), 1000, 'application/pdf', 'pdf'])
  }
  return dossierId
}

const codes = (r) => r.anomalies.map((x) => x.code)

// ═══════════════════════════════════════════════════════════
titre('Un dossier irréprochable ne déclenche rien')

const sain = fabriquer('TEST-0001')
const rSain = controlerDossier(db, sain)
ok(rSain.bloquantes === 0, `aucun blocage sur un dossier sain (obtenu : ${rSain.bloquantes})`)
ok(rSain.anomalies.length === 0,
  `aucune anomalie du tout (obtenu : ${codes(rSain).join(', ') || 'aucune'})`)

// ═══════════════════════════════════════════════════════════
titre('Chronologie')

const poseAvantDevis = fabriquer('TEST-0002', { datePose: '2025-05-01', dateAchevement: '2025-05-02' })
ok(codes(controlerDossier(db, poseAvantDevis)).includes('CHRONOLOGIE'),
  'une pose antérieure à la signature du devis est signalée')
const r2 = controlerDossier(db, poseAvantDevis)
ok(r2.anomalies.find((x) => x.code === 'CHRONOLOGIE')?.niveau === 'BLOQUANT',
  'et elle est bloquante')
ok(/2025-05-01/.test(r2.anomalies.find((x) => x.code === 'CHRONOLOGIE')?.detail || ''),
  'le détail porte les deux dates, pour vérifier sans rouvrir le dossier')

// Le même jour n'est PAS une anomalie : poser le jour de la signature est banal.
const memeJour = fabriquer('TEST-0003', { datePose: '2025-06-01', dateAchevement: '2025-06-01' })
ok(!codes(controlerDossier(db, memeJour)).includes('CHRONOLOGIE'),
  'une pose le jour même de la signature ne déclenche rien')

// ═══════════════════════════════════════════════════════════
titre('Fiche abrogée — le contrôle qui manquait en juin 2026')

const apresAbrogation = fabriquer('TEST-0004', {
  ficheId: ficheAbrogeeId, versionId: versionAbrogeeId,
  dateSignature: '2026-06-20', datePose: '2026-07-01', dateAchevement: '2026-07-05',
})
const rAbr = controlerDossier(db, apresAbrogation)
ok(codes(rAbr).includes('FICHE_ABROGEE'), 'une opération postérieure à l\'abrogation est signalée')
ok(rAbr.anomalies.find((x) => x.code === 'FICHE_ABROGEE')?.niveau === 'BLOQUANT',
  'et elle est bloquante, pas un simple avertissement')

// Avant l'abrogation, la même fiche ne doit rien déclencher.
const avantAbrogation = fabriquer('TEST-0005', {
  ficheId: ficheAbrogeeId, versionId: versionAbrogeeId,
  dateSignature: '2026-01-10', datePose: '2026-02-01', dateAchevement: '2026-02-05',
})
ok(!codes(controlerDossier(db, avantAbrogation)).includes('FICHE_ABROGEE'),
  'la même fiche avant son abrogation ne déclenche rien')

// ═══════════════════════════════════════════════════════════
titre('RGE')

const rgePerime = fabriquer('TEST-0006', {
  dateSignature: '2026-02-10', datePose: '2026-03-01', dateAchevement: '2026-03-05',
})
const rRge = controlerDossier(db, rgePerime)
ok(codes(rRge).includes('RGE_PERIME'), 'des travaux après la fin du RGE sont signalés')
ok(/2026-01-31/.test(rRge.anomalies.find((x) => x.code === 'RGE_PERIME')?.detail || ''),
  'le détail donne la dernière validité connue')

// La veille de l'échéance, c'est encore bon. Le contrôle ne doit pas être décalé d'un jour.
const rgeJusteAvant = fabriquer('TEST-0007', {
  dateSignature: '2026-01-05', datePose: '2026-01-31', dateAchevement: '2026-01-31',
})
ok(!codes(controlerDossier(db, rgeJusteAvant)).includes('RGE_PERIME'),
  'le dernier jour de validité du RGE est encore couvert')

const sansInstallateur = fabriquer('TEST-0008', { sansInstallateur: true })
ok(!codes(controlerDossier(db, sansInstallateur)).includes('RGE_PERIME'),
  'un dossier sans installateur ne déclenche pas un RGE périmé')

// ═══════════════════════════════════════════════════════════
titre('Vraisemblance des montants')

const primeFolle = fabriquer('TEST-0009', { volume: 100000, prime: 5000 })
ok(codes(controlerDossier(db, primeFolle)).includes('PRIME_INVRAISEMBLABLE'),
  `une prime de 50 €/MWh dépasse le plafond de ${PRIME_MAX_EUR_PAR_MWH}`)

const primeNormale = fabriquer('TEST-0010', { volume: 100000, prime: 400 })
ok(!codes(controlerDossier(db, primeNormale)).includes('PRIME_INVRAISEMBLABLE'),
  'une prime de 4 €/MWh ne déclenche rien')

const volumeNul = fabriquer('TEST-0011', { volume: 0 })
ok(codes(controlerDossier(db, volumeNul)).includes('VOLUME_NUL'), 'un volume nul est signalé')

// ═══════════════════════════════════════════════════════════
titre('Données du site')

const sansZone = fabriquer('TEST-0012', { zone: null })
ok(codes(controlerDossier(db, sansZone)).includes('SITE_INCOMPLET'),
  'une zone climatique absente est signalée')
ok(controlerDossier(db, sansZone).anomalies.find((x) => x.code === 'SITE_INCOMPLET')?.niveau === 'AVERTISSEMENT',
  "en avertissement — on peut déposer, mais l'éligibilité n'est pas vérifiable")

const zoneFausse = fabriquer('TEST-0013', { zone: 'H9' })
const rZone = controlerDossier(db, zoneFausse)
ok(codes(rZone).includes('SITE_VALEUR_HORS_LISTE'), 'une zone hors référentiel est signalée')
ok(rZone.anomalies.find((x) => x.code === 'SITE_VALEUR_HORS_LISTE')?.niveau === 'BLOQUANT',
  'et celle-là est bloquante : la valeur ne veut rien dire')

// H1_IDF doit être acceptée — c'est tout l'objet de la correction.
const idf = fabriquer('TEST-0014', { zone: 'H1_IDF', codePostal: '75011' })
ok(!codes(controlerDossier(db, idf)).includes('SITE_VALEUR_HORS_LISTE'),
  'H1 Île-de-France est une zone valide')

// ═══════════════════════════════════════════════════════════
titre('Pièces du dossier')

const sansAh = fabriquer('TEST-0015', { pieces: ['DEVIS', 'FACTURE'] })
const rPieces = controlerDossier(db, sansAh)
ok(codes(rPieces).filter((c) => c === 'PIECE_MANQUANTE').length === 3,
  `trois pièces manquantes signalées (AH, AFT, RGE) — obtenu ${codes(rPieces).filter((c) => c === 'PIECE_MANQUANTE').length}`)
const ah = rPieces.anomalies.find((x) => x.detail === 'type AH')
ok(ah?.niveau === 'BLOQUANT', "l'attestation sur l'honneur manquante est bloquante")
const aft = rPieces.anomalies.find((x) => x.detail === 'type AFT')
ok(aft?.niveau === 'AVERTISSEMENT', "l'attestation de fin de travaux manquante n'est qu'un avertissement")

// ═══════════════════════════════════════════════════════════
titre('Ce que le module refuse de faire')

const avantTout = db.prepare('SELECT COUNT(*) n FROM dossier').get().n
const volumeAvant = db.prepare('SELECT volume_cumac v FROM dossier WHERE numero = ?').get('TEST-0009').v
controlerLot(db, db.prepare('SELECT id FROM dossier').all().map((r) => r.id))
const apresTout = db.prepare('SELECT COUNT(*) n FROM dossier').get().n
const volumeApres = db.prepare('SELECT volume_cumac v FROM dossier WHERE numero = ?').get('TEST-0009').v
ok(avantTout === apresTout, 'contrôler ne crée ni ne supprime aucun dossier')
ok(volumeAvant === volumeApres,
  'contrôler ne corrige aucun montant — même celui qu\'il juge invraisemblable')

// ═══════════════════════════════════════════════════════════
titre('Agrégation sur un lot')

const bilan = controlerLot(db, db.prepare('SELECT id FROM dossier').all().map((r) => r.id))
ok(bilan.dossiers === apresTout, `${bilan.dossiers} dossiers passés au crible`)
ok(bilan.deposables + bilan.bloques === bilan.dossiers,
  'chaque dossier est soit déposable, soit bloqué — jamais les deux ni aucun')
ok(bilan.deposables >= 1, `au moins le dossier sain ressort déposable (${bilan.deposables})`)
ok(Object.values(bilan.parCode).every((x) => x.exemples.length > 0),
  'chaque code d\'anomalie porte au moins un exemple vérifiable')

fs.rmSync(process.env.CEE_FICHIERS, { recursive: true, force: true })
fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
