/**
 * Contrôles des factures d'acompte.
 *
 * 1. **Le montant est une part du net à payer par le client**, ventilée par taux de TVA au
 *    prorata du devis, et la somme des lignes tombe au centime sur le montant demandé.
 * 2. **Un refus ne consomme aucun numéro** : l'acompte vit dans la série des factures.
 * 3. **La facture finale déduit les acomptes, une seule fois**, et le note.
 * 4. **L'avoir sur la facture finale libère ses acomptes** ; un acompte déduit d'une facture
 *    encore valable ne s'annule pas seul.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const {
  preparerAcompte, emettreAcompte, emettreFacture, emettreAvoir, lireFacture,
  acomptesDisponibles, preparerFacture, apercuFacture,
} = await import('./lib/facture.js')
const { factureHtml } = await import('./lib/facture-html.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

const CIBLE = path.join(os.tmpdir(), `acompte-test-${process.pid}.db`)
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

const uid = () => crypto.randomUUID()
const entite = uid()
db.prepare(`INSERT INTO entite_emettrice (id, code, raison_sociale, siret, siren, tva, adresse, code_postal,
            ville, capital, assurance_nom, assurance_police, taux_tva_defaut, facture_prefixe,
            taux_penalites, indemnite_recouvrement, delai_paiement_jours, conditions_reglement)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(entite, 'ACP', 'ACOMPTE SAS', '95178810800029', '951788108', 'FR71951788108', '3 rue de Genève',
    '69006', 'Lyon', 1000, 'AXA', 'P-1', 20, 'ACP-F', 10.85, 40, 30, 'Virement à réception')

const fiche = uid(), version = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)')
  .run(fiche, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Système de séchage solaire')
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)').run(version, fiche, 1, '2024-01-01')

// Deux taux de TVA : 10 000 € TTC à 20 % et 1 100 € TTC à 10 %. Prime de 3 000 € déduite
// sur facture : le client doit 8 100 €.
const benef = uid(), site = uid(), dossier = uid()
db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale, siret) VALUES (?,?,?,?)').run(benef, 'SOCIETE', 'EARL DU SOLEIL', '12345678900011')
db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)').run(site, '1 route du Séchoir', '01000', 'Bourg-en-Bresse')
db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id, entite_id,
            date_achevement, facture_deduire_prime, num_devis) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(dossier, 'ACP-001', benef, site, fiche, version, entite, '2026-09-20', 1, 'ACP-2026-0007')
for (const [i, puv, tva, prime] of [[1, 10000, 20, 2000], [2, 1100, 10, 1000]]) {
  db.prepare(`INSERT INTO operation (id, dossier_id, ordre, fiche_id, fiche_version_id, quantite, unite, puv,
              taux_tva, volume_cumac, prime_beneficiaire, date_calcul) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid(), dossier, i, fiche, version, 1, 'u', puv, tva, 100000, prime, '2026-09-01')
}
const compteur = () => db.prepare('SELECT facture_compteur AS n FROM entite_emettrice WHERE id = ?').get(entite).n || 0

// ═══════════════════════════════════════════════════════════
titre('Le montant et sa ventilation')
const base = preparerFacture(db, dossier)
ok(base.emettable, `le dossier est facturable (${base.anomalies.map((a) => a.message).join(' / ') || 'aucune anomalie'})`)
ok(base.totaux.reste === 8100, `net à payer par le client : 11 100 − 3 000 = ${base.totaux.reste} €`)

const pa = preparerAcompte(db, dossier, { pourcentage: 30 })
ok(pa.emettable && pa.montant === 2430, `30 % du net = ${pa.montant} €`)
ok(pa.lignes.length === 2, 'une ligne par taux de TVA')
const somme = Math.round(pa.lignes.reduce((s, l) => s + l.total_ttc, 0) * 100) / 100
ok(somme === 2430, `la somme des lignes tombe au centime sur le montant (${somme} €)`)
const l20 = pa.lignes.find((l) => l.taux_tva === 20)
ok(Math.abs(l20.total_ttc - 2430 * 10000 / 11100) < 0.02, `part à 20 % au prorata du devis : ${l20.total_ttc} €`)
ok(pa.totauxAcompte.ht + pa.totauxAcompte.tva === 2430 || Math.abs(pa.totauxAcompte.ht + pa.totauxAcompte.tva - 2430) < 0.001,
  `HT ${pa.totauxAcompte.ht} + TVA ${pa.totauxAcompte.tva} = TTC`)
ok(pa.lignes[0].designation.includes('ACP-2026-0007'), 'la désignation cite le devis')

ok(!preparerAcompte(db, dossier, { pourcentage: 0 }).emettable, '0 % : refusé')
ok(!preparerAcompte(db, dossier, { pourcentage: 120 }).emettable, '120 % : refusé')
ok(!preparerAcompte(db, dossier, { montantTtc: 9000 }).emettable, 'un montant supérieur au net : refusé')

// ═══════════════════════════════════════════════════════════
titre('Émission et série de numéros')
const a1 = emettreAcompte(db, dossier, { pourcentage: 30 })
ok(a1.ok && a1.numero === 'ACP-F-2026-0001' || (a1.ok && /ACP-F-\d{4}-0001/.test(a1.numero)), `acompte émis : ${a1.numero}`)
const f1 = lireFacture(db, a1.id)
ok(f1.type === 'ACOMPTE' && f1.total_ttc === 2430 && f1.reste_a_payer === 2430 && f1.lignes.length === 2, 'type ACOMPTE, 2 430 € TTC, deux lignes')

const avant = compteur()
const refus = emettreAcompte(db, dossier, { montantTtc: 6000 })
ok(!refus.ok && compteur() === avant, `2 430 + 6 000 > 8 100 : refusé, et aucun numéro consommé (${refus.motifs?.[0]?.slice(0, 60)}…)`)

const html = factureHtml(f1)
ok(/FACTURE D(&#39;|&#x27;|')ACOMPTE/.test(html) && html.includes('la facture finale le déduira'), 'le document dit « facture d\'acompte »')

const apercu = apercuFacture(db, dossier).facture
ok(apercu.acomptes_ttc === 2430 && apercu.reste_a_payer === 5670, `l'aperçu de la facture finale déduit l'acompte : ${apercu.reste_a_payer} €`)

// ═══════════════════════════════════════════════════════════
titre('La facture finale')
const fin = emettreFacture(db, dossier)
ok(fin.ok, `facture finale émise : ${fin.numero}`)
const ff = lireFacture(db, fin.id)
ok(ff.total_ttc === 11100 && ff.acomptes_ttc === 2430 && ff.reste_a_payer === 5670,
  `11 100 € TTC − 3 000 € de prime − 2 430 € d'acompte = ${ff.reste_a_payer} € à payer`)
ok(ff.acomptes_detail?.includes(a1.numero), `la facture cite l'acompte déduit : « ${ff.acomptes_detail} »`)
ok(factureHtml(ff).includes('Acomptes déjà facturés'), 'le document imprime la ligne des acomptes')
ok(db.prepare('SELECT imputee_sur_id AS i FROM facture WHERE id = ?').get(a1.id).i === fin.id, "l'acompte est rattaché à la facture qui l'a déduit")
ok(acomptesDisponibles(db, dossier).length === 0, "et n'est plus disponible")
ok(!preparerAcompte(db, dossier, { pourcentage: 10 }).emettable, 'un nouvel acompte sur un dossier facturé : refusé')

// ═══════════════════════════════════════════════════════════
titre('Avoirs')
const avAcompte = emettreAvoir(db, a1.id)
ok(!avAcompte.ok && /Annulez d'abord/.test(avAcompte.motifs[0]), "un acompte déduit d'une facture valable ne s'annule pas seul")

const avFin = emettreAvoir(db, fin.id)
ok(avFin.ok, `avoir sur la facture finale : ${avFin.numero}`)
const lav = lireFacture(db, avFin.id)
ok(lav.total_ttc === -11100 && lav.acomptes_ttc === -2430 && lav.reste_a_payer === -5670, "l'avoir contre-passe tout, acompte compris")
ok(acomptesDisponibles(db, dossier).length === 1, "l'avoir libère l'acompte : il a été payé, il reste à imputer")

const fin2 = emettreFacture(db, dossier)
ok(fin2.ok && lireFacture(db, fin2.id).reste_a_payer === 5670, `la nouvelle facture le déduit à nouveau (${fin2.numero})`)

const av2 = emettreAvoir(db, fin2.id)
const avA = emettreAvoir(db, a1.id)
ok(av2.ok && avA.ok, `une fois la facture annulée, l'acompte s'annule à son tour (${avA.numero})`)
ok(acomptesDisponibles(db, dossier).length === 0, 'un acompte annulé ne se déduit plus')
const serie = db.prepare("SELECT numero FROM facture ORDER BY numero").all().map((r) => r.numero.slice(-4))
// acompte, facture, avoir, facture, avoir, avoir sur l'acompte : six pièces, six numéros.
ok(serie.join() === '0001,0002,0003,0004,0005,0006', `série continue, sans trou : ${serie.join(' ')}`)

db.close()
fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
