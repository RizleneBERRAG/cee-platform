/**
 * Passe les dossiers au crible des contrôles avant dépôt.
 *
 * Usage :
 *   node controler.mjs                 tous les dossiers
 *   node controler.mjs EPC-2025-2134   un dossier précis, avec le détail
 *   node controler.mjs --statut DÉPOSÉ les dossiers d'un statut
 *
 * N'écrit rien. Constate, explique, et laisse décider.
 */
import { DatabaseSync } from 'node:sqlite'
import { controlerDossier, controlerLot } from './lib/controles-depot.js'

const db = new DatabaseSync(process.env.CEE_DB_PATH || 'db/cee.db')
const args = process.argv.slice(2)

// ── Un dossier précis ──
const numero = args.find((a) => /^EPC-/i.test(a))
if (numero) {
  const d = db.prepare('SELECT id, numero FROM dossier WHERE UPPER(numero) = ?').get(numero.toUpperCase())
  if (!d) { console.log(`Dossier ${numero} introuvable.`); process.exit(2) }
  const r = controlerDossier(db, d.id)
  console.log(`── ${r.numero} ──\n`)
  if (r.anomalies.length === 0) { console.log('  Aucune anomalie. Déposable.') }
  for (const a of r.anomalies) {
    const marque = a.niveau === 'BLOQUANT' ? ' BLOQUANT ' : a.niveau === 'AVERTISSEMENT' ? '  averti  ' : '   info   '
    console.log(`${marque} ${a.message}`)
    if (a.detail) console.log(`            ${a.detail}`)
  }
  console.log(`\n  ${r.bloquantes} anomalie(s) bloquante(s).`)
  process.exit(0)
}

// ── Un lot ──
const iStatut = args.indexOf('--statut')
let sql = 'SELECT d.id FROM dossier d'
let params = []
if (iStatut >= 0 && args[iStatut + 1]) {
  sql += ' LEFT JOIN statut s ON s.id = d.statut_dossier_id WHERE s.libelle = ? OR d.statut_origine = ?'
  params = [args[iStatut + 1], args[iStatut + 1]]
}
const ids = db.prepare(sql).all(...params).map((r) => r.id)
if (ids.length === 0) { console.log('Aucun dossier à contrôler.'); process.exit(2) }

console.log(`── Contrôle de ${ids.length} dossier(s) ──\n`)
const t0 = Date.now()
const bilan = controlerLot(db, ids)

console.log(`  déposables sans réserve : ${bilan.deposables}`)
console.log(`  avec au moins un blocage: ${bilan.bloques}`)
console.log(`  (${Date.now() - t0} ms)\n`)

const lignes = Object.entries(bilan.parCode).sort((a, b) => {
  const poids = { BLOQUANT: 0, AVERTISSEMENT: 1, INFORMATION: 2 }
  return (poids[a[1].niveau] - poids[b[1].niveau]) || (b[1].n - a[1].n)
})
for (const [code, info] of lignes) {
  const marque = info.niveau === 'BLOQUANT' ? 'BLOQUANT     ' : info.niveau === 'AVERTISSEMENT' ? 'avertissement' : 'information  '
  console.log(`  ${marque} ${String(info.n).padStart(5)}  ${code}`)
  for (const e of info.exemples) console.log(`                       ${e}`)
}

console.log(`\n  Rien n'a été modifié : ces contrôles constatent, ils ne corrigent pas.`)
