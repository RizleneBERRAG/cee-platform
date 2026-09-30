/**
 * La mise à niveau du schéma ne doit dépendre ni des fins de ligne, ni des commentaires.
 *
 * Constaté le 30/09/2026 : `db/schema.sql` réécrit en CRLF — ce que fait git sous Windows
 * avec core.autocrlf, ou n'importe quel éditeur — gardait ses commentaires au découpage.
 * Chaque phrase de commentaire devenait une « colonne » (« pour », « SARL », « et »…) et la
 * mise à niveau l'AJOUTAIT à la base au démarrage, pendant que de vraies colonnes étaient
 * perdues dans le même morceau. Une base de production abîmée par un simple `git checkout`.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, colonnesDeclarees, cheminSchemaParDefaut } = await import('./lib/migrations.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

const lf = fs.readFileSync(cheminSchemaParDefaut(), 'utf8').replace(/\r\n/g, '\n')
const crlf = lf.replace(/\n/g, '\r\n')

titre('Découpage')
const attenduLf = colonnesDeclarees(lf)
ok(JSON.stringify(attenduLf) === JSON.stringify(colonnesDeclarees(crlf)), 'le schéma en CRLF donne exactement les mêmes colonnes qu\'en LF')

// Un nom de colonne réel est en minuscules : les faux trouvés le 30/09 étaient « SARL »,
// « H1_IDF », « 5 », ou des mots français. On vérifie la forme, puis la présence de chaque
// nom au début d'une ligne de déclaration dans le texte du schéma.
const suspects = []
for (const [t, cols] of Object.entries(attenduLf)) {
  for (const c of cols) {
    const declare = new RegExp(`^\\s*${c.nom}\\s+[A-Z]`, 'm').test(lf)
    if (!/^[a-z][a-z0-9_]*$/.test(c.nom) || !declare) suspects.push(`${t}.${c.nom}`)
  }
}
ok(suspects.length === 0, suspects.length ? `colonnes suspectes : ${suspects.join(', ')}` : 'aucune colonne tirée d\'un commentaire')

const piege = `
-- Un commentaire qui cite CREATE TABLE fantome (x TEXT) et ouvre une parenthèse (
CREATE TABLE IF NOT EXISTS essai (
  id TEXT PRIMARY KEY, -- l'identifiant, (unique)
  -- une ligne de commentaire, avec des virgules, et un « ) » isolé )
  libelle TEXT NOT NULL DEFAULT 'a -- pas un commentaire',
  valeur REAL
);`
for (const [nom, sql] of [['LF', piege], ['CRLF', piege.replace(/\n/g, '\r\n')]]) {
  const t = colonnesDeclarees(sql)
  ok(Object.keys(t).join() === 'essai' && t.essai.map((c) => c.nom).join() === 'id,libelle,valeur',
    `${nom} : parenthèses, virgules et « CREATE TABLE » en commentaire ne faussent rien`)
  ok(t.essai?.[1]?.declaration.includes("'a -- pas un commentaire'"), `${nom} : un « -- » dans une chaîne reste dans la chaîne`)
}

titre('Mise à niveau')
const CIBLE = path.join(os.tmpdir(), `schema-crlf-${process.pid}.db`)
fs.rmSync(CIBLE, { force: true })
const tmpLf = path.join(os.tmpdir(), `schema-lf-${process.pid}.sql`)
const tmpCrlf = path.join(os.tmpdir(), `schema-crlf-${process.pid}.sql`)
fs.writeFileSync(tmpLf, lf)
fs.writeFileSync(tmpCrlf, crlf)
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
const r1 = mettreANiveau(db, tmpLf)
ok(r1.erreurs.length === 0, r1.erreurs.length ? `schéma LF : ${r1.erreurs.slice(0, 3).join(' | ')}` : 'base neuve montée depuis le schéma LF, sans erreur')
const r2 = mettreANiveau(db, tmpCrlf)
ok(r2.colonnesAjoutees.length === 0 && r2.tablesCreees.length === 0,
  r2.colonnesAjoutees.length ? `le CRLF a ajouté : ${r2.colonnesAjoutees.join(', ')}` : 'repasser le schéma en CRLF n\'ajoute rien')
ok(r2.erreurs.length === 0, r2.erreurs.length ? `schéma CRLF : ${r2.erreurs.slice(0, 3).join(' | ')}` : 'et ne lève aucune erreur')
db.close()
for (const f of [CIBLE, tmpLf, tmpCrlf]) fs.rmSync(f, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
