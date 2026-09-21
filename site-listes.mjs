/**
 * Contrôles des trois listes fermées du site.
 *
 * Zone climatique, âge du bâtiment et type de chauffage décident de l'éligibilité et du
 * forfait de plusieurs fiches. Une erreur ici ne provoque aucun message : elle sort un
 * montant faux. Ces contrôles sont donc écrits pour attraper les confusions plausibles —
 * l'Île-de-France traitée comme un H1 ordinaire, une valeur de chauffage inventée rangée
 * « par défaut », une tranche d'âge décalée d'un an — et pas seulement pour vérifier que
 * les listes existent.
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  ZONES_CLIMATIQUES, CODES_ZONES, DEPARTEMENTS_IDF, zoneGenerale,
  AGES_BATIMENT, CODES_AGES, trancheDepuisAnnees,
  TYPES_CHAUFFAGE, CODES_CHAUFFAGE, chauffageDepuisLibelle,
  zoneValide, ageValide, chauffageValide,
} from './lib/referentiels-site.js'
import { zoneDepuisCodePostal, departementDe } from './lib/zones.js'

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('Zones climatiques')

ok(CODES_ZONES.includes('H1_IDF'), "H1 Île-de-France fait partie des zones — c'est l'oubli corrigé")
ok(CODES_ZONES.length === 4, `quatre zones et pas trois (obtenu : ${CODES_ZONES.length})`)
ok(zoneGenerale('H1_IDF') === 'H1', "une grille qui ignore l'Île-de-France retombe sur H1")
ok(zoneGenerale('H2') === 'H2', 'une zone sans parente se renvoie elle-même')
ok(zoneGenerale('H9') === null, 'une zone inconnue ne renvoie rien')

// Le point qui compte : un site parisien ne doit pas ressortir en H1 ordinaire.
const paris = zoneDepuisCodePostal('75011')
ok(paris.zone === 'H1_IDF', `Paris (75011) → ${paris.zone}`)
const lyon = zoneDepuisCodePostal('69003')
ok(lyon.zone === 'H1', `Lyon (69003) → ${lyon.zone}, H1 sans mention Île-de-France`)
const marseille = zoneDepuisCodePostal('13001')
ok(marseille.zone === 'H3', `Marseille (13001) → ${marseille.zone}`)

for (const dep of DEPARTEMENTS_IDF) {
  const cp = dep + '000'
  const r = zoneDepuisCodePostal(cp)
  if (r.zone !== 'H1_IDF') { ok(false, `le département ${dep} devrait être H1_IDF, obtenu ${r.zone}`); break }
}
ok(true, `les ${DEPARTEMENTS_IDF.size} départements franciliens ressortent tous en H1_IDF`)

ok(departementDe('20190') === '2A' && departementDe('20250') === '2B',
  'la Corse est départagée entre 2A et 2B selon le rang du code postal')
ok(zoneDepuisCodePostal('abc').zone === null, 'un code postal invalide ne renvoie aucune zone')
ok(zoneDepuisCodePostal('').departement === null, 'un code postal vide ne renvoie aucun département')

// ═══════════════════════════════════════════════════════════
titre("Âge du bâtiment")

ok(CODES_AGES.length === 4, `quatre tranches (obtenu : ${CODES_AGES.length})`)
for (const [annees, attendu] of [
  [0, 'MOINS_2_ANS'], [1, 'MOINS_2_ANS'],
  [2, 'DE_2_A_15_ANS'], [14, 'DE_2_A_15_ANS'],
  [15, 'PLUS_15_ANS'], [60, 'PLUS_15_ANS'],
]) {
  ok(trancheDepuisAnnees(annees) === attendu, `${annees} an(s) → ${attendu}`)
}
ok(trancheDepuisAnnees(-1) === null, 'un âge négatif ne donne aucune tranche')
ok(trancheDepuisAnnees('inconnu') === null, "un âge illisible ne donne aucune tranche")
// La borne exacte est le piège : 2 ans doit basculer, pas rester dans « moins de 2 ans ».
ok(trancheDepuisAnnees(2) !== 'MOINS_2_ANS', 'la bascule se fait À 2 ans, pas après')
ok(trancheDepuisAnnees(15) !== 'DE_2_A_15_ANS', 'la bascule se fait À 15 ans, pas après')
// « Neuf » est une qualification juridique : la conversion depuis un âge ne la produit jamais.
ok(!CODES_AGES.slice(0, 1).includes(trancheDepuisAnnees(0)),
  "un bâtiment de 0 an n'est pas déclaré « neuf » automatiquement")

// ═══════════════════════════════════════════════════════════
titre('Type de chauffage')

ok(CODES_CHAUFFAGE.length === 3, `trois types et pas sept (obtenu : ${CODES_CHAUFFAGE.length})`)
for (const [libelle, attendu] of [
  ['Gaz naturel', 'COMBUSTIBLE'], ['fioul domestique', 'COMBUSTIBLE'],
  ['Granulés bois', 'COMBUSTIBLE'], ['Électrique', 'ELECTRIQUE'],
  ['electrique', 'ELECTRIQUE'], ['Module hybride', 'HYBRIDE'],
  ['COMBUSTIBLE', 'COMBUSTIBLE'],
]) {
  ok(chauffageDepuisLibelle(libelle) === attendu, `« ${libelle} » → ${attendu}`)
}
// Le contrôle décisif : ce qu'on ne reconnaît pas reste vide, jamais rangé par défaut.
for (const flou of ['mixte', 'autre', 'à préciser', 'PAC', '']) {
  ok(chauffageDepuisLibelle(flou) === null,
    `« ${flou || '(vide)'} » ne tombe dans aucun type plutôt que dans « combustible »`)
}

// ═══════════════════════════════════════════════════════════
titre('Validation à l\'enregistrement')

ok(zoneValide('H1_IDF') && zoneValide(null) && !zoneValide('H4'),
  'seules les zones de la liste sont acceptées, le vide reste permis')
ok(ageValide('PLUS_15_ANS') && ageValide('') && !ageValide('12'),
  "un âge en années n'est plus accepté à la place d'une tranche")
ok(chauffageValide('HYBRIDE') && !chauffageValide('Gaz'),
  'un libellé libre est refusé, seul le code passe')

// ═══════════════════════════════════════════════════════════
titre('Sur la base réelle')

const SOURCE = process.env.CEE_DB_SOURCE || 'db/cee.db'
if (!fs.existsSync(SOURCE)) {
  console.log(`  (base ${SOURCE} absente — contrôles ignorés)`)
} else {
  const db = new DatabaseSync(SOURCE)
  const un = (s) => db.prepare(s).get()
  const colonnes = db.prepare('PRAGMA table_info(site)').all().map((c) => c.name)

  ok(colonnes.includes('age_batiment_tranche'), 'la colonne de tranche existe')
  ok(un(`SELECT COUNT(*) n FROM site WHERE zone_climatique IS NOT NULL
         AND zone_climatique NOT IN (${CODES_ZONES.map((z) => `'${z}'`).join(',')})`).n === 0,
    'aucun site ne porte une zone hors liste')
  ok(un(`SELECT COUNT(*) n FROM site WHERE type_chauffage IS NOT NULL
         AND type_chauffage NOT IN (${CODES_CHAUFFAGE.map((c) => `'${c}'`).join(',')})`).n === 0,
    'aucun site ne porte un type de chauffage hors liste')
  ok(un(`SELECT COUNT(*) n FROM site WHERE age_batiment_tranche IS NOT NULL
         AND age_batiment_tranche NOT IN (${CODES_AGES.map((a) => `'${a}'`).join(',')})`).n === 0,
    'aucun site ne porte une tranche hors liste')
  // La conversion ne doit avoir perdu personne : tout site qui avait un âge a une tranche.
  ok(un(`SELECT COUNT(*) n FROM site WHERE age_batiment IS NOT NULL
         AND age_batiment_tranche IS NULL`).n === 0,
    'tout site qui portait un âge en années porte maintenant sa tranche')
  // Et aucun site francilien ne doit rester en H1 ordinaire.
  ok(un(`SELECT COUNT(*) n FROM site WHERE zone_climatique = 'H1'
         AND substr(replace(code_postal,' ',''),1,2) IN ('75','77','78','91','92','93','94','95')`).n === 0,
    "aucun site francilien n'est resté en H1 ordinaire")
}

// ═══════════════════════════════════════════════════════════
titre('Le formulaire du site affiche EXACTEMENT ce qu\'il réenregistre')

// ── Le bug que ce contrôle empêche de revenir ──
//
// La requête du dossier ne ramenait pas `site.adresse`. Le champ arrivait donc vide à
// l'écran, et le formulaire — qui renvoie tout ce qu'il affiche — réécrivait NULL dans une
// colonne obligatoire : erreur SQL, page blanche, modification perdue. L'âge du bâtiment et
// le type de chauffage, eux, étaient effacés en silence, ce qui est pire.
//
// La règle tient en une phrase : tout champ que le formulaire renvoie doit être lu par la
// requête qui remplit ce formulaire. On la vérifie sur les noms, pas sur une capture.
const { readFileSync } = await import('node:fs')
const sourceQueries = readFileSync('lib/queries.js', 'utf8')
const sourcePage = readFileSync('app/dossiers/[id]/page.jsx', 'utf8')
const sourceActions = readFileSync('lib/actions.js', 'utf8')

const bloc = sourceQueries.slice(sourceQueries.indexOf('const SELECT_DOSSIER'), sourceQueries.indexOf('/**', sourceQueries.indexOf('const SELECT_DOSSIER')))
const champsSite = [...sourceActions.matchAll(/^\s{2}(\w+): '[^']*',?$/gm)]
const champsFormulaire = [...sourcePage.matchAll(/name="(\w+)"/g)].map((m) => m[1])

for (const champ of ['adresse', 'code_postal', 'ville', 'zone_climatique', 'secteur_activite',
  'surface', 'qpv', 'age_batiment', 'type_chauffage']) {
  ok(new RegExp(`s\\.${champ}\\b`).test(bloc),
    `la requête du dossier ramène site.${champ} — sinon le formulaire l'efface en l'enregistrant`)
  ok(champsFormulaire.includes(champ), `et le formulaire porte bien un champ « ${champ} »`)
}

// Les trois colonnes que la base refuse de voir vides doivent être protégées deux fois :
// côté navigateur (pour le dire tout de suite) et côté serveur (parce qu'un navigateur ment).
for (const champ of ['adresse', 'code_postal', 'ville']) {
  const ligne = sourcePage.split('\n').find((l) => l.includes(`name="${champ}"`)) || ''
  ok(/required/.test(ligne), `le champ « ${champ} » est marqué obligatoire dans le formulaire`)
}
ok(/INDISPENSABLES/.test(sourceActions),
  "et l'enregistrement refuse côté serveur de vider un champ obligatoire, plutôt que de laisser SQL échouer")

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
