/**
 * Mise à niveau automatique du schéma.
 *
 * Le problème qu'elle résout : `CREATE TABLE IF NOT EXISTS` crée les tables absentes mais
 * n'ajoute **aucune colonne** à une table qui existe déjà. Une base créée avant une livraison
 * continue donc de tourner avec l'ancien schéma, et la première requête sur une colonne neuve
 * échoue par « no such column ». La seule issue était de supprimer la base — donc de perdre
 * les dossiers. Inacceptable dès que les données comptent.
 *
 * Le principe retenu : **le fichier `db/schema.sql` fait foi**. On le lit, on en déduit les
 * colonnes que chaque table devrait avoir, on compare à ce que la base contient, et on ajoute
 * ce qui manque. Aucune liste de migrations à tenir à jour en parallèle : ajouter une colonne
 * au schéma suffit, elle sera appliquée aux bases existantes au démarrage suivant.
 *
 * Ce que cette mise à niveau ne fait **jamais**, volontairement :
 * - supprimer une colonne ou une table (une colonne disparue du schéma est laissée en place) ;
 * - changer le type d'une colonne existante ;
 * - toucher aux données.
 * Elle est donc additive et sans perte. Une transformation destructrice doit rester une
 * décision humaine, écrite à la main.
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * Le schéma sans ses commentaires, fins de ligne ramenées à « \n ».
 *
 * Les commentaires sont retirés sur le texte entier AVANT d'y chercher les tables : une
 * parenthèse ou un « CREATE TABLE » cité dans un commentaire faussait sinon le découpage.
 * Les chaînes ('CLASSIQUE', 'now') sont recopiées telles quelles — un « -- » à l'intérieur
 * n'ouvre pas de commentaire.
 *
 * Les fins de ligne Windows comptaient aussi : le retrait se faisait par `/--.*$/` ligne à
 * ligne, et `.` ne franchit pas le « \r » d'une fin CRLF. Un schéma réécrit en CRLF (par un
 * éditeur, ou par git avec core.autocrlf) gardait donc tous ses commentaires, qui étaient
 * lus comme des colonnes — « pour », « SARL », « et »… — et AJOUTÉS à la base au démarrage.
 */
export function sansCommentaires(sql) {
  const texte = sql.replace(/\r\n?/g, '\n')
  let out = ''
  let i = 0
  while (i < texte.length) {
    const c = texte[i]
    if (c === '-' && texte[i + 1] === '-') {
      const fin = texte.indexOf('\n', i)
      i = fin === -1 ? texte.length : fin
      continue
    }
    if (c === "'") {
      const debut = i
      i++
      while (i < texte.length && !(texte[i] === "'" && texte[i + 1] !== "'")) i += texte[i] === "'" ? 2 : 1
      i++
      out += texte.slice(debut, i)
      continue
    }
    out += c
    i++
  }
  return out
}

/** Découpe le schéma en { table: [{ nom, declaration }] }. */
export function colonnesDeclarees(schema) {
  const sql = sansCommentaires(schema)
  const tables = {}
  // On isole chaque CREATE TABLE … ( … ) ; en s'arrêtant à la parenthèse fermante de même niveau.
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi
  let m
  while ((m = re.exec(sql)) !== null) {
    const nomTable = m[1]
    let i = re.lastIndex
    let niveau = 1
    while (i < sql.length && niveau > 0) {
      if (sql[i] === '(') niveau++
      else if (sql[i] === ')') niveau--
      i++
    }
    const corps = sql.slice(re.lastIndex, i - 1)
    tables[nomTable] = decouperColonnes(corps)
  }
  return tables
}

/** Sépare les définitions de colonnes, en ignorant les virgules entre parenthèses. */
function decouperColonnes(corps) {
  // Les commentaires sont retirés AVANT le découpage : une virgule dans un commentaire
  // (« Compteur d'échecs consécutifs, pour ralentir… ») coupait la définition en deux,
  // inventait une colonne « pour » et faisait perdre la vraie colonne qui suivait.
  // Le même retrait que pour le schéma entier : il respecte les chaînes, là où un
  // `/--.*$/` ligne à ligne coupait un DEFAULT 'a -- b' en plein milieu.
  const propre = sansCommentaires(corps)

  const morceaux = []
  let courant = ''
  let niveau = 0
  let dansChaine = false
  for (const c of propre) {
    // Une virgule dans une chaîne (DEFAULT 'a, b') n'est pas un séparateur de colonnes.
    if (c === "'") dansChaine = !dansChaine
    if (!dansChaine) {
      if (c === '(') niveau++
      else if (c === ')') niveau--
    }
    if (c === ',' && niveau === 0 && !dansChaine) { morceaux.push(courant); courant = '' }
    else courant += c
  }
  morceaux.push(courant)

  const colonnes = []
  for (const brut of morceaux) {
    const ligne = brut.replace(/\s+/g, ' ').trim()
    if (!ligne) continue
    // Les contraintes de table (PRIMARY KEY (…), FOREIGN KEY …, UNIQUE (…), CHECK …) ne sont pas des colonnes.
    if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(ligne)) continue
    const nom = /^["`]?(\w+)["`]?/.exec(ligne)?.[1]
    if (!nom) continue
    colonnes.push({ nom, declaration: ligne })
  }
  return colonnes
}

/**
 * Rend une déclaration de colonne acceptable par `ALTER TABLE … ADD COLUMN`.
 *
 * SQLite refuse d'ajouter une colonne qui serait PRIMARY KEY ou UNIQUE, ou NOT NULL sans
 * valeur par défaut constante — parce qu'il ne saurait pas quoi mettre dans les lignes
 * déjà là. On retire donc ces contraintes pour la colonne ajoutée : elle sera simplement
 * nullable sur les lignes existantes, ce qui est le comportement voulu.
 */
export function pourAjout(declaration) {
  let d = declaration
    .replace(/\bPRIMARY\s+KEY\b/gi, '')
    .replace(/\bAUTOINCREMENT\b/gi, '')
    .replace(/\bUNIQUE\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  const aDefautConstant = /\bDEFAULT\s+(?!\()/i.test(d)
  if (!aDefautConstant) {
    // DEFAULT (expression) n'est pas constant pour SQLite : on le retire avec le NOT NULL.
    d = d.replace(/\bDEFAULT\s*\([^)]*\)/gi, '').replace(/\s+/g, ' ').trim()
    d = d.replace(/\bNOT\s+NULL\b/gi, '').replace(/\s+/g, ' ').trim()
  }
  return d
}

/**
 * Découpe un script SQL en instructions, en ignorant les points-virgules
 * situés dans une chaîne, un commentaire ou entre parenthèses.
 */
export function instructions(sql) {
  const out = []
  let courant = ''
  let i = 0
  let niveau = 0
  while (i < sql.length) {
    const c = sql[i]
    if (c === '-' && sql[i + 1] === '-') {
      const fin = sql.indexOf('\n', i)
      i = fin === -1 ? sql.length : fin
      continue
    }
    if (c === "'") {
      const debut = i
      i++
      while (i < sql.length && !(sql[i] === "'" && sql[i + 1] !== "'")) i += sql[i] === "'" ? 2 : 1
      i++
      courant += sql.slice(debut, i)
      continue
    }
    if (c === '(') niveau++
    else if (c === ')') niveau--
    if (c === ';' && niveau === 0) { out.push(courant); courant = ''; i++; continue }
    courant += c
    i++
  }
  out.push(courant)
  return out.map((s) => s.trim()).filter(Boolean)
}

/**
 * Applique le schéma à une base existante.
 *
 * L'ordre des trois phases n'est pas cosmétique. Exécuter le fichier d'un bloc échoue dès
 * qu'un index porte sur une colonne que l'ancienne base n'a pas encore : `exec` s'arrête à
 * la première erreur, et rien de ce qui suit n'est appliqué. On crée donc les tables,
 * **puis** les colonnes manquantes, **puis** seulement les index.
 *
 * @returns {{tablesCreees:string[], colonnesAjoutees:string[], erreurs:string[]}}
 */
export function mettreANiveau(db, cheminSchema) {
  const sql = fs.readFileSync(cheminSchema, 'utf8')
  const rapport = { tablesCreees: [], colonnesAjoutees: [], erreurs: [] }

  const tablesAvant = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  )

  const toutes = instructions(sql)
  const creationsTables = toutes.filter((s) => /^CREATE\s+TABLE\b/i.test(s))
  const reste = toutes.filter((s) => !/^CREATE\s+TABLE\b/i.test(s))

  // 1. Les tables absentes. Chaque instruction est isolée : l'échec de l'une
  //    ne doit pas empêcher les suivantes de s'appliquer.
  for (const s of creationsTables) {
    try { db.exec(s) } catch (e) { rapport.erreurs.push(`création — ${e.message}`) }
  }

  const tablesApres = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  rapport.tablesCreees = tablesApres.filter((t) => !tablesAvant.has(t) && !t.startsWith('sqlite_'))

  // 2. Les colonnes qui manquent aux tables déjà présentes.
  const attendu = colonnesDeclarees(sql)
  for (const [table, colonnes] of Object.entries(attendu)) {
    if (!tablesApres.includes(table)) continue
    let existantes
    try {
      existantes = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name))
    } catch (e) {
      rapport.erreurs.push(`${table} : lecture impossible — ${e.message}`)
      continue
    }
    for (const c of colonnes) {
      if (existantes.has(c.nom)) continue
      const decl = pourAjout(c.declaration)
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${decl}`)
        rapport.colonnesAjoutees.push(`${table}.${c.nom}`)
      } catch (e) {
        rapport.erreurs.push(`${table}.${c.nom} : ${e.message}`)
      }
    }
  }

  // 3. Les index et tout le reste, maintenant que les colonnes qu'ils visent existent.
  for (const s of reste) {
    try { db.exec(s) } catch (e) { rapport.erreurs.push(`index — ${e.message}`) }
  }

  // 4. Le contrôle qui manquait.
  //
  // Chaque instruction est exécutée dans son propre try/catch pour qu'un échec isolé
  // n'emporte pas les suivantes. L'effet de bord : un CREATE TABLE cassé — une colonne
  // déclarée deux fois, par exemple — échoue en silence, et l'application démarre sans
  // cette table. On ne s'en aperçoit qu'à la première requête, très loin de la cause.
  //
  // C'est arrivé. On vérifie donc explicitement que tout ce que le schéma déclare existe
  // réellement, et on le remonte comme une anomalie majeure, pas comme une ligne de plus
  // dans une liste d'avertissements.
  const presentes = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
  )
  rapport.tablesManquantes = Object.keys(attendu).filter((t) => !presentes.has(t))
  for (const t of rapport.tablesManquantes) {
    rapport.erreurs.push(
      `TABLE MANQUANTE : « ${t} » est déclarée dans le schéma mais absente de la base. ` +
      `Sa création a échoué — voir les erreurs « création » ci-dessus.`
    )
  }

  return rapport
}

export function cheminSchemaParDefaut() {
  return path.join(process.cwd(), 'db', 'schema.sql')
}
