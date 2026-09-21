/**
 * Éprouve la recherche sur un portefeuille réaliste.
 * Chaque critère est confronté à un comptage SQL écrit indépendamment du moteur :
 * si les deux divergent, c'est le moteur qui a tort.
 */
import { rechercher, compter, totaux, CRITERES, COLONNES } from './lib/recherche.js'
import { get } from './lib/db.js'

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const chrono = (f) => { const t = Date.now(); const r = f(); return [r, Date.now() - t] }

const total = get('SELECT COUNT(*) n FROM dossier').n
titre(`Portefeuille de ${total} dossiers`)

// ── Chaque critère confronté à un SQL indépendant ──
const controles = [
  ['zone', 'H1', "SELECT COUNT(*) n FROM dossier d JOIN site s ON s.id=d.site_id WHERE s.zone_climatique='H1'"],
  ['zone', 'H3', "SELECT COUNT(*) n FROM dossier d JOIN site s ON s.id=d.site_id WHERE s.zone_climatique='H3'"],
  ['fiche', 'BAT-EQ-127', "SELECT COUNT(*) n FROM dossier d JOIN fiche f ON f.id=d.fiche_id WHERE f.code='BAT-EQ-127'"],
  ['charte', 'CDP', "SELECT COUNT(*) n FROM dossier WHERE charte='CDP'"],
  ['regime', 'PRECAIRE', "SELECT COUNT(*) n FROM dossier d JOIN beneficiaire b ON b.id=d.beneficiaire_id WHERE b.regime_revenu='PRECAIRE'"],
  ['avec_mpr', 'oui', 'SELECT COUNT(*) n FROM dossier WHERE avec_mpr=1'],
  ['qpv', 'non', 'SELECT COUNT(*) n FROM dossier d JOIN site s ON s.id=d.site_id WHERE COALESCE(s.qpv,0)=0'],
  ['sans_lot', 'oui', 'SELECT COUNT(*) n FROM dossier WHERE lot_id IS NULL'],
  ['ville', 'Lyon', "SELECT COUNT(*) n FROM dossier d JOIN site s ON s.id=d.site_id WHERE s.ville LIKE '%Lyon%'"],
  ['departement', '69', "SELECT COUNT(*) n FROM dossier d JOIN site s ON s.id=d.site_id WHERE s.departement='69'"],
  ['secteur_act', 'BUREAUX', "SELECT COUNT(*) n FROM dossier d JOIN site s ON s.id=d.site_id WHERE s.secteur_activite='BUREAUX'"],
  ['engage_du', '2026-01-01', "SELECT COUNT(*) n FROM dossier WHERE date_engagement >= '2026-01-01'"],
  ['engage_au', '2025-12-31', "SELECT COUNT(*) n FROM dossier WHERE date_engagement <= '2025-12-31'"],
  ['qte_min', '500', 'SELECT COUNT(*) n FROM dossier WHERE quantite >= 500'],
  ['cumac_min', '1000000', 'SELECT COUNT(*) n FROM dossier WHERE volume_cumac >= 1000000'],
  ['verrouille', 'oui', 'SELECT COUNT(*) n FROM dossier WHERE COALESCE(verrouille,0)=1'],
  ['statut', 'À traiter', "SELECT COUNT(*) n FROM dossier d JOIN statut st ON st.id=d.statut_dossier_id WHERE st.libelle='À traiter'"],
]
titre('Chaque critère contre un comptage SQL indépendant')
for (const [cle, val, sql] of controles) {
  const attendu = get(sql).n
  const obtenu = compter({ [cle]: val })
  ok(obtenu === attendu, `${cle} = ${val} → ${obtenu} (SQL : ${attendu})`)
}

// ── Combinaisons ──
titre('Combinaisons de critères')
const combo = { zone: 'H1', avec_mpr: 'non', engage_du: '2026-01-01' }
const comboSql = get(`SELECT COUNT(*) n FROM dossier d
  JOIN site s ON s.id=d.site_id
  WHERE s.zone_climatique='H1' AND COALESCE(d.avec_mpr,0)=0 AND d.date_engagement >= '2026-01-01'`).n
ok(compter(combo) === comboSql, `trois critères combinés → ${compter(combo)} (SQL : ${comboSql})`)
ok(compter(combo) <= compter({ zone: 'H1' }), 'ajouter un critère ne peut que réduire le résultat')

const libre = compter({ q: 'Lyon' })
ok(libre > 0 && libre <= total, `recherche libre « Lyon » → ${libre} dossiers`)

// ── Injection ──
titre('Robustesse')
for (const mauvais of ["' OR 1=1 --", '"; DROP TABLE dossier; --', "%' UNION SELECT 1 --", '../../etc/passwd']) {
  try {
    const n = compter({ beneficiaire: mauvais })
    ok(n === 0, `« ${mauvais.slice(0, 22)}… » ne renvoie rien et ne casse rien`)
  } catch (e) { ok(false, `« ${mauvais} » lève : ${e.message}`) }
}
ok(get('SELECT COUNT(*) n FROM dossier').n === total, 'la table est intacte après les tentatives')

// Tri sur une colonne inventée : doit retomber sur le tri par défaut, pas planter
try {
  const r = rechercher({}, {}, { tri: 'd.numero; DROP TABLE dossier', sens: 'asc; --', limite: 5 })
  ok(r.length === 5, 'un tri forgé dans l\'URL est ignoré au profit du tri par défaut')
} catch (e) { ok(false, 'un tri forgé fait planter : ' + e.message) }

// ── Pagination ──
titre('Pagination et tri')
const p1 = rechercher({}, {}, { tri: 'numero', sens: 'asc', limite: 50, decalage: 0 })
const p2 = rechercher({}, {}, { tri: 'numero', sens: 'asc', limite: 50, decalage: 50 })
ok(p1.length === 50 && p2.length === 50, 'deux pages pleines de 50 lignes')
ok(new Set([...p1, ...p2].map((d) => d.id)).size === 100, 'aucun doublon entre deux pages consécutives')
ok(p1.at(-1).numero < p2[0].numero, 'l\'ordre est continu d\'une page à l\'autre')

const desc = rechercher({}, {}, { tri: 'cumac', sens: 'desc', limite: 10 })
const croissant = desc.every((d, i) => i === 0 || (desc[i - 1].volume_cumac ?? 0) >= (d.volume_cumac ?? 0))
ok(croissant, 'le tri décroissant sur le cumac est respecté')

// ── Totaux ──
titre('Totaux sur le résultat entier')
const t = totaux({ zone: 'H1' })
const tSql = get(`SELECT COALESCE(SUM(volume_cumac),0) c, COALESCE(SUM(marge_nette),0) m, COUNT(*) n
  FROM dossier d JOIN site s ON s.id=d.site_id WHERE s.zone_climatique='H1'`)
ok(Math.round(t.cumac) === Math.round(tSql.c), 'le cumac total porte sur tout le résultat')
ok(Math.round(t.marge) === Math.round(tSql.m), 'la marge totale aussi')
ok(t.n === tSql.n, `et le compte : ${t.n}`)

// ── Temps de réponse ──
titre('Temps de réponse')
const [, tCompte] = chrono(() => compter({}))
const [, tPage] = chrono(() => rechercher({}, {}, { tri: 'numero', sens: 'desc', limite: 50 }))
const [, tFiltre] = chrono(() => rechercher({ zone: 'H1', avec_mpr: 'non' }, {}, { limite: 50 }))
const [, tTotaux] = chrono(() => totaux({}))
const [, tDerniere] = chrono(() => rechercher({}, {}, { limite: 50, decalage: total - 50 }))
console.log(`  compte total        ${tCompte} ms`)
console.log(`  première page       ${tPage} ms`)
console.log(`  page filtrée        ${tFiltre} ms`)
console.log(`  totaux du résultat  ${tTotaux} ms`)
console.log(`  dernière page       ${tDerniere} ms`)
ok(Math.max(tCompte, tPage, tFiltre, tTotaux, tDerniere) < 300, 'toutes les requêtes sous 300 ms')

// ── Cloisonnement ──
titre('Cloisonnement sur la recherche')
const u = get('SELECT id, nom FROM unite_affaire ORDER BY nom LIMIT 1')
const nUnite = get('SELECT COUNT(*) n FROM dossier WHERE unite_affaire_id = ?', [u.id]).n
ok(compter({}, { uniteId: u.id }) === nUnite, `portée « ${u.nom} » → ${nUnite} sur ${total}`)
ok(nUnite < total, 'la portée réduit bien le périmètre')
ok(compter({ unite: null }, { uniteId: u.id }) === nUnite, 'un critère vide ne desserre pas la portée')
const autre = get('SELECT id FROM unite_affaire WHERE id <> ? LIMIT 1', [u.id]).id
ok(compter({ unite: autre }, { uniteId: u.id }) === 0, 'demander une autre unité depuis une portée restreinte ne renvoie rien')
const fuites = rechercher({}, { uniteId: u.id }, { limite: 500 }).filter((d) => d.unite_affaire_id !== u.id)
ok(fuites.length === 0, 'aucune ligne hors périmètre dans 500 résultats')

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
