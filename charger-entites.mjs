/**
 * Charge les sociétés sous lesquelles les devis peuvent être émis.
 *
 * Usage :
 *   node charger-entites.mjs [--appliquer]
 *
 * Sans `--appliquer`, rien n'est écrit : la commande affiche ce qu'elle ferait et ce qui
 * empêcherait chaque société d'émettre un devis régulier.
 *
 * ── Ce qu'il ne fait pas ──
 *
 * Il ne complète aucun champ manquant. Un SIRET, un capital ou un numéro de police
 * d'assurance ne se devinent pas : ce qui manque reste vide et la société est signalée
 * comme inapte à émettre, jusqu'à ce que le gérant fournisse la valeur. Une mention légale
 * inventée sur un document signé par un client est une faute qu'aucun correctif ultérieur
 * ne rattrape.
 *
 * Rejouable : une société est reconnue par son `code`.
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { controlerEntite } from './lib/devis.js'

const APPLIQUER = process.argv.includes('--appliquer')
const CIBLE = process.env.CEE_DB_PATH || 'db/cee.db'
const SOURCE = process.env.CEE_ENTITES || 'db/entites.json'

const ref = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const db = new DatabaseSync(CIBLE)
const uid = () => crypto.randomUUID()
const un = (s, p = []) => db.prepare(s).get(...p)
const run = (s, p = []) => db.prepare(s).run(...p)

const CHAMPS = ['code', 'raison_sociale', 'forme_juridique', 'capital', 'siren', 'siret', 'naf',
  'rcs_ville', 'rcs_numero', 'tva', 'adresse', 'code_postal', 'ville', 'telephone', 'email',
  'site_web', 'representant_nom', 'representant_qualite', 'logo', 'assurance_nom',
  'assurance_police', 'assurance_couverture', 'conditions_reglement', 'validite_jours',
  'taux_tva_defaut', 'devis_prefixe', 'facture_prefixe', 'taux_penalites',
  'indemnite_recouvrement', 'delai_paiement_jours', 'par_defaut']

console.log('── Sociétés émettrices de devis ──')
console.log(`  source : ${SOURCE}`)
console.log(`  base   : ${CIBLE}`)
console.log(APPLIQUER ? '  mode   : ÉCRITURE\n' : '  mode   : simulation (ajoutez --appliquer pour écrire)\n')

let bloquantsTotal = 0
for (const x of ref.entites) {
  const existante = un('SELECT id FROM entite_emettrice WHERE code = ?', [x.code])
  const anomalies = controlerEntite(x, [])
  const bloquants = anomalies.filter((a) => a.niveau === 'BLOQUANT')
  bloquantsTotal += bloquants.length

  console.log(`  ${x.raison_sociale}  [${x.code}]`)
  console.log(`      ${existante ? 'existe → mise à jour' : 'à créer'}${x.par_defaut ? '   · société par défaut' : ''}`)
  console.log(`      ${[x.adresse, x.code_postal, x.ville].filter(Boolean).join(' ') || 'adresse non renseignée'}`)
  console.log(`      SIRET ${x.siret || '—'} · TVA ${x.tva || '—'}`)
  for (const a of anomalies) console.log(`      ${a.niveau === 'BLOQUANT' ? '✘' : '?'} ${a.message}`)
  console.log('')
}

if (ref._lisezMoi) {
  console.log('  ── À lire ──')
  for (const l of ref._lisezMoi) console.log(`  ${l}`)
  console.log('')
}

console.log(`  ${ref.entites.length} société(s), ${bloquantsTotal} point(s) bloquant(s) pour l'émission.`)
console.log('  Charger une société incomplète est volontaire : elle existe, elle n\'émet pas.')

if (!APPLIQUER) {
  console.log('\n  Rien n\'a été écrit. Relancez avec --appliquer.')
  process.exit(0)
}

db.exec('BEGIN')
try {
  for (const x of ref.entites) {
    // L'installateur RGE est une ligne à part : c'est lui qui porte les certifications et
    // leurs dates. On le rattache s'il existe déjà, on le crée sinon — sans inventer de
    // certification, qui elle ne se devine pas.
    let installateurId = null
    if (x.installateur?.siret) {
      const i = un('SELECT id FROM installateur_rge WHERE siret = ?', [x.installateur.siret])
      if (i) installateurId = i.id
      else {
        installateurId = uid()
        run('INSERT INTO installateur_rge (id, raison_sociale, siret, actif) VALUES (?,?,?,1)',
          [installateurId, x.installateur.raison_sociale, x.installateur.siret])
      }
    }

    const valeurs = Object.fromEntries(CHAMPS.map((c) => [c, x[c] ?? null]))
    valeurs.validite_jours = x.validite_jours ?? 30
    valeurs.par_defaut = x.par_defaut ? 1 : 0

    if (existeDeja(x.code)) {
      // Le compteur de devis n'est JAMAIS réécrit : il porte une suite de numéros déjà
      // émis. Le remettre à zéro créerait des doublons dans une série que le fisc peut
      // demander à voir.
      run(`UPDATE entite_emettrice SET ${CHAMPS.map((c) => `${c} = ?`).join(', ')}, installateur_id = ?
           WHERE code = ?`, [...CHAMPS.map((c) => valeurs[c]), installateurId, x.code])
    } else {
      run(`INSERT INTO entite_emettrice (id, ${CHAMPS.join(', ')}, installateur_id)
           VALUES (${['?', ...CHAMPS.map(() => '?'), '?'].join(', ')})`,
        [uid(), ...CHAMPS.map((c) => valeurs[c]), installateurId])
    }
  }

  // Une seule société par défaut : deux feraient dépendre le choix de l'ordre de lecture.
  const parDefaut = un('SELECT id FROM entite_emettrice WHERE par_defaut = 1 ORDER BY code LIMIT 1')
  if (parDefaut) run('UPDATE entite_emettrice SET par_defaut = 0 WHERE id <> ?', [parDefaut.id])

  db.exec('COMMIT')
} catch (err) {
  db.exec('ROLLBACK')
  console.error(`\n  ✘ Rien n'a été écrit : ${err.message}`)
  process.exit(1)
}

function existeDeja(code) {
  return !!un('SELECT id FROM entite_emettrice WHERE code = ?', [code])
}

const n = un('SELECT COUNT(*) AS n FROM entite_emettrice').n
console.log(`\n  ✔ Écrit. ${n} société(s) enregistrée(s).`)
