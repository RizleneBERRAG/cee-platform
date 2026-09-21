/**
 * Charge dans la base les contrats de rachat relevés sur l'ancien logiciel.
 *
 * Usage :
 *   node charger-deals.mjs [--appliquer]
 *
 * Sans `--appliquer`, la commande n'écrit RIEN : elle affiche ce qu'elle ferait, contrat
 * par contrat, et signale les anomalies de grille. Ces dix-huit chiffres décident de la
 * marge de chaque dossier ; on regarde avant de signer.
 *
 * ── Ce que ce chargement ne fait PAS ──
 *
 * Il ne recalcule **aucun** dossier. Les 1 677 dossiers repris portent les montants de
 * l'ancien logiciel, figés. Charger une grille de tarifs ne change pas rétroactivement ce
 * qui a déjà été facturé : la règle de gel l'interdit, et ce script n'écrit que dans la
 * table `deal`.
 *
 * Il ne reprend pas non plus le lien deal ↔ fiche. Vérification faite sur les douze
 * contrats : ils portent tous exactement les mêmes 141 fiches, toutes activées. Recopier
 * douze fois la même liste ne distinguerait aucun contrat d'un autre et laisserait croire
 * à un paramétrage qui n'existe pas.
 *
 * ── Rejouable ──
 *
 * Un contrat est reconnu par son couple (libellé, version). Relancer met à jour les
 * tarifs sans créer de doublon.
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { anomaliesRatios, RATIOS } from './lib/ratios.js'

const APPLIQUER = process.argv.includes('--appliquer')
const CIBLE = process.env.CEE_DB_PATH || 'db/cee.db'
const SOURCE = process.env.CEE_DEALS || 'db/deals-pixel.json'

const ref = JSON.parse(fs.readFileSync(SOURCE, 'utf8'))
const db = new DatabaseSync(CIBLE)
const uid = () => crypto.randomUUID()
const un = (s, p = []) => db.prepare(s).get(...p)
const run = (s, p = []) => db.prepare(s).run(...p)

const COLONNES = RATIOS.map(([c]) => c)
const eur = (v) => (v === null || v === undefined ? '—' : `${Number(v).toFixed(2).replace('.', ',')}`)

console.log('── Contrats de rachat ──')
console.log(`  source : ${SOURCE}  (relevé le ${ref.source?.releve_le || '?'})`)
console.log(`  base   : ${CIBLE}`)
console.log(APPLIQUER ? '  mode   : ÉCRITURE\n' : '  mode   : simulation (ajoutez --appliquer pour écrire)\n')

// ── Étape 1 : les délégataires ──
//
// Un contrat ne peut pas exister sans le sien. On les résout AVANT d'écrire quoi que ce
// soit, pour que l'absence d'un délégataire arrête le chargement au lieu de le laisser à
// moitié fait.
const parDelegataire = new Map()
const aCreer = []
for (const d of ref.deals) {
  const cle = `${d.delegataire.nom}|${d.delegataire.oblige ?? ''}`
  if (parDelegataire.has(cle)) continue
  const trouve = d.delegataire.oblige
    ? un('SELECT id, nom FROM delegataire WHERE nom = ? AND oblige = ?', [d.delegataire.nom, d.delegataire.oblige])
    : un('SELECT id, nom FROM delegataire WHERE nom = ? AND oblige IS NULL', [d.delegataire.nom])
  parDelegataire.set(cle, trouve ? trouve.id : null)
  if (!trouve) aCreer.push({ cle, ...d.delegataire })
}

if (aCreer.length) {
  console.log('  Délégataires absents de la base, à créer :')
  for (const d of aCreer) console.log(`    · ${d.nom}${d.oblige ? ` — ${d.oblige}` : ''}`)
  console.log('')
}

// ── Étape 2 : le plan, contrat par contrat ──
let anomaliesTotal = 0
const plan = []
for (const d of ref.deals) {
  const existant = un('SELECT id FROM deal WHERE libelle = ? AND version = ?', [d.libelle, d.version])
  const anomalies = anomaliesRatios(d.ratios)
  anomaliesTotal += anomalies.length
  plan.push({ d, existant, anomalies })

  console.log(`  ${d.libelle}  (${d.version})`)
  console.log(`      délégataire : ${d.delegataire.nom}${d.delegataire.oblige ? ` — ${d.delegataire.oblige}` : ''}`)
  console.log(`      ${existant ? 'existe → mis à jour' : 'à créer'}`)
  console.log(`      grande préc. ${eur(d.ratios.r_deleg_grande_precarite_sans_mpr)} / ` +
    `précaire ${eur(d.ratios.r_deleg_precaire_sans_mpr)} / ` +
    `classique ${eur(d.ratios.r_deleg_classique_sans_mpr)}   (versé par le délégataire, hors MPR, €/MWh)`)
  for (const a of anomalies) console.log(`      ${a.gravite === 'ERREUR' ? '✘' : '?'} ${a.message}`)
}

console.log(`\n  ${plan.length} contrat(s), ${aCreer.length} délégataire(s) à créer, ${anomaliesTotal} remarque(s) sur les grilles.`)

if (ref.source?.reserve) {
  console.log('\n  ── Réserve de lecture ──')
  for (const l of ref.source.reserve) console.log(`  ${l}`)
}

if (!APPLIQUER) {
  console.log('\n  Rien n\'a été écrit. Relancez avec --appliquer.')
  process.exit(0)
}

// ── Étape 3 : l'écriture, en une transaction ──
//
// Tout ou rien : une grille à moitié chargée serait pire qu'aucune, parce qu'elle
// donnerait des marges sur une partie du portefeuille et pas sur l'autre, sans le dire.
db.exec('BEGIN')
try {
  for (const d of aCreer) {
    const id = uid()
    run('INSERT INTO delegataire (id, nom, oblige, actif) VALUES (?,?,?,1)', [id, d.nom, d.oblige])
    parDelegataire.set(d.cle, id)
  }

  const champs = ['libelle', 'version', 'delegataire_id', 'type_beneficiaire', 'date_debut',
    'par_defaut', 'actif', ...COLONNES, 'source', 'source_ref']

  for (const { d, existant } of plan) {
    const delegataireId = parDelegataire.get(`${d.delegataire.nom}|${d.delegataire.oblige ?? ''}`)
    if (!delegataireId) throw new Error(`délégataire non résolu pour « ${d.libelle} »`)

    const valeurs = {
      libelle: d.libelle,
      version: d.version,
      delegataire_id: delegataireId,
      type_beneficiaire: d.type_beneficiaire || 'B2B_B2C',
      // L'ancien logiciel ne porte aucune date de contrat : les champs y sont vides sur
      // les douze. On ne peut donc pas savoir depuis quand chaque grille s'applique.
      // Faute de mieux, la date du relevé — et surtout pas une date inventée qui ferait
      // croire à une antériorité.
      date_debut: ref.source?.releve_le || new Date().toISOString().slice(0, 10),
      par_defaut: d.par_defaut ? 1 : 0,
      actif: d.actif === false ? 0 : 1,
      ...Object.fromEntries(COLONNES.map((c) => [c, d.ratios[c] ?? null])),
      source: 'Pixel CRM',
      source_ref: `Paramétrage › Deals — relevé le ${ref.source?.releve_le || '?'}`,
    }

    if (existant) {
      run(`UPDATE deal SET ${champs.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
        [...champs.map((c) => valeurs[c]), existant.id])
    } else {
      run(`INSERT INTO deal (id, ${champs.join(', ')}) VALUES (${['?', ...champs.map(() => '?')].join(', ')})`,
        [uid(), ...champs.map((c) => valeurs[c])])
    }
  }
  db.exec('COMMIT')
} catch (e) {
  db.exec('ROLLBACK')
  console.error(`\n  ✘ Rien n'a été écrit : ${e.message}`)
  process.exit(1)
}

const n = un('SELECT COUNT(*) AS n FROM deal').n
console.log(`\n  ✔ Écrit. La base porte ${n} contrat(s) de rachat.`)
