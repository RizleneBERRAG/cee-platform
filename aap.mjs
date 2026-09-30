/**
 * Contrôles des appels à paiement et des statuts en masse.
 *
 * 1. **Un appel ne prend que ce qui peut l'être** — du bon délégataire, valorisé, dans aucun
 *    autre appel — et dit pourquoi il refuse le reste.
 * 2. **L'écart entre déposé et validé est visible**, au kWh et à l'euro.
 * 3. **Validé, l'appel ne bouge plus.** Facturé, son numéro vient de la série des factures de
 *    la société, sans trou : un refus ou un numéro saisi n'en consomme aucun.
 * 4. **L'écart entre facturé et reçu est rendu**, au centime.
 * 5. **Les statuts en masse** laissent une ligne de journal par dossier, refusent un statut du
 *    mauvais axe et passent sur un dossier verrouillé.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const A = await import('./lib/aap.js')
const { statuerDossiers } = await import('./lib/statuts-masse.js')
const { attribuerNumeroFacture } = await import('./lib/facture.js')
const { appelHtml } = await import('./lib/aap-html.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const leve = (f) => { try { f(); return null } catch (e) { return e.message } }

const CIBLE = path.join(os.tmpdir(), `aap-test-${process.pid}.db`)
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())
const uid = () => crypto.randomUUID()

const drapo = uid(), greenflex = uid()
db.prepare('INSERT INTO delegataire (id, nom, oblige) VALUES (?,?,?), (?,?,?)').run(drapo, 'DRAPO', 'TotalEnergies', greenflex, 'GREENFLEX', null)
const entite = uid()
db.prepare(`INSERT INTO entite_emettrice (id, code, raison_sociale, siret, siren, tva, adresse, code_postal, ville, capital,
            assurance_nom, assurance_police, taux_tva_defaut, facture_prefixe, taux_penalites, indemnite_recouvrement,
            delai_paiement_jours, par_defaut, actif) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1)`)
  .run(entite, 'BPG', 'BIO POWER GROUP', '95178810800029', '951788108', 'FR71951788108', '1 rue', '63390', 'Saint-Georges', 1000,
    'AXA', 'P-1', 20, 'BPG-F', 10.85, 40, 30)
const fiche = uid(), version = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)').run(fiche, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Séchage solaire')
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)').run(version, fiche, 1, '2024-01-01')
const lot = uid()
db.prepare("INSERT INTO lot (id, numero, organisme, statut) VALUES (?,?,?,'DEPOSE')").run(lot, 'LOT-2026-001', 'DRAPO')

function dossier(numero, { deleg = drapo, cumac = 100000, prime = 700, fige = true, lotId = lot, verrou = 0 } = {}) {
  const b = uid(), s = uid(), d = uid()
  db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale) VALUES (?,?,?)').run(b, 'SOCIETE', `EARL ${numero}`)
  db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)').run(s, '1 route', '63000', 'Clermont')
  db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id, delegataire_id,
              volume_cumac, prime_delegataire, date_calcul, lot_id, verrouille) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d, numero, b, s, fiche, version, deleg, cumac, prime, fige ? '2026-09-01' : null, lotId, verrou)
  return d
}
const d1 = dossier('D1', { cumac: 1000000, prime: 7000, verrou: 1 })
const d2 = dossier('D2', { cumac: 500000, prime: 3500, verrou: 1 })
const dNonFige = dossier('D3', { fige: false })
const dAutre = dossier('D4', { deleg: greenflex })
const dHorsLot = dossier('D5', { lotId: null, cumac: 200000, prime: 1400 })
const compteur = () => db.prepare('SELECT facture_compteur AS n FROM entite_emettrice WHERE id = ?').get(entite).n || 0

// ═══════════════════════════════════════════════════════════
titre('Créer un appel depuis un lot')
ok(A.delegataireDuLot(db, lot) === drapo, "le délégataire d'un lot se retrouve par le nom de l'organisme")
const a1 = A.creerAppel(db, { lotId: lot })
let x = A.lireAppel(db, a1)
ok(x.numero === `AAP-${new Date().getFullYear()}-001`, `numéro interne : ${x.numero}`)
ok(x.lignes.map((l) => l.numero).join() === 'D1,D2', 'seuls les dossiers valorisés du lot et du délégataire sont repris (D1, D2)')
ok(x.entite_id === entite, 'la société par défaut est proposée')
const r = A.ajouterDossiers(db, a1, [dNonFige, dAutre, dHorsLot, d1])
ok(r.ajoutes.join() === 'D5' && r.refuses.length === 3, `refus motivés : ${r.refuses.map((y) => `${y.numero} (${y.motif})`).join(', ')}`)
const a2 = A.creerAppel(db, { delegataireId: drapo })
ok(/déjà dans/.test(A.ajouterDossiers(db, a2, [d1]).refuses[0]?.motif || ''), "un dossier n'appartient qu'à un seul appel")
A.supprimerAppel(db, a2)

// ═══════════════════════════════════════════════════════════
titre('Déposé et validé')
x = A.lireAppel(db, a1)
ok(x.totaux.ht === 11900 && x.totaux.cumac === 1700000, `par défaut, validé = déposé : 1 700 MWh, ${x.totaux.ht} € HT`)
ok(x.totaux.prixMwh === 7, `prix moyen : ${x.totaux.prixMwh} € / MWh`)
const ligneD2 = x.lignes.find((l) => l.numero === 'D2')
A.majLigne(db, ligneD2.id, { cumacValide: 450000, primeHt: 3150 })
x = A.lireAppel(db, a1)
ok(x.totaux.ecartCumac === -50000 && x.totaux.ecartPrime === -350 && x.totaux.lignesEcart === 1,
  `D2 validé à 450 MWh au lieu de 500 : écart de ${x.totaux.ecartCumac / 1000} MWh et ${x.totaux.ecartPrime} €, sur 1 ligne`)
ok(x.totaux.tva === 2310 && x.totaux.ttc === 13860, `TVA 20 % : ${x.totaux.tva} € ; TTC ${x.totaux.ttc} €`)
ok(/positifs/.test(leve(() => A.majLigne(db, ligneD2.id, { cumacValide: -1 })) || ''), 'un volume négatif est refusé')

// ═══════════════════════════════════════════════════════════
titre('Valider, facturer')
ok(/sans dossier/.test(leve(() => A.validerAppel(db, A.creerAppel(db, { delegataireId: greenflex }))) || ''), 'un appel vide ne se valide pas')
A.validerAppel(db, a1)
ok(/n'est plus possible/.test(leve(() => A.majLigne(db, ligneD2.id, { primeHt: 1 })) || ''), 'validé, une ligne ne se modifie plus')
ok(/n'est plus possible/.test(leve(() => A.supprimerAppel(db, a1)) || ''), 'ni ne se supprime')

db.prepare('UPDATE entite_emettrice SET taux_penalites = 0 WHERE id = ?').run(entite)
const avant = compteur()
const refus = A.emettreFactureAppel(db, a1)
ok(!refus.ok && compteur() === avant, `société incomplète : facture refusée, aucun numéro consommé (${refus.motifs[0].slice(0, 60)}…)`)
db.prepare('UPDATE entite_emettrice SET taux_penalites = 10.85 WHERE id = ?').run(entite)

attribuerNumeroFacture(db, entite) // une facture client déjà émise dans la même série
const f = A.emettreFactureAppel(db, a1)
ok(f.ok && /BPG-F-\d{4}-0002$/.test(f.numero), `la facture prend la suite de la série des factures : ${f.numero}`)
x = A.lireAppel(db, a1)
ok(x.statut === 'PAIEMENT_ATTENDU' && x.total_ttc === 13860 && x.total_cumac === 1650000, 'paiement en attente, totaux figés')
const html = appelHtml(x, db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(entite))
ok(html.includes(f.numero) && html.includes('D2') && html.includes('13 860,00') && html.includes('D.441-5'),
  'le document porte le numéro, les dossiers, le total et les mentions légales')

const a3 = A.creerAppel(db, { delegataireId: greenflex })
A.ajouterDossiers(db, a3, [dAutre]); A.validerAppel(db, a3)
const n3 = compteur()
ok(A.emettreFactureAppel(db, a3, { numeroExterne: 'EXT-42' }).ok && compteur() === n3, 'un numéro émis ailleurs ne consomme rien de la série')
const a4 = A.creerAppel(db, { delegataireId: drapo })
db.prepare("INSERT INTO appel_paiement_ligne (id, appel_id, dossier_id, cumac_depose, prime_attendue, cumac_valide, prime_ht) VALUES (?,?,?,1,1,1,1)").run(uid(), a4, dNonFige)
A.validerAppel(db, a4)
ok(/déjà porté/.test(A.emettreFactureAppel(db, a4, { numeroExterne: 'EXT-42' }).motifs?.[0] || ''), 'et un numéro déjà utilisé est refusé')

// ═══════════════════════════════════════════════════════════
titre('Encaisser')
ok(A.enregistrerPaiement(db, a1, { date: '2026-11-15', montant: 13860 }) === 0, 'virement exact : écart nul')
ok(A.enregistrerPaiement(db, a1, { date: '2026-11-15', montant: 13500 }) === -360, 'virement plus faible : écart de −360 €, rendu au centime')
ok(A.lireAppel(db, a1).statut === 'PAYE', 'paiement reçu')
ok(A.comptesParStatut(db).PAYE === 1, 'les compteurs par statut suivent')

// ═══════════════════════════════════════════════════════════
titre('Statuts en masse')
const st = (axe, libelle) => { const id = uid(); db.prepare('INSERT INTO statut (id, libelle, axe) VALUES (?,?,?)').run(id, libelle, axe); return id }
const paye = st('DOSSIER', 'Payé'), facture = st('FACTURATION', 'Facturé'), valide = st('ADMIN', 'Validé délégataire')
const n = statuerDossiers(db, [d1, d2], { statut_dossier_id: paye, statut_facturation_id: facture, statut_admin_id: '' }, { utilisateurId: null })
ok(n === 4, `2 dossiers × 2 axes = ${n} changements (l'axe laissé vide n'est pas touché)`)
ok(db.prepare("SELECT COUNT(*) AS n FROM journal_champ WHERE entite = 'Dossier' AND nouvelle = 'Payé'").get().n === 2, 'une ligne de journal par dossier')
ok(db.prepare('SELECT statut_dossier_id AS s FROM dossier WHERE id = ?').get(d1).s === paye, 'un dossier verrouillé change bien de statut')
ok(statuerDossiers(db, [d1, d2], { statut_dossier_id: paye }) === 0, 'réappliquer le même statut ne réécrit rien')
ok(/Statut invalide/.test(leve(() => statuerDossiers(db, [d1], { statut_dossier_id: valide })) || ''), "un statut d'un autre axe est refusé")

db.close()
fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
