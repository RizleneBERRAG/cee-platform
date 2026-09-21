/**
 * Archive l'exploitation d'ECO PRO CONCEPT, puis vide la plateforme.
 *
 * Usage :
 *   node archiver.mjs                 → simulation : dit ce qu'il ferait, n'écrit rien
 *   node archiver.mjs --archiver      → produit l'archive, ne vide RIEN
 *   node archiver.mjs --archiver --vider  → produit l'archive, la vérifie, puis vide
 *
 * ── Pourquoi deux drapeaux et pas un ──
 *
 * Vider est irréversible. Le faire exiger un second drapeau, explicite, évite qu'une
 * commande tapée trop vite emporte 1 677 dossiers. Et `--vider` sans `--archiver` est
 * refusé : on ne supprime pas ce dont on n'a pas d'abord fait une copie.
 *
 * ── Ce que « vérifiée » veut dire ici ──
 *
 * L'archive n'est pas déclarée bonne parce que le script n'a pas planté. Elle est **relue
 * depuis le disque**, ligne par ligne, et recomptée table par table ; les sommes des
 * volumes cumac et des primes sont recalculées sur l'archive et comparées à la base. Si un
 * seul compte ne tombe pas juste, **rien n'est vidé**. Une reprise de données a déjà
 * montré dans ce projet qu'un traitement « qui passe sans erreur » ne prouve rien sur les
 * chiffres.
 *
 * ── Ce qui est gardé dans la base vidée ──
 *
 * Le paramétrage : fiches officielles et leurs versions, contrats délégataires, statuts,
 * rôles, types de documents, liasses, bureaux de contrôle, référentiels. C'est du travail
 * déjà fait et vérifié, qui ne dépend pas de l'ancienne activité.
 *
 * Ce qui part : les dossiers et tout ce qui pend à eux — opérations, chantiers, pièces,
 * notes, journal, accès clients, propositions, lots.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const ARCHIVER = process.argv.includes('--archiver')
const VIDER = process.argv.includes('--vider')
const CIBLE = process.env.CEE_DB_PATH || 'db/cee.db'
const RACINE_FICHIERS = process.env.CEE_FICHIERS || 'fichiers'
const DOSSIER_ARCHIVE = process.env.CEE_ARCHIVES || 'archives'

/**
 * Les tables d'EXPLOITATION : celles qui décrivent l'activité, et qui seront vidées.
 * L'ordre est celui de la suppression — les enfants avant les parents, sinon une clé
 * étrangère bloque ou, pire, laisse des orphelins.
 */
const EXPLOITATION = [
  'proposition_champ', 'proposition', 'session_client', 'acces_client',
  'document_dossier', 'piece_lue',
  'note', 'journal_champ',
  'controle', 'audit_energetique', 'dossier_intervenant',
  'operation', 'chantier',
  'dossier', 'lot',
  'beneficiaire', 'site',
]

/** Les tables de PARAMÉTRAGE : conservées telles quelles. Listées pour être comptées. */
const PARAMETRAGE = [
  'fiche', 'fiche_version', 'delegataire', 'deal', 'deal_fiche', 'entite_emettrice',
  'installateur_rge', 'certification_rge', 'produit', 'type_document', 'liasse',
  'liasse_item', 'bureau_controle', 'etape', 'categorie_statut', 'statut',
  'role', 'utilisateur', 'unite_affaire',
]

const db = new DatabaseSync(CIBLE)
const existe = (t) => !!db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?").get(t)
const compte = (t) => (existe(t) ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : null)

console.log('── Archivage de l\'exploitation ──')
console.log(`  base : ${CIBLE}`)
console.log(`  mode : ${VIDER ? 'ARCHIVER PUIS VIDER' : ARCHIVER ? 'ARCHIVER SEULEMENT' : 'simulation'}\n`)

if (VIDER && !ARCHIVER) {
  console.error('  ✘ `--vider` sans `--archiver` est refusé : on ne supprime pas sans copie préalable.')
  process.exit(1)
}

// ── Inventaire ──
const avant = {}
console.log('  À archiver puis vider :')
for (const t of EXPLOITATION) {
  const n = compte(t)
  avant[t] = n
  if (n === null) console.log(`    ${t.padEnd(22)} (table absente)`)
  else if (n > 0) console.log(`    ${t.padEnd(22)} ${String(n).padStart(6)}`)
}
console.log('\n  Conservé (paramétrage) :')
for (const t of PARAMETRAGE) {
  const n = compte(t)
  if (n) console.log(`    ${t.padEnd(22)} ${String(n).padStart(6)}`)
}

// Les totaux qui serviront de preuve.
const totaux = {
  cumac: db.prepare('SELECT ROUND(SUM(volume_cumac), 2) AS v FROM dossier').get().v,
  primes: db.prepare('SELECT ROUND(SUM(prime_beneficiaire), 2) AS v FROM operation').get().v,
  pieces: compte('document_dossier'),
}
console.log(`\n  Totaux témoins : ${totaux.cumac} kWh cumac · ${totaux.primes} € de primes · ${totaux.pieces} pièces`)

if (!ARCHIVER) {
  console.log('\n  Rien n\'a été fait. Relancez avec --archiver.')
  process.exit(0)
}

// ═══════════════════════════════════════════════════════════
// L'archive
// ═══════════════════════════════════════════════════════════

fs.mkdirSync(DOSSIER_ARCHIVE, { recursive: true })
const horodatage = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const nomBase = `eco-pro-concept-${horodatage}`
const cheminJson = path.join(DOSSIER_ARCHIVE, `${nomBase}.json.gz`)
const cheminCopie = path.join(DOSSIER_ARCHIVE, `${nomBase}.db`)

// 1. Une copie intégrale de la base. C'est l'archive la plus sûre : elle se rouvre avec
//    n'importe quel outil SQLite, sans dépendre d'un script.
db.exec(`VACUUM INTO '${cheminCopie.replace(/'/g, "''")}'`)
console.log(`\n  ✔ Copie de la base   : ${cheminCopie} (${(fs.statSync(cheminCopie).size / 1048576).toFixed(1)} Mo)`)

// 2. Un export lisible, table par table. Une copie SQLite se relit ; un JSON se lit aussi
//    par quelqu'un qui n'a pas la plateforme, dans dix ans, avec un simple éditeur.
const contenu = { _archive: { societe: 'ECO PRO CONCEPT', le: new Date().toISOString(), totaux }, tables: {} }
for (const t of EXPLOITATION) {
  if (!existe(t)) continue
  contenu.tables[t] = db.prepare(`SELECT * FROM ${t}`).all()
}
const brut = Buffer.from(JSON.stringify(contenu), 'utf8')
fs.writeFileSync(cheminJson, zlib.gzipSync(brut, { level: 9 }))
console.log(`  ✔ Export lisible     : ${cheminJson} (${(fs.statSync(cheminJson).size / 1048576).toFixed(1)} Mo)`)

// 3. Les pièces jointes. Elles ne sont PAS dans la base : le stockage est adressé par
//    empreinte, et la base ne porte que les empreintes. Les oublier ferait une archive
//    complète en apparence et vide de tout document.
const empreintes = db.prepare('SELECT DISTINCT empreinte, extension FROM document_dossier WHERE empreinte IS NOT NULL').all()
let piecesTrouvees = 0
const piecesManquantes = []
for (const e of empreintes) {
  const p = path.join(RACINE_FICHIERS, e.empreinte.slice(0, 2), e.empreinte.slice(2, 4), `${e.empreinte}.${e.extension || 'bin'}`)
  if (fs.existsSync(p)) piecesTrouvees++
  else piecesManquantes.push(e.empreinte)
}
console.log(`  ✔ Pièces sur disque  : ${piecesTrouvees}/${empreintes.length} présentes` +
  (piecesManquantes.length ? ` — ${piecesManquantes.length} introuvable(s)` : ''))
console.log(`    (le dossier « ${RACINE_FICHIERS} » n'est pas touché : les fichiers restent où ils sont)`)

// ═══════════════════════════════════════════════════════════
// La vérification — c'est elle qui autorise, ou non, la suppression
// ═══════════════════════════════════════════════════════════

console.log('\n── Vérification de l\'archive ──')
let verifOk = true
const verif = (c, m) => { if (!c) verifOk = false; console.log(`  ${c ? '✔' : '✘'} ${m}`) }

// On relit la copie DEPUIS LE DISQUE. Vérifier l'objet qu'on vient de construire en
// mémoire ne prouverait rien sur ce qui a réellement été écrit.
const copie = new DatabaseSync(cheminCopie, { readOnly: true })
for (const t of EXPLOITATION) {
  if (avant[t] === null) continue
  const n = copie.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n
  verif(n === avant[t], `${t} : ${n} ligne(s) dans l'archive, ${avant[t]} dans la base`)
}
const cumacArchive = copie.prepare('SELECT ROUND(SUM(volume_cumac), 2) AS v FROM dossier').get().v
const primesArchive = copie.prepare('SELECT ROUND(SUM(prime_beneficiaire), 2) AS v FROM operation').get().v
verif(cumacArchive === totaux.cumac, `volumes cumac : ${cumacArchive} = ${totaux.cumac}`)
verif(primesArchive === totaux.primes, `primes : ${primesArchive} = ${totaux.primes}`)
copie.close()

// Le JSON relu depuis le disque, décompressé, recompté.
const relu = JSON.parse(zlib.gunzipSync(fs.readFileSync(cheminJson)).toString('utf8'))
for (const t of EXPLOITATION) {
  if (avant[t] === null) continue
  verif((relu.tables[t] || []).length === avant[t],
    `${t} : ${(relu.tables[t] || []).length} ligne(s) dans l'export lisible`)
}
verif(piecesManquantes.length === 0,
  piecesManquantes.length ? `${piecesManquantes.length} pièce(s) absente(s) du stockage` : 'toutes les pièces sont sur le disque')

// L'empreinte de l'archive, pour pouvoir prouver plus tard qu'elle n'a pas bougé.
const sceau = crypto.createHash('sha256').update(fs.readFileSync(cheminCopie)).digest('hex')
fs.writeFileSync(path.join(DOSSIER_ARCHIVE, `${nomBase}.sha256`), `${sceau}  ${path.basename(cheminCopie)}\n`)
console.log(`  ✔ Empreinte SHA-256 : ${sceau.slice(0, 16)}… (fichier .sha256 à côté de l'archive)`)

if (!verifOk) {
  console.error('\n  ✘ L\'archive ne se vérifie pas. RIEN n\'a été vidé.')
  process.exit(1)
}
console.log('\n  ✔ Archive vérifiée : chaque compte et chaque total correspond.')

if (!VIDER) {
  console.log('\n  La base n\'a pas été vidée. Ajoutez --vider pour le faire.')
  process.exit(0)
}

// ═══════════════════════════════════════════════════════════
// La purge
// ═══════════════════════════════════════════════════════════

console.log('\n── Remise à zéro ──')
db.exec('PRAGMA foreign_keys = OFF')
db.exec('BEGIN')
try {
  for (const t of EXPLOITATION) {
    if (!existe(t)) continue
    db.exec(`DELETE FROM ${t}`)
  }
  // Les compteurs de devis repartent de zéro : nouvelle activité, nouvelles sociétés,
  // nouvelle série de numéros. Les anciens numéros vivent dans l'archive.
  db.exec('UPDATE entite_emettrice SET devis_compteur = 0, devis_annee = NULL')
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error(`  ✘ Purge interrompue, rien n'a été supprimé : ${e.message}`)
  process.exit(1)
}

console.log('  Après purge :')
for (const t of EXPLOITATION) {
  const n = compte(t)
  if (n !== null && n !== 0) console.log(`    ⚠ ${t} : ${n} ligne(s) restante(s)`)
}
const restants = EXPLOITATION.filter((t) => compte(t)).length
console.log(restants === 0 ? '    toutes les tables d\'exploitation sont vides.' : '')

console.log('\n  Paramétrage conservé :')
for (const t of PARAMETRAGE) {
  const n = compte(t)
  if (n) console.log(`    ${t.padEnd(22)} ${String(n).padStart(6)}`)
}

db.exec('VACUUM')
console.log(`\n  ✔ Plateforme vide. L'archive est dans « ${DOSSIER_ARCHIVE} » :`)
console.log(`    ${path.basename(cheminCopie)}   — la base complète, rouvrable telle quelle`)
console.log(`    ${path.basename(cheminJson)}    — le même contenu en texte`)
console.log(`    ${nomBase}.sha256               — l'empreinte, pour vérifier qu'elle n'a pas bougé`)
console.log(`\n  Les ${totaux.pieces} pièces jointes restent dans « ${RACINE_FICHIERS} », intactes.`)
