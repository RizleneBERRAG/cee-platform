/**
 * Les 214 pièces « sans texte » n'ont-elles vraiment rien à lire ?
 *
 * Conclure « aucun texte » à partir d'UN réglage d'OCR, c'est confondre « ce document ne
 * porte pas de texte » et « nos réglages ne l'ont pas vu ». La différence décide de la
 * suite : dans le premier cas il n'y a rien à faire, dans le second il suffit de mieux
 * régler. On rejoue donc chaque échec de trois façons, de la moins chère à la plus chère :
 *
 *   1. `pdftotext` — le PDF porte-t-il une couche de texte ? Si oui, aucun OCR n'était
 *      nécessaire et c'est notre chaîne qui passait à côté.
 *   2. OCR à 300 points par pouce au lieu de 120 — un titre en petits caractères ou un scan
 *      pâle peut n'apparaître qu'à cette résolution.
 *   3. Les dimensions de la page rendue, pour distinguer une photo (format appareil) d'un
 *      document (format A4).
 *
 * Rien n'est écrit en base. Ce script répond à une question, il ne corrige rien.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const { DatabaseSync } = await import('node:sqlite')
const { lireDocument, typeDuTexte } = await import('./lib/typage-contenu.js')

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d }
const ARCHIVE = arg('--archive', 'archives/eco-pro-concept-2026-09-17-14-13-22.db')
const RACINE = process.env.CEE_FICHIERS || 'fichiers'
const N = Number(arg('--limite', '25'))

const db = new DatabaseSync(ARCHIVE)
const docs = db.prepare(`
  SELECT d.id, d.nom_fichier, d.empreinte, d.extension, d.taille
    FROM document_dossier d JOIN piece_lue p ON p.document_id = d.id
   WHERE p.type_trouve IS NULL OR p.type_trouve = ''
   ORDER BY d.nom_fichier`).all()

const chemin = (d) => path.join(RACINE, d.empreinte.slice(0, 2), d.empreinte.slice(2, 4), `${d.empreinte}.${d.extension}`)
const sansEspaces = (s) => String(s || '').replace(/\s/g, '').length

const bilan = {
  coucheTexte: [], ocr300: [], rienDuTout: [], photo: [], deja: [],
}

let vus = 0
for (const d of docs) {
  if (vus >= N) break
  const p = chemin(d)
  if (!fs.existsSync(p)) continue
  const contenu = fs.readFileSync(p)

  // La chaîne actuelle : si elle trouve quelque chose, ce document n'est pas un « vide ».
  const actuel = lireDocument(contenu, d.extension)
  if (actuel.ok && sansEspaces(actuel.texte) >= 40) { bilan.deja.push(d); continue }

  vus++
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sonde-'))
  try {
    const src = path.join(tmp, `f.${d.extension}`)
    fs.writeFileSync(src, contenu)

    // 1. Couche de texte du PDF.
    let couche = ''
    if (/^pdf$/i.test(d.extension)) {
      try {
        couche = execFileSync('pdftotext', ['-f', '1', '-l', '3', src, '-'],
          { stdio: ['ignore', 'pipe', 'ignore'], timeout: 30000 }).toString()
      } catch { couche = '' }
    }
    if (sansEspaces(couche) >= 40) {
      bilan.coucheTexte.push({ ...d, type: typeDuTexte(couche), extrait: couche.trim().slice(0, 120).replace(/\s+/g, ' ') })
      continue
    }

    // 2. OCR à 300 dpi, et dimensions de la page.
    let image = src
    let dims = null
    if (/^pdf$/i.test(d.extension)) {
      const prefixe = path.join(tmp, 'p')
      try {
        execFileSync('pdftoppm', ['-r', '300', '-f', '1', '-l', '1', '-png', src, prefixe],
          { stdio: 'pipe', timeout: 120000 })
      } catch { bilan.rienDuTout.push({ ...d, motif: 'rendu impossible' }); continue }
      const rendu = fs.readdirSync(tmp).find((f) => f.startsWith('p-') && f.endsWith('.png'))
      if (!rendu) { bilan.rienDuTout.push({ ...d, motif: 'aucune page rendue' }); continue }
      image = path.join(tmp, rendu)
    }
    try {
      const info = execFileSync('pdfinfo', ['-f', '1', '-l', '1', src], { stdio: ['ignore', 'pipe', 'ignore'] }).toString()
      const m = /Page\s+1\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(info)
      if (m) dims = { l: Number(m[1]), h: Number(m[2]) }
    } catch { /* pdfinfo absent ou image : sans importance */ }

    let texte300 = ''
    try {
      texte300 = execFileSync('tesseract', [image, '-', '-l', 'fra'],
        { stdio: ['ignore', 'pipe', 'ignore'], timeout: 180000, maxBuffer: 8 * 1024 * 1024 }).toString()
    } catch { texte300 = '' }

    if (sansEspaces(texte300) >= 40) {
      bilan.ocr300.push({ ...d, type: typeDuTexte(texte300), extrait: texte300.trim().slice(0, 120).replace(/\s+/g, ' ') })
    } else {
      // Un format nettement non-A4 (A4 = 595 × 842 points) trahit une photo insérée telle quelle.
      const estPhoto = dims && Math.abs(dims.l - 595) > 60 && Math.abs(dims.h - 842) > 60
      ;(estPhoto ? bilan.photo : bilan.rienDuTout).push({
        ...d, dims, caracteres: sansEspaces(texte300), motif: estPhoto ? 'format non A4' : 'aucun texte à 300 dpi',
      })
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  if (vus % 5 === 0) process.stdout.write(`   ${vus}/${N}\r`)
}

console.log(`   ${vus} pièces sondées.                    \n`)
console.log('── Résultat ──')
console.log(`  ${String(bilan.coucheTexte.length).padStart(4)}  portaient une couche de texte : notre chaîne passait à côté`)
console.log(`  ${String(bilan.ocr300.length).padStart(4)}  deviennent lisibles à 300 dpi : c'est un réglage, pas une fatalité`)
console.log(`  ${String(bilan.photo.length).padStart(4)}  sont des images au format non A4 : des photos`)
console.log(`  ${String(bilan.rienDuTout).length ? String(bilan.rienDuTout.length).padStart(4) : '   0'}  ne donnent rien même à 300 dpi`)

for (const [nom, liste] of [['Couche de texte', bilan.coucheTexte], ['Lisibles à 300 dpi', bilan.ocr300]]) {
  if (!liste.length) continue
  console.log(`\n── ${nom} — 12 premiers ──`)
  for (const x of liste.slice(0, 12)) console.log(`  [${x.type || 'sans type'}] ${x.extrait}`)
}

if (bilan.photo.length || bilan.rienDuTout.length) {
  console.log('\n── Formats des pièces muettes ──')
  const t = {}
  for (const x of [...bilan.photo, ...bilan.rienDuTout]) {
    const k = x.dims ? `${Math.round(x.dims.l)}×${Math.round(x.dims.h)} pt` : 'image'
    t[k] = (t[k] || 0) + 1
  }
  for (const [k, n] of Object.entries(t).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${k}`)
  }
}
