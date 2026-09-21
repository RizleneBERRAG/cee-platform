/**
 * Lance la reprise des données du logiciel précédent, et la vérifie.
 *
 * Usage :
 *   node reprise-pixel.mjs <cofrac.csv> <depot.csv> [bilan.csv]
 *
 * Par défaut l'import se fait sur une COPIE de la base (`db/cee-reprise.db`) : on regarde
 * le résultat avant de décider de le garder. Passer CEE_DB_PATH pour viser une autre base.
 *
 * La vérification qui suit l'import n'est pas décorative. Un import qui « passe » sans que
 * personne ne recompte les lignes et les totaux est un import dont on ne sait rien.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { mettreANiveau, cheminSchemaParDefaut } from './lib/migrations.js'
import { appliquerManuelles } from './lib/migrations-manuelles.js'
import { importerPixel, lireCsv, nombre, COLONNES_COFRAC } from './lib/import-pixel.js'

const [cofrac, depot, bilan] = process.argv.slice(2)
if (!cofrac || !depot) {
  console.log('Usage : node reprise-pixel.mjs <cofrac.csv> <depot.csv> [bilan.csv]')
  process.exit(2)
}
for (const f of [cofrac, depot, bilan].filter(Boolean)) {
  if (!fs.existsSync(f)) { console.log(`Fichier introuvable : ${f}`); process.exit(2) }
}

const CIBLE = process.env.CEE_DB_PATH || path.join(process.cwd(), 'db', 'cee-reprise.db')
const SOURCE = path.join(process.cwd(), 'db', 'cee.db')

if (!process.env.CEE_DB_PATH) {
  // On repart d'une base neuve, au schéma courant, sans les données de démonstration :
  // mélanger 120 dossiers inventés et 1 677 vrais rendrait tout contrôle ininterprétable.
  if (fs.existsSync(CIBLE)) fs.unlinkSync(CIBLE)
}

const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
const rs = mettreANiveau(db, cheminSchemaParDefaut())
if (rs.erreurs.length) { console.log('Schéma :'); for (const e of rs.erreurs) console.log('  -', e) }
appliquerManuelles(db)

const titre = (t) => console.log(`\n── ${t} ──`)
const fmt = (n) => new Intl.NumberFormat('fr-FR').format(Math.round(Number(n) || 0))

titre('Import')
const r = importerPixel(db, { cofrac, depot, bilan }, {})

console.log(`  lus            : ${r.lus.cofrac} opérations, ${r.lus.depot} dossiers, ${r.lus.bilan} lignes de bilan`)
console.log(`  dossiers       : ${r.dossiers.crees} créés, ${r.dossiers.ignores} déjà présents`)
console.log(`  opérations     : ${r.operations.creees} créées, ${r.operations.orphelines} orphelines`)
console.log(`  chantiers      : ${r.chantiers}`)
console.log(`  référentiels   : ${r.referentiels.fiches} fiches, ${r.referentiels.installateurs} installateurs, ` +
            `${r.referentiels.produits} produits, ${r.referentiels.delegataires} délégataires`)
console.log(`  bilan          : ${r.bilan.rattaches} rattachés, ${r.bilan.ambigus} clés ambiguës écartées`)
console.log(`  alignement     : HT + TVA = TTC sur ${r.alignement.coherentes}/${r.alignement.verifiees} lignes ` +
            `(${Math.round(r.alignement.taux * 100)} %)`)
console.log(`  durée          : ${r.ms} ms`)
for (const a of r.avertissements) console.log(`  ⚠ ${a}`)

// ═══════════════════════════════════════════════════════════
// Vérification : la base contient-elle vraiment ce que la source annonçait ?
// ═══════════════════════════════════════════════════════════
let ko = 0
const ok = (c, m) => { if (!c) ko++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const un = (s, p = []) => db.prepare(s).get(...p)

titre('Vérification contre la source')

const src = lireCsv(depot)
const srcOps = lireCsv(cofrac, COLONNES_COFRAC)

const nbDossiers = un('SELECT COUNT(*) AS n FROM dossier').n
ok(nbDossiers === r.dossiers.crees, `${nbDossiers} dossiers en base, autant que créés`)
ok(nbDossiers === src.lignes.length,
  `autant de dossiers que dans l'export source (${src.lignes.length})`)

const nbOps = un('SELECT COUNT(*) AS n FROM operation').n
ok(nbOps === srcOps.lignes.length - r.operations.orphelines,
  `${nbOps} opérations en base pour ${srcOps.lignes.length} lignes source (${r.operations.orphelines} orpheline(s))`)

// Cumac : la somme en base doit retomber sur la somme du fichier.
const cumacSource = srcOps.lignes.reduce((s, l) => s + (nombre(l.cumac) ?? 0), 0)
const cumacBase = un('SELECT COALESCE(SUM(volume_cumac), 0) AS s FROM operation').s
ok(Math.round(cumacSource) === Math.round(cumacBase),
  `volume cumac : ${fmt(cumacBase)} kWh en base, ${fmt(cumacSource)} dans la source`)

const cumacDossiers = un('SELECT COALESCE(SUM(volume_cumac), 0) AS s FROM dossier').s
ok(Math.round(cumacDossiers) === Math.round(cumacBase),
  'la projection sur les dossiers retombe sur la somme des opérations')

titre('Intégrité')
ok(un(`SELECT COUNT(*) AS n FROM operation o
       LEFT JOIN dossier d ON d.id = o.dossier_id WHERE d.id IS NULL`).n === 0,
  'aucune opération orpheline de dossier')
ok(un('SELECT COUNT(*) AS n FROM operation WHERE chantier_id IS NULL').n === 0,
  'aucune opération sans chantier')
ok(un(`SELECT COUNT(*) AS n FROM dossier d
       WHERE NOT EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = d.id)`).n === 0,
  'aucun dossier sans opération')
ok(un(`SELECT COUNT(*) AS n FROM (
        SELECT dossier_id FROM chantier WHERE principal = 1 GROUP BY dossier_id HAVING COUNT(*) > 1)`).n === 0,
  'aucun dossier à deux chantiers principaux')
ok(un('SELECT COUNT(*) AS n FROM dossier WHERE numero IS NULL OR numero = \'\'').n === 0,
  'tous les dossiers ont un numéro')
ok(un(`SELECT COUNT(*) AS n FROM (SELECT numero FROM dossier GROUP BY numero HAVING COUNT(*) > 1)`).n === 0,
  'aucun numéro de dossier en double')

titre('Ce qui reste vide, et c\'est voulu')
const sansDeleg = un('SELECT COUNT(*) AS n FROM dossier WHERE delegataire_id IS NULL').n
console.log(`  ${sansDeleg}/${nbDossiers} dossiers sans délégataire — clé de rattachement ambiguë au bilan`)
const sansMarge = un('SELECT COUNT(*) AS n FROM operation WHERE marge_nette IS NULL').n
console.log(`  ${sansMarge}/${nbOps} opérations sans marge — absente de tous les exports, elle viendra au recalcul`)
const sansPrime = un('SELECT COUNT(*) AS n FROM operation WHERE prime_beneficiaire IS NULL').n
console.log(`  ${sansPrime}/${nbOps} opérations sans prime bénéficiaire — non renseignée à la source`)

titre('Aperçu du référentiel reconstitué')
for (const [libelle, sql] of [
  ['fiches', 'SELECT code AS v, COUNT(*) AS n FROM operation o JOIN fiche f ON f.id = o.fiche_id GROUP BY code ORDER BY n DESC'],
  ['délégataires', "SELECT nom || COALESCE(' - ' || oblige, '') AS v, COUNT(*) AS n FROM dossier d JOIN delegataire g ON g.id = d.delegataire_id GROUP BY v ORDER BY n DESC"],
]) {
  const lignes = db.prepare(sql).all()
  console.log(`  ${libelle} (${lignes.length}) :`)
  for (const l of lignes.slice(0, 8)) console.log(`     ${String(l.n).padStart(5)}  ${l.v}`)
}

console.log(`\n${ko === 0 ? '✔ Tous les contrôles passent.' : `✘ ${ko} contrôle(s) en échec.`}`)
console.log(`Base : ${CIBLE}`)
process.exit(ko ? 1 : 0)
