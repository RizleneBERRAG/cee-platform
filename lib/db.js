import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { mettreANiveau, cheminSchemaParDefaut } from './migrations.js'
import { appliquerManuelles } from './migrations-manuelles.js'

const DB_PATH = process.env.CEE_DB_PATH || path.join(process.cwd(), 'db', 'cee.db')

let _db = null

export function db() {
  if (_db) return _db
  const dir = path.dirname(DB_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  _db = new DatabaseSync(DB_PATH)

  // Les clés étrangères sont désactivées le temps de la mise à niveau : ajouter une colonne
  // qui référence une autre table est refusé quand elles sont actives.
  _db.exec('PRAGMA foreign_keys = OFF')

  // Le schéma est aligné à l'ouverture, avant la première requête.
  //
  // Sans cela, une base créée avant une livraison tourne avec l'ancien schéma et la première
  // requête sur une colonne neuve échoue par « no such column » — l'utilisateur voit une page
  // blanche et n'a d'autre issue que de supprimer sa base. La mise à niveau est additive :
  // elle ne supprime rien et ne touche pas aux données.
  try {
    const r = mettreANiveau(_db, cheminSchemaParDefaut())
    if (r.tablesCreees.length || r.colonnesAjoutees.length) {
      console.log('[schéma] mise à niveau appliquée :',
        [...r.tablesCreees.map((t) => `table ${t}`), ...r.colonnesAjoutees].join(', '))
    }
    for (const e of r.erreurs) console.warn('[schéma] non appliqué —', e)
    // Une table déclarée mais absente n'est pas un avertissement : l'application ne peut
    // pas fonctionner. On le dit fort, au démarrage, plutôt que de laisser la première
    // requête échouer par « no such table » trois écrans plus loin.
    if (r.tablesManquantes?.length) {
      console.error(
        '[schéma] ERREUR GRAVE — table(s) absente(s) après mise à niveau :',
        r.tablesManquantes.join(', '),
        '\n          L\'application ne fonctionnera pas correctement. Corrigez db/schema.sql.'
      )
    }
  } catch (e) {
    // Une base illisible doit le dire clairement plutôt que de laisser échouer la requête suivante.
    console.error('[schéma] mise à niveau impossible :', e.message)
  }

  // Puis les transformations structurelles, qui supposent les colonnes déjà en place.
  // Elles sont nommées, enregistrées et ne se rejouent pas : voir migrations-manuelles.js.
  try {
    const m = appliquerManuelles(_db)
    if (m.appliquees.length) console.log('[schéma] étapes structurelles :', m.appliquees.join(', '))
    for (const e of m.erreurs) console.warn('[schéma] étape non appliquée —', e)
  } catch (e) {
    console.error('[schéma] étapes structurelles impossibles :', e.message)
  }

  _db.exec('PRAGMA foreign_keys = ON')

  // ── Attendre son tour plutôt que d'abandonner ──
  //
  // Par défaut, SQLite renonce IMMÉDIATEMENT quand le fichier est occupé par une autre
  // connexion, et l'écran affiche « database is locked » — une erreur 500 pour un conflit
  // qui dure quelques millisecondes. Le cas se produit dès qu'un second programme touche la
  // base pendant que l'application tourne : une sauvegarde, un script de chargement, un
  // outil de vérification. Cinq secondes d'attente suffisent à absorber ces croisements.
  _db.exec('PRAGMA busy_timeout = 5000')

  // ── Pourquoi PAS le mode WAL ──
  //
  // Le mode WAL supprimerait l'essentiel de ces conflits au lieu de les faire patienter.
  // Il a été essayé, et retiré. La raison tient en une phrase : en WAL, une partie des
  // données validées vit dans un fichier `-wal` séparé, et `db/cee.db` seul ne suffit plus.
  //
  // Or ici on copie ce fichier tout le temps — sauvegardes, archives, base de travail des
  // contrôles, copie avant mise à jour. Chacune de ces copies devenait silencieusement
  // incomplète : la table portait des lignes que l'index ignorait, une requête en rendait
  // trois et la suivante six. Vérifié : `PRAGMA integrity_check` a fini par signaler un
  // index faux sur la base de travail.
  //
  // Une base qu'on ne peut plus sauvegarder en copiant un fichier, sur une application
  // installée sur un poste, c'est un prix trop élevé pour quelques millisecondes d'attente.
  return _db
}

/// node:sqlite renvoie des objets à prototype nul : React refuse de les sérialiser
/// vers un composant client. On les remet à plat une fois pour toutes ici.
const plat = (row) => (row == null ? row : { ...row })

export function all(sql, params = []) {
  return db().prepare(sql).all(...params).map(plat)
}

export function get(sql, params = []) {
  return plat(db().prepare(sql).get(...params))
}

export function run(sql, params = []) {
  return db().prepare(sql).run(...params)
}

export function initSchema() {
  const sql = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8')
  db().exec(sql)
}

/// Journal au niveau du champ — appelé à chaque écriture sur une entité suivie.
export function journaliser({ entite, entiteId, dossierId = null, champ, ancienne, nouvelle, utilisateurId = null }) {
  if (String(ancienne ?? '') === String(nouvelle ?? '')) return
  run(
    `INSERT INTO journal_champ (id, entite, entite_id, dossier_id, champ, ancienne, nouvelle, utilisateur_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), entite, entiteId, dossierId, champ,
     ancienne == null ? null : String(ancienne),
     nouvelle == null ? null : String(nouvelle), utilisateurId]
  )
}
