/**
 * La zone climatique d'un site, déduite de son code postal.
 *
 * ── Pourquoi ce module existe ──
 *
 * La déduction vivait dans l'import de masse, donc l'import et les écrans de saisie ne
 * répondaient pas forcément la même chose. Une zone climatique décide d'un forfait : deux
 * chemins qui la calculent séparément finissent par diverger, et la divergence se lit dans
 * un montant, pas dans un message d'erreur.
 *
 * ── L'Île-de-France ──
 *
 * La table des départements donne H1 pour les huit départements franciliens. C'est vrai au
 * sens climatique et faux au sens des fiches, qui distinguent H1 Île-de-France. On affine
 * donc la réponse ici, à un seul endroit.
 *
 * ── Ce qu'on refuse de faire ──
 *
 * La zone d'un site réel dépend de sa commune, parfois de son altitude — pas seulement de
 * son département. Huit départements sont à cheval sur deux zones : pour ceux-là, la
 * déduction est marquée **incertaine** et l'appelant doit pouvoir le dire à l'utilisateur
 * plutôt que d'afficher un résultat net. Une valeur déduite qui se présente comme une valeur
 * saisie est un mensonge par omission.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DEPARTEMENTS_IDF } from './referentiels-site.js'

let cache = null
function table() {
  if (cache) return cache
  try {
    const brut = fs.readFileSync(path.join(process.cwd(), 'db', 'zones-climatiques.json'), 'utf8')
    const j = JSON.parse(brut)
    cache = { zones: j.zones || {}, incertains: new Set(j._incertains || []) }
  } catch {
    cache = { zones: {}, incertains: new Set() }
  }
  return cache
}

/** Le département d'un code postal, Corse comprise (2A / 2B selon le rang). */
export function departementDe(codePostal) {
  const cp = String(codePostal || '').replace(/\s/g, '')
  if (!/^\d{5}$/.test(cp)) return null
  if (cp.startsWith('20')) return Number(cp) < 20200 ? '2A' : '2B'
  return cp.slice(0, 2)
}

/**
 * La zone climatique déduite d'un code postal.
 *
 * @returns {{zone: string|null, departement: string|null, incertaine: boolean}}
 */
export function zoneDepuisCodePostal(codePostal) {
  const departement = departementDe(codePostal)
  if (!departement) return { zone: null, departement: null, incertaine: false }

  const { zones, incertains } = table()
  let zone = zones[departement] ?? null
  // La distinction que la table climatique ne porte pas, mais que les fiches exigent.
  if (zone === 'H1' && DEPARTEMENTS_IDF.has(departement)) zone = 'H1_IDF'

  return { zone, departement, incertaine: zone != null && incertains.has(departement) }
}
