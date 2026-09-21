/**
 * Compare nos fiches au catalogue public du ministère et signale les écarts.
 *
 * Usage :
 *   node veiller.mjs
 *   node veiller.mjs --fichier catalogue.html   (pour rejouer sans réseau)
 *
 * N'écrit rien dans le référentiel : la veille signale, un humain vérifie sur le PDF
 * officiel, et c'est `charger-fiches.mjs` qui enregistre. Une veille qui se mettrait à jour
 * toute seule transformerait une erreur de lecture en montants faux sur tout le portefeuille.
 *
 * À faire tourner une fois par semaine. Le coût est nul et l'enjeu se compte en dossiers.
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { veiller, SOURCES_CATALOGUE } from './lib/veille-fiches.js'

const db = new DatabaseSync(process.env.CEE_DB_PATH || 'db/cee.db')
const args = process.argv.slice(2)
const iFichier = args.indexOf('--fichier')

const recuperer = iFichier >= 0 && args[iFichier + 1]
  ? async () => fs.readFileSync(args[iFichier + 1], 'utf8')
  : async (url) => {
      const r = await fetch(url, { headers: { 'User-Agent': 'plateforme-cee/veille' } })
      if (!r.ok) throw new Error(`le catalogue a répondu ${r.status}`)
      return await r.text()
    }

console.log('── Veille sur le catalogue des fiches ──')
console.log(`  source : ${iFichier >= 0 ? args[iFichier + 1] : SOURCES_CATALOGUE[0]}\n`)

const r = await veiller(db, recuperer, iFichier >= 0 ? ['(fichier local)'] : SOURCES_CATALOGUE)

if (!r.accessible) {
  // Distinction essentielle : « rien à signaler » et « je n'ai pas pu regarder » ne sont
  // pas la même réponse, et confondre les deux est le meilleur moyen de rater la prochaine
  // abrogation.
  console.log(`  IMPOSSIBLE DE VÉRIFIER — ${r.raison}`)
  console.log('  Aucune conclusion : ce n\'est pas « aucune anomalie ».')
  process.exit(2)
}

console.log(`  ${r.codesAuCatalogue} code(s) lus au catalogue, ${r.examinees} de nos fiches examinées.\n`)

if (r.ecarts.length === 0) {
  console.log('  ✔ Aucun écart : nos fiches correspondent au catalogue.')
  process.exit(0)
}

const ordre = { ALERTE: 0, AVERTISSEMENT: 1 }
for (const e of r.ecarts.sort((a, b) => (ordre[a.niveau] - ordre[b.niveau]) || (b.operations - a.operations))) {
  console.log(`  ${e.niveau === 'ALERTE' ? 'ALERTE       ' : 'avertissement'} ${e.message}`)
  console.log(`                ${e.detail}`)
}

const alertes = r.ecarts.filter((e) => e.niveau === 'ALERTE').length
console.log(`\n  ${alertes} alerte(s), ${r.ecarts.length - alertes} avertissement(s).`)
console.log('  Rien n\'a été modifié. Vérifiez à la source, puis chargez la nouvelle version.')
process.exit(alertes > 0 ? 1 : 0)
