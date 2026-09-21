/**
 * Veille sur le catalogue des fiches d'opérations standardisées.
 *
 * ── Pourquoi ce module existe ──
 *
 * AGRI-TH-117 a été abrogée le 3 juin 2026. Nous l'avons découvert le 17 septembre, en
 * cherchant tout autre chose. Entre les deux, 30 dossiers ont été engagés sur une fiche qui
 * n'existait plus, et la fenêtre de recensement — dix jours — s'était refermée depuis
 * longtemps.
 *
 * Rien de tout cela ne demandait d'intelligence : le ministère publie son catalogue en
 * ligne. Il suffisait de le lire et de le comparer. C'est ce que fait ce module.
 *
 * ── Ce qu'il compare, et ce qu'il refuse de conclure ──
 *
 * Il relève, pour chacune de NOS fiches, ce que dit le catalogue public : la fiche y
 * figure-t-elle encore, et sous quelle version ? Il signale trois situations :
 *
 * - **disparue** du catalogue — abrogation probable, à confirmer à la source ;
 * - **version plus récente** que la nôtre — notre forfait est peut-être périmé ;
 * - **introuvable dans notre base** alors qu'elle est au catalogue — sans objet chez nous.
 *
 * Il ne met **rien à jour tout seul**. Un forfait lu dans un tableau HTML n'a pas la valeur
 * d'un arrêté : on signale, un humain vérifie sur le PDF officiel, et c'est lui qui charge
 * la nouvelle version. Une veille qui écrirait d'elle-même dans le référentiel
 * transformerait une erreur de lecture en montants faux sur tout un portefeuille.
 *
 * ── Hors ligne ──
 *
 * Sans accès réseau, le module le dit et ne renvoie rien plutôt que de laisser croire que
 * tout va bien. « Aucune anomalie » et « je n'ai pas pu regarder » ne sont pas la même
 * réponse.
 */

/**
 * Les sources publiques du catalogue, essayées dans cet ordre.
 *
 * Plusieurs, parce qu'une seule finit toujours par changer d'adresse ou par refuser un
 * client qui n'est pas un navigateur. Le PDF du catalogue est le plus stable : c'est un
 * fichier, pas une page.
 */
export const SOURCES_CATALOGUE = [
  'https://www.ecologie.gouv.fr/sites/default/files/documents/Catalogue%20fiches%20version%20actualis%C3%A9e%2084%C3%A8me%20arr%C3%AAt%C3%A9%20hors%2082%C3%A8me%20arr%C3%AAt%C3%A9.pdf',
  'https://www.ecologie.gouv.fr/politiques-publiques/operations-standardisees-deconomies-denergie',
]

/** Conservé pour compatibilité : la première source. */
export const URL_CATALOGUE = SOURCES_CATALOGUE[0]

/** Le motif d'un code de fiche : trois à cinq lettres, un domaine, un numéro. */
export const MOTIF_CODE = /\b([A-Z]{3,5}-[A-Z]{2,3}-\d{2,3})\b/g

/**
 * Extrait les codes de fiches et leurs versions d'un texte de catalogue.
 *
 * On lit du HTML ou du texte, pas une API : le format peut changer sans prévenir. La
 * fonction est donc tolérante sur la forme et stricte sur ce qu'elle affirme — un code
 * qu'elle ne reconnaît pas franchement n'est pas inventé.
 *
 * @returns {Map<string, {versions: string[]}>}
 */
export function lireCatalogue(texte) {
  const t = String(texte || '')
  const trouve = new Map()

  // Les positions de tous les codes : elles bornent la lecture de chacun.
  const positions = [...t.matchAll(MOTIF_CODE)].map((m) => ({ code: m[1].toUpperCase(), index: m.index, fin: m.index + m[1].length }))

  for (let i = 0; i < positions.length; i++) {
    const { code, fin } = positions[i]
    if (!trouve.has(code)) trouve.set(code, { versions: [] })

    // ── Où s'arrêter de lire ──
    //
    // Une ligne du catalogue décrit UNE fiche. Lire au-delà attribue à l'une les versions
    // de sa voisine : sans cette borne, AGRI-EQ-110 héritait du « A55-2 » de la ligne
    // suivante et ressortait comme ayant une version de retard. On s'arrête donc au premier
    // des trois : fin de ligne, code suivant, ou 200 caractères.
    const finLigne = t.indexOf('\n', fin)
    const codeSuivant = positions[i + 1]?.index ?? Infinity
    const borne = Math.min(
      finLigne === -1 ? Infinity : finLigne,
      codeSuivant,
      fin + 200,
    )

    for (const v of t.slice(fin, borne).matchAll(/\bA\.?\s?(\d{1,3})[-.](\d{1,2})\b/g)) {
      const version = `A${v[1]}-${v[2]}`
      if (!trouve.get(code).versions.includes(version)) trouve.get(code).versions.push(version)
    }
  }
  return trouve
}

/** Compare « A65-2 » et « A73-3 » : renvoie > 0 si a est plus récente. */
export function comparerVersions(a, b) {
  const lire = (v) => {
    const m = /^A\.?\s?(\d{1,3})[-.](\d{1,2})$/i.exec(String(v || '').trim())
    return m ? [Number(m[1]), Number(m[2])] : null
  }
  const x = lire(a), y = lire(b)
  if (!x || !y) return 0
  return (x[0] - y[0]) || (x[1] - y[1])
}

/**
 * Compare nos fiches au catalogue et renvoie les écarts.
 *
 * @param {object} db         base ouverte
 * @param {Map} catalogue     résultat de `lireCatalogue`
 * @returns {{ecarts: Array, examinees: number}}
 */
export function comparer(db, catalogue) {
  const nos = db.prepare(`
    SELECT f.code,
           (SELECT COUNT(*) FROM operation o WHERE o.fiche_id = f.id) AS operations,
           fv.version, fv.date_fin, fv.motif_fin
    FROM fiche f
    JOIN fiche_version fv ON fv.fiche_id = f.id
    WHERE f.code <> 'SANS-CODE-REPRISE'
    ORDER BY f.code, fv.date_effet DESC`).all()

  // On ne garde que la version la plus récente de chaque fiche chez nous.
  const parCode = new Map()
  for (const r of nos) if (!parCode.has(r.code)) parCode.set(r.code, r)

  const ecarts = []
  for (const [code, nôtre] of parCode) {
    const auCatalogue = catalogue.get(code)
    const dejaAbrogee = /abrog/i.test(nôtre.motif_fin || '')

    if (!auCatalogue) {
      // Une fiche qu'on porte et que le catalogue ne mentionne plus. Si nous la savons
      // déjà abrogée, rien de neuf ; sinon, c'est exactement le cas AGRI-TH-117.
      if (!dejaAbrogee) {
        ecarts.push({
          code, niveau: 'ALERTE', type: 'ABSENTE_DU_CATALOGUE',
          message: `La fiche ${code} ne figure plus au catalogue public.`,
          detail: `${nôtre.operations} opération(s) chez nous — vérifier une éventuelle abrogation à la source`,
          operations: nôtre.operations,
        })
      }
      continue
    }

    const plusRecente = auCatalogue.versions
      .filter((v) => comparerVersions(v, nôtre.version) > 0)
      .sort((a, b) => comparerVersions(b, a))[0]
    if (plusRecente) {
      ecarts.push({
        code, niveau: 'AVERTISSEMENT', type: 'VERSION_PLUS_RECENTE',
        message: `Le catalogue annonce la version ${plusRecente} de ${code}, nous portons ${nôtre.version}.`,
        detail: `${nôtre.operations} opération(s) — le forfait a peut-être changé`,
        operations: nôtre.operations,
      })
    }
  }

  return { ecarts, examinees: parCode.size }
}

/**
 * Récupère le catalogue et compare. Le réseau peut manquer : on le dit.
 *
 * @param {object} db
 * @param {Function} recuperer  fonction (url) => texte ; injectable pour les tests
 */
export async function veiller(db, recuperer, sources = SOURCES_CATALOGUE) {
  let texte = null
  const refus = []
  for (const url of sources) {
    try {
      texte = await recuperer(url)
      if (texte) break
    } catch (e) {
      refus.push(`${url.slice(0, 60)}… : ${e.message}`)
    }
  }
  if (!texte) {
    return {
      accessible: false,
      raison: refus.join(' | ') || 'aucune source joignable',
      ecarts: [],
      examinees: 0,
    }
  }
  const catalogue = lireCatalogue(texte)
  if (catalogue.size === 0) {
    // Page récupérée mais illisible : le format a changé, ou ce n'est pas la bonne page.
    // Le dire est la seule réponse honnête — zéro écart serait un faux calme.
    return {
      accessible: false,
      raison: 'Page récupérée, mais aucun code de fiche reconnu : le format du catalogue a probablement changé.',
      ecarts: [],
      examinees: 0,
    }
  }
  return { accessible: true, codesAuCatalogue: catalogue.size, ...comparer(db, catalogue) }
}
