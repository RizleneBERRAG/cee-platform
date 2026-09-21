/**
 * Installe le workflow (étapes, statuts, types de document) dans une base, et rattache les
 * dossiers repris à un statut.
 *
 * Séparé du jeu de démonstration : après une reprise de données réelles, on veut le
 * workflow SANS les 120 dossiers inventés. Rejouable — rien n'est créé deux fois.
 *
 * ── La traduction des statuts, et ses limites ──
 *
 * Le logiciel précédent mélange dans une seule liste ses statuts ADV numérotés, des noms de
 * deals et des listes de travail. On traduit ce qui a un équivalent, et **on parque le reste
 * à l'entrée du pipeline** plutôt que de créer chez nous « LISTE PLANTES » ou « HOMELIOR ».
 * Le libellé d'origine reste dans `dossier.statut_origine` : rien n'est perdu, rien n'est
 * inventé, et leur dette de conception ne franchit pas la porte.
 */
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(process.env.CEE_DB_PATH || 'db/cee.db')
const id = () => crypto.randomUUID()
const un = (s, p = []) => db.prepare(s).get(...p)
const run = (s, p = []) => db.prepare(s).run(...p)

const ETAPES = [
  ['Confirmation', '#f59e0b'], ['Devis', '#3b82f6'], ['Installation', '#8b5cf6'],
  ['Contrôle', '#ec4899'], ['Valorisation', '#10b981'],
]
const STATUTS = [
  ['Confirmation', 'À confirmer', '#f59e0b', 0], ['Confirmation', 'À reconfirmer', '#f59e0b', 0],
  ['Confirmation', 'Manque infos', '#f97316', 0], ['Confirmation', 'En attente', '#eab308', 0],
  ['Confirmation', 'Non éligible', '#ef4444', 1], ['Confirmation', 'Pas intéressé', '#ef4444', 1],
  ['Confirmation', 'Annulé', '#dc2626', 1],
  ['Devis', 'Devis à faire', '#3b82f6', 0], ['Devis', 'Devis envoyé', '#2563eb', 0],
  ['Installation', 'À planifier', '#8b5cf6', 0], ['Installation', 'Planifié', '#7c3aed', 0],
  ['Installation', 'En commande', '#6d28d9', 0], ['Installation', 'Livré', '#5b21b6', 0],
  ['Contrôle', 'À contrôler', '#ec4899', 0], ['Contrôle', 'Contrôle OK', '#22c55e', 0],
  ['Contrôle', 'Contrôle négatif', '#ef4444', 1],
  ['Valorisation', 'À traiter', '#10b981', 0], ['Valorisation', 'Déposé', '#059669', 0],
  ['Valorisation', 'AAF', '#047857', 0],
]
const AUTRES_AXES = [
  ['ADMIN', ['En attente délégataire', 'Validé délégataire', 'Problème liste']],
  ['FACTURATION', ['Non facturé', 'Facturé', 'AAF']],
  ['INSTALLATION', ['Non installé', 'Installé', 'SAV']],
  ['COFRAC', ['Non contrôlé', 'Satisfaisant', 'Non satisfaisant']],
]
const TYPES_DOC = [
  ['AH', "Attestation sur l'honneur"], ['DEVIS', 'Devis signé'], ['FACTURE', 'Facture'],
  ['AFT', 'Attestation de fin de travaux'], ['DOSSIER_CEE', 'Dossier CEE'],
  ['CADRE_CONTRIB', 'Cadre de contribution'], ['FICHE_TECH', 'Fiche technique produit'],
  ['PHOTOS', 'Photos de chantier'], ['RGE', 'Certificat RGE'], ['KBIS', 'Kbis / justificatif société'],
  ['CNI', "Pièce d'identité"], ['COFRAC', 'Rapport de contrôle COFRAC'],
]

/** Ce qui a un équivalent chez nous. Le reste reste à l'entrée, libellé d'origine conservé. */
const TRADUCTION = [
  [/^0\s*-/, 'À confirmer'],
  [/^1\s*-/, 'Devis envoyé'],
  [/^2\s*-/, 'Planifié'],
  [/^3\s*-/, 'À contrôler'],
  [/^4\s*-/, 'À traiter'],
  [/^5\s*-/, 'À traiter'],
  [/^6\s*-/, 'À traiter'],
  [/^7\s*-/, 'AAF'],
  [/^8\s*-/, 'Annulé'],
  [/^9\s*-/, 'Annulé'],
  [/^DEVIS A FAIRE$/i, 'Devis à faire'],
  [/^DEVIS ENVOY/i, 'Devis envoyé'],
  [/^DEVIS SIGN/i, 'À planifier'],
  [/^D[ÉE]POS[ÉE]$/i, 'Déposé'],
]

// ── Étapes ──
const etapeIds = {}
ETAPES.forEach(([libelle, couleur], i) => {
  let e = un('SELECT id FROM etape WHERE libelle = ?', [libelle])
  if (!e) {
    const eid = id()
    run('INSERT INTO etape (id, libelle, ordre, couleur) VALUES (?,?,?,?)', [eid, libelle, i + 1, couleur])
    e = { id: eid }
  }
  etapeIds[libelle] = e.id
})

// ── Statuts ──
const statutIds = {}
STATUTS.forEach(([etape, libelle, couleur, perdu], i) => {
  let s = un("SELECT id FROM statut WHERE libelle = ? AND axe = 'DOSSIER'", [libelle])
  if (!s) {
    const sid = id()
    run('INSERT INTO statut (id, libelle, ordre, couleur, axe, perdu, etape_id) VALUES (?,?,?,?,?,?,?)',
      [sid, libelle, i, couleur, 'DOSSIER', perdu, etapeIds[etape]])
    s = { id: sid }
  }
  statutIds[libelle] = s.id
})
for (const [axe, libelles] of AUTRES_AXES) {
  libelles.forEach((l, i) => {
    if (un('SELECT id FROM statut WHERE libelle = ? AND axe = ?', [l, axe])) return
    run('INSERT INTO statut (id, libelle, ordre, couleur, axe, perdu) VALUES (?,?,?,?,?,?)',
      [id(), l, i, '#64748b', axe, l === 'Non satisfaisant' ? 1 : 0])
  })
}

// ── Types de document ──
for (const [code, libelle] of TYPES_DOC) {
  if (un('SELECT id FROM type_document WHERE code = ?', [code])) continue
  run('INSERT INTO type_document (id, code, libelle) VALUES (?,?,?)', [id(), code, libelle])
}

// ── Rattachement des dossiers ──
const traduire = (origine) => {
  const s = String(origine || '').trim()
  if (!s) return null
  for (const [re, cible] of TRADUCTION) if (re.test(s)) return cible
  return null
}

const dossiers = db.prepare('SELECT id, statut_origine FROM dossier WHERE statut_dossier_id IS NULL').all()
const compte = { traduits: 0, entree: 0 }
const nonTraduits = new Map()

db.exec('BEGIN')
for (const d of dossiers) {
  const cible = traduire(d.statut_origine)
  if (cible) compte.traduits++
  else {
    compte.entree++
    const k = String(d.statut_origine || '(vide)').trim()
    nonTraduits.set(k, (nonTraduits.get(k) || 0) + 1)
  }
  const libelle = cible || 'À confirmer'
  const sid = statutIds[libelle]
  const etape = STATUTS.find(([, l]) => l === libelle)?.[0]
  run('UPDATE dossier SET statut_dossier_id = ?, etape_id = ? WHERE id = ?',
    [sid, etapeIds[etape] ?? null, d.id])
}
db.exec('COMMIT')

console.log(`workflow : ${Object.keys(etapeIds).length} étapes, ${Object.keys(statutIds).length} statuts, ${TYPES_DOC.length} types de document`)
console.log(`dossiers : ${compte.traduits} statuts traduits, ${compte.entree} placés à l'entrée du pipeline`)
if (nonTraduits.size) {
  console.log("libellés d'origine sans équivalent (conservés dans statut_origine) :")
  for (const [k, n] of [...nonTraduits].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`   ${String(n).padStart(5)}  ${k}`)
  }
}
