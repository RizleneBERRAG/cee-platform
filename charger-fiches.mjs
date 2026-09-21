/**
 * Charge le référentiel officiel des fiches d'opérations dans la base.
 *
 * Usage :
 *   node charger-fiches.mjs [--appliquer]
 *
 * Sans `--appliquer`, la commande n'écrit RIEN : elle affiche ce qu'elle ferait. Un
 * référentiel décide de la valeur de chaque dossier ; on regarde avant de signer.
 *
 * ── Ce que ce chargement ne fait PAS, et c'est essentiel ──
 *
 * Il ne recalcule aucun dossier. Les 3 304 opérations reprises portent les volumes et les
 * primes de l'ancien logiciel, figés. Les forfaits chargés ici sont ceux des versions EN
 * VIGUEUR : RES-EC-104 vaut 4 000 kWh cumac par luminaire aujourd'hui, mais un devis de
 * septembre 2024 en affiche 9 300 — la fiche a changé entre-temps. Appliquer les valeurs
 * d'aujourd'hui à un dossier d'hier réécrirait des montants déjà facturés avec des chiffres
 * faux. La règle de gel l'interdit, ce script n'y touche pas, et les versions portent leurs
 * dates d'effet pour que le calcul choisisse la bonne.
 *
 * ── Ce qu'il fait ──
 *
 * Il complète les coquilles vides créées par la reprise : libellé officiel, secteur, unité,
 * forfaits, conditions d'éligibilité, référence d'arrêté, date d'effet et, s'il y a lieu,
 * date de fin et motif. Rejouable : relancer met à jour sans dupliquer.
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const APPLIQUER = process.argv.includes('--appliquer')
const CIBLE = process.env.CEE_DB_PATH || 'db/cee.db'
const SOURCE = process.env.CEE_REFERENTIEL || 'db/referentiel-fiches.json'

const ref = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const db = new DatabaseSync(CIBLE)
const uid = () => crypto.randomUUID()
const un = (s, p = []) => db.prepare(s).get(...p)
const run = (s, p = []) => db.prepare(s).run(...p)

console.log(`── Référentiel des fiches ──`)
console.log(`  source : ${SOURCE}`)
console.log(`  base   : ${CIBLE}`)
console.log(APPLIQUER ? '  mode   : ÉCRITURE\n' : '  mode   : simulation (ajoutez --appliquer pour écrire)\n')

const plan = []
for (const f of ref.fiches) {
  const existante = un('SELECT id, libelle FROM fiche WHERE code = ?', [f.code])
  const nbOps = existante
    ? un('SELECT COUNT(*) AS n FROM operation WHERE fiche_id = ?', [existante.id]).n
    : 0
  plan.push({ f, existante, nbOps })

  console.log(`  ${f.code}  — ${f.libelle}`)
  console.log(`      ${existante ? `existe (${nbOps} opération(s) rattachées)` : 'à créer'}`)
  if (existante && /à compléter/i.test(existante.libelle)) {
    console.log(`      libellé actuel : « ${existante.libelle} » → remplacé`)
  }
  for (const v of f.versions) {
    const incomplet = JSON.stringify(v.coefficients).includes('_a_completer')
    console.log(`      version ${v.version} du ${v.date_effet}${v.date_fin ? ` au ${v.date_fin}` : ''}` +
      `${incomplet ? '   ⚠ forfait non relevé, reste à compléter' : ''}`)
    if (v.motif_fin) console.log(`         motif de fin : ${v.motif_fin.slice(0, 100)}…`)
  }
}

if (!APPLIQUER) {
  console.log('\n  Rien n\'a été écrit. Relancez avec --appliquer pour enregistrer.')
  process.exit(0)
}

db.exec('BEGIN')
let creees = 0, majFiches = 0, majVersions = 0, creeesVersions = 0
try {
  for (const { f, existante } of plan) {
    let ficheId
    if (existante) {
      run('UPDATE fiche SET libelle = ?, secteur = ?, domaine = ? WHERE id = ?',
        [f.libelle, f.secteur, f.domaine, existante.id])
      ficheId = existante.id
      majFiches++
    } else {
      ficheId = uid()
      run('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
        [ficheId, f.code, f.secteur, f.domaine, f.libelle])
      creees++
    }

    for (const v of f.versions) {
      const dejaV = un('SELECT id FROM fiche_version WHERE fiche_id = ? AND version = ?', [ficheId, v.version])
      const valeurs = [
        v.version, v.date_effet, v.date_fin ?? null, v.arrete_reference ?? null,
        v.motif_fin ?? null, v.formule_type, v.unite_variable ?? null,
        JSON.stringify(v.coefficients), JSON.stringify(v.conditions),
      ]
      if (dejaV) {
        run(`UPDATE fiche_version SET version=?, date_effet=?, date_fin=?, arrete_reference=?,
             motif_fin=?, formule_type=?, unite_variable=?, coefficients=?, conditions=?
             WHERE id = ?`, [...valeurs, dejaV.id])
        majVersions++
      } else {
        // La reprise a créé une version « par défaut » sans numéro officiel : on la
        // récupère plutôt que d'en ajouter une seconde à côté, sinon les opérations
        // existantes pointeraient vers une version orpheline.
        const orpheline = un(`SELECT id FROM fiche_version WHERE fiche_id = ?
                              AND (coefficients = '[]' OR coefficients IS NULL OR coefficients = '')
                              ORDER BY date_effet LIMIT 1`, [ficheId])
        if (orpheline) {
          run(`UPDATE fiche_version SET version=?, date_effet=?, date_fin=?, arrete_reference=?,
               motif_fin=?, formule_type=?, unite_variable=?, coefficients=?, conditions=?
               WHERE id = ?`, [...valeurs, orpheline.id])
          majVersions++
        } else {
          run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin,
               arrete_reference, motif_fin, formule_type, unite_variable, coefficients, conditions)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [uid(), ficheId, ...valeurs])
          creeesVersions++
        }
      }
    }
  }
  db.exec('COMMIT')
} catch (e) {
  try { db.exec('ROLLBACK') } catch { /* transaction déjà refermée */ }
  console.log(`\n  ÉCHEC — base inchangée : ${e.message}`)
  process.exit(1)
}

console.log(`\n── Écrit ──`)
console.log(`  fiches créées      : ${creees}`)
console.log(`  fiches mises à jour: ${majFiches}`)
console.log(`  versions reprises  : ${majVersions}`)
console.log(`  versions ajoutées  : ${creeesVersions}`)

// ── Vérifications ──
let ko = 0
const ok = (c, m) => { if (!c) ko++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
console.log('\n── Vérification ──')

ok(un("SELECT COUNT(*) AS n FROM fiche WHERE libelle LIKE '%à compléter%'").n === 0,
  'plus aucune fiche au libellé « à compléter »')
ok(un("SELECT COUNT(*) AS n FROM operation o LEFT JOIN fiche_version fv ON fv.id = o.fiche_version_id WHERE fv.id IS NULL").n === 0,
  'chaque opération pointe toujours vers une version existante')
ok(un("SELECT COUNT(*) AS n FROM fiche_version WHERE coefficients = '[]'").n <= 1,
  'les versions portent leurs coefficients (hors celles restant à compléter)')

const abrogees = db.prepare(`SELECT f.code, fv.date_fin,
    (SELECT COUNT(*) FROM operation o WHERE o.fiche_id = f.id) AS ops
  FROM fiche f JOIN fiche_version fv ON fv.fiche_id = f.id
  WHERE fv.motif_fin LIKE '%abrog%'`).all()
if (abrogees.length) {
  console.log('\n── Fiches abrogées portées en base ──')
  for (const a of abrogees) {
    console.log(`  ${a.code} : fin au ${a.date_fin} — ${a.ops} opération(s) concernées`)
  }
}

const incomplet = db.prepare(`SELECT f.code FROM fiche f JOIN fiche_version fv ON fv.fiche_id = f.id
                              WHERE fv.coefficients LIKE '%_a_completer%'`).all()
if (incomplet.length) {
  console.log(`\n  Reste à compléter : ${incomplet.map((r) => r.code).join(', ')} (forfait non relevé).`)
}

console.log(`\n${ko === 0 ? '✔ Tous les contrôles passent.' : `✘ ${ko} contrôle(s) en échec.`}`)
process.exit(ko ? 1 : 0)
