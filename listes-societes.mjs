/**
 * Contrôles des listes paramétrables et des sociétés émettrices.
 *
 * 1. **Ce qui s'imprime sur un document légal se contrôle** : IBAN (clé modulo 97), BIC,
 *    SIRET qui commence par le SIREN, clé du numéro de TVA.
 * 2. **Une série de numéros entamée garde son préfixe.**
 * 3. **Le logo se juge sur son contenu** : ni SVG, ni HTML renommé.
 * 4. **L'IBAN est figé sur la facture à l'émission** : changer de banque ne réécrit pas une
 *    facture déjà envoyée.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const L = await import('./lib/listes.js')
const S = await import('./lib/societes.js')
const F = await import('./lib/facture.js')
const A = await import('./lib/aap.js')
const { factureHtml } = await import('./lib/facture-html.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const leve = (f) => { try { f(); return null } catch (e) { return e.message } }

const CIBLE = path.join(os.tmpdir(), `listes-${process.pid}.db`)
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())
const uid = () => crypto.randomUUID()

// ═══════════════════════════════════════════════════════════
titre('Les contrôles de saisie')
ok(L.ibanValide('FR76 3000 6000 0112 3456 7890 189') && !L.ibanValide('FR76 3000 6000 0112 3456 7890 188'), "IBAN : un seul chiffre faux est détecté par la clé")
ok(L.bicValide('AGRIFRPP') && L.bicValide('BNPAFRPPXXX') && !L.bicValide('BNP'), 'BIC : 8 ou 11 caractères')
ok(JSON.stringify(L.departements('1, 38 69;2a 971')) === '["01","2A","38","69","971"]', 'départements : normalisés et triés')
ok(/99/.test(leve(() => L.departements('01 99')) || ''), 'un département inconnu est refusé, pas ignoré')

// ═══════════════════════════════════════════════════════════
titre('Listes')
ok(/obligatoire/.test(leve(() => L.enregistrerValeur(db, 'compte_bancaire', { libelle: 'Compte courant', donnees: { iban: '' } })) || ''), 'un compte sans IBAN est refusé')
ok(/clé de contrôle/.test(leve(() => L.enregistrerValeur(db, 'compte_bancaire', { libelle: 'Compte courant', donnees: { iban: 'FR7630006000011234567890188', bic: 'AGRIFRPP' } })) || ''), 'un IBAN faux est refusé')
const compte1 = L.enregistrerValeur(db, 'compte_bancaire', { libelle: 'Crédit Agricole', donnees: { banque: 'CA Centre-Est', iban: 'fr7630006000011234567890189', bic: 'agrifrpp' } })
ok(L.valeurListe(db, compte1).donnees.iban === 'FR76 3000 6000 0112 3456 7890 189', 'IBAN rangé par groupes de quatre, en majuscules')
ok(/existe déjà/.test(leve(() => L.enregistrerValeur(db, 'compte_bancaire', { libelle: 'crédit agricole', donnees: { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' } })) || ''), 'un doublon de libellé (casse comprise) est refusé')
const amo1 = L.enregistrerValeur(db, 'amo', { libelle: 'Soliha', donnees: { siret: '123 456 789 00012' }, parDefaut: true })
const amo2 = L.enregistrerValeur(db, 'amo', { libelle: 'Urbanis', parDefaut: true })
ok(L.valeursListe(db, 'amo').filter((x) => x.par_defaut).map((x) => x.id).join() === amo2, 'une seule valeur par défaut par liste')
L.enregistrerValeur(db, 'amo', { id: amo1, libelle: 'Soliha', donnees: { siret: '12345678900012' }, actif: false })
ok(L.valeursListe(db, 'amo').length === 1 && L.valeursListe(db, 'amo', { tous: true }).length === 2, 'une valeur désactivée sort des choix, pas de la base')
ok(/14 chiffres/.test(leve(() => L.enregistrerValeur(db, 'amo', { libelle: 'X', donnees: { siret: '123' } })) || ''), 'SIRET contrôlé')

// ═══════════════════════════════════════════════════════════
titre('Sociétés émettrices')
const base = {
  code: 'bpg', raison_sociale: 'BIO POWER GROUP', siren: '951 788 108', siret: '95178810800029', tva: 'FR71951788108',
  adresse: '1 rue', code_postal: '63390', ville: 'Saint-Georges', capital: '1000', telephone: '0600000000',
  assurance_nom: 'AXA', assurance_police: 'P-1', taux_tva_defaut: '20', devis_prefixe: 'bpg', facture_prefixe: 'BPG-F',
  taux_penalites: '10,85', indemnite_recouvrement: '40', delai_paiement_jours: '30', compte_bancaire_id: compte1,
}
ok(/ne commence pas par le SIREN/.test(leve(() => S.validerSociete(db, { ...base, siret: '12345678900011' })) || ''), 'un SIRET qui ne commence pas par le SIREN est refusé')
ok(/clé de contrôle est fausse/.test(leve(() => S.validerSociete(db, { ...base, tva: 'FR1951788108' })) || ''), 'une clé de TVA fausse est refusée')
ok(/Compte bancaire inconnu/.test(leve(() => S.validerSociete(db, { ...base, compte_bancaire_id: amo2 })) || ''), "un identifiant d'une autre liste n'est pas un compte bancaire")
const { id: bpg } = S.enregistrerSociete(db, null, base, { parDefaut: true })
let e = db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(bpg)
ok(e.code === 'BPG' && e.devis_prefixe === 'BPG' && e.taux_penalites === 10.85 && e.siren === '951788108', 'normalisée : code et préfixes en majuscules, 10,85 lu comme 10.85, espaces du SIREN retirés')
ok(F.controlerFacture(e, []).filter((x) => x.niveau === 'BLOQUANT').length === 0, 'complète : plus rien ne bloque ses factures')
ok(/déjà pris/.test(leve(() => S.enregistrerSociete(db, null, { ...base, siret: null })) || ''), 'deux sociétés ne partagent pas un code')
const { id: autre } = S.enregistrerSociete(db, null, { ...base, code: 'DPC', devis_prefixe: 'DPC', facture_prefixe: 'DPC-F' }, { parDefaut: true })
ok(db.prepare('SELECT COUNT(*) AS n FROM entite_emettrice WHERE par_defaut = 1').get().n === 1
  && db.prepare('SELECT par_defaut FROM entite_emettrice WHERE id = ?').get(autre).par_defaut === 1, 'une seule société par défaut')
S.enregistrerSociete(db, autre, { devis_prefixe: 'DPX' }, { parDefaut: false })
ok(db.prepare('SELECT devis_prefixe FROM entite_emettrice WHERE id = ?').get(autre).devis_prefixe === 'DPX', 'sans émission, le préfixe se change librement')
db.prepare('UPDATE entite_emettrice SET devis_compteur = 3, devis_annee = ? WHERE id = ?').run(new Date().getFullYear(), autre)
ok(/entamée cette année/.test(leve(() => S.enregistrerSociete(db, autre, { devis_prefixe: 'DPC' })) || ''), 'une série entamée cette année garde son préfixe')

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40)])
ok(S.logoEnImage(png).startsWith('data:image/png;base64,'), 'logo PNG accepté, gardé en image intégrée')
ok(/PNG, JPEG ou WebP/.test(leve(() => S.logoEnImage(Buffer.from('<svg onload="alert(1)"></svg>'))) || ''), 'un SVG est refusé (il peut porter du script)')
ok(/PNG, JPEG ou WebP/.test(leve(() => S.logoEnImage(Buffer.from('<html>logo.png</html>'))) || ''), 'un HTML renommé aussi')
ok(/trop lourd/.test(leve(() => S.logoEnImage(Buffer.concat([png, Buffer.alloc(310 * 1024)]))) || ''), 'et un logo de plus de 300 Ko')

// ═══════════════════════════════════════════════════════════
titre("L'IBAN sur les factures")
const fiche = uid(), version = uid(), benef = uid(), site = uid(), dossier = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)').run(fiche, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Séchage')
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)').run(version, fiche, 1, '2024-01-01')
db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale) VALUES (?,?,?)').run(benef, 'SOCIETE', 'EARL')
db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)').run(site, '1 route', '01000', 'Bourg')
db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id, entite_id, date_achevement)
            VALUES (?,?,?,?,?,?,?,?)`).run(dossier, 'D1', benef, site, fiche, version, bpg, '2026-09-20')
db.prepare(`INSERT INTO operation (id, dossier_id, ordre, fiche_id, fiche_version_id, quantite, puv, taux_tva, date_calcul)
            VALUES (?,?,1,?,?,1,1200,20,'2026-09-01')`).run(uid(), dossier, fiche, version)
ok(F.apercuFacture(db, dossier).facture.reglement_iban === 'FR76 3000 6000 0112 3456 7890 189', "l'aperçu montre l'IBAN du compte de la société")
const fac = F.emettreFacture(db, dossier)
ok(fac.ok && F.lireFacture(db, fac.id).reglement_iban === 'FR76 3000 6000 0112 3456 7890 189', 'la facture émise le porte')
ok(factureHtml(F.lireFacture(db, fac.id)).includes('IBAN <b>FR76 3000 6000 0112 3456 7890 189</b>'), 'et l\'imprime dans le bloc de règlement')
const compte2 = L.enregistrerValeur(db, 'compte_bancaire', { libelle: 'Commerzbank', donnees: { iban: 'DE89370400440532013000', bic: 'COBADEFFXXX' } })
S.enregistrerSociete(db, bpg, { compte_bancaire_id: compte2 }, { parDefaut: false })
ok(F.lireFacture(db, fac.id).reglement_iban === 'FR76 3000 6000 0112 3456 7890 189', 'changer de banque ne réécrit pas une facture déjà émise')
const av = F.emettreAvoir(db, fac.id)
ok(av.ok && !F.lireFacture(db, av.id).reglement_iban, "l'avoir n'appelle aucun paiement : pas d'IBAN")
ok(L.coordonneesBancaires(db, bpg).reglement_iban === 'DE89 3704 0044 0532 0130 00', 'les nouvelles factures prendront le nouveau compte')

const deleg = uid()
db.prepare('INSERT INTO delegataire (id, nom) VALUES (?,?)').run(deleg, 'DRAPO')
db.prepare("UPDATE dossier SET delegataire_id = ?, volume_cumac = 1000, prime_delegataire = 7, date_calcul = '2026-09-01' WHERE id = ?").run(deleg, dossier)
const ap = A.creerAppel(db, { delegataireId: deleg, entiteId: bpg })
A.ajouterDossiers(db, ap, [dossier]); A.validerAppel(db, ap)
ok(A.emettreFactureAppel(db, ap).ok && A.lireAppel(db, ap).reglement_iban === 'DE89 3704 0044 0532 0130 00', "l'appel à paiement fige aussi l'IBAN à l'émission")

db.close()
fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
