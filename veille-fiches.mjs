/**
 * Contrôles de la veille réglementaire.
 *
 * La veille dépend d'une page publique qu'on ne maîtrise pas. On ne teste donc pas « est-ce
 * que le site répond » — ça n'apprend rien et ça casse dès que le réseau tousse — mais les
 * deux choses qui nous appartiennent : **savoir lire un catalogue**, et **ne jamais conclure
 * au calme quand on n'a pas pu regarder**.
 *
 * Le second point est le plus important. Une veille qui, faute de réseau, répond « aucune
 * anomalie » est pire que pas de veille : elle rassure. C'est exactement ce qui s'est passé
 * en juin 2026, sauf que personne ne regardait du tout.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const { lireCatalogue, comparerVersions, comparer, veiller } = await import('./lib/veille-fiches.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// Un extrait fidèle du catalogue réel, avec ses irrégularités de format.
const CATALOGUE = `
Catalogue 84ème arrêté   Intitulé de la fiche   N° de référence   Module
Rénovation d'éclairage extérieur   RES-EC-104   A14-1 ; A62-2 applicable au 01/01/2025 ; A77-3 applicable au 26/11/2025
Luminaire d'éclairage général à modules LED   BAT-EQ-127   A14-1, A28-2, A35-3 ; A40-4 applicable au 01/04/2022 ; A.71-5 du 01/08/2025 au 24/02/2026
Séchage solaire par insufflation   AGRI-EQ-110   A38-1 applicable au 31/07/2021
Isolation de combles ou de toitures   BAR-EN-101   A14-1 ; A55-2 applicable au 01/07/2024
`

// ═══════════════════════════════════════════════════════════
titre('Lecture du catalogue')

const cat = lireCatalogue(CATALOGUE)
ok(cat.size === 4, `quatre fiches lues (obtenu : ${cat.size})`)
ok(cat.has('RES-EC-104'), 'RES-EC-104 est reconnue')
ok(cat.get('RES-EC-104').versions.includes('A77-3'),
  `la version la plus récente de RES-EC-104 est relevée (${cat.get('RES-EC-104').versions.join(', ')})`)
ok(cat.get('BAT-EQ-127').versions.includes('A71-5'),
  'la forme « A.71-5 » avec un point est comprise comme A71-5')
ok(!cat.has('AGRI-TH-117'), "AGRI-TH-117, absente du catalogue, n'est pas inventée")
ok(lireCatalogue('').size === 0, 'un texte vide ne produit aucune fiche')
ok(lireCatalogue('rien à voir ici').size === 0, "un texte sans code ne produit aucune fiche")

// ═══════════════════════════════════════════════════════════
titre('Comparaison de versions')

ok(comparerVersions('A73-3', 'A65-2') > 0, 'A73-3 est plus récente que A65-2')
ok(comparerVersions('A65-2', 'A73-3') < 0, 'et réciproquement')
ok(comparerVersions('A65-3', 'A65-2') > 0, 'à numéro d\'arrêté égal, la révision départage')
ok(comparerVersions('A65-2', 'A65-2') === 0, 'deux versions identiques sont à égalité')
ok(comparerVersions('A65-2', 'inconnue') === 0, 'une version illisible ne prétend pas être plus récente')
// Le piège : comparer des nombres comme des chaînes ferait de A9-1 la plus récente.
ok(comparerVersions('A65-2', 'A9-1') > 0, 'A65 est plus récente que A9 — comparaison numérique, pas alphabétique')

// ═══════════════════════════════════════════════════════════
titre('Détection des écarts')

const CIBLE = path.join(os.tmpdir(), 'veille-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

const uid = () => crypto.randomUUID()
const run = (s, p = []) => db.prepare(s).run(...p)
function poser(code, version, motifFin = null) {
  const fId = uid()
  run('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
    [fId, code, 'X', 'Y', code])
  run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, motif_fin,
       formule_type, unite_variable, coefficients, conditions) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [uid(), fId, version, '2025-01-01', motifFin ? '2026-06-03' : null, motifFin,
     'FORFAIT_PAR_UNITE', 'U', '{}', '{}'])
  return fId
}

poser('RES-EC-104', 'A62-2')              // une version de retard
poser('BAT-EQ-127', 'A71-5')              // à jour
poser('AGRI-TH-117', 'A65-2')             // disparue du catalogue, pas encore marquée
poser('AGRI-EQ-110', 'A38-1')             // à jour

const { ecarts, examinees } = comparer(db, cat)
ok(examinees === 4, `quatre de nos fiches examinées (obtenu : ${examinees})`)

const disparue = ecarts.find((e) => e.code === 'AGRI-TH-117')
ok(disparue?.type === 'ABSENTE_DU_CATALOGUE',
  'AGRI-TH-117, absente du catalogue, est signalée — le cas de juin 2026')
ok(disparue?.niveau === 'ALERTE', 'et en ALERTE, pas en simple avertissement')

const enRetard = ecarts.find((e) => e.code === 'RES-EC-104')
ok(enRetard?.type === 'VERSION_PLUS_RECENTE',
  'RES-EC-104 est signalée : le catalogue annonce A77-3, nous portons A62-2')
ok(/A77-3/.test(enRetard?.message || ''), 'le message nomme la version attendue')

ok(!ecarts.find((e) => e.code === 'BAT-EQ-127'), "une fiche à jour n'est pas signalée")
ok(!ecarts.find((e) => e.code === 'AGRI-EQ-110'), "une autre fiche à jour non plus")

// Une fiche que nous savons DÉJÀ abrogée ne doit plus crier à chaque passage.
const db2 = new DatabaseSync(path.join(os.tmpdir(), 'veille-test2.db'))
db2.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db2, cheminSchemaParDefaut())
const run2 = (s, p = []) => db2.prepare(s).run(...p)
const f2 = uid()
run2('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
  [f2, 'AGRI-TH-117', 'X', 'Y', 'abrogée'])
run2(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, motif_fin,
     formule_type, unite_variable, coefficients, conditions) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [uid(), f2, 'A65-2', '2025-01-01', '2026-06-03',
   'Fiche abrogée par arrêté du 29 mai 2026.', 'FORFAIT_PAR_UNITE', 'U', '{}', '{}'])
ok(comparer(db2, cat).ecarts.length === 0,
  'une fiche déjà portée comme abrogée ne rejaillit pas à chaque veille')

// ═══════════════════════════════════════════════════════════
titre("Le refus de conclure — le contrôle qui compte le plus")

const horsLigne = await veiller(db, async () => { throw new Error('réseau injoignable') }, ['http://x'])
ok(horsLigne.accessible === false, "sans réseau, la veille se déclare inaccessible")
ok(horsLigne.ecarts.length === 0, 'et ne renvoie aucun écart')
ok(/injoignable/.test(horsLigne.raison), 'en disant pourquoi')

const pageVide = await veiller(db, async () => 'une page sans le moindre code de fiche', ['http://x'])
ok(pageVide.accessible === false,
  "une page récupérée mais illisible n'est PAS traitée comme « aucune anomalie »")
ok(/format/.test(pageVide.raison), 'et la raison le dit : le format a probablement changé')

// Et quand tout va bien, elle conclut.
const enLigne = await veiller(db, async () => CATALOGUE, ['http://x'])
ok(enLigne.accessible === true, 'avec un catalogue lisible, la veille conclut')
ok(enLigne.ecarts.length === 2, `et retrouve les deux écarts (obtenu : ${enLigne.ecarts.length})`)

// Une source qui échoue ne doit pas empêcher la suivante d'être essayée.
let appels = 0
const repli = await veiller(db, async (u) => {
  appels++
  if (u === 'http://ko') throw new Error('403')
  return CATALOGUE
}, ['http://ko', 'http://ok'])
ok(repli.accessible === true && appels === 2,
  'une première source en échec bascule sur la suivante')

fs.rmSync(CIBLE, { force: true })
fs.rmSync(path.join(os.tmpdir(), 'veille-test2.db'), { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
