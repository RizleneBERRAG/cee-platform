/**
 * Rattachement des pièces jointes reprises du logiciel précédent.
 *
 * ── Le problème à résoudre ──
 *
 * On reçoit des archives de documents — PDF, photos — produites par un export dont on ne
 * maîtrise ni la structure de dossiers ni la convention de nommage. Il faut retrouver, pour
 * chaque fichier, à QUEL dossier il appartient et de QUEL type il relève. Se tromper de
 * dossier, c'est ranger l'attestation d'un client chez un autre : au mieux le dépôt est
 * rejeté, au pire on transmet la pièce d'un tiers à un délégataire.
 *
 * ── Comment on identifie le dossier ──
 *
 * Par le numéro, cherché dans le chemin complet — nom de fichier ET dossiers parents, parce
 * que les exports rangent tantôt `EPC-2026-2934/facture.pdf`, tantôt `facture_EPC-2026-2934.pdf`.
 * Le numéro est une chaîne très reconnaissable (`EPC-2026-2934`), ce qui rend la
 * correspondance sûre — bien plus qu'un rapprochement par nom de client, où deux
 * « CHRISTE CHARPENTE » se confondraient.
 *
 * **Un fichier dont on ne trouve pas le dossier n'est jamais rangé « au hasard ».** Il est
 * compté, listé, et laissé de côté. Une pièce non rattachée se rattrape ; une pièce rangée
 * dans le mauvais dossier ne se découvre qu'au contrôle.
 *
 * ── Comment on identifie le type ──
 *
 * Par mots-clés dans le nom du fichier, avec une table explicite. Aucun type trouvé →
 * le document est rangé sous « AUTRE » plutôt que rejeté : la pièce existe, elle est au bon
 * dossier, seul son classement reste à affiner. Perdre le fichier serait pire que le mal ranger.
 *
 * ── Rejouable ──
 *
 * La déduplication se fait sur (dossier, empreinte du contenu) : relancer l'import sur la
 * même archive ne crée aucun doublon, et une archive partielle peut être complétée plus tard.
 */
import fs from 'node:fs'
import path from 'node:path'
import { enregistrer, nomPropre } from './fichiers.js'

/**
 * Le numéro de dossier dans sa forme la plus courante : `EPC-2026-2934`.
 *
 * Ce motif ne sert QUE de recours, quand on n'a pas la liste des numéros réels. Sur les
 * données reprises, il est insuffisant : à côté de la forme régulière cohabitent
 * `EPC-2024-0`, `EPC-2024-1234_1`, `EPC-2024-1037-00` et `EPC-A-2024-12345`. C'est pourquoi
 * le rattachement réel n'utilise pas ce motif mais la liste des numéros en base.
 */
export const MOTIF_NUMERO = /\b([A-Z]{2,5}-\d{4}-\d{1,6})\b/i

/**
 * Prépare un nom de fichier pour la reconnaissance.
 *
 * Le souligné est le piège de cet exercice : pour une expression régulière, `_` est un
 * caractère de MOT. Une frontière `\b` ne s'y forme donc pas, et `facture_EPC-2026-2934.pdf`
 * ne correspond à rien — pas plus que `AH_signee.pdf` ou `certificat_RGE.pdf`. Or c'est
 * précisément le séparateur que tous les exports utilisent.
 *
 * On le remplace donc par une espace avant toute reconnaissance. Une ligne, et les trois
 * quarts des noms de fichiers réels redeviennent lisibles.
 */
const normaliser = (v) => String(v || '').replace(/[_]+/g, ' ')

/**
 * Reconnaissance du type de document d'après le nom du fichier.
 *
 * L'ordre compte : le premier motif qui correspond gagne. Les libellés les plus spécifiques
 * viennent donc avant les plus généraux — « attestation de fin de travaux » avant
 * « attestation », faute de quoi toute AFT serait classée en attestation sur l'honneur.
 */
export const TYPES = [
  ['COFRAC', /cofrac|controle|contrôle/i],
  ['AFT', /\baft\b|fin.?de.?travaux|fin.?des.?travaux|achevement|achèvement/i],
  ['AH', /\bah\b|attestation.?sur.?l.?honneur|att.?honneur/i],
  ['CADRE_CONTRIB', /cadre.?de.?contrib|cadre.?contrib/i],
  ['DOSSIER_CEE', /dossier.?cee/i],
  ['DEVIS', /devis/i],
  ['FACTURE', /facture/i],
  ['FICHE_TECH', /fiche.?tech|technique|notice/i],
  ['RGE', /\brge\b|qualibat|qualipac|qualifelec/i],
  ['KBIS', /kbis|k.?bis|extrait.?rcs/i],
  ['CNI', /\bcni\b|identit|passeport/i],
  ['PHOTOS', /photo|\bimg\b|\bdsc\b|chantier/i],
]

/** Le type d'un fichier d'après son nom. Renvoie null si rien ne correspond. */
export function typeDeDocument(nomFichier) {
  const n = normaliser(nomFichier)
  for (const [code, motif] of TYPES) if (motif.test(n)) return code
  return null
}

/** Aucun numéro réel n'approche cette longueur ; c'est une borne de sécurité, pas une règle. */
const LONGUEUR_MAX_NUMERO = 40

/** Le préfixe alphabétique par lequel un numéro commence : le `EPC-` de `EPC-2026-2934`. */
const DEPART = /[A-Z]{2,6}-/g

/**
 * Le numéro de dossier RÉEL contenu dans un segment de chemin, ou null.
 *
 * ── Pourquoi on ne reconnaît pas le numéro à sa forme ──
 *
 * Les numéros repris n'ont pas de forme unique. Sur les 1 677 dossiers cohabitent
 * `EPC-2024-1001`, `EPC-2024-0`, `EPC-2024-1234_1`, `EPC-2024-1037-00` et `EPC-A-2024-12345`.
 * Un motif assez large pour tous les accepter accepte aussi n'importe quoi ; un motif assez
 * étroit pour être sûr en laisse passer 61 à côté.
 *
 * On ne devine donc rien : on cherche dans le texte les numéros **qui existent en base**.
 *
 * ── Pourquoi le plus long gagne, et pourquoi la fin doit être nette ──
 *
 * 84 numéros réels sont préfixes d'un autre numéro réel : `EPC-2024-1018` et
 * `EPC-2024-10180`, `EPC-2024-1037` et `EPC-2024-1037-00`. Prendre la première
 * correspondance rangerait les pièces du second chez le premier. On retient donc la plus
 * longue correspondance connue.
 *
 * Et surtout, on exige que le numéro **s'arrête proprement** : le caractère qui suit ne doit
 * être ni une lettre, ni un chiffre, ni un séparateur suivi d'un chiffre. Sans cette règle,
 * un fichier `EPC-2024-01234_x.pdf` dont le dossier n'est pas repris irait chez
 * `EPC-2024-0`, qui, lui, existe. Une pièce non rattachée se rattrape ; une pièce rangée
 * chez le mauvais client ne se découvre qu'au contrôle.
 *
 * @param {string} segment
 * @param {Set<string>} connus  numéros réels, en majuscules
 */
export function numeroConnuDans(segment, connus) {
  const s = String(segment || '').toUpperCase()
  let meilleur = null

  DEPART.lastIndex = 0
  for (let m; (m = DEPART.exec(s)); ) {
    const reste = s.slice(m.index)
    const max = Math.min(reste.length, LONGUEUR_MAX_NUMERO)
    for (let i = 2; i <= max; i++) {
      const candidat = reste.slice(0, i)
      if (!connus.has(candidat)) continue
      if (!finNette(reste, i)) continue
      if (!meilleur || candidat.length > meilleur.length) meilleur = candidat
    }
    // Les départs peuvent se chevaucher (`EPC-A-2024-…`) : on repart juste après.
    DEPART.lastIndex = m.index + 1
  }
  return meilleur
}

/** Le numéro se termine-t-il là, ou est-il le début d'un numéro plus long qu'on ne connaît pas ? */
function finNette(reste, i) {
  const suivant = reste[i]
  if (suivant === undefined) return true
  if (/[A-Z0-9]/.test(suivant)) return false
  if ((suivant === '-' || suivant === '_') && /\d/.test(reste[i + 1] || '')) return false
  return true
}

/**
 * Le numéro de dossier contenu dans un chemin, en partant du segment le plus profond —
 * le nom du fichier prime donc sur celui du répertoire qui le contient.
 *
 * Avec la liste des numéros réels (le cas de la reprise), la reconnaissance se fait par
 * `numeroConnuDans`. Sans elle, on retombe sur le motif de forme : suffisant pour un test,
 * insuffisant pour des données réelles.
 *
 * Le souligné n'est PAS normalisé ici, contrairement au type de document : il fait partie
 * de 31 numéros réels (`EPC-2024-1234_1`). Le remplacer les rendrait introuvables.
 *
 * @param {string} cheminRelatif
 * @param {Set<string>|null} connus  numéros réels, en majuscules
 */
export function numeroDansChemin(cheminRelatif, connus = null) {
  const segments = String(cheminRelatif || '').split(/[\\/]/).filter(Boolean).reverse()

  for (const brut of segments) {
    if (connus) {
      const trouve = numeroConnuDans(brut, connus)
      if (trouve) return trouve
      continue
    }
    const m = MOTIF_NUMERO.exec(normaliser(brut))
    if (m) return m[1].toUpperCase()
  }
  return null
}

/** Parcourt une arborescence et renvoie tous les fichiers, chemin relatif compris. */
export function listerFichiers(racine, base = racine) {
  const out = []
  let entrees
  try { entrees = fs.readdirSync(racine, { withFileTypes: true }) } catch { return out }
  for (const e of entrees) {
    const complet = path.join(racine, e.name)
    if (e.isDirectory()) out.push(...listerFichiers(complet, base))
    else if (e.isFile()) out.push({ complet, relatif: path.relative(base, complet) })
  }
  return out
}

/**
 * Range les pièces d'un répertoire dans les dossiers correspondants.
 *
 * @param {object} db        base ouverte
 * @param {string} racine    répertoire contenant les documents (archives déjà décompressées)
 * @param {object} options   { utilisateurId }
 * @returns rapport détaillé
 */
export function importerPieces(db, racine, options = {}) {
  const t0 = Date.now()
  const rapport = {
    fichiers: 0,
    rattaches: 0,
    dejaPresents: 0,
    sansDossier: 0,
    sansType: 0,
    refuses: 0,
    octets: 0,
    dossiersTouches: 0,
    exemplesSansDossier: [],
    motifsDeRefus: {},
    parType: {},
    ms: 0,
  }

  const uid = () => crypto.randomUUID()
  const get = (sql, p = []) => db.prepare(sql).get(...p)
  const run = (sql, p = []) => db.prepare(sql).run(...p)

  // Index des dossiers par numéro : une seule lecture, puis tout se fait en mémoire.
  const parNumero = new Map(
    db.prepare('SELECT id, numero FROM dossier').all().map((d) => [String(d.numero).toUpperCase(), d.id])
  )
  const numerosConnus = new Set(parNumero.keys())

  // Les types de document, créés au besoin — y compris « AUTRE », le filet de sécurité.
  const typeIds = new Map(
    db.prepare('SELECT id, code FROM type_document').all().map((t) => [t.code, t.id])
  )
  const typeId = (code, libelle) => {
    if (typeIds.has(code)) return typeIds.get(code)
    const id = uid()
    run('INSERT INTO type_document (id, code, libelle) VALUES (?,?,?)', [id, code, libelle || code])
    typeIds.set(code, id)
    return id
  }
  typeId('AUTRE', 'Pièce non classée')

  const fichiers = listerFichiers(racine)
  rapport.fichiers = fichiers.length

  const touches = new Set()

  db.exec('BEGIN')
  try {
    for (const f of fichiers) {
      const numero = numeroDansChemin(f.relatif, numerosConnus)
      if (!numero || !parNumero.has(numero)) {
        rapport.sansDossier++
        if (rapport.exemplesSansDossier.length < 10) rapport.exemplesSansDossier.push(f.relatif)
        continue
      }
      const dossierId = parNumero.get(numero)

      let contenu
      try { contenu = fs.readFileSync(f.complet) } catch { rapport.refuses++; continue }

      // `enregistrer` vérifie le type RÉEL d'après les premiers octets, pas d'après
      // l'extension : un .pdf qui serait en réalité du HTML est refusé, parce qu'il
      // pourrait exécuter du script dans le navigateur de qui le consulte.
      const r = enregistrer(contenu, path.basename(f.relatif))
      if (r.erreur) {
        rapport.refuses++
        const cle = r.erreur.slice(0, 60)
        rapport.motifsDeRefus[cle] = (rapport.motifsDeRefus[cle] || 0) + 1
        continue
      }

      // Déduplication par (dossier, empreinte) : la même pièce reçue deux fois — dans deux
      // archives qui se recouvrent, par exemple — n'est rattachée qu'une fois.
      const deja = get('SELECT id FROM document_dossier WHERE dossier_id = ? AND empreinte = ?',
        [dossierId, r.empreinte])
      if (deja) { rapport.dejaPresents++; continue }

      const code = typeDeDocument(f.relatif)
      if (!code) rapport.sansType++
      const tid = typeId(code || 'AUTRE')

      run(`INSERT INTO document_dossier
             (id, dossier_id, type_document_id, nom_fichier, empreinte, taille, type_mime, extension, depose_par)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        [uid(), dossierId, tid, nomPropre(path.basename(f.relatif)),
         r.empreinte, r.taille, r.mime, r.extension, options.utilisateurId ?? null])

      rapport.rattaches++
      rapport.octets += r.taille
      rapport.parType[code || 'AUTRE'] = (rapport.parType[code || 'AUTRE'] || 0) + 1
      touches.add(dossierId)
    }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch { /* transaction déjà refermée */ }
    throw new Error(`Import des pièces interrompu, base inchangée : ${e.message}`)
  }

  rapport.dossiersTouches = touches.size
  rapport.ms = Date.now() - t0
  return rapport
}
