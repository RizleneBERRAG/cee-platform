/**
 * Recette : chaque formulaire, soumis pour de vrai, et la base relue derrière.
 *
 * ── L'invariant, et pourquoi c'est LE bon test ──
 *
 * Un formulaire renvoyé SANS RIEN CHANGER ne doit rien changer en base.
 *
 * Cette phrase paraît banale. Elle attrape pourtant, à elle seule, toute la famille de
 * défauts dont faisait partie « NOT NULL constraint failed: site.adresse » : un champ que
 * l'écran affiche mais que la requête ne lit pas arrive vide, repart vide, et écrase la
 * valeur en base. Selon la colonne, ça plante bruyamment (adresse, obligatoire) ou ça
 * efface en silence (âge du bâtiment, type de chauffage) — et le silence est pire.
 *
 * Vérifier champ par champ « ce que l'écran montre » contre « ce que la requête ramène »
 * demanderait de connaître la liste attendue, donc de la maintenir, donc de l'oublier.
 * Comparer la base avant et après un aller-retour à vide ne demande rien : c'est la
 * définition même de « ne rien changer ».
 *
 * ── Ce que ce fichier ne fait pas ──
 *
 * Il ne clique sur aucun bouton destructeur (supprimer, retirer, révoquer, déposer). Ces
 * gestes-là sont éprouvés à part, sur des données faites pour disparaître.
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

// Les tables qui bougent légitimement à chaque requête : elles ne prouvent rien ici.
const IGNORER = new Set(['session', 'session_client', 'journal_champ', 'piece_lue', 'migration_manuelle'])

/**
 * Une photographie de toute la base, table par table, ligne par ligne.
 *
 * Le serveur écrit dans le même fichier au même moment : une lecture peut tomber sur un
 * verrou. Ce n'est pas un défaut de l'application, c'est la conséquence de l'observer
 * pendant qu'elle travaille — on patiente et on recommence, plutôt que de conclure.
 */
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
        out[name] = db.prepare(`SELECT * FROM "${name}"`).all().map((l) => JSON.stringify(l)).sort()
      }
      db.close()
      return out
    } catch (e) {
      derniere = e
      try { db?.close() } catch { /* déjà fermée */ }
      dormir(300)
    }
  }
  throw derniere
}

/** Ce qui a changé entre deux photographies, en clair. */
function differences(avant, apres) {
  const ecarts = []
  for (const table of new Set([...Object.keys(avant), ...Object.keys(apres)])) {
    const a = avant[table] || []
    const b = apres[table] || []
    const disparues = a.filter((l) => !b.includes(l))
    const apparues = b.filter((l) => !a.includes(l))
    if (!disparues.length && !apparues.length) continue
    // Une ligne modifiée apparaît des deux côtés : on montre le champ qui diffère.
    if (disparues.length === apparues.length && disparues.length <= 3) {
      for (let i = 0; i < disparues.length; i++) {
        const av = JSON.parse(disparues[i]); const ap = JSON.parse(apparues[i])
        const champs = Object.keys({ ...av, ...ap })
          .filter((k) => JSON.stringify(av[k]) !== JSON.stringify(ap[k]))
          .map((k) => `${k} : ${JSON.stringify(av[k])} → ${JSON.stringify(ap[k])}`)
        ecarts.push(`${table} — ${champs.join(', ') || `${disparues.length} ligne(s) remplacée(s)`}`)
      }
    } else {
      ecarts.push(`${table} — ${disparues.length} ligne(s) retirée(s), ${apparues.length} ajoutée(s)`)
    }
  }
  return ecarts
}

const DESTRUCTEUR = /supprim|retir|révoqu|revoqu|déposer|deposer|déconnect|deconnect|effacer|vider|archiver/i

// ── Les boutons qui DOIVENT écrire ──
//
// « Émettre la facture » consomme un numéro, « Verrouiller » verrouille : leur reprocher
// de modifier la base serait absurde. L'invariant « ne rien changer » ne s'applique qu'aux
// formulaires d'enregistrement. Pour ceux-là, on vérifie seulement qu'ils ne plantent pas ;
// leur effet est éprouvé ailleurs, là où on sait ce qu'on attend.
const ECRIT_PAR_NATURE = /émettre|emettre|verrouill|déverrouill|deverrouill|calculer|recalculer|générer|generer|ouvrir|affecter|importer|activer|connect|soumettre|accepter|refuser|valider|reporter|par défaut|par defaut|basculer|réinitialiser|reinitialiser/i

const ECRANS = [
  ['Fiche dossier', `/dossiers/${D}`],
  ['Fiche lot', `/lots/${L}`],
  ['Paramétrage — délégataires', '/parametrage/delegataires'],
  ['Paramétrage — deals', '/parametrage/deals'],
  ['Paramétrage — catalogue', '/parametrage/catalogue'],
  ['Paramétrage — RGE', '/parametrage/rge'],
  ['Paramétrage — contrôle', '/parametrage/controle'],
  ['Paramétrage — pièces', '/parametrage/pieces'],
  ['Paramétrage — workflow', '/parametrage/workflow'],
  ['Comptes et rôles', '/utilisateurs'],
  ['Mon compte', '/compte'],
]

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const c = await b.newContext({ viewport: { width: 1400, height: 1100 } })
await c.addCookies([{ name: 'cee_session', value: 'recette', domain: 'localhost', path: '/' }])
const p = await c.newPage()

titre('Un formulaire réenregistré sans modification ne doit rien changer')

for (const [nomEcran, url] of ECRANS) {
  await p.goto(BASE + url, { waitUntil: 'networkidle' })
  const formulaires = await p.locator('form').count()

  for (let i = 0; i < formulaires; i++) {
    await p.goto(BASE + url, { waitUntil: 'networkidle' })
    const f = p.locator('form').nth(i)
    const bouton = f.locator('button:not([disabled])').first()
    if (!(await bouton.count())) continue

    const libelle = ((await bouton.textContent()) || '').trim().replace(/\s+/g, ' ')
    if (!libelle || DESTRUCTEUR.test(libelle)) continue
    const ecritParNature = ECRIT_PAR_NATURE.test(libelle)

    // Un formulaire dont un champ obligatoire est vide ne peut pas être renvoyé tel quel :
    // le navigateur le bloque, à juste titre. Ce n'est pas un défaut, on passe.
    const incomplet = await f.evaluate((el) => !el.checkValidity())
    if (incomplet) { console.log(`  (ignoré) ${nomEcran} › « ${libelle} » — champ obligatoire vide à l'écran`); continue }

    const avant = photo()
    try {
      await bouton.click({ timeout: 8000 })
      await p.waitForLoadState('networkidle', { timeout: 15000 })
    } catch (e) {
      ok(false, `${nomEcran} › « ${libelle} » — la soumission a échoué : ${e.message.slice(0, 50)}`)
      continue
    }
    const exception = /server-side exception|Application error/.test(await p.content())
    const ecarts = differences(avant, photo())

    if (ecritParNature) {
      ok(!exception, `${nomEcran} › « ${libelle} » — écrit par nature, sans erreur`
        + `${ecarts.length ? ` (${ecarts.length} écriture(s))` : ''}`
        + `${exception ? ' — EXCEPTION SERVEUR' : ''}`)
    } else {
      ok(!exception && ecarts.length === 0,
        `${nomEcran} › « ${libelle} »${exception ? ' — EXCEPTION SERVEUR' : ''}`
        + `${ecarts.length ? ` — A MODIFIÉ : ${ecarts.slice(0, 3).join(' | ')}` : ''}`)
    }
  }
}

await b.close()
console.log(`\n${echecs === 0 ? '✔ Aucun formulaire ne modifie la base quand on ne lui demande rien.' : `✘ ${echecs} formulaire(s) en défaut.`}`)
process.exit(echecs ? 1 : 0)
