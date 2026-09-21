/**
 * Reconnaissance du type d'un document d'après son CONTENU, et non son nom.
 *
 * ── Pourquoi il a fallu en arriver là ──
 *
 * Les pièces reprises du logiciel précédent s'appellent `09-09-2026_9bd3f8bf-ceaa-439e.pdf`.
 * Ni le type, ni le client, ni le dossier : une date et un identifiant technique. La
 * reconnaissance par le nom de fichier, qui marche sur des archives normales, ne donne
 * strictement rien ici — tout atterrit sous « AUTRE ».
 *
 * Le type existe pourtant chez eux, mais l'obtenir coûterait une requête par type et par
 * dossier — plus de onze mille appels sur le CRM d'un tiers pour une information qui est
 * écrite en toutes lettres sur la première page de chaque document. On la lit donc
 * nous-mêmes : rendu de la page 1, OCR, et correspondance par mots-clés.
 *
 * ── Ce que la lecture apporte en plus du type ──
 *
 * Les documents d'ECO PRO CONCEPT portent le numéro de dossier en en-tête
 * (« Numéro Client : EPC-2024-1255 »). Quand on le trouve, on le RENVOIE, et l'appelant
 * compare avec le dossier sous lequel la pièce a été rangée. Ce n'est pas un détail :
 * c'est le seul contrôle indépendant dont on dispose sur un rattachement fait par ailleurs
 * à l'aveugle. Une pièce dont le contenu contredit son rangement doit être signalée, jamais
 * corrigée en silence — on ne sait pas lequel des deux a tort.
 *
 * ── Ce que cette reconnaissance ne prétend pas être ──
 *
 * L'OCR se trompe. « Attestation » mal reconnu devient « Atestaton », un tampon traverse
 * une ligne, une page scannée de travers ne donne rien. On ne force donc JAMAIS : sans
 * correspondance franche, le document reste sous « AUTRE », là où il était. Un type faux
 * se propage dans un dépôt ; un « AUTRE » se voit et se corrige à la main.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

/** Le numéro de dossier tel qu'il apparaît en en-tête des documents. */
const MOTIF_NUMERO = /\b(EPC[\s-]?\d{4}[\s-]\d{1,6})\b/i

/**
 * Les types, du plus spécifique au plus général — l'ordre décide.
 *
 * « Attestation de fin de travaux » contient « attestation » : si l'attestation sur
 * l'honneur passait en premier, toutes les AFT seraient mal classées. Les motifs tolèrent
 * l'à-peu-près de l'OCR (accents perdus, lettres avalées) sans devenir vagues au point
 * d'attraper n'importe quoi.
 */
export const REGLES = [
  ['COFRAC', /\bcofrac\b|rapport\s+de\s+contr[oôe]le|organisme\s+de\s+contr[oôe]le/i],
  ['AFT', /fin\s+de?s?\s+travaux|proc[eè]s.?verbal\s+de\s+r[eé]ception|ach[eè]vement\s+des\s+travaux/i],
  ['CADRE_CONTRIB', /cadre\s+de\s+contribution|r[oô]le\s+actif\s+et\s+incitatif/i],
  ['AH', /attestation\s+sur\s+l.?honneur/i],
  ['DEVIS', /^\s*devis\b|\bdevis\s+n[°o]|\bdevis\s+\d{4}/im],
  ['FACTURE', /^\s*facture\b|\bfacture\s+n[°o]|\bfacture\s+\d{4}/im],
  ['RGE', /\brge\b|qualibat|qualipac|qualifelec|reconnu\s+garant/i],
  ['KBIS', /\bk\s?bis\b|extrait\s+.{0,15}registre\s+du\s+commerce|greffe\s+du\s+tribunal/i],
  ['CNI', /carte\s+nationale\s+d.?identit|r[eé]publique\s+fran[çc]aise.{0,40}identit|passeport/i],
  ['AVIS_IMPOSITION', /avis\s+d.?imp[oô]t|avis\s+d.?imposition|revenu\s+fiscal\s+de\s+r[eé]f[eé]rence/i],
  ['DOSSIER_CEE', /certificat.{0,3}s?\s+d.?[eé]conomie.{0,3}s?\s+d.?[eé]nergie|dossier\s+cee/i],
  ['FICHE_TECH', /fiche\s+technique|notice\s+technique|caract[eé]ristiques\s+techniques/i],
  // Trois familles découvertes en lisant ce qui restait « AUTRE » sur les premiers lots.
  // Elles n'avaient rien d'exotique : simplement, on ne les avait pas prévues.
  ['CERTIF_SIGNATURE', /certification\s+horodat|rapport\s+du\s+certificat|signature\s+[eé]lectronique|horodatage/i],
  // ── Le cadastre, tel qu'il arrive réellement ──
  //
  // Sur les 239 pièces restées sans type, la seule famille lisible était celle-ci : des
  // captures d'écran de Géoportail et de Google Maps. Elles échappaient à la règle pour
  // deux raisons distinctes. D'abord l'OCR massacre « Géoportail » — on a relevé
  // « Oportail », « eoportail », « portail Q ». Ensuite, et surtout, une capture Google
  // Maps ne contient nulle part le mot « cadastre » : elle contient les boutons de
  // l'interface. Ce sont donc ces boutons qu'on reconnaît, parce que c'est ce qui est
  // réellement écrit sur l'image.
  //
  // Un mot seul ne suffit pas pour les tournures les plus abîmées : « portail » tout court
  // attraperait un portail de clôture sur un devis de menuiserie. On exige alors une
  // CONJONCTION — plusieurs indices présents ensemble —, ce qu'une simple alternance de
  // motifs ne sait pas exprimer. D'où une règle qui est une fonction et non une expression
  // régulière : elle dit ce qu'elle vérifie, au lieu de le cacher dans une ligne illisible.
  ['CADASTRE', (t) => {
    if (/g[eé]?o?portail|cadastr|plan\s+de\s+situation|donn[eé]es\s+cartographiques|\bgoogle\s+maps\b/i.test(t)) return true
    // L'OCR écorche ces deux mots plus que les autres, parce qu'ils sont imprimés en
    // très petits caractères sur les extraits : « Parcolle », « Altiude ». On tolère donc
    // le milieu du mot, mais on exige le chiffre qui suit — sans lui, « parcelle » tout
    // court apparaît dans n'importe quel devis de terrassement.
    if (/parc[a-z]{2,5}\s*[:.]\s*\d/i.test(t)) return true
    if (/alt[a-z]{1,5}de?\s*[:.]?\s*\d+[.,]\d+\s*m/i.test(t)) return true
    // La référence cadastrale elle-même : « 000 / AB / 0126 », « 000 /0F 0246 ».
    if (/\b\d{3}\s*[/|]\s*[0-9A-Z]{1,3}\s*[/|]?\s*\d{4}\b/.test(t)) return true
    if (/ajouter\s+un\s+\w{0,3}eu\s+manquant/i.test(t)) return true
    if (/sugg[eé]rer\s+une\s+mod\w*\s+du\s*lieu/i.test(t)) return true
    // La barre d'outils de Google Maps, lue de travers : au moins trois de ses cinq
    // boutons côte à côte. Trois sur cinq ne se produit pas par hasard dans un devis.
    const boutons = [/itin\w*|rin[eé]r\w*/i, /enre\w*g\w*/i, /pro\w{0,3}mit[eé]?/i, /envoyer/i, /partager/i]
    if (boutons.filter((b) => b.test(t)).length >= 3) return true
    // Le bandeau de Géoportail : la République française et un « portail » quelconque.
    // Le bandeau de Géoportail. « FRANÇAISE » saute souvent à la lecture, et « Géo » aussi :
    // il reste « RÉPUBLIQUE » et un « portail » quelconque. La règle des cartes d'identité
    // passe avant celle-ci, donc une CNI ne peut pas être happée par ce motif.
    if (/r[eé]publique/i.test(t) && /portail/i.test(t)) return true
    return false
  }],
  ['MANDAT', /mandat\s+(?:de\s+)?(?:repr[eé]sentation|sp[eé]cial)|pouvoir\s+de\s+repr[eé]sentation/i],
]

/**
 * Le texte rendu par l'OCR est-il du bruit ?
 *
 * Une photo passée à l'OCR ne rend pas une page vide : elle rend des caractères. On a
 * relevé « LOT: ar RSR ST EU LPS pr NS Etre, rs CRE ++ 2 dE. » — quarante caractères, donc
 * assez pour passer le seuil de « page vide », et rien à lire. Ce bruit se reconnaît à sa
 * forme : des jetons très courts, presque aucun mot de quatre lettres ou plus. Le
 * distinguer permet de retomber sur l'indice de format au lieu de classer « AUTRE ».
 */
export function bruitOcr(texte) {
  const jetons = String(texte || '').match(/[\p{L}]+/gu) || []
  if (jetons.length < 6) return true
  const mots = jetons.filter((j) => j.length >= 4)
  return mots.length / jetons.length < 0.2
}

/** Le type déduit d'un texte, ou null si rien ne correspond franchement. */
export function typeDuTexte(texte) {
  const t = String(texte || '')
  if (t.replace(/\s/g, '').length < 40) return null // page quasi vide : l'OCR n'a rien donné
  if (bruitOcr(t)) return null // des caractères, mais pas des mots : l'OCR a lu une image
  for (const [code, motif] of REGLES) {
    const trouve = typeof motif === 'function' ? motif(t) : motif.test(t)
    if (trouve) return code
  }
  return null
}

/** Le numéro de dossier lu dans le texte, normalisé, ou null. */
export function numeroDuTexte(texte) {
  const m = MOTIF_NUMERO.exec(String(texte || ''))
  if (!m) return null
  return m[1].toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-')
}

let outilsVerifies = null
/** Les outils externes sont-ils présents ? Vérifié une fois, pas à chaque fichier. */
export function outilsDisponibles() {
  if (outilsVerifies !== null) return outilsVerifies
  outilsVerifies = ['pdftoppm', 'tesseract'].every((o) => {
    try { execFileSync('which', [o], { stdio: 'pipe' }); return true } catch { return false }
  })
  return outilsVerifies
}

/**
 * Le format de la première page d'un PDF, en points PostScript.
 *
 * A4 vaut 595 × 842. Un PDF qui n'est qu'une photo insérée telle quelle porte le format de
 * l'appareil : 591 × 1280 pour un téléphone tenu debout, 480 × 640, 1445 × 639. Ce n'est
 * pas une preuve, c'est un indice — mais c'est un indice qui ne dépend ni de l'OCR ni de la
 * qualité du scan, donc le seul disponible quand il n'y a aucun texte.
 */
export function formatPage(cheminPdf) {
  try {
    const info = execFileSync('pdfinfo', ['-f', '1', '-l', '1', cheminPdf],
      { stdio: ['ignore', 'pipe', 'ignore'], timeout: 20000 }).toString()
    const m = /Page\s+1\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/.exec(info)
    return m ? { largeur: Number(m[1]), hauteur: Number(m[2]) } : null
  } catch { return null }
}

/** Une page qui ne ressemble à aucun format bureautique courant. */
export function formatNonDocument(f) {
  if (!f) return false
  const proche = (a, b) => Math.abs(a - b) <= 40
  const COURANTS = [[595, 842], [842, 595], [612, 792], [792, 612], [595, 935], [842, 1191]]
  return !COURANTS.some(([l, h]) => proche(f.largeur, l) && proche(f.hauteur, h))
}

/**
 * Lit la première page d'un document et en déduit ce qu'on peut.
 *
 * `ok` dit si la lecture a RÉELLEMENT eu lieu. Sans ce drapeau, un échec silencieux —
 * fichier illisible, rendu raté, OCR planté — renvoie un texte vide, que l'appelant ne
 * distingue pas d'une page blanche et sur lequel il applique ses replis. C'est exactement
 * ce qui s'est produit : huit fichiers jamais lus classés « photos de chantier » parce
 * qu'ils n'avaient « pas de texte ». Un échec doit se voir, pas se déguiser en résultat.
 *
 * @param {Buffer} contenu
 * @param {string} extension  'pdf', 'png', 'jpg'…
 * `indice` dit SUR QUOI le type repose : `TEXTE` (l'OCR l'a lu), `TEXTE_300DPI` (il a
 * fallu un rendu fin), `IMAGE_SANS_TEXTE` ou `FORMAT_NON_DOCUMENT` (aucun texte, mais la
 * nature du fichier parle). Les deux derniers sont des constats de forme, pas des
 * lectures : celui qui relit un classement doit pouvoir faire la différence.
 *
 * @returns {{ok, type, indice, numero, texte}}
 */
export function lireDocument(contenu, extension) {
  const vide = { ok: false, type: null, indice: null, numero: null, texte: '' }
  if (!outilsDisponibles()) return vide
  if (!Buffer.isBuffer(contenu) && !(contenu instanceof Uint8Array)) return vide

  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-'))
  const ocr = (image) => execFileSync('tesseract', [image, '-', '-l', 'fra'],
    { stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, maxBuffer: 8 * 1024 * 1024 }).toString()

  try {
    if (/^(png|jpe?g|gif|webp)$/i.test(extension)) {
      const image = path.join(dossier, 'page.png')
      fs.writeFileSync(image, contenu)
      const texte = ocr(image)
      const type = typeDuTexte(texte)
      // Une image sans le moindre texte EST une photo : c'est le seul cas où le repli est
      // une constatation et non une supposition. `indice` dit sur quoi il repose, pour que
      // personne n'ait à deviner d'où sort ce type.
      if (!type && (texte.replace(/\s/g, '').length < 40 || bruitOcr(texte))) {
        return { ok: true, type: 'PHOTOS', indice: 'IMAGE_SANS_TEXTE', numero: null, texte }
      }
      return { ok: true, type, indice: type ? 'TEXTE' : null, numero: numeroDuTexte(texte), texte }
    }
    if (!/^pdf$/i.test(extension)) return vide

    const src = path.join(dossier, 'doc.pdf')
    fs.writeFileSync(src, contenu)

    // ── Pourquoi on ne s'arrête pas à la page 1 ──
    //
    // Certains documents commencent par une page de garde, un scan de travers ou une
    // feuille quasi vide : l'OCR en tire deux caractères, et le document part en « AUTRE »
    // alors que la page suivante annonce clairement ce qu'il est. On avance donc de page
    // en page tant qu'on n'a ni texte exploitable ni type, en s'arrêtant tôt — trois pages
    // suffisent pour un en-tête, et chaque page coûte une seconde.
    let cumul = ''
    for (const page of [1, 2, 3]) {
      const prefixe = path.join(dossier, `p${page}`)
      try {
        // 120 points par pouce : assez pour l'OCR d'un titre, dix fois plus rapide que 300.
        execFileSync('pdftoppm', ['-r', '120', '-f', String(page), '-l', String(page), '-png', src, prefixe],
          { stdio: 'pipe', timeout: 60000 })
      } catch { break }
      const rendu = fs.readdirSync(dossier).find((f) => f.startsWith(`p${page}-`) && f.endsWith('.png'))
      if (!rendu) break

      const texte = ocr(path.join(dossier, rendu))
      cumul += (cumul ? '\n' : '') + texte
      const type = typeDuTexte(cumul)
      // Assez de matière, ou un type franc : inutile de rendre les pages suivantes.
      if (type || texte.replace(/\s/g, '').length >= 60) {
        return { ok: true, type, indice: 'TEXTE', numero: numeroDuTexte(cumul), texte: cumul }
      }
    }

    // ── La seconde chance, à 300 points par pouce ──
    //
    // Sur un échantillon des pièces que 120 dpi laissait muettes, une sur cinq redevenait
    // lisible à 300 — et il s'agissait chaque fois d'extraits cadastraux dont les mentions
    // sont imprimées en très petits caractères. Conclure « ce document ne porte pas de
    // texte » à partir d'un seul réglage revenait donc à confondre ce que le document dit
    // et ce que nos réglages voyaient. On ne paie ce rendu, quatre fois plus lent, que
    // pour les documents qui n'ont rien donné : ils sont rares.
    if (cumul.replace(/\s/g, '').length < 40 || bruitOcr(cumul)) {
      const fin = path.join(dossier, 'hd')
      try {
        execFileSync('pdftoppm', ['-r', '300', '-f', '1', '-l', '1', '-png', src, fin],
          { stdio: 'pipe', timeout: 180000 })
        const rendu = fs.readdirSync(dossier).find((f) => f.startsWith('hd-') && f.endsWith('.png'))
        if (rendu) {
          const texte = ocr(path.join(dossier, rendu))
          if (texte.replace(/\s/g, '').length >= 40 && !bruitOcr(texte)) {
            const type = typeDuTexte(texte)
            return { ok: true, type, indice: type ? 'TEXTE_300DPI' : null, numero: numeroDuTexte(texte), texte }
          }
        }
      } catch { /* le rendu haute résolution a échoué : on retombe sur ce qui suit */ }

      // Toujours rien à lire. Le format de la page, lui, reste une information.
      if (formatNonDocument(formatPage(src))) {
        return { ok: true, type: 'PHOTOS', indice: 'FORMAT_NON_DOCUMENT', numero: null, texte: cumul }
      }
    }

    return { ok: true, type: typeDuTexte(cumul), indice: null, numero: numeroDuTexte(cumul), texte: cumul }
  } catch {
    return vide
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true })
  }
}
