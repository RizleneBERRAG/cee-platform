/**
 * Range les pièces jointes reprises dans les dossiers de la plateforme.
 *
 * Usage :
 *   node reprise-pieces.mjs <dossier-ou-archive> [<autre> ...]
 *
 * Accepte des répertoires et des .zip. Les archives sont décompressées dans un répertoire
 * temporaire, jamais dans le projet.
 *
 * Rejouable : relancer sur les mêmes archives ne crée aucun doublon.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { importerPieces } from './lib/import-pieces.js'
import { poids } from './lib/fichiers.js'
import { extraire } from './lib/zip.js'

const entrees = process.argv.slice(2)
if (entrees.length === 0) {
  console.log('Usage : node reprise-pieces.mjs <dossier-ou-archive.zip> [...]')
  process.exit(2)
}

const CIBLE = process.env.CEE_DB_PATH || path.join(process.cwd(), 'db', 'cee.db')
if (!fs.existsSync(CIBLE)) { console.log(`Base introuvable : ${CIBLE}`); process.exit(2) }

/** Décompresse les archives dans un répertoire temporaire, à l'écart du projet. */
function preparer(chemins) {
  const racines = []
  let temporaire = null
  for (const c of chemins) {
    if (!fs.existsSync(c)) { console.log(`  ignoré (introuvable) : ${c}`); continue }
    if (fs.statSync(c).isDirectory()) {
      // Un répertoire qui contient des archives : on prend les archives, pas le répertoire.
      // C'est le cas du dossier de téléchargements, où les lots se sont accumulés — et ça
      // évite d'avoir à écrire un motif de fichiers à la main, ce que l'invite de commandes
      // de Windows ne sait de toute façon pas développer.
      const archives = fs.readdirSync(c)
        .filter((f) => /^PJ-.*\.zip$/i.test(f))
        .map((f) => path.join(c, f))
      if (archives.length) {
        console.log(`  ${archives.length} archive(s) trouvée(s) dans ${path.basename(c)}`)
        chemins.push(...archives)
        continue
      }
      racines.push(c)
      continue
    }
    if (!/\.zip$/i.test(c)) { console.log(`  ignoré (ni dossier ni .zip) : ${c}`); continue }
    temporaire ||= fs.mkdtempSync(path.join(os.tmpdir(), 'pieces-'))
    const sortie = path.join(temporaire, path.basename(c, '.zip'))
    fs.mkdirSync(sortie, { recursive: true })
    try {
      // Décompression par `lib/zip.js` et non par la commande `unzip` : la plateforme
      // tourne sous Windows, où cette commande n'existe pas.
      const r = extraire(c, sortie)
      racines.push(sortie)
      console.log(`  décompressé : ${path.basename(c)} — ${r.extraits} fichier(s)`)
      for (const ref of r.refuses.slice(0, 5)) {
        console.log(`      REFUSÉ : ${ref.nom} (${ref.motif})`)
      }
      if (r.refuses.length > 5) console.log(`      … et ${r.refuses.length - 5} autre(s) refusé(s)`)
    } catch (e) {
      console.log(`  ÉCHEC de décompression : ${path.basename(c)} — ${e.message.split('\n')[0]}`)
    }
  }
  return { racines, temporaire }
}

console.log('── Préparation ──')
const { racines, temporaire } = preparer(entrees)
if (racines.length === 0) { console.log('Rien à traiter.'); process.exit(2) }

const db = new DatabaseSync(CIBLE)
const avantDocs = db.prepare('SELECT COUNT(*) n FROM document_dossier').get().n

console.log('\n── Rattachement ──')
let total = { fichiers: 0, rattaches: 0, dejaPresents: 0, sansDossier: 0, sansType: 0, refuses: 0, octets: 0 }
const parType = {}
const exemples = []
const refus = {}

for (const r of racines) {
  const rap = importerPieces(db, r, {})
  for (const k of Object.keys(total)) total[k] += rap[k]
  for (const [t, n] of Object.entries(rap.parType)) parType[t] = (parType[t] || 0) + n
  for (const [m, n] of Object.entries(rap.motifsDeRefus)) refus[m] = (refus[m] || 0) + n
  exemples.push(...rap.exemplesSansDossier)
  console.log(`  ${path.basename(r)} : ${rap.rattaches} rattachée(s), ${rap.sansDossier} sans dossier, ` +
              `${rap.dejaPresents} déjà présente(s), ${rap.refuses} refusée(s) — ${rap.ms} ms`)
}

console.log('\n── Résultat ──')
console.log(`  fichiers examinés    : ${total.fichiers}`)
console.log(`  pièces rattachées    : ${total.rattaches}  (${poids(total.octets)})`)
console.log(`  déjà présentes       : ${total.dejaPresents}`)
console.log(`  sans dossier trouvé  : ${total.sansDossier}`)
console.log(`  type non reconnu     : ${total.sansType}  (rangées sous « AUTRE », pas perdues)`)
console.log(`  refusées             : ${total.refuses}`)
for (const [m, n] of Object.entries(refus)) console.log(`      ${n} × ${m}`)

if (Object.keys(parType).length) {
  console.log('\n  par type de document :')
  for (const [t, n] of Object.entries(parType).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(6)}  ${t}`)
  }
}
if (exemples.length) {
  console.log('\n  exemples de fichiers sans dossier identifiable :')
  for (const e of exemples.slice(0, 8)) console.log(`      ${e}`)
  console.log('      (aucun n\'a été rangé au hasard — ils attendent)')
}

// ── Vérification ──
let ko = 0
const ok = (c, m) => { if (!c) ko++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const un = (s) => db.prepare(s).get()

console.log('\n── Vérification ──')
const apresDocs = un('SELECT COUNT(*) n FROM document_dossier').n
ok(apresDocs - avantDocs === total.rattaches,
  `${apresDocs - avantDocs} ligne(s) créée(s) en base, autant que de pièces rattachées`)
ok(un(`SELECT COUNT(*) n FROM document_dossier dd
       LEFT JOIN dossier d ON d.id = dd.dossier_id WHERE d.id IS NULL`).n === 0,
  'aucune pièce rattachée à un dossier inexistant')
ok(un(`SELECT COUNT(*) n FROM document_dossier dd
       LEFT JOIN type_document t ON t.id = dd.type_document_id WHERE t.id IS NULL`).n === 0,
  'aucune pièce sans type de document')
ok(un(`SELECT COUNT(*) n FROM (
        SELECT dossier_id, empreinte FROM document_dossier WHERE empreinte IS NOT NULL
        GROUP BY dossier_id, empreinte HAVING COUNT(*) > 1)`).n === 0,
  'aucun doublon (même dossier, même contenu)')
ok(un('SELECT COUNT(*) n FROM document_dossier WHERE empreinte IS NULL OR taille IS NULL').n === 0,
  'toutes les pièces portent une empreinte et une taille')

const avecPieces = un('SELECT COUNT(DISTINCT dossier_id) n FROM document_dossier').n
const totalDossiers = un('SELECT COUNT(*) n FROM dossier').n
console.log(`\n  ${avecPieces}/${totalDossiers} dossiers ont maintenant au moins une pièce.`)

if (temporaire) fs.rmSync(temporaire, { recursive: true, force: true })
console.log(`\n${ko === 0 ? '✔ Tous les contrôles passent.' : `✘ ${ko} contrôle(s) en échec.`}`)
process.exit(ko ? 1 : 0)
