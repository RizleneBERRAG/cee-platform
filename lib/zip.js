/**
 * Lecture d'archives ZIP, sans dépendance externe.
 *
 * ── Pourquoi ne pas appeler `unzip` ──
 *
 * La reprise des pièces doit tourner là où est la plateforme : sur un poste Windows, où
 * `unzip` n'existe pas. Dépendre d'un outil absent, c'est livrer une reprise qui marche
 * chez moi et pas chez vous. Node sait décompresser (`zlib.inflateRawSync`) ; il ne manquait
 * que la lecture du format d'archive lui-même, qui tient en une page.
 *
 * ── Ce que cette lecture refuse de faire ──
 *
 * Un nom d'entrée dans une archive est une donnée qui vient de l'extérieur, pas un chemin de
 * confiance. `../../Windows/System32/...` est un nom d'entrée parfaitement valide, et une
 * extraction naïve l'écrit où il le demande : c'est la faille dite « zip slip ». Chaque
 * destination est donc résolue puis **vérifiée comme étant sous le répertoire de sortie**,
 * et toute entrée qui en sort est refusée et comptée, jamais écrite.
 *
 * On refuse aussi les liens symboliques et tout ce qui n'est pas un fichier ordinaire : une
 * archive ne doit pas pouvoir créer un pont vers le reste du disque.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const SIG_EOCD = 0x06054b50
const SIG_EOCD64_LOC = 0x07064b50
const SIG_EOCD64 = 0x06064b50
const SIG_CENTRAL = 0x02014b50

/** Position de la fin du répertoire central, cherchée depuis la fin du fichier. */
function trouverEocd(buf) {
  const min = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i
  }
  return -1
}

/**
 * L'index d'une archive : une entrée par fichier, sans rien décompresser.
 * @returns {Array<{nom, methode, compresse, brut, offset, repertoire}>}
 */
export function lireIndex(buf) {
  const p = trouverEocd(buf)
  if (p < 0) throw new Error('archive illisible : fin de répertoire central introuvable')

  let nombre = buf.readUInt16LE(p + 10)
  let debut = buf.readUInt32LE(p + 16)

  // Archive ZIP64 : les champs 32 bits sont saturés et les vrais sont ailleurs.
  if (debut === 0xffffffff || nombre === 0xffff) {
    const loc = p - 20
    if (loc >= 0 && buf.readUInt32LE(loc) === SIG_EOCD64_LOC) {
      const off64 = Number(buf.readBigUInt64LE(loc + 8))
      if (buf.readUInt32LE(off64) === SIG_EOCD64) {
        nombre = Number(buf.readBigUInt64LE(off64 + 32))
        debut = Number(buf.readBigUInt64LE(off64 + 48))
      }
    }
  }

  const entrees = []
  let o = debut
  for (let k = 0; k < nombre && o + 46 <= buf.length; k++) {
    if (buf.readUInt32LE(o) !== SIG_CENTRAL) break
    const methode = buf.readUInt16LE(o + 10)
    const compresse = buf.readUInt32LE(o + 20)
    const brut = buf.readUInt32LE(o + 24)
    const ln = buf.readUInt16LE(o + 28)
    const le = buf.readUInt16LE(o + 30)
    const lc = buf.readUInt16LE(o + 32)
    const attributsExternes = buf.readUInt32LE(o + 38)
    const offset = buf.readUInt32LE(o + 42)
    const nom = buf.toString('utf8', o + 46, o + 46 + ln)
    // Bit 0xA000 des attributs Unix : lien symbolique. On ne les extrait pas.
    const lien = ((attributsExternes >>> 16) & 0xf000) === 0xa000
    entrees.push({ nom, methode, compresse, brut, offset, lien, repertoire: nom.endsWith('/') })
    o += 46 + ln + le + lc
  }
  return entrees
}

/** Le contenu d'une entrée. */
export function contenuDe(buf, e) {
  const ln = buf.readUInt16LE(e.offset + 26)
  const le = buf.readUInt16LE(e.offset + 28)
  const debut = e.offset + 30 + ln + le
  const donnees = buf.subarray(debut, debut + e.compresse)
  if (e.methode === 0) return donnees
  if (e.methode === 8) return zlib.inflateRawSync(donnees)
  throw new Error(`méthode de compression ${e.methode} non gérée`)
}

/** Le chemin de destination est-il bien à l'intérieur du répertoire de sortie ? */
function destinationSure(sortie, nom) {
  if (nom.includes('\0')) return null
  const cible = path.resolve(sortie, nom)
  const racine = path.resolve(sortie) + path.sep
  return cible.startsWith(racine) ? cible : null
}

/**
 * Décompresse une archive dans un répertoire.
 *
 * @returns {{extraits:number, octets:number, refuses:Array<{nom,motif}>}}
 */
export function extraire(cheminZip, sortie) {
  const buf = fs.readFileSync(cheminZip)
  const entrees = lireIndex(buf)
  const rapport = { extraits: 0, octets: 0, refuses: [] }

  for (const e of entrees) {
    if (e.repertoire) continue
    if (e.lien) { rapport.refuses.push({ nom: e.nom, motif: 'lien symbolique' }); continue }

    const cible = destinationSure(sortie, e.nom)
    if (!cible) { rapport.refuses.push({ nom: e.nom, motif: 'chemin hors du répertoire de sortie' }); continue }

    let contenu
    try { contenu = contenuDe(buf, e) } catch (err) {
      rapport.refuses.push({ nom: e.nom, motif: err.message }); continue
    }

    fs.mkdirSync(path.dirname(cible), { recursive: true })
    fs.writeFileSync(cible, contenu)
    rapport.extraits++
    rapport.octets += contenu.length
  }
  return rapport
}
