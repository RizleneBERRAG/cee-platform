/**
 * Recette : chaque écran de la plateforme, ouvert pour de vrai.
 *
 * Une suite de contrôle vérifie une règle ; elle ne vérifie pas qu'une page s'affiche.
 * L'erreur « NOT NULL constraint failed: site.adresse » l'a montré : toutes les suites
 * passaient au vert pendant que la fiche d'un dossier tombait en erreur dès qu'on
 * enregistrait. Ce fichier ouvre donc les pages une par une, dans un vrai navigateur, sur
 * une vraie base, et relève trois choses à chaque fois :
 *
 *   - le code HTTP renvoyé,
 *   - la présence d'une exception serveur dans la page,
 *   - les erreurs de console du navigateur.
 *
 * Il ne modifie rien : c'est la lecture seule de toute l'application.
 */
import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.RECETTE_URL || 'http://localhost:3100'
const { dossier: D, lot: L } = JSON.parse(fs.readFileSync(process.env.RECETTE_IDS || '/tmp/ids.json', 'utf8'))

const ECRANS = [
  ['Tableau de bord', '/'],
  ['Liste des dossiers', '/dossiers'],
  ['Recherche filtrée', '/dossiers?statut=&fiche='],
  ['Nouveau dossier', '/dossiers/nouveau'],
  ['Import de dossiers', '/dossiers/import'],
  ['Fiche dossier', `/dossiers/${D}`],
  ['Liste des lots', '/lots'],
  ['Fiche lot', `/lots/${L}`],
  ['Paramétrage', '/parametrage'],
  ['— catalogue produits', '/parametrage/catalogue'],
  ['— contrôle COFRAC', '/parametrage/controle'],
  ['— deals', '/parametrage/deals'],
  ['— délégataires', '/parametrage/delegataires'],
  ['— pièces et liasses', '/parametrage/pieces'],
  ['— installateurs RGE', '/parametrage/rge'],
  ['— workflow', '/parametrage/workflow'],
  ['Référentiel des fiches', '/referentiel'],
  ['Import de référentiel', '/referentiel/import'],
  ['Simulateur de marge', '/simulateur'],
  ['Comptes et rôles', '/utilisateurs'],
  ['Mon compte', '/compte'],
  ['Page de refus', '/refus'],
  ['Connexion', '/connexion'],
]

const DOCUMENTS = [
  ['Aperçu du devis', `/dossiers/${D}/devis`],
  ['Aperçu de la facture', `/dossiers/${D}/facture`],
  ['Contrôle du dépôt', `/lots/${L}/depot?controle=1`],
  ['Export récapitulatif du lot', `/lots/${L}/export`],
  ['Export des dossiers', '/dossiers/export'],
]

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const c = await b.newContext({ viewport: { width: 1400, height: 1000 } })
await c.addCookies([{ name: 'cee_session', value: 'recette', domain: 'localhost', path: '/' }])
const p = await c.newPage()

// ── Ce qu'on compte comme une erreur, et ce qu'on ne compte pas ──
//
// Le message de console « Failed to load resource » ne dit PAS quelle ressource : filtrer
// sur son texte revient à filtrer à l'aveugle. On écoute donc les réponses elles-mêmes,
// où l'URL est connue. Le favicon absent n'est pas un défaut de l'application ; une
// feuille de style ou un script en 404, si.
const erreursConsole = []
p.on('pageerror', (e) => erreursConsole.push('exception JS : ' + String(e)))
p.on('console', (m) => {
  if (m.type() !== 'error') return
  if (/Failed to load resource/.test(m.text())) return // traité par l'écouteur de réponses
  erreursConsole.push(m.text())
})
p.on('response', (r) => {
  if (r.status() >= 400 && !/favicon/.test(r.url())) {
    erreursConsole.push(`${r.status()} sur ${r.url()}`)
  }
})

console.log('── Les écrans ──')
for (const [nom, url] of ECRANS) {
  erreursConsole.length = 0
  let statut = 0
  try {
    const r = await p.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 })
    statut = r?.status() ?? 0
  } catch (e) {
    ok(false, `${nom} — la page n'a pas répondu : ${e.message.slice(0, 60)}`)
    continue
  }
  const corps = await p.content()
  const exception = /server-side exception|Application error/.test(corps)
  const vide = corps.replace(/<[^>]*>/g, '').trim().length < 40

  ok(statut < 400 && !exception && !vide && erreursConsole.length === 0,
    `${nom.padEnd(30)} ${statut}${exception ? ' — EXCEPTION SERVEUR' : ''}${vide ? ' — page vide' : ''}`
    + `${erreursConsole.length ? ` — console : ${erreursConsole[0].slice(0, 70)}` : ''}`)
}

console.log('\n── Les documents et exports ──')
for (const [nom, url] of DOCUMENTS) {
  const r = await p.request.get(BASE + url)
  const corps = await r.text()
  ok(r.status() < 400 && corps.length > 100,
    `${nom.padEnd(30)} ${r.status()} — ${corps.length} octets`)
}

console.log('\n── Ce qui doit être refusé ──')
const sans = await b.newContext()
const q = await sans.newPage()
for (const [nom, url, attendu] of [
  ['Fiche dossier sans session', `/dossiers/${D}`, '/connexion'],
  ['Tableau de bord sans session', '/', '/connexion'],
  ['Paramétrage sans session', '/parametrage', '/connexion'],
]) {
  await q.goto(BASE + url, { waitUntil: 'domcontentloaded' })
  ok(q.url().includes(attendu), `${nom.padEnd(30)} → renvoyé vers ${attendu} (obtenu : ${new URL(q.url()).pathname})`)
}
// ── Ne pas suivre les redirections ──
//
// Par défaut le client HTTP suit la redirection vers /connexion et rapporte un 200 :
// la lecture naïve conclut « la route est ouverte » alors qu'elle est fermée. On regarde
// donc le PREMIER code renvoyé, et surtout on vérifie qu'aucune donnée du dossier n'a fui
// dans le corps de la réponse — c'est ça, la vraie question.
for (const [nom, url] of [
  ['Devis sans session', `/dossiers/${D}/devis`],
  ['Facture sans session', `/dossiers/${D}/facture`],
  ['Tableau de dépôt sans session', `/lots/${L}/depot`],
  ['Export du lot sans session', `/lots/${L}/export`],
  ['Export des dossiers sans session', '/dossiers/export'],
]) {
  const r = await q.request.get(BASE + url, { maxRedirects: 0 })
  const corps = await r.text()
  const fuite = /EARL DE LA D\u00c9MONSTRATION|EARL DE LA DÉMONSTRATION|cumac/i.test(corps)
  ok([401, 403, 302, 307].includes(r.status()) && !fuite,
    `${nom.padEnd(34)} → ${r.status()}${fuite ? ' — DONNÉES DU DOSSIER EXPOSÉES' : ', aucune donnée exposée'}`)
}

await b.close()
console.log(`\n${echecs === 0 ? '✔ Tous les écrans répondent.' : `✘ ${echecs} écran(s) en défaut.`}`)
process.exit(echecs ? 1 : 0)
