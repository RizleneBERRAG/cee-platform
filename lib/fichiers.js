/**
 * Stockage des pièces jointes.
 *
 * Cinq décisions, chacune pour une raison précise.
 *
 * 1. **Le fichier va sur le disque, pas en base.** Un blob par pièce ferait grossir
 *    `cee.db` jusqu'à le rendre impossible à copier ou à sauvegarder. La base ne garde
 *    que les métadonnées.
 * 2. **Le nom du fichier sur disque est son empreinte SHA-256.** Le nom d'origine n'entre
 *    jamais dans un chemin : c'est ce qui rend la traversée de répertoire (`../../etc/passwd`)
 *    structurellement impossible, plutôt que de compter sur un filtrage que l'on peut oublier.
 * 3. **La même empreinte n'est écrite qu'une fois.** Vingt dossiers qui portent la même
 *    attestation d'un installateur occupent un seul fichier. Corollaire : effacer une pièce
 *    n'efface le fichier que si plus aucune ligne ne le référence.
 * 4. **Le type est déterminé par le contenu, pas par ce qu'annonce le navigateur.** On lit
 *    les premiers octets. Un `.pdf` qui est en réalité du HTML est refusé — sinon il serait
 *    servi tel quel et pourrait exécuter du script dans la session de qui le consulte.
 * 5. **Rien n'est servi depuis un chemin public.** Le dossier de stockage est hors de
 *    l'arborescence servie par le serveur ; une route dédiée relit les droits à chaque accès.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { nomPropre } from './nom-fichier.js'

const RACINE = process.env.CEE_FICHIERS || path.join(process.cwd(), 'fichiers')

/** 25 Mo : au-delà, c'est une photo non redimensionnée ou une erreur de manipulation. */
export const TAILLE_MAX = 25 * 1024 * 1024

/**
 * Types acceptés, reconnus à leur signature binaire.
 *
 * Volontairement restrictif. Ce qui n'est pas ici est refusé : un SVG ou un HTML est un
 * document qui peut porter du script, et le servir au navigateur d'un collègue reviendrait
 * à lui faire exécuter le fichier déposé par un tiers.
 */
const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', octets: [0x25, 0x50, 0x44, 0x46] },              // %PDF
  { mime: 'image/jpeg', ext: 'jpg', octets: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', octets: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', ext: 'gif', octets: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp', ext: 'webp', octets: [0x52, 0x49, 0x46, 0x46], a8: [0x57, 0x45, 0x42, 0x50] },
  { mime: 'image/tiff', ext: 'tif', octets: [0x49, 0x49, 0x2a, 0x00] },
  { mime: 'image/tiff', ext: 'tif', octets: [0x4d, 0x4d, 0x00, 0x2a] },
  // Les formats bureautiques modernes sont des archives ZIP : on ne peut pas les distinguer
  // à la signature seule. On les accepte comme ZIP et on ne les affiche jamais en aperçu.
  { mime: 'application/zip', ext: 'zip', octets: [0x50, 0x4b, 0x03, 0x04] },
  { mime: 'application/zip', ext: 'zip', octets: [0x50, 0x4b, 0x05, 0x06] },
  // Les vieux .doc et .xls, encore courants chez les artisans.
  { mime: 'application/vnd.ms-office', ext: 'doc', octets: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
]

/** Reconnaît le type réel d'un contenu. Renvoie null si la signature n'est pas acceptée. */
export { nomPropre }

/** Reconnaît le type réel d'un contenu. */
export function typeReel(buf) {
  for (const s of SIGNATURES) {
    if (buf.length < s.octets.length) continue
    if (!s.octets.every((o, i) => buf[i] === o)) continue
    if (s.a8 && !s.a8.every((o, i) => buf[8 + i] === o)) continue
    return { mime: s.mime, ext: s.ext }
  }
  return null
}

/** Les types dont l'aperçu dans le navigateur est sans danger. */
export const APERCU = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'])



/** Chemin sur disque, dérivé de l'empreinte seule. Deux niveaux pour ne pas saturer un répertoire. */
function cheminDe(empreinte, extension) {
  if (!/^[a-f0-9]{64}$/.test(empreinte)) throw new Error('Empreinte invalide.')
  const ext = /^[a-z0-9]{1,5}$/.test(String(extension || '')) ? extension : 'bin'
  return path.join(RACINE, empreinte.slice(0, 2), empreinte.slice(2, 4), `${empreinte}.${ext}`)
}

/**
 * Écrit un contenu et renvoie ses métadonnées.
 * @returns {{empreinte, taille, mime, extension, deduplique}} ou {erreur}
 */
export function enregistrer(buffer, nomOrigine) {
  if (!buffer || buffer.length === 0) return { erreur: 'Le fichier est vide.' }
  if (buffer.length > TAILLE_MAX) {
    return { erreur: `Le fichier fait ${Math.round(buffer.length / 1048576)} Mo — la limite est de ${TAILLE_MAX / 1048576} Mo.` }
  }

  const type = typeReel(buffer)
  if (!type) {
    return {
      erreur: 'Type de fichier non accepté. Formats admis : PDF, JPEG, PNG, GIF, WebP, TIFF, ' +
        'documents Office et archives ZIP. Le type est déterminé d\'après le contenu, pas d\'après l\'extension.',
    }
  }

  const empreinte = crypto.createHash('sha256').update(buffer).digest('hex')
  const chemin = cheminDe(empreinte, type.ext)
  const deduplique = fs.existsSync(chemin)

  if (!deduplique) {
    fs.mkdirSync(path.dirname(chemin), { recursive: true })
    // Écriture puis renommage : un fichier n'apparaît à son emplacement final que complet.
    const provisoire = `${chemin}.${process.pid}.tmp`
    fs.writeFileSync(provisoire, buffer)
    fs.renameSync(provisoire, chemin)
  }

  return {
    empreinte, taille: buffer.length, mime: type.mime, extension: type.ext,
    nom: nomPropre(nomOrigine), deduplique,
  }
}

/** Relit un contenu, en vérifiant que l'empreinte correspond toujours. */
export function lire(empreinte, extension) {
  const chemin = cheminDe(empreinte, extension)
  if (!fs.existsSync(chemin)) return null
  const buf = fs.readFileSync(chemin)
  // Si le fichier sur disque a été altéré, on refuse de le servir plutôt que de le servir faux.
  const verif = crypto.createHash('sha256').update(buf).digest('hex')
  if (verif !== empreinte) return { altere: true }
  return { contenu: buf }
}

export function existe(empreinte, extension) {
  try { return fs.existsSync(cheminDe(empreinte, extension)) } catch { return false }
}

/**
 * Efface le fichier d'une empreinte — uniquement si plus aucune ligne ne s'y réfère.
 * `encoreUtilise` est fourni par l'appelant, qui seul connaît la base.
 */
export function effacerSiOrphelin(empreinte, extension, encoreUtilise) {
  if (encoreUtilise) return false
  try {
    const chemin = cheminDe(empreinte, extension)
    if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); return true }
  } catch { /* un fichier déjà absent n'est pas une erreur */ }
  return false
}

/** Taille lisible : 1,4 Mo plutôt que 1468006. */
export function poids(octets) {
  const n = Number(octets) || 0
  if (n < 1024) return `${n} o`
  if (n < 1048576) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / 1048576).toFixed(1).replace('.', ',')} Mo`
}

/** Place occupée et nombre de fichiers distincts, pour l'écran de paramétrage. */
export function occupation() {
  let fichiers = 0
  let octets = 0
  const parcourir = (d) => {
    let entrees
    try { entrees = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entrees) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) parcourir(p)
      else { fichiers++; try { octets += fs.statSync(p).size } catch { /* ignoré */ } }
    }
  }
  parcourir(RACINE)
  return { fichiers, octets, racine: RACINE }
}
