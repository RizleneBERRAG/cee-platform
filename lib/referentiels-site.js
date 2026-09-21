/**
 * Listes fermées décrivant le SITE, et pourquoi ces trois-là comptent plus que les autres.
 *
 * Zone climatique, âge du bâtiment et type de chauffage ne sont pas des champs
 * d'information : ils **conditionnent l'éligibilité et le forfait** de plusieurs fiches
 * BAR-EN et BAR-TH. Une valeur fausse ici ne se voit nulle part à l'écran et sort un volume
 * cumac faux à l'autre bout. C'est la raison d'être de ce fichier : trois listes fermées,
 * une conversion explicite, et un refus à l'enregistrement plutôt qu'un champ libre.
 */

/**
 * Les zones climatiques, **avec H1 Île-de-France**.
 *
 * L'oubli qu'on corrige ici : la plateforme n'en connaissait que trois. Or l'Île-de-France
 * est distinguée de H1 sur plusieurs fiches — les forfaits n'y sont pas les mêmes, la
 * densité du bâti et le raccordement au réseau de chaleur changeant l'économie de
 * l'opération. Traiter un dossier francilien comme un H1 ordinaire donne un montant faux,
 * en silence.
 *
 * `parente` dit de quelle zone générale une zone relève : un barème qui ne distingue pas
 * l'Île-de-France doit pouvoir retomber sur H1 sans qu'on duplique ses lignes.
 */
export const ZONES_CLIMATIQUES = [
  { code: 'H1', libelle: 'H1', parente: null },
  { code: 'H1_IDF', libelle: 'H1 — Île-de-France', parente: 'H1' },
  { code: 'H2', libelle: 'H2', parente: null },
  { code: 'H3', libelle: 'H3', parente: null },
]

export const CODES_ZONES = ZONES_CLIMATIQUES.map((z) => z.code)

/** Les départements franciliens, pour distinguer H1_IDF de H1 à partir du code postal. */
export const DEPARTEMENTS_IDF = new Set(['75', '77', '78', '91', '92', '93', '94', '95'])

/**
 * La zone d'un barème qui ne connaît pas l'Île-de-France.
 *
 * Sans cette fonction, chaque grille devrait lister H1_IDF à côté de H1, et celle qui
 * l'oublierait renverrait « pas de valeur » au lieu de la valeur de H1 — un dossier
 * francilien sans forfait, et personne pour s'en apercevoir.
 */
export function zoneGenerale(code) {
  const z = ZONES_CLIMATIQUES.find((x) => x.code === code)
  return z?.parente ?? z?.code ?? null
}

/**
 * Les tranches d'âge du bâtiment, telles que les fiches les emploient.
 *
 * On stockait un nombre d'années libre. Les fiches, elles, raisonnent par tranches, et
 * c'est la tranche qui ouvre ou ferme un droit : « bâtiment de plus de deux ans » est une
 * condition d'éligibilité fréquente. Un entier oblige chaque calcul à refaire la conversion,
 * et il suffit qu'un seul la fasse autrement pour que deux écrans se contredisent.
 */
export const AGES_BATIMENT = [
  { code: 'NEUF', libelle: 'Neuf', min: 0, max: 0 },
  { code: 'MOINS_2_ANS', libelle: 'Moins de 2 ans', min: 0, max: 2 },
  { code: 'DE_2_A_15_ANS', libelle: 'De 2 à 15 ans', min: 2, max: 15 },
  { code: 'PLUS_15_ANS', libelle: 'Plus de 15 ans', min: 15, max: null },
]

export const CODES_AGES = AGES_BATIMENT.map((a) => a.code)

/**
 * La tranche correspondant à un nombre d'années.
 *
 * Sert à convertir l'existant. Une valeur de 0 an est ambiguë — neuf, ou livré cette année ?
 * On choisit `MOINS_2_ANS` et **on ne prétend pas savoir** : « neuf » est une qualification
 * juridique que l'âge seul ne donne pas, et se tromper dans ce sens est le moins grave
 * (moins de 2 ans reste éligible là où « neuf » exclut).
 */
export function trancheDepuisAnnees(annees) {
  const n = Number(annees)
  if (!Number.isFinite(n) || n < 0) return null
  if (n < 2) return 'MOINS_2_ANS'
  if (n < 15) return 'DE_2_A_15_ANS'
  return 'PLUS_15_ANS'
}

/**
 * Les types de chauffage réellement employés par le dispositif.
 *
 * La plateforme en portait sept, inventés pour les écrans de démonstration. Le dispositif
 * n'en distingue que trois, et cette distinction décide de l'éligibilité : une fiche
 * réservée au chauffage combustible ne s'applique pas à un logement électrique. Sept valeurs
 * dont quatre n'existent pas, c'est quatre façons de rendre un dossier inclassable.
 */
export const TYPES_CHAUFFAGE = [
  { code: 'COMBUSTIBLE', libelle: 'Combustible' },
  { code: 'ELECTRIQUE', libelle: 'Électrique' },
  { code: 'HYBRIDE', libelle: 'Module hybride' },
]

export const CODES_CHAUFFAGE = TYPES_CHAUFFAGE.map((c) => c.code)

/**
 * Rapproche une valeur libre d'un code, ou renvoie null.
 *
 * Utilisée pour convertir l'existant et pour absorber les libellés d'un import. Elle est
 * volontairement stricte : ce qu'elle ne reconnaît pas franchement reste vide, et se voit.
 * Deviner « gaz » → COMBUSTIBLE est raisonnable ; deviner « mixte » ne l'est pas.
 */
export function chauffageDepuisLibelle(valeur) {
  const v = String(valeur || '').trim().toLowerCase()
  if (!v) return null
  if (CODES_CHAUFFAGE.includes(v.toUpperCase())) return v.toUpperCase()
  if (/hybride/.test(v)) return 'HYBRIDE'
  if (/[ée]lectri/.test(v)) return 'ELECTRIQUE'
  if (/combustible|gaz|fioul|propane|bois|granul|charbon|p[ée]trole/.test(v)) return 'COMBUSTIBLE'
  return null
}

/** Vrai si la valeur appartient à la liste fermée (ou est vide, ce qui reste permis). */
export const zoneValide = (v) => v == null || v === '' || CODES_ZONES.includes(v)
export const ageValide = (v) => v == null || v === '' || CODES_AGES.includes(v)
export const chauffageValide = (v) => v == null || v === '' || CODES_CHAUFFAGE.includes(v)
