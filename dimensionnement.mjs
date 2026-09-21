/**
 * Contrôles du dimensionnement.
 *
 * Ce module est le pont entre ce que le client déclare et ce que le client paie. Trois
 * choses comptent donc, dans cet ordre :
 *
 * 1. **Il ne dimensionne pas à la place de l'ingénieur.** Aucune puissance n'est proposée,
 *    déduite ou pré-remplie. Un chiffre suggéré par la machine finit validé sans être relu.
 * 2. **Il refuse de reporter ce qui est faux.** Humidité cible supérieure à l'initiale,
 *    puissance nulle, type de produit non choisi : pas de report, et le motif est dit.
 * 3. **Il ne réécrit jamais une opération figée.** Un dimensionnement révisé crée une
 *    nouvelle opération ; il n'efface pas des montants déjà calculés.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const {
  controlesDimensionnement, etatDimensionnement, reporterDansOperation,
  CHAMPS_DIMENSIONNEMENT, ENTREES_CLIENT, FICHE_SECHAGE,
} = await import('./lib/dimensionnement.js')
const { enregistrerReponses, reponsesDuDossier, champsClientQualification } = await import('./lib/fiche-qualification.js')
const { calculerCumac } = await import('./lib/cumac.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('Les contrôles arithmétiques — des faits, pas des avis')

const volumeIncoherent = controlesDimensionnement({
  'q.bat_longueur': 40, 'q.bat_largeur': 20, 'q.bat_hauteur': 8, 'q.bat_volume': 2000,
})
ok(volumeIncoherent.some((a) => a.champ === 'q.bat_volume'),
  'un volume déclaré très éloigné de L × l × h est signalé (2 000 contre 6 400 m³)')

ok(controlesDimensionnement({
  'q.bat_longueur': 40, 'q.bat_largeur': 20, 'q.bat_hauteur': 8, 'q.bat_volume': 6400,
}).length === 0, 'un volume cohérent ne déclenche rien')

ok(controlesDimensionnement({
  'q.bat_longueur': 40, 'q.bat_largeur': 20, 'q.bat_hauteur': 8, 'q.bat_volume': 6100,
}).length === 0, 'et un écart de moins de 10 % non plus — une dalle, un pilier, ça arrive')

const humidite = controlesDimensionnement({ 'q.humidite_initiale': 20, 'q.humidite_cible': 45 })
ok(humidite.some((a) => a.niveau === 'BLOQUANT'),
  'une humidité cible supérieure à l\'initiale est bloquante — il n\'y a rien à sécher')

ok(controlesDimensionnement({ 'q.humidite_initiale': 45, 'q.humidite_cible': 20 }).length === 0,
  'le sens normal ne déclenche rien')

const puissanceTropGrande = controlesDimensionnement({ 'q.dim_puissance': 120, 'q.energie_kva': 60 })
ok(puissanceTropGrande.some((a) => /abonnement/.test(a.message)),
  'une puissance qui dépasse le compteur est signalée — à savoir avant la pose, pas après')
ok(puissanceTropGrande.every((a) => a.niveau !== 'BLOQUANT'),
  'sans bloquer : renforcer un abonnement est possible')

ok(controlesDimensionnement({ 'q.dim_puissance': 0 }).some((a) => a.niveau === 'BLOQUANT'),
  'une puissance nulle est bloquante : c\'est elle qui porte tout le calcul')

// Le contrôle des contrôles : rien ne doit être signalé sur une fiche vide.
ok(controlesDimensionnement({}).length === 0, 'une fiche vide ne produit aucune alerte')

// ═══════════════════════════════════════════════════════════
titre('Le module ne dimensionne pas à la place de l\'ingénieur')

const source = fs.readFileSync('lib/dimensionnement.js', 'utf8')
// Aucune formule ne doit produire une puissance : ni depuis le volume, ni depuis l'humidité.
ok(!/dim_puissance\s*[:=]\s*[^=]*[*/+]/.test(source),
  'aucune formule ne calcule une puissance thermique')
// On cherche un IDENTIFIANT, pas un mot dans un commentaire : le fichier explique
// justement qu'il ne propose rien, et cette phrase-là ne doit pas faire échouer le test.
const sansCommentaires = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
ok(!/(puissanceEstimee|puissanceSuggeree|suggestionPuissance|estimerPuissance)/.test(sansCommentaires),
  'et aucune variable ne porte le nom d\'une estimation de puissance')

const ecran = fs.readFileSync('app/dossiers/[id]/Dimensionnement.jsx', 'utf8')
ok(!/defaultValue=\{[^}]*puissance[^}]*\}/i.test(ecran.replace(/nombre\(etat\.puissance\)/g, '')),
  'le champ de puissance n\'est pas pré-rempli par la machine')

// ═══════════════════════════════════════════════════════════
titre('Du relevé client au calcul CEE')

const CIBLE = path.join(os.tmpdir(), 'dim-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

// Le référentiel réel : c'est le barème officiel qu'on veut voir appliqué.
const reel = new DatabaseSync(process.env.CEE_DB_SOURCE || 'db/cee.db', { readOnly: true })
const ficheReelle = reel.prepare('SELECT * FROM fiche WHERE code = ?').get(FICHE_SECHAGE)
const versionReelle = reel.prepare('SELECT * FROM fiche_version WHERE fiche_id = ? ORDER BY date_effet DESC LIMIT 1')
  .get(ficheReelle.id)
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)')
  .run(ficheReelle.id, ficheReelle.code, ficheReelle.secteur, ficheReelle.domaine, ficheReelle.libelle)
db.prepare(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, arrete_reference,
            motif_fin, formule_type, unite_variable, coefficients, conditions)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run(versionReelle.id, versionReelle.fiche_id, versionReelle.version, versionReelle.date_effet,
    versionReelle.date_fin, versionReelle.arrete_reference, versionReelle.motif_fin,
    versionReelle.formule_type, versionReelle.unite_variable, versionReelle.coefficients, versionReelle.conditions)
reel.close()

const uid = () => crypto.randomUUID()
const benefId = uid(); const siteId = uid(); const dossierId = uid(); const chantierId = uid()
db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale) VALUES (?,?,?)')
  .run(benefId, 'SOCIETE', 'SCIERIE DES MONTS')
db.prepare('INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique) VALUES (?,?,?,?,?,?)')
  .run(siteId, 'Route de Queuille', '63780', 'Saint-Georges-de-Mons', '63', 'H1')
db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id)
            VALUES (?,?,?,?,?,?)`)
  .run(dossierId, 'BPG-2026-0001', benefId, siteId, ficheReelle.id, versionReelle.id)
db.prepare('INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre) VALUES (?,?,?,1,?,1)')
  .run(chantierId, dossierId, siteId, 'Chantier principal')

// ── Le client a rempli sa fiche ──
enregistrerReponses(db, dossierId, {
  'q.activite': ['Scierie', 'Exploitant forestier'],
  'q.produit_nature': 'Plaquettes de hêtre',
  'q.humidite_initiale': '45', 'q.humidite_cible': '20',
  'q.bat_longueur': '40', 'q.bat_largeur': '20', 'q.bat_hauteur': '8', 'q.bat_volume': '6400',
  'q.energie': ['Électricité', 'Biomasse'], 'q.energie_kva': '80',
})

let etat = etatDimensionnement(db, dossierId)
ok(etat.entrees.some((e) => e.cle === 'q.produit_nature' && e.valeur === 'Plaquettes de hêtre'),
  'les réponses du client remontent sur l\'écran du bureau d\'études')
ok(etat.anomalies.length === 0, 'aucune incohérence sur ce relevé')
ok(!etat.reportable, 'sans puissance thermique, rien ne peut être reporté')

ok(etat.suggestionProduit === 'FORESTIER',
  'le type de produit est SUGGÉRÉ depuis l\'activité (scierie + exploitant forestier)')
ok(/Scierie/.test(etat.motifSuggestion), 'et la suggestion dit d\'où elle vient')

// Une activité mixte ne doit RIEN suggérer : le barème diffère du simple au double.
const dossierMixte = uid(); const benef2 = uid(); const site2 = uid()
db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale) VALUES (?,?,?)').run(benef2, 'SOCIETE', 'MIXTE')
db.prepare('INSERT INTO site (id, adresse, code_postal, ville, zone_climatique) VALUES (?,?,?,?,?)')
  .run(site2, 'x', '63000', 'y', 'H1')
db.prepare('INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id) VALUES (?,?,?,?,?,?)')
  .run(dossierMixte, 'BPG-2026-0002', benef2, site2, ficheReelle.id, versionReelle.id)
enregistrerReponses(db, dossierMixte, { 'q.activite': ['Scierie', 'Céréales'] })
ok(etatDimensionnement(db, dossierMixte).suggestionProduit === null,
  'une activité à cheval sur les deux filières ne suggère rien — c\'est à l\'ingénieur de trancher')

// ── Le bureau d'études conclut ──
enregistrerReponses(db, dossierId, {
  'q.dim_capacite': '35', 'q.dim_volume_utile': '4200', 'q.dim_nb_kits': '6',
  'q.dim_puissance': '72', 'q.dim_debit': '48000', 'q.dim_surface_diffusion': '180',
})
etat = etatDimensionnement(db, dossierId)
ok(etat.puissance === 72, `la puissance retenue est lue (${etat.puissance} kW)`)
ok(etat.reportable, 'le dimensionnement devient reportable')

// ── Le report ──
const refus1 = reporterDansOperation(db, dossierId, { typeProduit: '', typeInstallation: 'SYSTEME_COMPLET' })
ok(!refus1.ok && /simple au double/.test(refus1.motifs.join(' ')),
  'sans type de produit, le report est refusé — et le motif dit ce que ça coûte')

const refus2 = reporterDansOperation(db, dossierId, { typeProduit: 'FORESTIER', typeInstallation: '' })
ok(!refus2.ok, 'sans type d\'installation non plus')

const rep = reporterDansOperation(db, dossierId, { typeProduit: 'FORESTIER', typeInstallation: 'SYSTEME_COMPLET' })
ok(rep.ok && rep.creee, 'le report crée l\'opération')

const op = db.prepare('SELECT * FROM operation WHERE id = ?').get(rep.operationId)
ok(Number(op.quantite) === 72, 'la quantité de l\'opération est la puissance thermique, en kW')
ok(op.unite === 'kW', `et l'unité suit la fiche (${op.unite})`)
ok(op.type_produit === 'FORESTIER' && op.type_installation === 'SYSTEME_COMPLET',
  'les deux critères de barème sont posés sur l\'opération')
ok(op.date_calcul === null, 'le report ne fige AUCUN montant — il prépare, il ne conclut pas')

// ── Le calcul qui en découle ──
const fv = db.prepare('SELECT * FROM fiche_version WHERE id = ?').get(versionReelle.id)
const cumac = calculerCumac({
  ficheVersion: fv, quantite: op.quantite,
  contexte: { zoneClimatique: 'H1', typeProduit: op.type_produit, typeInstallation: op.type_installation },
})
ok(cumac.complet, 'le volume cumac se calcule')
ok(cumac.coefficient === 102600, `le barème retenu est celui du forestier en H1 (${cumac.coefficient})`)
ok(cumac.cumac === 102600 * 72, `soit ${(cumac.cumac / 1000).toLocaleString('fr-FR')} MWh cumac pour 72 kW`)

// Le même dossier en agricole : la différence doit sauter aux yeux.
const enAgricole = calculerCumac({
  ficheVersion: fv, quantite: 72,
  contexte: { zoneClimatique: 'H1', typeProduit: 'AGRICOLE', typeInstallation: 'SYSTEME_COMPLET' },
})
ok(cumac.cumac - enAgricole.cumac > 4000000,
  `se tromper de filière coûterait ${((cumac.cumac - enAgricole.cumac) / 1000).toLocaleString('fr-FR')} MWh cumac`)

// ── Rejouer le report ──
const rep2 = reporterDansOperation(db, dossierId, { typeProduit: 'AGRICOLE', typeInstallation: 'TOITURE_COUPLEE' })
ok(rep2.ok && !rep2.creee && rep2.operationId === rep.operationId,
  'un second report met à jour l\'opération non figée au lieu d\'en créer une deuxième')
const opMaj = db.prepare('SELECT * FROM operation WHERE id = ?').get(rep.operationId)
ok(opMaj.type_produit === 'AGRICOLE' && opMaj.type_installation === 'TOITURE_COUPLEE',
  'et les critères sont bien corrigés')

// ── Une opération FIGÉE n'est jamais réécrite ──
db.prepare(`UPDATE operation SET date_calcul = ?, volume_cumac = ?, prime_beneficiaire = ? WHERE id = ?`)
  .run('2026-09-18T10:00:00.000Z', 7387200, 30000, rep.operationId)
enregistrerReponses(db, dossierId, { 'q.dim_puissance': '90' })

const rep3 = reporterDansOperation(db, dossierId, { typeProduit: 'FORESTIER', typeInstallation: 'SYSTEME_COMPLET' })
ok(rep3.ok && rep3.creee, 'un report après figeage crée une NOUVELLE opération')
ok(rep3.operationId !== rep.operationId, 'et ne touche pas à la précédente')
const figee = db.prepare('SELECT * FROM operation WHERE id = ?').get(rep.operationId)
ok(Number(figee.quantite) === 72 && Number(figee.volume_cumac) === 7387200,
  'l\'opération figée garde exactement sa quantité et son volume')
ok(Number(db.prepare('SELECT quantite FROM operation WHERE id = ?').get(rep3.operationId).quantite) === 90,
  'la nouvelle porte la puissance révisée (90 kW)')

// ── Un dimensionnement bloquant ne se reporte pas ──
enregistrerReponses(db, dossierId, { 'q.humidite_initiale': '20', 'q.humidite_cible': '45' })
const refus3 = reporterDansOperation(db, dossierId, { typeProduit: 'FORESTIER', typeInstallation: 'SYSTEME_COMPLET' })
ok(!refus3.ok && /rien à sécher/.test(refus3.motifs.join(' ')),
  'une incohérence bloquante empêche le report, en disant laquelle')

// ═══════════════════════════════════════════════════════════
titre('Cohérence de la section 14')

ok(CHAMPS_DIMENSIONNEMENT.length === 7, `sept champs de dimensionnement (obtenu : ${CHAMPS_DIMENSIONNEMENT.length})`)
const ouvertsAuClient = champsClientQualification().map((c) => c.cle)
ok(CHAMPS_DIMENSIONNEMENT.every((c) => !ouvertsAuClient.includes(c)),
  'aucun d\'eux n\'est ouvert au client — c\'est le travail du bureau d\'études')
ok(ENTREES_CLIENT.every(([cle]) => ouvertsAuClient.includes(cle)),
  'et toutes les entrées affichées viennent bien de ce que le client peut remplir')

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
