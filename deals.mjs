/**
 * Contrôles de la grille des contrats de rachat.
 *
 * Trois choses sont vérifiées ici, et une seule d'entre elles concerne du code :
 *
 * 1. **La migration à dix-huit cases** ne perd aucun contrat et relâche bien le
 *    `NOT NULL DEFAULT 0` des anciens ratios ;
 * 2. **Une case vide n'est pas un zéro.** C'est le contrôle qui compte : la grille de
 *    l'ancien logiciel a un trou — aucun champ pour le tarif délégataire en précaire hors
 *    MaPrimeRénov'. Lu comme un zéro, ce trou ferait crier « chaque dossier perd de
 *    l'argent » sur les douze contrats, et noierait les vraies alertes ;
 * 3. **Le fichier relevé est fidèle et complet** — dix-huit cases par contrat, aucune
 *    inventée.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const { appliquerManuelles } = await import('./lib/migrations-manuelles.js')
const { anomaliesRatios, RATIOS, COMBINAISONS, LIGNES, colonne } = await import('./lib/ratios.js')
const { calculerValorisation, MODES_REVERSEMENT, euros } = await import('./lib/marge.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('La grille compte dix-huit cases')

ok(RATIOS.length === 18, `dix-huit ratios déclarés (obtenu : ${RATIOS.length})`)
ok(COMBINAISONS.length === 6, `six combinaisons régime × MPR (obtenu : ${COMBINAISONS.length})`)
ok(new Set(RATIOS.map(([c]) => c)).size === 18, 'aucune colonne déclarée deux fois')
ok(COMBINAISONS.every(([r, m]) => LIGNES.every((l) => colonne(l, r, m))),
  'chaque croisement ligne × régime × MPR a bien une colonne')
ok(colonne(LIGNES[1], 'GRANDE_PRECARITE', 'sans MPR') === 'r_cede_grande_precarite_sans_mpr',
  'la grande précarité a ses propres colonnes, distinctes de la précarité simple')

// ═══════════════════════════════════════════════════════════
titre('Une case vide n\'est pas un zéro')

// Le cas réel : tout est renseigné sauf le tarif délégataire en précaire hors MPR,
// parce que l'ancien logiciel n'a pas ce champ.
const commeChezPixel = {
  r_deleg_precaire_sans_mpr: null,
  r_cede_precaire_sans_mpr: 4.55,
  r_garde_precaire_sans_mpr: 4.55,
}
const a1 = anomaliesRatios(commeChezPixel)
ok(!a1.some((a) => a.gravite === 'ERREUR'),
  'un tarif délégataire absent ne produit PAS une erreur de reliquat')
ok(a1.some((a) => a.gravite === 'DOUTE' && /pas renseigné/.test(a.message)),
  'il produit un doute, qui nomme ce qui manque')

// Le reliquat négatif est signalé — mais comme un doute, pas comme un verdict : onze des
// douze contrats réels sont dans ce cas, et le sens de la ligne « installateur » n'est pas
// tranché. Un contrôle qui crie sur onze contrats sur douze n'est plus un contrôle.
const a2 = anomaliesRatios({
  r_deleg_classique_sans_mpr: 6,
  r_cede_classique_sans_mpr: 4,
  r_garde_classique_sans_mpr: 4,
})
ok(a2.some((a) => /de plus par MWh/.test(a.message)), 'un reliquat négatif est signalé')
ok(a2.every((a) => a.gravite !== 'ERREUR'),
  'et il est présenté comme un doute à trancher, pas comme une erreur de saisie')

// Une combinaison entièrement vide ne dit rien du tout.
ok(anomaliesRatios({}).length === 0, 'une grille vide ne produit aucune remarque')
ok(anomaliesRatios({ r_deleg_precaire_sans_mpr: null, r_cede_precaire_sans_mpr: null,
  r_garde_precaire_sans_mpr: null }).length === 0,
  'une combinaison à trois cases vides non plus')

// Un zéro explicite, lui, est un tarif : gratuit, mais déclaré.
const a3 = anomaliesRatios({
  r_deleg_precaire_sans_mpr: 0,
  r_cede_precaire_sans_mpr: 4.55,
  r_garde_precaire_sans_mpr: 4.55,
})
ok(a3.some((a) => /de plus par MWh/.test(a.message)) && !a3.some((a) => /pas renseigné/.test(a.message)),
  'un zéro explicite est lu comme un tarif nul, pas comme une case vide')

ok(anomaliesRatios({ r_cede_classique_sans_mpr: -1 })
  .some((a) => a.gravite === 'ERREUR' && /négatif/.test(a.message)),
  'un tarif négatif est signalé')

// ═══════════════════════════════════════════════════════════
titre('La migration à dix-huit cases')

const CIBLE = path.join(os.tmpdir(), 'deals-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')

// On reconstitue l'ANCIENNE table, celle d'avant la migration, avec une ligne dedans.
db.exec(`CREATE TABLE delegataire (id TEXT PRIMARY KEY, nom TEXT NOT NULL, oblige TEXT, actif INTEGER NOT NULL DEFAULT 1)`)
db.exec(`CREATE TABLE deal (
  id TEXT PRIMARY KEY, libelle TEXT NOT NULL, version TEXT NOT NULL DEFAULT 'V1',
  delegataire_id TEXT NOT NULL REFERENCES delegataire(id),
  type_beneficiaire TEXT NOT NULL DEFAULT 'B2B_B2C', volume_cumac REAL,
  date_debut TEXT NOT NULL, date_fin TEXT, num_contrat_standard TEXT, num_contrat_cdp TEXT,
  num_contrat_mpr TEXT, date_fin_facturation TEXT,
  par_defaut INTEGER NOT NULL DEFAULT 0, actif INTEGER NOT NULL DEFAULT 1,
  r_deleg_precaire_sans_mpr REAL NOT NULL DEFAULT 0,
  r_deleg_precaire_avec_mpr REAL NOT NULL DEFAULT 0,
  r_cede_precaire_sans_mpr REAL NOT NULL DEFAULT 0,
  r_cede_precaire_avec_mpr REAL NOT NULL DEFAULT 0,
  r_garde_precaire_sans_mpr REAL NOT NULL DEFAULT 0,
  r_garde_precaire_avec_mpr REAL NOT NULL DEFAULT 0,
  r_deleg_classique_sans_mpr REAL NOT NULL DEFAULT 0,
  r_deleg_classique_avec_mpr REAL NOT NULL DEFAULT 0,
  r_cede_classique_sans_mpr REAL NOT NULL DEFAULT 0,
  r_cede_classique_avec_mpr REAL NOT NULL DEFAULT 0,
  r_garde_classique_sans_mpr REAL NOT NULL DEFAULT 0,
  r_garde_classique_avec_mpr REAL NOT NULL DEFAULT 0)`)
db.prepare('INSERT INTO delegataire (id, nom) VALUES (?,?)').run('dg', 'ANCIEN')
db.prepare(`INSERT INTO deal (id, libelle, delegataire_id, date_debut, r_deleg_classique_sans_mpr)
            VALUES (?,?,?,?,?)`).run('d1', 'Contrat déjà là', 'dg', '2025-01-01', 7.25)

mettreANiveau(db, cheminSchemaParDefaut())
const rapport = appliquerManuelles(db)
ok(rapport.erreurs.length === 0, `la mise à niveau passe sans erreur${rapport.erreurs.length ? ` (${rapport.erreurs.join(' ; ')})` : ''}`)

const def = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'deal'").get().sql
ok(/r_deleg_grande_precarite_sans_mpr/.test(def), 'la table porte désormais la grande précarité')
ok(!/r_deleg_precaire_sans_mpr\s+REAL\s+NOT\s+NULL/i.test(def),
  'les anciens ratios ne sont plus NOT NULL — une case peut rester vide')

const survivant = db.prepare('SELECT * FROM deal WHERE id = ?').get('d1')
ok(!!survivant, 'le contrat déjà en base a survécu à la reconstruction')
ok(Number(survivant.r_deleg_classique_sans_mpr) === 7.25, 'et son tarif est intact (7,25 €/MWh)')
ok(survivant.r_deleg_grande_precarite_sans_mpr === null,
  'ses nouvelles cases sont vides, pas à zéro')

// Rejouée, la migration ne doit pas repasser.
const rapport2 = appliquerManuelles(db)
ok(!rapport2.appliquees.includes('2026-09-17-deal-grille-18-ratios'),
  'la migration ne se rejoue pas au démarrage suivant')

// ═══════════════════════════════════════════════════════════
titre('Le relevé de l\'ancien logiciel')

const ref = JSON.parse(fs.readFileSync('db/deals-pixel.json', 'utf8'))
ok(ref.deals.length === 12, `douze contrats relevés (obtenu : ${ref.deals.length})`)
ok(ref.deals.every((d) => Object.keys(d.ratios).length === 18),
  'chacun porte exactement dix-huit cases')

const colonnesConnues = new Set(RATIOS.map(([c]) => c))
ok(ref.deals.every((d) => Object.keys(d.ratios).every((c) => colonnesConnues.has(c))),
  'aucune colonne inventée dans le fichier')

ok(ref.deals.every((d) => d.ratios.r_deleg_precaire_sans_mpr === null),
  'le tarif délégataire précaire hors MPR est vide sur les douze — le champ n\'existe pas dans l\'ancien logiciel')

ok(ref.deals.every((d) => Object.values(d.ratios).every((v) => v === null || (Number.isFinite(v) && v >= 0))),
  'aucun tarif négatif ni illisible')

// Aucune des douze grilles ne doit produire d'ERREUR — c'est-à-dire de valeur qui n'a
// aucune lecture métier possible. Si l'une en produit, c'est une faute de recopie.
const fautives = ref.deals
  .map((d) => ({ libelle: d.libelle, err: anomaliesRatios(d.ratios).filter((a) => a.gravite === 'ERREUR') }))
  .filter((x) => x.err.length)
ok(fautives.length === 0,
  fautives.length
    ? `contrats en erreur : ${fautives.map((f) => `${f.libelle} (${f.err[0].message})`).join(' | ')}`
    : 'aucune des douze grilles ne présente de valeur impossible')

// Le constat qui appelle une décision du gérant : la somme cédé + commission dépasse ce
// que verse le délégataire sur presque tous les contrats. Le test le fige pour que la
// question ne se perde pas — et pour qu'on remarque si un jour ce n'est plus vrai.
const cumulSuperieur = ref.deals.filter((d) =>
  anomaliesRatios(d.ratios).some((a) => /de plus par MWh/.test(a.message)))
ok(cumulSuperieur.length === 11,
  `onze contrats sur douze cumulent au-delà du versement du délégataire — question ouverte, ` +
  `pas erreur (obtenu : ${cumulSuperieur.length})`)

// Le chargement ne doit toucher qu'à la table `deal`.
const source = fs.readFileSync('charger-deals.mjs', 'utf8')
ok(!/UPDATE\s+(dossier|operation)\b/i.test(source),
  'le chargeur n\'écrit ni dans `dossier` ni dans `operation` — la règle de gel tient')
ok(/--appliquer/.test(source) && /mode\s+: simulation/.test(source),
  'le chargeur est en simulation par défaut')

// ═══════════════════════════════════════════════════════════
titre('Le mode de reversement : le choix laissé au contrat')

const GRILLE = {
  r_deleg_classique_sans_mpr: 6.5,
  r_cede_classique_sans_mpr: 4.55,
  r_garde_classique_sans_mpr: 4.55,
}
const MWH = 1000000 // 1 000 MWh cumac, pour des chiffres lisibles

ok(MODES_REVERSEMENT.length === 2 && MODES_REVERSEMENT.every((m) => m.code && m.libelle && m.aide),
  'deux modes proposés, chacun avec son explication')

// ── Sans mode : rien n'est calculé. C'est LE contrôle important. ──
const sansMode = calculerValorisation({ cumac: MWH, deal: GRILLE })
ok(sansMode.indetermine === true, 'un contrat sans mode de reversement ne produit aucune marge')
ok(sansMode.margeNette === null, 'la marge est `null`, PAS zéro — une marge absente se voit, un zéro se croit')
ok(sansMode.caDelegataire === null && sansMode.primeBeneficiaire === null,
  'aucun montant n\'est calculé non plus')
ok(/pas choisi/.test(sansMode.motif), 'et le motif dit pourquoi')

// ── Cumulé : les deux lignes se déduisent. ──
const cumule = calculerValorisation({ cumac: MWH, deal: { ...GRILLE, mode_reversement: 'CUMULE' } })
ok(cumule.indetermine === false, 'avec un mode, la marge se calcule')
ok(cumule.margeNette === 6500 - 4550 - 4550,
  `cumulé : 6 500 − 4 550 − 4 550 = ${cumule.margeNette} € (les deux sont déduits)`)
ok(cumule.deduitBeneficiaire && cumule.deduitInstallateur, 'et les deux déductions sont annoncées')

// ── Alternatif : une seule, celle du destinataire de la prime. ──
const altBenef = calculerValorisation({ cumac: MWH, deal: { ...GRILLE, mode_reversement: 'ALTERNATIF' } })
ok(altBenef.margeNette === 6500 - 4550,
  `alternatif, prime au bénéficiaire : 6 500 − 4 550 = ${altBenef.margeNette} €`)
ok(altBenef.deduitBeneficiaire && !altBenef.deduitInstallateur,
  'seule la ligne du bénéficiaire est déduite')
ok(altBenef.destinatairePrime === 'BENEFICIAIRE',
  'et le destinataire retenu est affiché, pas supposé en silence')

const altInstall = calculerValorisation({
  cumac: MWH, deal: { ...GRILLE, mode_reversement: 'ALTERNATIF' }, destinatairePrime: 'INSTALLATEUR' })
ok(!altInstall.deduitBeneficiaire && altInstall.deduitInstallateur,
  'quand la prime va à l\'installateur, c\'est son tarif qui s\'applique')

// ── Le tarif délégataire manquant bloque aussi, même avec un mode choisi ──
const sansDeleg = calculerValorisation({
  cumac: MWH,
  deal: { mode_reversement: 'CUMULE', r_cede_classique_sans_mpr: 4.55, r_garde_classique_sans_mpr: 4.55 },
})
ok(sansDeleg.indetermine === true && sansDeleg.margeNette === null,
  'sans tarif délégataire, la marge reste indéterminée même si le mode est choisi')
ok(/délégataire/.test(sansDeleg.motif), 'et le motif le dit')

// ── Un montant inconnu s'affiche « — », un zéro réel s'affiche « 0 € » ──
ok(euros(null) === '—', 'euros(null) affiche un tiret')
// `Intl` sépare le montant du symbole par une espace insécable étroite : comparer au
// caractère près ferait échouer un test correct.
ok(/^0\s*€$/u.test(euros(0).replace(/\u202f|\u00a0/g, ' ')),
  'euros(0) affiche bien zéro — un zéro réel reste une information')

// ═══════════════════════════════════════════════════════════
titre('Le mode change le niveau des alertes de grille')

const aSansMode = anomaliesRatios(GRILLE, null)
ok(aSansMode.length === 1 && aSansMode[0].gravite === 'DOUTE',
  'sans mode : un doute, pas un verdict')
ok(/Choisissez le mode/.test(aSansMode[0].message),
  'et le message invite à trancher plutôt qu\'à corriger')

const aCumule = anomaliesRatios(GRILLE, 'CUMULE')
ok(aCumule.length === 1 && aCumule[0].gravite === 'ERREUR',
  'réglé sur « cumulés », le même écart devient une erreur — les dossiers perdent vraiment de l\'argent')

const aAlternatif = anomaliesRatios(GRILLE, 'ALTERNATIF')
ok(aAlternatif.length === 0,
  'réglé sur « au choix », il n\'y a plus rien à signaler : le cumul n\'a pas à tomber juste')

// En mode alternatif, la vraie faute est qu'UNE ligne dépasse le versement du délégataire.
const aFaute = anomaliesRatios(
  { r_deleg_classique_sans_mpr: 6, r_cede_classique_sans_mpr: 9, r_garde_classique_sans_mpr: 2 },
  'ALTERNATIF')
ok(aFaute.some((x) => x.gravite === 'ERREUR' && /Prime cédée/.test(x.ligne)),
  'mais une ligne qui dépasse à elle seule le versement reste une erreur')

// Le mode est lu depuis le deal lui-même quand il n'est pas passé à part.
ok(anomaliesRatios({ ...GRILLE, mode_reversement: 'ALTERNATIF' }).length === 0,
  'le mode porté par le deal est pris en compte sans avoir à le repasser')

// ═══════════════════════════════════════════════════════════
titre('Les douze contrats repris, une fois le mode choisi')

const enCumule = ref.deals.filter((d) => anomaliesRatios(d.ratios, 'CUMULE').some((a) => a.gravite === 'ERREUR'))
const enAlternatif = ref.deals.filter((d) => anomaliesRatios(d.ratios, 'ALTERNATIF').some((a) => a.gravite === 'ERREUR'))
ok(enCumule.length === 11,
  `réglés sur « cumulés », onze contrats sur douze perdraient de l'argent (obtenu : ${enCumule.length})`)
ok(enAlternatif.length === 0,
  `réglés sur « au choix », aucun ne pose problème (obtenu : ${enAlternatif.length})`)

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
