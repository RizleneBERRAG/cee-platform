/**
 * Contrôles du calcul de volume cumac.
 *
 * ── Pourquoi cette suite existe ──
 *
 * Elle aurait dû exister le jour où le référentiel officiel a été chargé. Elle n'existait
 * pas, et pendant vingt-quatre heures les quatre fiches de la plateforme ont été
 * **incalculables** : leurs barèmes étaient enregistrés en objet imbriqué là où le moteur
 * attend un tableau, et `calculerCumac` levait `coefficients.filter is not a function`.
 * Personne ne l'a vu, parce que les 1 677 dossiers repris portaient des montants figés
 * qu'on ne recalculait jamais. Le premier dossier créé à la main aurait fait tomber l'écran.
 *
 * D'où la règle que cette suite applique : **chaque fiche du référentiel est réellement
 * calculée**, avec un contexte plausible, et le résultat est comparé au barème officiel.
 * Un référentiel qui se charge sans erreur ne prouve rien ; un référentiel qui calcule
 * juste, si.
 */
import fs from 'node:fs'

const { DatabaseSync } = await import('node:sqlite')
const { calculerCumac, choisirCoefficient, baremeLisible, ficheApplicable, conditionsLisibles } = await import('./lib/cumac.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('Un barème mal formé ne fait plus tomber le calcul')

// La forme exacte qui plantait : un objet au lieu d'un tableau.
const objet = { ficheVersion: { coefficients: JSON.stringify({ forfait: 710 }), formule_type: 'FORFAIT_PAR_UNITE' }, quantite: 10 }
let leve = false
let r
try { r = calculerCumac(objet) } catch { leve = true }
ok(!leve, 'un barème en objet ne lève plus d\'exception')
ok(r && r.complet === false, 'il est déclaré non calculable')
ok(/format attendu/.test(r?.detail || ''), 'et le motif dit ce qui ne va pas')
ok(r?.cumac === 0, 'le volume renvoyé est 0, accompagné de `complet: false` — les deux se lisent ensemble')

let leve2 = false
try { calculerCumac({ ficheVersion: { coefficients: '{pas du json' }, quantite: 1 }) } catch { leve2 = true }
ok(!leve2, 'un JSON invalide non plus')

ok(baremeLisible([]).ok === true, 'un tableau vide est un barème lisible (simplement sans ligne)')
ok(baremeLisible({ a: 1 }).ok === false, 'un objet ne l\'est pas')
ok(baremeLisible(null).ok === false, 'ni l\'absence de barème')

// ═══════════════════════════════════════════════════════════
titre('Le choix du barème : le plus spécifique gagne')

const bareme = [
  { criteres: {}, valeur: 100 },
  { criteres: { zoneClimatique: 'H2' }, valeur: 200 },
  { criteres: { zoneClimatique: 'H2', typeProduit: 'FORESTIER' }, valeur: 300 },
]
ok(choisirCoefficient(bareme, { zoneClimatique: 'H3' }).valeur === 100, 'le cas général s\'applique à défaut')
ok(choisirCoefficient(bareme, { zoneClimatique: 'H2' }).valeur === 200, 'un critère qui correspond l\'emporte sur le cas général')
ok(choisirCoefficient(bareme, { zoneClimatique: 'H2', typeProduit: 'FORESTIER' }).valeur === 300,
  'et deux critères l\'emportent sur un seul')
ok(choisirCoefficient([{ criteres: { zoneClimatique: 'H1' }, valeur: 1 }], { zoneClimatique: 'H2' }) === null,
  'rien ne correspond : on renvoie null plutôt qu\'un barème approchant')

// ═══════════════════════════════════════════════════════════
titre('AGRI-EQ-110 — la fiche du séchage solaire')

const db = new DatabaseSync(process.env.CEE_DB_SOURCE || 'db/cee.db')
const version = (code) => db.prepare(`
  SELECT fv.* FROM fiche_version fv JOIN fiche f ON f.id = fv.fiche_id
   WHERE f.code = ? ORDER BY fv.date_effet DESC LIMIT 1`).get(code)

const agri = version('AGRI-EQ-110')
ok(!!agri, 'la fiche est en base')
ok(agri.unite_variable === 'kW',
  `elle se calcule en kW de puissance thermique, pas en unités (obtenu : ${agri.unite_variable})`)
ok(baremeLisible(JSON.parse(agri.coefficients)).ok, 'son barème est lisible par le moteur')

// Les douze valeurs officielles, recopiées ici à la main depuis deux sources concordantes.
// Les réécrire dans le test est volontaire : si quelqu'un modifie le référentiel par
// erreur, c'est ce tableau-là qui s'y oppose.
const OFFICIEL = [
  ['SYSTEME_COMPLET', 'AGRICOLE', 'H1', 42700], ['SYSTEME_COMPLET', 'AGRICOLE', 'H2', 48500],
  ['SYSTEME_COMPLET', 'AGRICOLE', 'H3', 55700],
  ['SYSTEME_COMPLET', 'FORESTIER', 'H1', 102600], ['SYSTEME_COMPLET', 'FORESTIER', 'H2', 116600],
  ['SYSTEME_COMPLET', 'FORESTIER', 'H3', 134100],
  ['TOITURE_COUPLEE', 'AGRICOLE', 'H1', 12200], ['TOITURE_COUPLEE', 'AGRICOLE', 'H2', 13900],
  ['TOITURE_COUPLEE', 'AGRICOLE', 'H3', 17400],
  ['TOITURE_COUPLEE', 'FORESTIER', 'H1', 16900], ['TOITURE_COUPLEE', 'FORESTIER', 'H2', 19300],
  ['TOITURE_COUPLEE', 'FORESTIER', 'H3', 24100],
]

let justes = 0
for (const [typeInstallation, typeProduit, zoneClimatique, attendu] of OFFICIEL) {
  const c = calculerCumac({ ficheVersion: agri, quantite: 1, contexte: { typeInstallation, typeProduit, zoneClimatique } })
  if (c.coefficient === attendu && c.cumac === attendu) justes++
  else console.log(`         ${typeInstallation} ${typeProduit} ${zoneClimatique} : ${c.coefficient} au lieu de ${attendu}`)
}
ok(justes === 12, `les douze barèmes officiels sont exacts (${justes}/12)`)

// Le cas qui coûte cher : confondre agricole et forestier.
const agricole = calculerCumac({ ficheVersion: agri, quantite: 30, contexte: { zoneClimatique: 'H1', typeProduit: 'AGRICOLE', typeInstallation: 'SYSTEME_COMPLET' } })
const forestier = calculerCumac({ ficheVersion: agri, quantite: 30, contexte: { zoneClimatique: 'H1', typeProduit: 'FORESTIER', typeInstallation: 'SYSTEME_COMPLET' } })
ok(forestier.cumac > agricole.cumac * 2,
  `le barème forestier vaut plus du double de l'agricole (${(forestier.cumac / agricole.cumac).toFixed(1)}×) — la case cochée change tout`)

// L'Île-de-France suit H1 : la fiche ne la distingue pas, mais notre référentiel des zones
// si. Sans cette ligne, un chantier francilien ne trouverait aucun barème.
const idf = calculerCumac({ ficheVersion: agri, quantite: 1, contexte: { zoneClimatique: 'H1_IDF', typeProduit: 'AGRICOLE', typeInstallation: 'SYSTEME_COMPLET' } })
ok(idf.coefficient === 42700, 'un chantier en Île-de-France prend bien le barème H1')

// Un critère manquant ne doit PAS retenir un barème au hasard.
const incomplet = calculerCumac({ ficheVersion: agri, quantite: 30, contexte: { zoneClimatique: 'H2' } })
ok(incomplet.complet === false, 'sans le type de produit, le calcul ne conclut pas')
ok(incomplet.cumac === 0 && /typeProduit/.test(incomplet.detail),
  'et il nomme le critère manquant plutôt que de dire « erreur »')

// Les conditions rappellent ce qui se joue au contrôle.
const conditions = JSON.parse(agri.conditions || '[]')
ok(conditions.some((c) => /PUISSANCE/i.test(c.code)),
  'la fiche rappelle que la quantité est une puissance en kW, pas une surface')

// ═══════════════════════════════════════════════════════════
titre('Toutes les fiches de la plateforme calculent réellement')

// Le contrôle qui manquait. Chaque fiche est appelée avec un contexte plausible ; aucune
// ne doit lever d'exception, et aucune ne doit porter un barème illisible.
const CONTEXTES = {
  'AGRI-EQ-110': { zoneClimatique: 'H2', typeProduit: 'AGRICOLE', typeInstallation: 'SYSTEME_COMPLET' },
  'AGRI-TH-117': {},
  'RES-EC-104': { variante: 'GRADATION_ET_DETECTION' },
  'BAT-EQ-127': { irc: 'irc_inferieur_90', secteurActivite: 'HOTELLERIE', efficaciteLumineuse: '160-184' },
}
const fiches = db.prepare("SELECT code FROM fiche WHERE code <> 'SANS-CODE-REPRISE' ORDER BY code").all()
ok(fiches.length >= 4, `${fiches.length} fiches officielles en base`)

for (const { code } of fiches) {
  const fv = version(code)
  const lisible = baremeLisible(JSON.parse(fv.coefficients))
  ok(lisible.ok, `${code} : son barème est au format que le moteur sait lire`)
  if (!lisible.ok) continue

  let planté = false
  let res
  try { res = calculerCumac({ ficheVersion: fv, quantite: 10, contexte: CONTEXTES[code] || {} }) } catch { planté = true }
  ok(!planté, `${code} : le calcul ne lève pas d'exception`)
  ok(res?.complet === true && res.cumac > 0,
    `${code} : ${res?.cumac?.toLocaleString('fr-FR')} kWh cumac pour 10 ${fv.unite_variable}`)
}

// Quelques valeurs nommément, pour que le référentiel ne dérive pas en silence.
ok(calculerCumac({ ficheVersion: version('AGRI-TH-117'), quantite: 1, contexte: {} }).coefficient === 710,
  'AGRI-TH-117 vaut 710 kWh cumac par m²')
ok(calculerCumac({ ficheVersion: version('RES-EC-104'), quantite: 1, contexte: {} }).coefficient === 4000,
  'RES-EC-104 vaut 4 000 kWh cumac par luminaire dans le cas général')
ok(calculerCumac({ ficheVersion: version('RES-EC-104'), quantite: 1, contexte: { variante: 'GRADATION_ET_DETECTION' } }).coefficient === 5600,
  'et 5 600 avec gradation et détection de présence')

// ═══════════════════════════════════════════════════════════
titre('Les fiches périmées restent périmées')

const abrogee = version('AGRI-TH-117')
ok(abrogee.date_fin === '2026-06-03', 'AGRI-TH-117 porte toujours sa date d\'abrogation')
ok(ficheApplicable(abrogee, '2026-09-18').applicable === false,
  'une opération engagée aujourd\'hui sur cette fiche est refusée')
ok(ficheApplicable(abrogee, '2026-01-15').applicable === true,
  'mais une opération engagée avant l\'abrogation reste valable')
ok(ficheApplicable(version('AGRI-EQ-110'), '2026-09-18').applicable === true,
  'AGRI-EQ-110, elle, est bien applicable aujourd\'hui — c\'est la fiche de la nouvelle activité')

// Le référentiel sur disque doit rester cohérent avec ce qui est chargé.
const ref = JSON.parse(fs.readFileSync('db/referentiel-fiches.json', 'utf8'))
ok(ref.fiches.every((f) => f.versions.every((v) => Array.isArray(v.coefficients))),
  'le fichier de référentiel ne porte plus aucun barème en objet')
ok(ref.fiches.every((f) => f.versions.every((v) => v.coefficients.every((c) => typeof c.valeur === 'number'))),
  'chaque ligne de barème porte une valeur numérique')

// ═══════════════════════════════════════════════════════════
titre('Les conditions de fiche : deux formes en base, une seule liste à afficher')

// Le bug réel : la fiche du dossier faisait `.map()` sur `conditions`. Le référentiel en
// stocke deux formes — un tableau pour quelques fiches, un objet pour toutes les autres.
// Sur une fiche de la seconde famille, la page entière tombait en erreur 500 sans rien
// dire. La cause est la même que celle du barème : une donnée de forme inattendue.
ok(conditionsLisibles('[{"code":"A","libelle":"Condition A"}]').length === 1,
  'la forme tableau est rendue telle quelle')
const condObjet = conditionsLisibles('{"engagement_avant":"2030-01-01","duree_vie_ans":17}')
ok(condObjet.length === 2, 'la forme objet donne une ligne par clé, au lieu de faire tomber la page')
ok(condObjet[0].libelle === 'engagement avant : 2030-01-01',
  `et chaque ligne est lisible telle quelle (obtenu : ${condObjet[0].libelle})`)
ok(conditionsLisibles('{"_note":"remarque interne","champ":"tertiaire"}').length === 1,
  "les notes internes du référentiel (clés « _ ») ne sont pas montrées comme des conditions")
ok(conditionsLisibles(null).length === 0 && conditionsLisibles('').length === 0,
  'une fiche sans condition donne une liste vide, pas une erreur')
ok(conditionsLisibles('{ ceci n\'est pas du JSON').length === 0,
  "un JSON abîmé donne une liste vide plutôt qu'une exception")

// Et la vérification qui compte : AUCUNE fiche chargée ne doit faire tomber la page.
for (const f of ref.fiches) {
  for (const v of f.versions) {
    const l = conditionsLisibles(typeof v.conditions === 'string' ? v.conditions : JSON.stringify(v.conditions ?? null))
    ok(Array.isArray(l), `${f.code} : ses conditions se rendent en liste`)
  }
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
