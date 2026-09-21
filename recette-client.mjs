/**
 * Recette : l'espace client, vu depuis le navigateur du client.
 *
 * ── Ce qui se joue ici ──
 *
 * Un client entre dans la plateforme avec des identifiants que le gérant lui a donnés. À
 * partir de cet instant, trois promesses doivent tenir, et elles ne sont pas de même
 * nature :
 *
 * 1. **Il ne voit que SON dossier.** Une session client n'est pas une session du personnel :
 *    elle ne doit ouvrir aucune porte de l'application interne, même en tapant l'adresse.
 * 2. **Il ne voit pas les montants qui ne le regardent pas.** La marge, les commissions, le
 *    taux du délégataire : ce sont les chiffres de l'entreprise, pas les siens.
 * 3. **Ce qu'il saisit ne modifie pas le dossier.** Il propose ; le gérant arbitre. Une
 *    saisie client qui écrirait directement dans le dossier retirerait au gérant le seul
 *    endroit où il peut dire non.
 *
 * Les suites de contrôle vérifient ces règles dans le code. Ce fichier les vérifie à
 * travers la porte d'entrée — cookie, route, rendu — parce que c'est par là qu'on entre.
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

// ── Des identifiants neufs, créés par le vrai mécanisme ──
//
// Le code n'est stocké que haché : il n'existe en clair qu'à l'instant où il est créé.
// On le fabrique donc ici plutôt que de le chercher, ce qui serait impossible.
const { ouvrirAcces } = await import('./lib/acces-client.js')
const dbEcriture = new DatabaseSync(CHEMIN_DB, { timeout: 5000 })
const acces = ouvrirAcces(dbEcriture, D, null)
dbEcriture.close()

// ═══════════════════════════════════════════════════════════
// Le code d'accès doit s'AFFICHER à l'écran du gérant
//
// ── Le défaut que ce contrôle empêche de revenir ──
//
// Le code n'existe en clair qu'à l'instant où il est créé : il n'est conservé que sous
// forme d'empreinte. L'action le renvoyait à l'écran par l'adresse (`?m=…`), mais la page
// n'affichait ce message nulle part. Résultat : le gérant cliquait, voyait un identifiant
// apparaître dans la liste, et le code était perdu pour de bon — l'accès naissait
// inutilisable, sans aucune erreur.
//
// La leçon dépasse ce bouton : une action qui a quelque chose à dire doit le dire À
// L'ÉCRAN. On le vérifie donc ici en cliquant, comme le gérant.
const gerant = await (await (await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
})).newContext()).newPage()
await gerant.context().addCookies([{ name: 'cee_session', value: 'recette', domain: 'localhost', path: '/' }])
titre("Le code d'accès s'affiche au gérant, une fois")

await gerant.goto(`${BASE}/dossiers/${D}`, { waitUntil: 'networkidle' })
const boutonAcces = gerant.locator('button:has-text("Générer un nouvel accès")')
ok(await boutonAcces.count() > 0, 'le gérant dispose du bouton de création d\'accès')
if (await boutonAcces.count()) {
  await Promise.all([gerant.waitForLoadState('networkidle'), boutonAcces.click()])
  await gerant.waitForTimeout(1200)
  const vu = await gerant.innerText('body')
  const identifiantVu = /[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(vu)
  const codeVu = /\b[A-Z0-9]{5}-[A-Z0-9]{5}\b/.test(vu)
  ok(/Accès client créé/i.test(vu), 'la création est annoncée à l\'écran')
  ok(identifiantVu, "l'identifiant est affiché")
  ok(codeVu, "LE CODE est affiché — sans lui l'accès serait inutilisable")
  ok(/plus jamais affiché|une fois/i.test(vu),
    'et il est dit clairement qu\'il ne réapparaîtra pas')
}
await gerant.context().browser().close()

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const client = await b.newContext({ viewport: { width: 1280, height: 1000 } })
const p = await client.newPage()

// ═══════════════════════════════════════════════════════════
titre("L'entrée")

await p.goto(`${BASE}/espace`, { waitUntil: 'networkidle' })
ok(/identifiant/i.test(await p.content()), "la page d'entrée demande un identifiant")

// Un mauvais code ne doit ni entrer, ni dire lequel des deux est faux.
await p.fill('[name="identifiant"]', acces.identifiant)
await p.fill('[name="code"]', 'MAUVAIS-CODE1')
// Cliquer par le libellé, et attendre la navigation : viser « le premier bouton » puis
// lire la page trop tôt m'a fait conclure à tort qu'une connexion valide échouait.
await Promise.all([p.waitForLoadState('networkidle'), p.click('button:has-text("Accéder")')])
await p.waitForTimeout(800)
const refus = await p.content()
ok(!/EARL DE LA DÉMONSTRATION/.test(refus), 'un code faux ne laisse pas entrer')
ok(!/identifiant inconnu|utilisateur inconnu/i.test(refus),
  "et le message ne dit pas lequel des deux est faux — sinon il devient un testeur d'identifiants")

// Les vrais identifiants, eux, ouvrent.
await p.goto(`${BASE}/espace`, { waitUntil: 'networkidle' })
await p.fill('[name="identifiant"]', acces.identifiant)
await p.fill('[name="code"]', acces.code)
await Promise.all([p.waitForLoadState('networkidle'), p.click('button:has-text("Accéder")')])
await p.waitForTimeout(800)
const dedans = await p.content()
ok(/EARL DE LA DÉMONSTRATION|DEMO-2026-0001/.test(dedans), 'les bons identifiants ouvrent le dossier')

// ═══════════════════════════════════════════════════════════
titre('Ce que le client ne doit pas voir')

const interdits = [
  ['la marge nette', /marge\s*nette/i],
  ['la commission installateur', /commission\s*installateur/i],
  ['le taux du délégataire', /taux\s*d[ée]l[ée]gataire|prime\s*d[ée]l[ée]gataire/i],
  ['le nom du deal', /DEAL DE DÉMONSTRATION/],
]
for (const [quoi, motif] of interdits) {
  ok(!motif.test(dedans), `${quoi} n'apparaît pas dans son espace`)
}

// ═══════════════════════════════════════════════════════════
titre("Une session client n'est pas une session du personnel")

for (const [quoi, url] of [
  ['le tableau de bord', '/'],
  ['la liste des dossiers', '/dossiers'],
  ['le paramétrage', '/parametrage'],
  ['les comptes', '/utilisateurs'],
  ['la fiche interne de son propre dossier', `/dossiers/${D}`],
  ['le devis', `/dossiers/${D}/devis`],
  ['la facture', `/dossiers/${D}/facture`],
  ['le tableau de dépôt', `/lots/${L}/depot`],
]) {
  const r = await p.request.get(BASE + url, { maxRedirects: 0 })
  const corps = await r.text()
  const entre = r.status() === 200 && /marge|Paramétrage|Comptes et rôles|Tableau de bord|kWh cumac/i.test(corps)
  ok(!entre, `${quoi.padEnd(42)} → ${r.status()}, l'espace client n'y donne pas accès`)
}

// ═══════════════════════════════════════════════════════════
titre('Ce que le client saisit ne modifie pas le dossier')

const lire = () => { const db = new DatabaseSync(CHEMIN_DB, { readOnly: true, timeout: 5000 })
  const r = JSON.stringify(db.prepare('SELECT * FROM dossier WHERE id = ?').get(D)); db.close(); return r }

await p.goto(`${BASE}/espace/dossier`, { waitUntil: 'networkidle' })
const champs = await p.locator('form input:not([type=hidden]), form select, form textarea').count()
ok(champs > 0, `la page de saisie du client présente ${champs} champ(s)`)

if (champs > 0) {
  const avant = lire()
  // Viser un champ NOMMÉ plutôt que « le premier venu » : le formulaire du client n'accepte
  // qu'une liste blanche de champs, et remplir n'importe quelle case au hasard ne prouve
  // rien sur le mécanisme qu'on veut éprouver.
  const cible = p.locator('[name="beneficiaire.telephone"]')
  ok(await cible.count() > 0, 'le client peut corriger son numéro de téléphone')
  if (await cible.count()) {
    await cible.fill('04 78 00 11 22')
    await Promise.all([p.waitForLoadState('networkidle'), p.click('button:has-text("Transmettre")')])
    await p.waitForTimeout(1200)
  }
  ok(/transmises|Merci/i.test(decodeURIComponent(p.url()) + (await p.content())),
    'la plateforme accuse réception de la correction')
  ok(avant === lire(), "et pourtant le dossier lui-même n'a pas bougé d'un champ")

  const db = new DatabaseSync(CHEMIN_DB, { readOnly: true, timeout: 5000 })
  const props = db.prepare('SELECT COUNT(*) AS n FROM proposition WHERE dossier_id = ?').get(D).n
  const detail = db.prepare('SELECT champ, valeur_avant, valeur_proposee FROM proposition_champ LIMIT 1').get()
  db.close()
  ok(props > 0, `la saisie a produit ${props} proposition(s) en attente d'arbitrage`)
  ok(detail && detail.valeur_avant !== detail.valeur_proposee,
    `la proposition garde l'avant et l'après : ${detail?.champ} « ${detail?.valeur_avant} » → « ${detail?.valeur_proposee} »`)
}

// ═══════════════════════════════════════════════════════════
titre('La révocation ferme la porte')

{
  const db = new DatabaseSync(CHEMIN_DB, { timeout: 5000 })
  db.prepare("UPDATE acces_client SET revoque_le = datetime('now') WHERE id = ?").run(acces.id)
  db.close()
}
const apresRevocation = await p.request.get(`${BASE}/espace/dossier`, { maxRedirects: 0 })
const corpsRevoque = await apresRevocation.text()
ok(!/EARL DE LA DÉMONSTRATION/.test(corpsRevoque),
  `un accès révoqué ne montre plus le dossier (${apresRevocation.status()})`)

await b.close()
console.log(`\n${echecs === 0 ? "✔ L'espace client tient ses trois promesses." : `✘ ${echecs} point(s) en défaut.`}`)
process.exit(echecs ? 1 : 0)
