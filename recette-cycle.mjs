/**
 * Recette : le cycle commercial du bout à l'autre, par l'écran.
 *
 * Les suites de contrôle vérifient les règles de la facture en appelant les fonctions
 * directement. Ce fichier fait la même chose en cliquant, parce que ce n'est pas la même
 * question : entre la règle et le bouton il y a une route, une garde, une permission et un
 * rendu, et c'est là qu'un cycle se casse sans qu'aucune règle ne soit fausse.
 *
 * Le parcours suit celui d'une affaire réelle :
 * devis → facture → avoir → nouvelle facture → tableau de dépôt.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.RECETTE_URL || 'http://localhost:3100'
const CHEMIN_DB = process.env.CEE_DB_PATH || '/tmp/recette.db'
const { dossier: D, lot: L } = JSON.parse(fs.readFileSync(process.env.RECETTE_IDS || '/tmp/ids.json', 'utf8'))
const { DatabaseSync } = await import('node:sqlite')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const base = () => new DatabaseSync(CHEMIN_DB, { readOnly: true, timeout: 5000 })
const un = (sql, p = []) => { const db = base(); const r = db.prepare(sql).get(...p); db.close(); return r }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const c = await b.newContext({ viewport: { width: 1400, height: 1100 } })
await c.addCookies([{ name: 'cee_session', value: 'recette', domain: 'localhost', path: '/' }])
const p = await c.newPage()

const req = (methode, url, options = {}) => p.request[methode](BASE + url, { maxRedirects: 0, ...options })

// ═══════════════════════════════════════════════════════════
titre('Le devis')

const apercu1 = await (await req('get', `/dossiers/${D}/devis`)).text()
ok(/PROVISOIRE/.test(apercu1), "l'aperçu porte le filigrane PROVISOIRE")
ok(/EARL DE LA DÉMONSTRATION/.test(apercu1), 'et nomme le client')
ok(/89\s?024,40|89 024,40/.test(apercu1), 'le total TTC des travaux y figure')
ok(/33\s?611,76|33 611,76/.test(apercu1), 'la prime CEE aussi')

const numAvant = un('SELECT devis_compteur AS n FROM entite_emettrice WHERE code = ?', ['DEMO'])?.n ?? 0
await (await req('get', `/dossiers/${D}/devis`)).text()
await (await req('get', `/dossiers/${D}/devis`)).text()
const numApres = un('SELECT devis_compteur AS n FROM entite_emettrice WHERE code = ?', ['DEMO'])?.n ?? 0
ok(numAvant === numApres, `trois aperçus n'ont consommé aucun numéro (compteur : ${numAvant})`)

// ═══════════════════════════════════════════════════════════
titre('La facture : aperçu, puis émission')

const apFact = await (await req('get', `/dossiers/${D}/facture`)).text()
ok(/NON ÉMISE/.test(apFact), "l'aperçu de la facture porte le filigrane NON ÉMISE")
ok(!/DEMO-F-2026/.test(apFact), "et ne porte aucun numéro de la série")

const compteurAvant = un("SELECT facture_compteur AS n FROM entite_emettrice WHERE code = 'DEMO'").n
const emission = await req('post', `/dossiers/${D}/facture`)
const htmlFacture = await emission.text()
ok(emission.status() === 200, `l'émission répond ${emission.status()}`)
const numero = (htmlFacture.match(/DEMO-F-2026-\d{4}/) || [])[0]
ok(!!numero, `la facture porte un numéro : ${numero || '(aucun)'}`)
ok(!/NON ÉMISE/.test(htmlFacture), "et plus aucun filigrane")
ok(/L\.441-10/.test(htmlFacture) && /D\.441-5/.test(htmlFacture),
  'les deux articles du code de commerce sont imprimés')
ok(un("SELECT facture_compteur AS n FROM entite_emettrice WHERE code = 'DEMO'").n === compteurAvant + 1,
  'le compteur a avancé exactement d\'un')

const f = un('SELECT * FROM facture WHERE numero = ?', [numero])
ok(f && f.total_ttc === 89024.4, `le TTC enregistré vaut 89 024,40 € (obtenu : ${f?.total_ttc})`)
ok(f && f.reste_a_payer === 55412.64, `le net à payer vaut 55 412,64 € (obtenu : ${f?.reste_a_payer})`)
ok(un('SELECT COUNT(*) AS n FROM facture_ligne WHERE facture_id = ?', [f.id]).n === 1,
  'la ligne a été recopiée sur la facture')

// ── Le refus attendu ──
const seconde = await req('post', `/dossiers/${D}/facture`)
const motif = await seconde.text()
ok(seconde.status() >= 400 && /porte déjà/i.test(motif),
  `une deuxième émission est refusée : ${motif.split('\n')[1]?.trim().slice(0, 60) || seconde.status()}`)

// ── La réimpression est à l'identique ──
const reimpression = await (await req('get', `/dossiers/${D}/facture`)).text()
ok(reimpression.includes(numero), 'la réimpression retrouve le même numéro')

// ═══════════════════════════════════════════════════════════
titre("Les lignes sont figées : corriger l'opération ne réécrit pas la facture")

{
  const db = new DatabaseSync(CHEMIN_DB)
  db.prepare('UPDATE operation SET puv = 1 WHERE dossier_id = ?').run(D)
  db.close()
}
const apresCorrection = await (await req('get', `/dossiers/${D}/facture`)).text()
ok(/89\s?024,40|89 024,40/.test(apresCorrection),
  "le prix de l'opération a été mis à 1 € ; la facture affiche toujours 89 024,40 €")
ok(!/(^|[^\d])1,00 €/.test(apresCorrection.replace(/ | /g, ' ')),
  "et ne porte aucune trace du nouveau prix")

// ═══════════════════════════════════════════════════════════
titre("L'avoir")

const avoir = await req('post', `/dossiers/${D}/facture?avoir=${f.id}`)
const htmlAvoir = await avoir.text()
ok(avoir.status() === 200, `l'avoir est émis (${avoir.status()})`)
const numAvoir = (htmlAvoir.match(/DEMO-F-2026-\d{4}/g) || []).find((n) => n !== numero)
ok(!!numAvoir && numAvoir !== numero, `il prend le numéro suivant de la même série : ${numAvoir}`)
ok(/AVOIR/.test(htmlAvoir), "le document s'annonce comme un AVOIR")
ok(/annule la facture/i.test(htmlAvoir) && htmlAvoir.includes(numero),
  "et désigne en clair la facture qu'il annule")

const a = un('SELECT * FROM facture WHERE numero = ?', [numAvoir])
ok(a && a.total_ttc === -89024.4, `les montants de l'avoir sont négatifs (${a?.total_ttc})`)
ok(a && a.annule_facture_id === f.id, "il pointe vers la facture d'origine")
ok(!!un('SELECT id FROM facture WHERE id = ?', [f.id]), "la facture annulée reste en base")

const originaleRelue = await (await req('get', `/dossiers/${D}/facture?facture=${f.id}`)).text()
ok(/annulée par l'avoir/i.test(originaleRelue),
  "réimprimée, la facture annulée le dit — sinon elle circulerait comme si elle valait encore")

// ── Et le dossier redevient facturable ──
const refaite = await req('post', `/dossiers/${D}/facture`)
const htmlRefaite = await refaite.text()
ok(refaite.status() === 200, "une nouvelle facture peut être émise après l'avoir")
const numRefaite = (htmlRefaite.match(/DEMO-F-2026-\d{4}/) || [])[0]
ok(numRefaite && ![numero, numAvoir].includes(numRefaite),
  `elle prend un troisième numéro : ${numRefaite}`)
const fRefaite = un('SELECT total_ttc FROM facture WHERE numero = ?', [numRefaite])
ok(fRefaite && fRefaite.total_ttc === 72,
  `et porte, elle, le prix corrigé : 72 × 1 € = 72,00 € (obtenu : ${fRefaite?.total_ttc})`)

// ── La série ne saute aucun numéro ──
const serie = (() => { const db = base()
  const r = db.prepare("SELECT numero FROM facture ORDER BY cree_le").all().map((x) => x.numero); db.close(); return r })()
const suffixes = serie.map((n) => Number(n.slice(-4)))
ok(suffixes.every((n, i) => i === 0 || n === suffixes[i - 1] + 1),
  `la série est continue : ${serie.join(' → ')}`)

// ═══════════════════════════════════════════════════════════
titre('Le tableau de dépôt')

const controle = await (await req('get', `/lots/${L}/depot?controle=1`)).text()
ok(/Toutes les lignes sont complètes|manque/.test(controle), 'le contrôle rend un verdict lisible')

const fichier = await req('get', `/lots/${L}/depot`)
if (fichier.status() === 200) {
  const csv = await fichier.text()
  const lignes = csv.replace(/^﻿/, '').trim().split('\r\n')
  ok(lignes.length === 2, `le fichier porte l'en-tête et une ligne (obtenu : ${lignes.length})`)
  ok(lignes[0].split(';').length === lignes[1].split(';').length,
    'autant de colonnes dans la ligne que dans les en-têtes')
  ok(csv.startsWith('﻿'), 'le BOM est présent pour Excel en français')
  ok(/="\d+"/.test(csv), 'les identifiants sortent protégés contre le tableur')
  ok(/\d+,\d{2}/.test(csv), 'les montants portent une virgule décimale')
} else {
  const motifs = await fichier.text()
  ok(/manque|incomplet|Export refusé/i.test(motifs),
    `l'export est refusé et dit pourquoi : ${motifs.split('\n')[1]?.trim().slice(0, 70)}`)
}

const forcé = await req('get', `/lots/${L}/depot?incomplet=1`)
ok(forcé.status() === 200, "on peut forcer la sortie d'un tableau incomplet pour travailler dessus")

await b.close()
console.log(`\n${echecs === 0 ? '✔ Le cycle commercial tient du devis au dépôt.' : `✘ ${echecs} point(s) en défaut.`}`)
process.exit(echecs ? 1 : 0)
