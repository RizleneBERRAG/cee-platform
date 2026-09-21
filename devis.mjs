/**
 * Contrôles du générateur de devis.
 *
 * Un devis est un document contractuel. Ce qui est vérifié ici, dans l'ordre d'importance :
 *
 * 1. **La numérotation ne produit ni doublon ni trou.** Une série de numéros avec un
 *    doublon est exactement ce qu'un contrôle fiscal relève, et elle ne se corrige pas
 *    après coup.
 * 2. **Un devis irrégulier ne sort pas.** Mentions légales manquantes, TVA dont la clé est
 *    fausse, assurance décennale absente : l'émission est refusée, pas décorée d'une case
 *    vide.
 * 3. **Les totaux ne comblent pas les trous.** Une ligne sans prix n'est pas une ligne à
 *    zéro ; un total incomplet le dit.
 * 4. **La prime déduite est traitée pour ce qu'elle est.** C'est le « reste à payer » qui
 *    engage le client — s'y tromper fait réclamer une somme qui n'est pas due.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const { tvaFrValide, controlerEntite, attribuerNumero, totauxDevis, donneesDevis } = await import('./lib/devis.js')
const { devisHtml, piedDePage } = await import('./lib/devis-html.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('Le numéro de TVA se vérifie, il ne se croit pas')

ok(tvaFrValide('FR71951788108', '951788108'), 'le numéro exact d\'ECO PRO CONCEPT est reconnu valide')
// Le cas réel : celui imprimé au bas de leurs devis depuis des mois, amputé d'un chiffre.
ok(!tvaFrValide('FR1951788108', '951788108'),
  'celui imprimé sur leurs devis (FR1951788108) est rejeté — il lui manque un chiffre')
ok(tvaFrValide('FR60824080782', '824080782'), 'celui de SPLIT DISTRIBUTION est valide')
ok(!tvaFrValide('FR00824080782', '824080782'), 'une clé fausse est rejetée même si la forme est bonne')
ok(!tvaFrValide('FR71951788108', '824080782'), 'un numéro valide mais attaché au mauvais SIREN est rejeté')
ok(tvaFrValide('FR71951788108', null), 'sans SIREN, seule la forme est contrôlée — on ne prétend pas mieux')

// ═══════════════════════════════════════════════════════════
titre('Un devis irrégulier ne sort pas')

const complete = {
  raison_sociale: 'TEST SAS', siret: '95178810800029', siren: '951788108',
  tva: 'FR71951788108', adresse: '3 rue de Genève', code_postal: '69006', ville: 'Lyon',
  capital: 1000, telephone: '0600000000', assurance_nom: 'AXA', assurance_police: 'P-123',
  taux_tva_defaut: 20,
}
ok(controlerEntite(complete, [{ libelle: 'Qualibat' }]).length === 0,
  'une société complète ne déclenche rien')

ok(controlerEntite(null).some((a) => a.niveau === 'BLOQUANT'),
  'aucune société choisie : bloquant')
ok(controlerEntite({ ...complete, tva: null }).some((a) => a.niveau === 'BLOQUANT' && a.champ === 'tva'),
  'sans numéro de TVA : bloquant')
ok(controlerEntite({ ...complete, tva: 'FR1951788108' }).some((a) => a.niveau === 'BLOQUANT' && a.champ === 'tva'),
  'avec un numéro de TVA dont la clé est fausse : bloquant')
ok(controlerEntite({ ...complete, assurance_police: null }).some((a) => a.niveau === 'BLOQUANT' && a.champ === 'assurance'),
  'sans assurance décennale : bloquant — son affichage est une obligation légale')
ok(controlerEntite({ ...complete, taux_tva_defaut: null }).some((a) => a.niveau === 'BLOQUANT'),
  'sans taux de TVA : bloquant, le taux n\'est pas deviné')

// Ce qui gêne sans rendre le document faux reste un avertissement.
const sansCapital = controlerEntite({ ...complete, capital: null }, [{ libelle: 'Qualibat' }])
ok(sansCapital.length === 1 && sansCapital[0].niveau === 'AVERTISSEMENT' && sansCapital[0].champ === 'capital',
  'un capital absent gêne sans bloquer — le document reste régulier')
ok(controlerEntite(complete, []).some((a) => a.niveau === 'AVERTISSEMENT' && a.champ === 'rge'),
  'l\'absence de qualification RGE est signalée sans bloquer')

// ═══════════════════════════════════════════════════════════
titre('Les totaux ne comblent pas les trous')

const t1 = totauxDevis(
  [{ quantite: 50, puv: 22.32 }, { quantite: 200, puv: 22.32 }],
  { prime: 5580, deduirePrime: true, tauxDefaut: 20 })
// Les chiffres du devis réel EPC-2024-1256 : 1 116,00 + 4 464,00 = 5 580,00 TTC,
// 4 650,00 HT, 930,00 de TVA, prime 5 580,00, reste 0,00.
ok(t1.ttc === 5580, `total TTC de 5 580,00 € (obtenu : ${t1.ttc})`)
ok(t1.ht === 4650, `total HT de 4 650,00 € (obtenu : ${t1.ht})`)
ok(t1.tvas.length === 1 && t1.tvas[0].montant === 930, `TVA de 930,00 € (obtenu : ${t1.tvas[0]?.montant})`)
ok(t1.reste === 0, `reste à payer nul, prime déduite (obtenu : ${t1.reste})`)
ok(t1.complet === true, 'et le total se déclare complet')

// Prime NON déduite : le client paie tout, la prime lui est versée à part.
const t2 = totauxDevis([{ quantite: 1, puv: 1200 }], { prime: 800, deduirePrime: false, tauxDefaut: 20 })
ok(t2.reste === 1200, `prime non déduite : le reste à payer reste le TTC entier (obtenu : ${t2.reste})`)
ok(t2.primeDeduite === null && t2.prime === 800, 'la prime est connue mais non déduite — les deux se distinguent')

// Une ligne sans prix n'est pas une ligne à zéro.
const t3 = totauxDevis([{ quantite: 1, puv: 1200 }, { quantite: 3, puv: null }], { tauxDefaut: 20 })
ok(t3.complet === false && t3.lignesSansPrix === 1,
  'une ligne sans prix rend le total incomplet, et le total le dit')
ok(t3.ttc === 1200, 'elle n\'est pas comptée pour zéro : le total ne porte que sur les lignes chiffrées')

// La prime qui dépasse le coût des travaux : le cas réel du dossier EPC-2026-1788.
const tExc = totauxDevis([{ quantite: 1, puv: 3776.41 }],
  { prime: 3984.12, deduirePrime: true, tauxDefaut: 20 })
ok(tExc.reste === 0, `une prime supérieure aux travaux ne donne pas un reste négatif (obtenu : ${tExc.reste})`)
ok(tExc.primeDeduite === 3776.41, 'la déduction est plafonnée au montant des travaux')
ok(tExc.primeExcedentaire === 207.71,
  `et l'excédent est exposé plutôt qu'escamoté (obtenu : ${tExc.primeExcedentaire})`)
ok(tExc.prime === 3984.12, 'la prime calculée reste lisible telle quelle')

// Le cas normal ne doit pas hériter de ce traitement.
ok(t1.primeExcedentaire === null, "une prime égale au TTC ne produit aucun excédent")

// Sans prime connue, on n'écrit pas « 0 € de prime ».
const t4 = totauxDevis([{ quantite: 1, puv: 1200 }], { prime: null, tauxDefaut: 20 })
ok(t4.prime === null && t4.reste === 1200, 'prime inconnue : elle reste vide, elle ne devient pas zéro')

// Plusieurs taux sur un même devis.
const t5 = totauxDevis(
  [{ quantite: 1, puv: 1200, taux_tva: 20 }, { quantite: 1, puv: 1055, taux_tva: 5.5 }],
  { tauxDefaut: 20 })
ok(t5.tvas.length === 2, 'deux taux de TVA cohabitent sur un même devis')
ok(t5.tvas[0].taux === 5.5 && t5.tvas[1].taux === 20, 'et ils sont présentés dans l\'ordre croissant')
ok(t5.ttc === 2255, `le TTC reste la somme des lignes (obtenu : ${t5.ttc})`)

// ═══════════════════════════════════════════════════════════
titre('La numérotation : ni doublon, ni trou, ni série partagée')

const CIBLE = path.join(os.tmpdir(), 'devis-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

const uid = () => crypto.randomUUID()
function poserEntite(code, prefixe) {
  const id = uid()
  db.prepare(`INSERT INTO entite_emettrice (id, code, raison_sociale, siret, siren, tva, adresse,
              code_postal, ville, devis_prefixe, capital, assurance_nom, assurance_police, taux_tva_defaut)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, code, `${code} SAS`, '95178810800029', '951788108', 'FR71951788108',
      '3 rue de Genève', '69006', 'Lyon', prefixe, 1000, 'AXA', 'P-1', 20)
  return id
}
const epc = poserEntite('EPC', 'EPC')
const spl = poserEntite('SPLIT', 'SPL')

const n1 = attribuerNumero(db, epc, new Date('2026-03-04'))
const n2 = attribuerNumero(db, epc, new Date('2026-07-19'))
const n3 = attribuerNumero(db, epc, new Date('2026-09-17'))
ok(n1 === 'EPC-2026-0001', `le premier numéro est EPC-2026-0001 (obtenu : ${n1})`)
ok(n2 === 'EPC-2026-0002' && n3 === 'EPC-2026-0003', 'la suite est continue, sans trou')
ok(new Set([n1, n2, n3]).size === 3, 'et sans doublon')

const s1 = attribuerNumero(db, spl, new Date('2026-09-17'))
ok(s1 === 'SPL-2026-0001',
  `chaque société a SA série : SPLIT repart à 1 sans être décalée par celle d'EPC (obtenu : ${s1})`)

const apres = attribuerNumero(db, epc, new Date('2027-01-02'))
ok(apres === 'EPC-2027-0001', `au changement d'année, le compteur repart à 1 (obtenu : ${apres})`)
const encore = attribuerNumero(db, epc, new Date('2027-02-02'))
ok(encore === 'EPC-2027-0002', 'et poursuit normalement ensuite')

// Le compteur est PERSISTÉ : une relecture depuis la base doit retrouver le même état.
const relu = db.prepare('SELECT devis_compteur, devis_annee FROM entite_emettrice WHERE id = ?').get(epc)
ok(Number(relu.devis_compteur) === 2 && Number(relu.devis_annee) === 2027,
  'le compteur est enregistré, pas tenu en mémoire — un redémarrage ne rejoue pas la série')

let leve = false
try { attribuerNumero(db, 'inexistant') } catch { leve = true }
ok(leve, 'numéroter sur une société inconnue échoue franchement plutôt que d\'inventer un préfixe')

// ═══════════════════════════════════════════════════════════
titre('Le document')

const entiteComplete = db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(epc)
const doc = devisHtml({
  dossier: { numero: 'EPC-2024-1256', client_raison_sociale: 'EARL DE CHEVASNE',
    site_adresse: '66 Chevasné', site_cp: '44440', site_ville: 'RIAILLE',
    delegataire_nom: 'LSF ENERGIE', delegataire_oblige: 'SCA PETROLE et DERIVES',
    devis_deduire_prime: 1 },
  entite: entiteComplete,
  certifications: [{ libelle: 'Qualibat', numero: 'E-12345', date_fin: '2027-06-30' }],
  operations: [{ fiche_code: 'RES-EC-104', fiche_libelle: "Rénovation d'éclairage extérieur",
    quantite: 50, puv: 22.32, volume_cumac: 2325000, prime_beneficiaire: 5580,
    marque: 'NESLIGHT', date_calcul: '2026-01-01' }],
  totaux: t1,
  anomalies: [],
}, 'EPC-2026-0001')

ok(doc.includes('EPC-2026-0001'), 'le numéro figure sur le document')
ok(doc.includes('EARL DE CHEVASNE'), 'le client aussi')
ok(doc.includes('RES-EC-104'), 'la fiche d\'opération est citée — le contrôle la vérifiera')
ok(doc.includes('LSF ENERGIE'), 'le délégataire est nommé dans les termes CEE')
ok(doc.includes('FR71951788108'), 'le pied de page porte le bon numéro de TVA')
ok(!doc.includes('PROVISOIRE'), 'un devis numéroté ne porte pas le filigrane provisoire')

const brouillon = devisHtml({
  dossier: { numero: 'EPC-2024-1256', devis_deduire_prime: 1 },
  entite: entiteComplete, operations: [], totaux: totauxDevis([], {}), anomalies: [],
}, null)
ok(brouillon.includes('PROVISOIRE'),
  'sans numéro, le document se déclare PROVISOIRE en clair — il ne peut pas être pris pour un devis')

// Une injection dans un nom de client ne doit pas devenir du HTML.
const piege = devisHtml({
  dossier: { numero: 'X', client_raison_sociale: '<script>alert(1)</script>', devis_deduire_prime: 1 },
  entite: entiteComplete, operations: [], totaux: totauxDevis([], {}), anomalies: [],
}, 'X-1')
ok(!piege.includes('<script>alert(1)</script>') && piege.includes('&lt;script&gt;'),
  'un nom de client contenant du HTML est échappé, pas exécuté')

// Le pied de page se reconstruit champ par champ — un capital absent ne donne pas « 0 € ».
const pied = piedDePage({ ...entiteComplete, capital: null, forme_juridique: 'SAS' })
ok(!/capital/i.test(pied), 'sans capital renseigné, la mention n\'est pas inventée à zéro')
// `toLocaleString('fr-FR')` sépare les milliers par une espace fine insécable (U+202F) et
// non par une espace ordinaire : comparer au caractère près ferait échouer un test correct.
const piedCapital = piedDePage({ ...entiteComplete, capital: 130000, forme_juridique: 'SAS' })
ok(/130\s*000,00\s*€/u.test(piedCapital.replace(/\u202f|\u00a0/g, ' ')),
  'avec un capital, il est écrit au pied du devis')

// ═══════════════════════════════════════════════════════════
titre('Les deux sociétés du groupe, telles que chargées')

const reel = new DatabaseSync(process.env.CEE_DB_SOURCE || 'db/cee.db')
// Les sociétés ACTIVES : celles qui peuvent émettre aujourd'hui. Une société archivée
// reste en base pour que les devis passés restent rattachables, mais elle n'émet plus —
// compter les lignes de la table confondrait les deux.
const entites = reel.prepare('SELECT * FROM entite_emettrice WHERE actif = 1 ORDER BY code').all()
ok(entites.length >= 1, `au moins une société émettrice active (obtenu : ${entites.length})`)
ok(entites.every((x) => x.raison_sociale && x.devis_prefixe),
  'chacune porte une raison sociale et un préfixe de numérotation')
ok(new Set(entites.map((x) => x.devis_prefixe)).size === entites.length,
  'et deux sociétés ne partagent jamais le même préfixe — sinon leurs séries se mélangeraient')
ok(reel.prepare("SELECT COUNT(*) AS n FROM entite_emettrice WHERE code = 'EPC' AND actif = 1").get().n === 0,
  "ECO PRO CONCEPT est archivée : elle n'émet plus")
ok(entites.every((x) => tvaFrValide(x.tva, x.siren)),
  'les deux numéros de TVA enregistrés sont valides')
ok(entites.filter((x) => x.par_defaut).length === 1,
  'une seule société par défaut — deux rendraient le choix dépendant de l\'ordre de lecture')
ok(entites.every((x) => Number(x.devis_compteur) === 0),
  'aucune n\'a encore émis de devis : les compteurs sont à zéro')

// Et le refus attendu : tant que l'assurance décennale manque, aucune des deux n'émet.
for (const x of entites) {
  const bl = controlerEntite(x, []).filter((a) => a.niveau === 'BLOQUANT')
  ok(bl.some((a) => a.champ === 'assurance'),
    `${x.raison_sociale} : l'émission est bloquée faute d'assurance décennale — attendu`)
}

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
