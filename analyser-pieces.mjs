/**
 * Pourquoi 239 pièces sont-elles restées sans type ?
 *
 * ── Ce que ce script cherche, et ce qu'il ne fait pas ──
 *
 * Il ne classe rien et n'écrit rien dans la base. Il relit les 239 fichiers, extrait leur
 * texte, et range chaque échec dans UNE des trois familles — parce que les trois appellent
 * trois réponses complètement différentes :
 *
 * 1. **Aucun texte du tout.** Photo de chantier, scan trop pâle, page blanche. Aucune règle
 *    n'y changera rien, et aucun modèle de langue non plus : il n'y a rien à lire. Ce sont
 *    des pièces qu'on classe à la main, ou qui sont réellement des photos.
 * 2. **Du texte, mais aucune règle ne correspond.** C'est une famille de documents qu'on
 *    n'avait pas prévue. La réponse est une règle de plus — gratuite, instantanée,
 *    vérifiable. Ce sont ces documents qu'il faut regarder de près.
 * 3. **La lecture a échoué.** Fichier abîmé, PDF chiffré, rendu impossible. À constater,
 *    pas à interpréter.
 *
 * C'est cette répartition, et elle seule, qui dit si un modèle de langue servirait à
 * quelque chose ici. Un modèle ne lit pas mieux une page blanche ; il sait en revanche
 * nommer un document dont le texte est là mais dont le vocabulaire nous a échappé.
 *
 * Usage : node analyser-pieces.mjs [--archive chemin.db] [--limite N]
 */
import fs from 'node:fs'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { lireDocument, typeDuTexte, REGLES, outilsDisponibles } = await import('./lib/typage-contenu.js')

const arg = (nom, defaut) => {
  const i = process.argv.indexOf(nom)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut
}

const ARCHIVE = arg('--archive', 'archives/eco-pro-concept-2026-09-17-14-13-22.db')
const RACINE = process.env.CEE_FICHIERS || 'fichiers'
const LIMITE = Number(arg('--limite', '0')) || Infinity

if (!outilsDisponibles()) {
  console.log("IGNORÉ — pdftoppm et tesseract sont nécessaires pour relire les pièces.")
  process.exit(2)
}
if (!fs.existsSync(ARCHIVE)) {
  console.log(`IGNORÉ — archive introuvable : ${ARCHIVE}`)
  process.exit(2)
}

const db = new DatabaseSync(ARCHIVE)
const sansType = db.prepare(`
  SELECT d.id, d.nom_fichier, d.empreinte, d.extension, d.taille, d.dossier_id
    FROM document_dossier d JOIN piece_lue p ON p.document_id = d.id
   WHERE p.type_trouve IS NULL OR p.type_trouve = ''
   ORDER BY d.nom_fichier`).all()

const chemin = (d) => path.join(RACINE, d.empreinte.slice(0, 2), d.empreinte.slice(2, 4), `${d.empreinte}.${d.extension}`)

console.log(`── ${sansType.length} pièces sans type — relecture ──`)
console.log(`   archive : ${ARCHIVE}`)
console.log(`   fichiers : ${RACINE}\n`)

const familles = { VIDE: [], TEXTE_SANS_REGLE: [], LECTURE_KO: [], ABSENT: [], TYPE_TROUVE: [] }
const textes = new Map()

let fait = 0
for (const d of sansType) {
  if (fait >= LIMITE) break
  const p = chemin(d)
  if (!fs.existsSync(p)) { familles.ABSENT.push(d); fait++; continue }

  let r
  try { r = lireDocument(fs.readFileSync(p), d.extension) } catch { r = { ok: false, texte: '', type: null } }

  const utile = String(r.texte || '').replace(/\s/g, '').length

  if (!r.ok) familles.LECTURE_KO.push({ ...d, utile })
  else if (r.type) familles.TYPE_TROUVE.push({ ...d, type: r.type })
  else if (utile < 40) familles.VIDE.push({ ...d, utile })
  else { familles.TEXTE_SANS_REGLE.push({ ...d, utile }); textes.set(d.id, r.texte) }

  fait++
  if (fait % 25 === 0) process.stdout.write(`   ${fait}/${Math.min(sansType.length, LIMITE)}\r`)
}

console.log(`   ${fait} pièces relues.                    \n`)

const pct = (n) => `${Math.round((n / fait) * 1000) / 10} %`
console.log('── Répartition ──')
for (const [nom, libelle] of [
  ['VIDE', 'aucun texte exploitable (photo, scan illisible, page blanche)'],
  ['TEXTE_SANS_REGLE', "du texte, mais aucune règle ne correspond"],
  ['LECTURE_KO', 'la lecture a échoué (fichier abîmé, PDF protégé)'],
  ['ABSENT', 'fichier absent du stockage'],
  ['TYPE_TROUVE', 'un type ressort maintenant (les règles ont évolué depuis la reprise)'],
]) {
  const n = familles[nom].length
  console.log(`  ${String(n).padStart(4)}  ${pct(n).padStart(6)}  ${libelle}`)
}

if (familles.TYPE_TROUVE.length) {
  console.log('\n── Types qui ressortent maintenant ──')
  const parType = {}
  for (const x of familles.TYPE_TROUVE) parType[x.type] = (parType[x.type] || 0) + 1
  for (const [t, n] of Object.entries(parType).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${t}`)
}

// ── Ce que disent les documents qu'aucune règle n'attrape ──
//
// On ne devine pas : on compte. Les mots les plus fréquents dans l'en-tête de ces
// documents, hors mots vides, montrent les familles qu'on n'a pas prévues. Les règles
// s'écrivent ensuite à partir de ce que les documents disent, pas de ce qu'on imagine.
if (familles.TEXTE_SANS_REGLE.length) {
  const VIDES = new Set(('le la les un une des du de et en au aux pour par sur dans avec sans ce cette ces '
    + 'est sont ont a ne pas plus que qui quoi dont ou où il elle nous vous ils elles son sa ses leur leurs '
    + 'notre nos votre vos mme mr monsieur madame tel fax email mail www http https com fr net org '
    + 'page date nom prenom adresse code postal ville telephone numero num total montant euros eur ttc ht tva').split(/\s+/))

  const freq = new Map()
  const premieresLignes = []
  for (const [, texte] of textes) {
    const lignes = texte.split('\n').map((l) => l.trim()).filter((l) => l.length > 3)
    if (lignes[0]) premieresLignes.push(lignes.slice(0, 2).join(' / ').slice(0, 90))
    const tete = lignes.slice(0, 12).join(' ').toLowerCase()
    const vus = new Set()
    for (const mot of tete.match(/[a-zàâäéèêëîïôöùûüç]{4,}/g) || []) {
      if (VIDES.has(mot) || vus.has(mot)) continue
      vus.add(mot)
      freq.set(mot, (freq.get(mot) || 0) + 1)
    }
  }

  console.log('\n── Mots les plus fréquents en tête de ces documents ──')
  console.log('   (nombre de documents où le mot apparaît dans les 12 premières lignes)')
  for (const [mot, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
    console.log(`  ${String(n).padStart(4)}  ${mot}`)
  }

  console.log('\n── Premières lignes, 30 échantillons ──')
  for (const l of premieresLignes.slice(0, 30)) console.log(`  ${l}`)

  // Les textes complets sont écrits à côté : c'est en les lisant qu'on écrit les règles.
  const sortie = 'analyse-pieces-textes.txt'
  const blocs = []
  for (const x of familles.TEXTE_SANS_REGLE) {
    blocs.push(`===== ${x.nom_fichier} (${x.extension}, ${x.taille} octets) =====\n${textes.get(x.id) || ''}`)
  }
  fs.writeFileSync(sortie, blocs.join('\n\n'))
  console.log(`\n   Textes complets écrits dans ${sortie} (${blocs.length} documents).`)
}

console.log(`\n── Ce que ça décide ──`)
const lisibles = familles.TEXTE_SANS_REGLE.length
const aveugles = familles.VIDE.length + familles.LECTURE_KO.length
console.log(`  ${lisibles} pièce(s) portent du texte qu'aucune règle ne reconnaît : des règles suffisent.`)
console.log(`  ${aveugles} pièce(s) n'ont aucun texte à lire : ni règle ni modèle n'y changera quoi que ce soit.`)
console.log(`  ${familles.TYPE_TROUVE.length} pièce(s) se classent déjà avec les règles actuelles.`)
