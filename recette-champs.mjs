/**
 * Recette : modifier UN champ, et vérifier qu'un seul champ change.
 *
 * L'autre moitié du contrôle. Le fichier voisin vérifie qu'un formulaire renvoyé à
 * l'identique ne change rien ; celui-ci vérifie que, quand on change une case, c'est cette
 * case-là qui change — et elle seule.
 *
 * Les deux ensemble couvrent le défaut trouvé sur l'adresse du site, et sa version
 * silencieuse : enregistrer le code postal effaçait l'âge du bâtiment sans rien dire. Le
 * premier contrôle l'attrape si le champ était rempli ; le second l'attrape même quand on
 * ne touche qu'à un champ voisin.
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

const IGNORER = new Set(['session', 'session_client', 'journal_champ', 'piece_lue', 'migration_manuelle'])

function photo(essais = 20) {
  const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  let derniere
  for (let i = 0; i < essais; i++) {
    let db
    try {
      db = new DatabaseSync(CHEMIN_DB, { readOnly: true, timeout: 5000 })
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
      const out = {}
      for (const { name } of tables) {
        if (IGNORER.has(name)) continue
        for (const l of db.prepare(`SELECT * FROM "${name}"`).all()) {
          for (const [col, val] of Object.entries(l)) out[`${name}.${l.id ?? '?'}.${col}`] = JSON.stringify(val)
        }
      }
      db.close()
      return out
    } catch (e) { derniere = e; try { db?.close() } catch { /* fermée */ } dormir(300) }
  }
  throw derniere
}

const changements = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter((k) => a[k] !== b[k])
  .map((k) => `${k.split('.')[0]}.${k.split('.')[2]} : ${a[k] ?? '(absent)'} → ${b[k] ?? '(absent)'}`)

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const c = await b.newContext({ viewport: { width: 1400, height: 1100 } })
await c.addCookies([{ name: 'cee_session', value: 'recette', domain: 'localhost', path: '/' }])
const p = await c.newPage()

/**
 * Change un champ, soumet le formulaire qui le contient, et rapporte tout ce qui a bougé.
 * `attendus` liste les colonnes qu'on accepte de voir changer ; tout le reste est un dégât.
 */
async function essai(nom, url, champ, valeur, attendus) {
  await p.goto(BASE + url, { waitUntil: 'networkidle' })
  const cible = p.locator(`[name="${champ}"]`).first()
  if (!(await cible.count())) { ok(false, `${nom} — champ « ${champ} » introuvable à l'écran`); return }

  // ── Choisir une valeur qui change vraiment quelque chose ──
  //
  // Réécrire la valeur déjà en place ne produit aucune écriture, et le contrôle conclurait
  // « rien n'a été enregistré » alors que tout va bien. On prend donc, pour un menu, une
  // option réellement différente de celle affichée ; pour une case à cocher, l'inverse ;
  // pour un champ libre, la valeur demandée — en la modifiant si elle est déjà là.
  const balise = await cible.evaluate((el) => el.tagName.toLowerCase())
  const type = await cible.evaluate((el) => el.type || '')

  if (balise === 'select') {
    const choix = await cible.evaluate((el) => {
      const autre = [...el.options].find((o) => o.value && o.value !== el.value)
      return autre ? autre.value : null
    })
    if (!choix) { ok(false, `${nom} — le menu n'offre aucune autre option`); return }
    await cible.selectOption(choix)
  } else if (type === 'checkbox') {
    await cible.setChecked(!(await cible.isChecked()))
  } else {
    const actuelle = await cible.inputValue()
    // Une date ne tolère pas qu'on lui accole un suffixe : si la valeur visée est déjà en
    // place, on décale d'un jour plutôt que d'écrire quelque chose que le champ refusera.
    let aEcrire = valeur
    if (actuelle === valeur) {
      if (type === 'date') {
        const j = new Date(valeur); j.setDate(j.getDate() + 1)
        aEcrire = j.toISOString().slice(0, 10)
      } else if (type === 'number') aEcrire = String(Number(valeur) + 1)
      else aEcrire = `${valeur} (bis)`
    }
    await cible.fill(aEcrire)
  }

  const avant = photo()
  const formulaire = cible.locator('xpath=ancestor::form[1]')
  await formulaire.locator('button:not([disabled])').last().click()
  await p.waitForLoadState('networkidle')

  // ── Attendre l'écriture, pas seulement la fin de la requête ──
  //
  // « Le réseau est calme » ne veut pas dire « la base est écrite » : l'action serveur peut
  // répondre avant que la transaction ne soit visible d'une autre connexion. Sans cette
  // attente, le contrôle lisait l'ancien état et concluait « la valeur n'a pas été
  // enregistrée » alors qu'elle l'était une fraction de seconde plus tard — un faux
  // négatif, c'est-à-dire la pire espèce de test.
  const dormir = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  let apres = photo()
  for (let i = 0; i < 20 && changements(avant, apres).length === 0; i++) { dormir(250); apres = photo() }

  const exception = /server-side exception|Application error/.test(await p.content())
  const bouge = changements(avant, apres)
  const inattendus = bouge.filter((l) => !attendus.some((a) => l.startsWith(a)))
  const voulu = bouge.some((l) => l.startsWith(attendus[0]))

  ok(!exception && voulu && inattendus.length === 0,
    `${nom.padEnd(42)}${exception ? ' — EXCEPTION' : ''}`
    + `${voulu ? '' : " — LA VALEUR N'A PAS ÉTÉ ENREGISTRÉE"}`
    + `${inattendus.length ? ` — DÉGÂTS COLLATÉRAUX : ${inattendus.join(' | ')}` : ''}`)
}

titre('Le site du dossier — le formulaire où le défaut avait été trouvé')
await essai('code postal', `/dossiers/${D}`, 'code_postal', '69003', ['site.code_postal', 'site.departement'])
await essai('ville', `/dossiers/${D}`, 'ville', 'Lyon', ['site.ville'])
await essai('adresse', `/dossiers/${D}`, 'adresse', '3 rue de Genève', ['site.adresse'])
await essai('zone climatique', `/dossiers/${D}`, 'zone_climatique', 'H2', ['site.zone_climatique'])
await essai("secteur d'activité", `/dossiers/${D}`, 'secteur_activite', 'INDUSTRIE', ['site.secteur_activite'])
await essai('type de chauffage', `/dossiers/${D}`, 'type_chauffage', 'BOIS', ['site.type_chauffage'])
await essai('âge du bâtiment', `/dossiers/${D}`, 'age_batiment', '12', ['site.age_batiment'])
await essai('surface', `/dossiers/${D}`, 'surface', '450', ['site.surface'])
await essai('quartier prioritaire', `/dossiers/${D}`, 'qpv', '1', ['site.qpv'])

titre('Le dossier lui-même')
await essai('quantité', `/dossiers/${D}`, 'quantite', '80', ['dossier.quantite'])
await essai('charte', `/dossiers/${D}`, 'charte', 'CDP', ['dossier.charte'])
await essai("date d'engagement", `/dossiers/${D}`, 'date_engagement', '2026-03-15', ['dossier.date_engagement'])
await essai('source', `/dossiers/${D}`, 'source', 'Recommandation', ['dossier.source'])

titre('Le volet commercial')
await essai('numéro de devis', `/dossiers/${D}`, 'num_devis', 'DEMO-2026-0009', ['dossier.num_devis'])
await essai('état du devis', `/dossiers/${D}`, 'etat_devis', 'SIGNE', ['dossier.etat_devis'])
await essai('type de lead', `/dossiers/${D}`, 'type_lead', 'ENTRANT', ['dossier.type_lead'])

// Le lot n'a pas de champ à saisir : son écran sert à rattacher et détacher des dossiers.
// Ce geste-là relève du cycle commercial, où il est éprouvé avec son contexte.

await b.close()
console.log(`\n${echecs === 0 ? '✔ Chaque champ modifié s\'enregistre, et lui seul.' : `✘ ${echecs} champ(s) en défaut.`}`)
process.exit(echecs ? 1 : 0)
