import { db, get } from '/home/claude/cee-platform/lib/db.js'
import { colonnesDeclarees } from '/home/claude/cee-platform/lib/migrations.js'
import fs from 'node:fs'

let ko = 0
const ok = (c, m) => { if (!c) ko++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const d = db()

titre('Intégrité des données')
ok(get('SELECT COUNT(*) AS n FROM dossier').n === 500, 'les 500 dossiers sont conservés')
ok(get('SELECT COUNT(*) AS n FROM beneficiaire').n === 500, 'les 500 bénéficiaires aussi')
ok(Math.round(get('SELECT SUM(marge_nette) AS s FROM dossier').s) === 420600, 'la marge totale est inchangée (420 600 €)')
ok(get('SELECT COUNT(*) AS n FROM utilisateur WHERE email = ?', ['vieux@exemple.fr']).n === 1, 'le compte existant est conservé')
ok(get('SELECT numero FROM dossier ORDER BY numero LIMIT 1').numero === 'D-2025-00001', 'les numéros de dossier sont intacts')

titre('Schéma complet')
const attendu = colonnesDeclarees(fs.readFileSync('/home/claude/cee-platform/db/schema.sql', 'utf8'))
const manquantes = []
for (const [t, cols] of Object.entries(attendu)) {
  const present = new Set(d.prepare(`PRAGMA table_info(${t})`).all().map((r) => r.name))
  for (const c of cols) if (!present.has(c.nom)) manquantes.push(`${t}.${c.nom}`)
}
ok(manquantes.length === 0, manquantes.length ? `manquent encore : ${manquantes.join(', ')}` : `toutes les colonnes déclarées sont présentes (${Object.keys(attendu).length} tables)`)

// Une table déclarée mais absente est le pire cas : chaque instruction du schéma étant
// exécutée isolément, un CREATE TABLE cassé échoue en silence et l'application démarre
// sans la table. C'est arrivé une fois — ce contrôle est là pour que ça ne recommence pas.
const tablesPresentes = new Set(
  d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
)
const tablesAbsentes = Object.keys(attendu).filter((t) => !tablesPresentes.has(t))
ok(tablesAbsentes.length === 0,
  tablesAbsentes.length
    ? `table(s) déclarée(s) mais absente(s) : ${tablesAbsentes.join(', ')}`
    : 'toutes les tables déclarées existent réellement')

const colUtil = d.prepare('PRAGMA table_info(utilisateur)').all().map((r) => r.name)
ok(colUtil.includes('echecs'), 'la colonne « echecs » est bien là')
ok(!colUtil.includes('pour'), 'aucune colonne fantôme issue d\'un commentaire')

titre('Les requêtes qui plantaient')
const requetes = [
  ['écran de connexion', 'SELECT COUNT(*) AS n FROM utilisateur WHERE mot_de_passe IS NOT NULL AND actif = 1'],
  ['sessions', 'SELECT COUNT(*) AS n FROM session'],
  ['recherche de dossiers', 'SELECT COUNT(*) AS n FROM dossier d LEFT JOIN statut st ON st.id = d.statut_dossier_id LEFT JOIN lot lt ON lt.id = d.lot_id LEFT JOIN deal dl ON dl.id = d.deal_id'],
  ['rapports d\'import', 'SELECT COUNT(*) AS n FROM import_lot'],
  ['rôles et permissions', 'SELECT COUNT(*) AS n FROM role WHERE code IS NOT NULL'],
  ['pièces et liasses', 'SELECT COUNT(*) AS n FROM liasse WHERE actif = 1'],
  ['journal', 'SELECT COUNT(*) AS n FROM journal_champ'],
]
for (const [libelle, sql] of requetes) {
  try { get(sql); ok(true, libelle) } catch (e) { ok(false, `${libelle} : ${e.message}`) }
}

titre('Écriture après mise à niveau')
try {
  const id = crypto.randomUUID()
  d.prepare('INSERT INTO utilisateur (id, email, nom, prenom, mot_de_passe) VALUES (?,?,?,?,?)')
    .run(id, 'test-migration@exemple.fr', 'Test', 'Migration', 'scrypt$x')
  ok(get('SELECT mot_de_passe AS m FROM utilisateur WHERE id = ?', [id]).m === 'scrypt$x', 'on peut écrire dans une colonne ajoutée')
  d.prepare('DELETE FROM utilisateur WHERE id = ?').run(id)
} catch (e) { ok(false, 'écriture : ' + e.message) }

console.log(`\n${ko === 0 ? '✔ Tous les contrôles passent.' : `✘ ${ko} contrôle(s) en échec.`}`)
process.exit(ko ? 1 : 0)
