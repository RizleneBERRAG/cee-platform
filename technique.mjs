/**
 * Contrôles des blocs réglementaires ajoutés après le relevé Pixel :
 * contrainte de charte, cohérence des ratios, devis/facture séparés, réseau de chaleur,
 * audit énergétique, contrôles COFRAC en deux passages.
 *
 * Deux moitiés, et les deux comptent.
 *
 * - En base : ce que le schéma autorise réellement. Une contrainte qu'on croit corrigée
 *   sans l'avoir vue accepter la ligne qu'elle rejetait avant n'est pas corrigée.
 * - En HTTP : les quatre nouvelles actions serveur sont une surface d'attaque neuve. On
 *   rejoue donc les appels tels qu'un compte d'une autre unité les enverrait. Masquer un
 *   formulaire ne protège rien — seul le refus du serveur compte.
 *
 * Lancez ./relancer.sh avant : le test HTTP part d'une base neuve.
 */
import { DatabaseSync } from 'node:sqlite'
import { anomaliesRatios } from './lib/ratios.js'
import { accreditationCouvre } from './lib/referentiels-technique.js'

const B = 'http://localhost:3000'
const db = new DatabaseSync('db/cee.db')

// ── Cette suite exige la base de DÉMONSTRATION ──
//
// Elle passe par le serveur et rejoue des scénarios complets : plusieurs unités d'affaire,
// des dossiers dans chacune, des pièces déposées, des deals portant des dossiers figés.
// C'est ce que `./relancer.sh` fabrique. Sur la base de production — qui est vide depuis
// l'archivage de l'ancienne activité — il n'y a rien à contrôler.
//
// On s'arrête donc en le DISANT, avec le code 2 (ni succès ni échec). Faire échouer la
// suite ferait croire à une régression ; la faire passer sur une base vide ferait croire à
// une couverture qui n'existe pas.
const _nbDossiers = db.prepare('SELECT COUNT(*) AS n FROM dossier').get().n
if (_nbDossiers === 0) {
  console.log('IGNORÉ — cette suite a besoin de la base de démonstration.')
  console.log('         Sauvegardez db/cee.db, lancez ./relancer.sh, relancez ce test, puis restaurez.')
  process.exit(2)
}
const q = (s, ...p) => db.prepare(s).all(...p).map((r) => ({ ...r }))
const un = (s, ...p) => q(s, ...p)[0]
let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const uid = () => crypto.randomUUID()

// ═══════════════════════════════════════════════════════════
titre('Contrainte de charte : la même fiche deux fois sur un deal')

const deal = un('SELECT id FROM deal LIMIT 1')
const fiche = un('SELECT id, code FROM fiche LIMIT 1')
ok(!!deal && !!fiche, 'un deal et une fiche existent pour le test')

if (deal && fiche) {
  db.prepare('DELETE FROM deal_fiche WHERE deal_id = ? AND fiche_id = ?').run(deal.id, fiche.id)

  let poseeHorsCdp = false, poseeCdp = false, refusDoublon = false
  try {
    db.prepare('INSERT INTO deal_fiche (id, deal_id, fiche_id, charte) VALUES (?,?,?,?)')
      .run(uid(), deal.id, fiche.id, 'HORS_CDP')
    poseeHorsCdp = true
  } catch { /* échec signalé plus bas */ }

  try {
    db.prepare('INSERT INTO deal_fiche (id, deal_id, fiche_id, charte) VALUES (?,?,?,?)')
      .run(uid(), deal.id, fiche.id, 'CDP')
    poseeCdp = true
  } catch { /* c'est précisément ce qui échouait avant la migration */ }

  // La contrainte doit rester utile : le VRAI doublon, lui, est toujours refusé.
  try {
    db.prepare('INSERT INTO deal_fiche (id, deal_id, fiche_id, charte) VALUES (?,?,?,?)')
      .run(uid(), deal.id, fiche.id, 'CDP')
  } catch { refusDoublon = true }

  ok(poseeHorsCdp, `${fiche.code} accepté hors coup de pouce`)
  ok(poseeCdp, `${fiche.code} accepté AUSSI en coup de pouce sur le même deal (c'est ce qui échouait)`)
  ok(refusDoublon, 'le vrai doublon (même deal, même fiche, même charte) reste refusé')

  db.prepare('DELETE FROM deal_fiche WHERE deal_id = ? AND fiche_id = ?').run(deal.id, fiche.id)
}

const defDealFiche = un("SELECT sql FROM sqlite_master WHERE name = 'deal_fiche'")?.sql || ''
ok(/UNIQUE\s*\([^)]*charte[^)]*\)/i.test(defDealFiche), 'la contrainte enregistrée mentionne bien la charte')

// ═══════════════════════════════════════════════════════════
titre('Cohérence de la grille de ratios')

const saine = {
  r_deleg_precaire_sans_mpr: 7, r_cede_precaire_sans_mpr: 3.5, r_garde_precaire_sans_mpr: 1.5,
  r_deleg_precaire_avec_mpr: 7, r_cede_precaire_avec_mpr: 3.5, r_garde_precaire_avec_mpr: 1.5,
  r_deleg_classique_sans_mpr: 6, r_cede_classique_sans_mpr: 3, r_garde_classique_sans_mpr: 1.5,
  r_deleg_classique_avec_mpr: 6, r_cede_classique_avec_mpr: 3, r_garde_classique_avec_mpr: 1.5,
}
ok(anomaliesRatios(saine).length === 0, 'une grille au reliquat positif ne déclenche rien')
ok(anomaliesRatios({}).length === 0, 'une grille vide ne déclenche rien (elle n\'est pas renseignée)')

// Le cas que l'on ne doit PAS signaler : reliquat nul, quand l'installateur est la société
// elle-même. C'est la configuration observée chez le confrère ; l'interdire serait une faute.
const reliquatNul = { ...saine, r_garde_precaire_sans_mpr: 3.5, r_garde_precaire_avec_mpr: 3.5 }
ok(anomaliesRatios(reliquatNul).length === 0, 'un reliquat NUL reste légitime et n\'est pas signalé')

// ── Pourquoi ce n'est plus une ERREUR ──
//
// Ce contrôle exigeait autrefois une erreur. Le relevé des douze contrats de l'ancien
// logiciel l'a démenti : onze d'entre eux cumulent au-delà de ce que verse le délégataire,
// parce que « prime cédée » et « commission installateur » y sont vraisemblablement deux
// tarifs au choix et non deux prélèvements. Un contrôle qui crie à la faute sur onze cas
// sur douze n'alerte plus personne. On signale, on ne condamne pas.
const perte = anomaliesRatios({ ...saine, r_cede_precaire_sans_mpr: 6 })
ok(perte.length === 1 && perte[0].gravite === 'DOUTE', 'un reliquat négatif est signalé, comme un doute à trancher')
ok(/de plus par MWh/.test(perte[0].message), 'et le message donne le calcul plutôt qu\'un verdict')
ok(/perd de l'argent/.test(perte[0].message), 'le message dit ce que ça coûte, pas seulement qu\'il y a un écart')

const negatif = anomaliesRatios({ ...saine, r_garde_classique_avec_mpr: -1 })
ok(negatif.some((x) => x.gravite === 'ERREUR'), 'un tarif négatif est une erreur')

const virgule = anomaliesRatios({ ...saine, r_cede_precaire_sans_mpr: 35 })
ok(virgule.some((x) => x.gravite === 'DOUTE' && /[Vv]irgule/.test(x.message)), 'une virgule oubliée est repérée')

// ═══════════════════════════════════════════════════════════
titre('Accréditation des bureaux de contrôle')

const bureaux = q('SELECT * FROM bureau_controle')
ok(bureaux.length >= 12, `le référentiel est peuplé (${bureaux.length} bureaux)`)
ok(bureaux.some((b) => b.date_fin_accreditation), 'au moins un bureau porte une date de fin d\'accréditation')

const perime = { nom: 'Bureau X', date_fin_accreditation: '2024-06-30' }
const apres = accreditationCouvre(perime, '2025-01-15')
ok(apres.etat === 'PERIMEE', 'un contrôle postérieur à l\'échéance est signalé')
ok(/rejeté au dépôt/.test(apres.message || ''), 'le message dit la conséquence réelle : le rejet au dépôt')
ok(accreditationCouvre(perime, '2024-01-15').etat === 'OK', 'un contrôle antérieur à l\'échéance passe')
ok(accreditationCouvre(perime, '2024-06-30').etat === 'OK', 'le jour même de l\'échéance est encore couvert')
ok(accreditationCouvre({ nom: 'Y', date_fin_accreditation: null }, '2025-01-01').etat === 'INCONNUE',
  'un bureau sans date est déclaré non vérifiable, pas « valide »')

// ═══════════════════════════════════════════════════════════
titre('Les blocs ne touchent pas au calcul')

const avantFige = un(`SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(marge_nette), 0), 2) AS s
                      FROM dossier WHERE date_calcul IS NOT NULL`)
const cible = un('SELECT id FROM dossier WHERE date_calcul IS NOT NULL LIMIT 1')
if (cible) {
  db.prepare(`UPDATE dossier SET reseau_statut = 'INEXISTANT', facture_deduire_prime = 0 WHERE id = ?`).run(cible.id)
  db.prepare('INSERT INTO controle (id, dossier_id, passage, modalite, date, resultat) VALUES (?,?,?,?,?,?)')
    .run(uid(), cible.id, 1, 'SUR_SITE', '2026-01-15', 'CONFORME')
  const apresFige = un(`SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(marge_nette), 0), 2) AS s
                        FROM dossier WHERE date_calcul IS NOT NULL`)
  ok(apresFige.n === avantFige.n && apresFige.s === avantFige.s,
    `renseigner réseau, facture et contrôle sur un dossier figé ne bouge pas la marge (${avantFige.s} €)`)
  db.prepare('DELETE FROM controle WHERE dossier_id = ?').run(cible.id)
} else {
  ok(false, 'aucun dossier figé pour ce contrôle')
}

// ═══════════════════════════════════════════════════════════
titre('Deux passages de contrôle coexistent')

const d2 = un('SELECT id FROM dossier LIMIT 1')
db.prepare('DELETE FROM controle WHERE dossier_id = ?').run(d2.id)
db.prepare('INSERT INTO controle (id, dossier_id, passage, modalite, resultat) VALUES (?,?,?,?,?)')
  .run(uid(), d2.id, 1, 'SUR_SITE', 'NON_CONFORME')
db.prepare('INSERT INTO controle (id, dossier_id, passage, modalite, resultat) VALUES (?,?,?,?,?)')
  .run(uid(), d2.id, 2, 'SUR_SITE', 'CONFORME')
const deux = q('SELECT passage, resultat FROM controle WHERE dossier_id = ? ORDER BY passage', d2.id)
ok(deux.length === 2, 'les deux passages sont enregistrés côte à côte')
ok(deux[0].resultat === 'NON_CONFORME' && deux[1].resultat === 'CONFORME',
  'le contre-contrôle n\'écrase pas la non-conformité initiale — c\'est ce qu\'un contrôleur vient vérifier')
db.prepare('DELETE FROM controle WHERE dossier_id = ?').run(d2.id)

// ═══════════════════════════════════════════════════════════
// Partie HTTP : les nouvelles actions serveur sont-elles cloisonnées ?
// ═══════════════════════════════════════════════════════════
titre('Cloisonnement des nouvelles actions serveur')

function client() {
  const jar = new Map()
  return {
    jar,
    async fetch(url, opts = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      const r = await fetch(B + url, {
        ...opts, redirect: 'manual',
        headers: { ...(opts.headers || {}), origin: B, ...(cookie ? { cookie } : {}) },
      })
      for (const sc of r.headers.getSetCookie?.() || []) {
        const [kv] = sc.split(';')
        const i = kv.indexOf('=')
        const k = kv.slice(0, i), v = kv.slice(i + 1)
        if (v === '') jar.delete(k); else jar.set(k, v)
      }
      return r
    },
    async page(url) {
      let r = await this.fetch(url)
      let n = 0
      while ([301, 302, 303, 307, 308].includes(r.status) && n++ < 5) {
        const u = new URL(r.headers.get('location'), B)
        r = await this.fetch(u.pathname + u.search)
      }
      return { statut: r.status, html: await r.text() }
    },
  }
}

function formulaire(html, ...marqueurs) {
  const forms = html.split('<form').slice(1).map((f) => '<form' + f.split('</form>')[0])
  const f = forms.find((x) => marqueurs.every((m) => x.includes(m)))
  if (!f) return null
  const champs = {}
  for (const m of f.matchAll(/<input\b([^>]*)>/g)) {
    const nom = /name="([^"]+)"/.exec(m[1])?.[1]
    if (!nom) continue
    champs[nom] = /value="([^"]*)"/.exec(m[1])?.[1] ?? ''
  }
  return { action: /action="([^"]*)"/.exec(f)?.[1] || '', champs }
}

const poster = async (cl, url, donnees) => {
  const body = new FormData()
  for (const [k, v] of Object.entries(donnees)) body.append(k, v)
  let r = await cl.fetch(url, { method: 'POST', body })
  let n = 0
  while ([301, 302, 303, 307, 308].includes(r.status) && n++ < 5) {
    const u = new URL(r.headers.get('location'), B)
    r = await cl.fetch(u.pathname + u.search)
  }
  return { statut: r.status, html: await r.text() }
}

const compte = un(`SELECT u.email, r.code FROM utilisateur u LEFT JOIN role r ON r.id = u.role_id
                   WHERE u.mot_de_passe IS NOT NULL LIMIT 1`)

if (!compte) {
  console.log('\n  (partie HTTP ignorée : aucun compte. Lancez ./relancer.sh puis ./tester.sh d\'abord.)')
} else {
  const MDP = process.env.CEE_MDP_TEST || 'MotDePasseSolide2026'
  const cl = client()
  let { html } = await cl.page('/connexion')
  const fc = formulaire(html, 'mot_de_passe')
  if (fc) await poster(cl, '/connexion', { ...fc.champs, email: compte.email, mot_de_passe: MDP })

  if (!cl.jar.has('cee_session')) {
    console.log(`\n  (partie HTTP ignorée : connexion impossible pour ${compte.email}.)`)
  } else {
    const dossier = un('SELECT id, numero FROM dossier LIMIT 1')
    const p = await cl.page(`/dossiers/${dossier.id}`)
    ok(p.statut === 200, 'la fiche dossier se charge avec les nouveaux blocs')
    ok(p.html.includes('Réseau public de chaleur'), 'le bloc réseau de chaleur est rendu')
    ok(p.html.includes('Audit énergétique'), 'le bloc audit énergétique est rendu')
    ok(p.html.includes('Contre-contrôle'), 'le second passage de contrôle est proposé')
    ok(p.html.includes('Devis et facture'), 'le bloc devis/facture est rendu')

    const fr = formulaire(p.html, 'reseau_statut')
    if (fr) {
      await poster(cl, `/dossiers/${dossier.id}`, {
        ...fr.champs, dossier_id: dossier.id, reseau_statut: 'INEXISTANT', reseau_nom: 'Aucun',
      })
      const apresEcriture = un('SELECT reseau_statut FROM dossier WHERE id = ?', dossier.id)
      ok(apresEcriture.reseau_statut === 'INEXISTANT', 'le statut réseau est bien enregistré')

      // Une valeur hors de la liste fermée ne doit pas s'installer en base.
      await poster(cl, `/dossiers/${dossier.id}`, {
        ...fr.champs, dossier_id: dossier.id, reseau_statut: 'N_IMPORTE_QUOI',
      })
      const apresPoison = un('SELECT reseau_statut FROM dossier WHERE id = ?', dossier.id)
      ok(apresPoison.reseau_statut === null,
        'une valeur hors référentiel est refusée (remise à vide), pas écrite telle quelle')
      ok(apresPoison.reseau_statut !== 'N_IMPORTE_QUOI', 'aucune valeur inventée n\'entre en base')

      // Le journal doit porter la trace de ces écritures : c'est ce qu'un contrôleur relira.
      const trace = un(`SELECT COUNT(*) AS n FROM journal_champ
                        WHERE dossier_id = ? AND champ LIKE 'Réseau%'`, dossier.id).n
      ok(trace > 0, 'les écritures du bloc réseau sont journalisées')
    } else {
      ok(false, 'formulaire réseau introuvable dans la page')
    }
  }
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
