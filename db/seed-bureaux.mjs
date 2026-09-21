/**
 * Les douze bureaux de contrôle et leur date de fin d'accréditation, relevés sur le
 * référentiel réel. Rejouable : un bureau déjà présent voit seulement sa date mise à jour.
 */
import { DatabaseSync } from 'node:sqlite'
const db = new DatabaseSync(process.env.CEE_DB_PATH || 'db/cee.db')

const BUREAUX = [
  ['Elite Quality Inspection', '2023-09-30'],
  ['Qualiconsult', '2022-08-31'],
  ['Socotec', '2024-06-30'],
  ['Noal Mesure & Contrôle', null],
  ['Smart Environnement', null],
  ['Dekra', '2025-05-31'],
  ['COGF', '2026-02-28'],
  ['Preventec', '2024-07-31'],
  ['Bureau Veritas', '2023-05-31'],
  ['Diagnosteam', '2024-08-31'],
  ['Expert Contrôle Energie', '2026-09-30'],
  ['Copraudit', '2018-02-28'],
]

let crees = 0, majs = 0
for (const [nom, fin] of BUREAUX) {
  const e = db.prepare('SELECT id, date_fin_accreditation FROM bureau_controle WHERE nom = ?').get(nom)
  if (e) {
    if ((e.date_fin_accreditation ?? null) !== fin) {
      db.prepare('UPDATE bureau_controle SET date_fin_accreditation = ? WHERE id = ?').run(fin, e.id)
      majs++
    }
  } else {
    db.prepare('INSERT INTO bureau_controle (id, nom, date_fin_accreditation, actif) VALUES (?,?,?,1)')
      .run(crypto.randomUUID(), nom, fin)
    crees++
  }
}
const jour = new Date().toISOString().slice(0, 10)
const perimes = db.prepare('SELECT COUNT(*) n FROM bureau_controle WHERE date_fin_accreditation < ?').get(jour).n
const sansDate = db.prepare('SELECT COUNT(*) n FROM bureau_controle WHERE date_fin_accreditation IS NULL').get().n
console.log(`${crees} créé(s), ${majs} mis à jour — ${perimes} périmé(s) à ce jour, ${sansDate} sans date.`)
