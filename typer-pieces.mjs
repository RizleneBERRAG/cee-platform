/**
 * Donne un type aux pièces reprises qui sont arrivées sous « AUTRE », en lisant leur contenu.
 *
 * Usage :
 *   node typer-pieces.mjs [nombre-max]
 *
 * Reprenable : chaque pièce traitée est marquée, relancer poursuit là où on s'est arrêté.
 * Interrompre n'abîme rien — au pire, des pièces restent « AUTRE », c'est-à-dire leur état
 * actuel.
 *
 * ── Le contrôle qui compte ──
 *
 * Les documents portent souvent leur numéro de dossier en en-tête. Quand la lecture en
 * trouve un, on le compare au dossier sous lequel la pièce a été rangée. Un désaccord n'est
 * PAS corrigé : il est signalé. Le rattachement vient de l'export (une pièce, un dossier
 * demandé), la lecture vient de l'OCR — quand les deux se contredisent, on ne sait pas
 * lequel a tort, et deviner serait pire que signaler.
 */
import { DatabaseSync } from 'node:sqlite'
import { lireDocument, outilsDisponibles } from './lib/typage-contenu.js'
import { lire } from './lib/fichiers.js'

const CIBLE = process.env.CEE_DB_PATH || 'db/cee.db'
const MAX = Number(process.argv[2] || 0) || Infinity

if (!outilsDisponibles()) {
  console.log("pdftoppm et tesseract sont nécessaires pour lire le contenu des documents.")
  process.exit(2)
}

const db = new DatabaseSync(CIBLE)
const id = () => crypto.randomUUID()
const un = (s, p = []) => db.prepare(s).get(...p)
const run = (s, p = []) => db.prepare(s).run(...p)

// Mémoire du travail déjà fait, pour être reprenable sans retraiter.
db.exec(`CREATE TABLE IF NOT EXISTS piece_lue (
  document_id TEXT PRIMARY KEY,
  lu_le TEXT NOT NULL DEFAULT (datetime('now')),
  type_trouve TEXT,
  numero_lu TEXT,
  -- Sur quoi le type repose : TEXTE, TEXTE_300DPI (il a fallu un rendu fin),
  -- IMAGE_SANS_TEXTE ou FORMAT_NON_DOCUMENT (aucun texte, mais la forme du fichier parle).
  -- Qui relit un classement doit pouvoir distinguer une lecture d'un constat de forme.
  indice TEXT
)`)
// La colonne est arrivée après coup : sur une base déjà typée, on l'ajoute plutôt que de
// tout retraiter.
try { db.exec('ALTER TABLE piece_lue ADD COLUMN indice TEXT') } catch { /* déjà présente */ }

const LIBELLES = {
  AH: "Attestation sur l'honneur", AFT: 'Attestation de fin de travaux', DEVIS: 'Devis signé',
  FACTURE: 'Facture', CADRE_CONTRIB: 'Cadre de contribution', COFRAC: 'Rapport de contrôle COFRAC',
  DOSSIER_CEE: 'Dossier CEE', FICHE_TECH: 'Fiche technique produit', RGE: 'Certificat RGE',
  KBIS: 'Kbis / justificatif société', CNI: "Pièce d'identité", PHOTOS: 'Photos de chantier',
  AVIS_IMPOSITION: "Avis d'imposition", CERTIF_SIGNATURE: 'Certificat de signature électronique',
  CADASTRE: 'Extrait cadastral / plan de situation', MANDAT: 'Mandat de représentation',
}
const typeIds = new Map(db.prepare('SELECT id, code FROM type_document').all().map((t) => [t.code, t.id]))
const typeId = (code) => {
  if (typeIds.has(code)) return typeIds.get(code)
  const tid = id()
  run('INSERT INTO type_document (id, code, libelle) VALUES (?,?,?)', [tid, code, LIBELLES[code] || code])
  typeIds.set(code, tid)
  return tid
}

const aTraiter = db.prepare(`
  SELECT dd.id, dd.empreinte, dd.extension, dd.nom_fichier, d.numero
  FROM document_dossier dd
  JOIN dossier d ON d.id = dd.dossier_id
  JOIN type_document t ON t.id = dd.type_document_id
  WHERE t.code = 'AUTRE'
    AND dd.id NOT IN (SELECT document_id FROM piece_lue)
  ORDER BY dd.created_at`).all()

const lot = aTraiter.slice(0, MAX === Infinity ? aTraiter.length : MAX)
console.log(`── Lecture du contenu ──`)
console.log(`  ${aTraiter.length} pièce(s) sans type ; on en traite ${lot.length}.\n`)

const t0 = Date.now()
const compte = { lues: 0, typees: 0, sansType: 0, illisibles: 0 }
const parType = {}
const parIndice = {}
const desaccords = []

for (const p of lot) {
  // `lire` renvoie une ENVELOPPE : { contenu } si tout va bien, { altere: true } si le
  // fichier sur disque ne correspond plus à son empreinte, null s'il a disparu. Passer
  // l'enveloppe telle quelle à l'OCR donne un fichier illisible et un résultat vide qui
  // ressemble à une page blanche — l'erreur qu'on ne veut plus refaire.
  const f = lire(p.empreinte, p.extension)
  if (!f || f.altere || !f.contenu) { compte.illisibles++; continue }

  const r = lireDocument(f.contenu, p.extension)
  if (!r.ok) { compte.illisibles++; continue }
  compte.lues++

  // Le contrôle croisé : le document dit-il appartenir au dossier où il est rangé ?
  if (r.numero && r.numero.toUpperCase() !== String(p.numero).toUpperCase()) {
    desaccords.push({ piece: p.nom_fichier, range: p.numero, lu: r.numero })
  }

  // Le repli « aucun texte lu ⇒ photo de chantier » vivait ici, et seulement pour les
  // images. Il est maintenant dans `lireDocument`, où il s'applique aussi aux PDF qui ne
  // sont qu'une photo insérée — c'est-à-dire à l'immense majorité des pièces qui restaient
  // sans type. Le laisser en double ici garantirait qu'un jour les deux divergent.
  const code = r.type

  if (code) {
    run('UPDATE document_dossier SET type_document_id = ? WHERE id = ?', [typeId(code), p.id])
    compte.typees++
    parType[code] = (parType[code] || 0) + 1
    parIndice[r.indice || 'NON_PRECISE'] = (parIndice[r.indice || 'NON_PRECISE'] || 0) + 1
  } else {
    compte.sansType++
  }
  run('INSERT OR REPLACE INTO piece_lue (document_id, type_trouve, numero_lu, indice) VALUES (?,?,?,?)',
    [p.id, code ?? null, r.numero ?? null, r.indice ?? null])

  if (compte.lues % 25 === 0) {
    process.stdout.write(`  ${compte.lues}/${lot.length} lues, ${compte.typees} typées…\n`)
  }
}

console.log(`\n── Résultat (${Math.round((Date.now() - t0) / 1000)} s) ──`)
console.log(`  pièces lues        : ${compte.lues}`)
console.log(`  type reconnu       : ${compte.typees}`)
console.log(`  resté « AUTRE »    : ${compte.sansType}  (rien de franc à l'OCR — inchangé, pas perdu)`)
console.log(`  fichier illisible  : ${compte.illisibles}`)
if (Object.keys(parType).length) {
  console.log('\n  par type :')
  for (const [t, n] of Object.entries(parType).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(6)}  ${t}`)
  }
}

// ── Sur quoi reposent ces classements ──
//
// Un type lu sur le document et un type déduit de la forme du fichier ne se valent pas. Le
// second est solide — un PDF au format d'un téléphone est une photo — mais il se vérifie en
// ouvrant la pièce, pas en relisant du texte. Le distinguer ici évite qu'on prenne les deux
// pour la même chose en relisant ce rapport dans six mois.
const LIBELLE_INDICE = {
  TEXTE: "lu sur le document",
  TEXTE_300DPI: "lu après un rendu fin (petits caractères)",
  IMAGE_SANS_TEXTE: "image sans aucun texte : photo",
  FORMAT_NON_DOCUMENT: "PDF au format d'une photo, sans texte",
  NON_PRECISE: 'origine non précisée',
}
if (Object.keys(parIndice).length) {
  console.log("\n  d'où vient le type :")
  for (const [i, n] of Object.entries(parIndice).sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(6)}  ${LIBELLE_INDICE[i] || i}`)
  }
}

// ── Le contrôle croisé, et le tri entre fausse alerte et vraie question ──
//
// L'OCR confond le 3 et le 8, avale un chiffre, tronque une fin de ligne : sur les premiers
// lots, 28 pièces « contredisaient » leur dossier, et 25 d'entre elles lisaient un numéro
// qui N'EXISTE PAS (« EPC-2024-82583 » pour « EPC-2024-32583 »). Un contrôle qui signale
// vingt-cinq faux pour trois vrais n'est pas lu longtemps.
//
// On sépare donc les deux : un numéro lu absent de la base est une erreur de lecture, et on
// le dit tel quel ; un numéro lu qui, lui, désigne un dossier réel est la seule situation
// où il faut regarder le document. Rien n'est déplacé dans aucun des deux cas.
console.log('\n── Contrôle croisé numéro lu / dossier de rangement ──')
const avecNumero = un(`SELECT COUNT(*) AS n FROM piece_lue WHERE numero_lu IS NOT NULL`).n
const existants = new Set(db.prepare('SELECT numero FROM dossier').all()
  .map((r) => String(r.numero).toUpperCase()))
const serieux = desaccords.filter((d) => existants.has(String(d.lu).toUpperCase()))
const lecturesRatees = desaccords.length - serieux.length

console.log(`  ${avecNumero} pièce(s) portent un numéro lisible.`)
console.log(`  ${avecNumero - desaccords.length} confirment le dossier où elles sont rangées.`)
if (lecturesRatees > 0) {
  console.log(`  ${lecturesRatees} lisent un numéro qui n'existe pas — erreur d'OCR, sans conséquence.`)
}
if (serieux.length === 0) {
  console.log('  OK   aucune pièce ne désigne un AUTRE dossier réel.')
} else {
  console.log(`\n  ATTENTION : ${serieux.length} pièce(s) désignent un autre dossier RÉEL.`)
  console.log("  Rien n'a été déplacé — à vérifier à l'œil, le document tranchera :")
  for (const d of serieux) {
    console.log(`      rangée dans ${d.range}, le document dit ${d.lu}  (${d.piece})`)
  }
}

const restant = un(`SELECT COUNT(*) AS n FROM document_dossier dd
                    JOIN type_document t ON t.id = dd.type_document_id
                    WHERE t.code = 'AUTRE' AND dd.id NOT IN (SELECT document_id FROM piece_lue)`).n
console.log(`\n  ${restant} pièce(s) restent à lire — relancez la commande pour continuer.`)
