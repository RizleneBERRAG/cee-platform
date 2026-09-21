/**
 * Contrôles du parcours commercial et des intervenants.
 *
 * Deux pièges guettent cette fonctionnalité, et ce sont eux qu'on attaque en priorité.
 *
 * 1. **La duplication de lignes.** Un dossier a N intervenants. Filtrer par jointure le
 *    ferait apparaître N fois : le comptage serait faux, et les totaux de marge du tableau
 *    de bord seraient multipliés par le nombre de commerciaux. D'où le EXISTS — qu'il faut
 *    prouver, pas supposer.
 * 2. **La valeur inventée.** Les listes fermées ne valent que si le serveur refuse ce qui
 *    n'y figure pas. Un champ « fermé » qui accepte n'importe quoi est un champ libre avec
 *    une décoration.
 */
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { planterJeuEssai } from './lib/jeu-essai.js'
import {
  anomaliesCommerciales, valeurDe, TYPES_LEAD, ETATS_DEVIS, ROLES_INTERVENANT,
  libelleRole, roleCommissionne,
} from './lib/referentiels-commercial.js'
import { CRITERES, SECTIONS, construireFiltres } from './lib/recherche.js'

const B = 'http://localhost:3000'

// ── Sur une COPIE, jamais sur la base réelle ──
//
// Ces contrôles écrivent puis effacent (un intervenant, un taux de commission). Le faire
// dans la base de travail revenait à parier sur le fait que le nettoyage passe toujours ;
// une interruption en plein test y laissait des lignes. La copie règle la question, et
// permet en prime de planter un jeu d'essai quand la plateforme est neuve.
const SOURCE = process.env.CEE_DB_SOURCE || 'db/cee.db'
const CIBLE = '/tmp/commercial-test.db'
// Effacer le journal d'une copie précédente : un `-wal` orphelin se greffe sur la
// nouvelle copie et fait diverger la table de ses index.
for (const suffixe of ['', '-wal', '-shm']) fs.rmSync(CIBLE + suffixe, { force: true })
fs.copyFileSync(SOURCE, CIBLE)
const db = new DatabaseSync(CIBLE)
const _essai = planterJeuEssai(db)
if (_essai.plante) {
  // La reprise n'a pas tourné sur cette copie : les dossiers plantés n'ont pas encore
  // d'opération. On la joue, puisque c'est l'état normal d'un dossier dans la plateforme.
  const { reprendreDossiersEnOperations } = await import('./lib/migrations-manuelles.js')
  db.exec('PRAGMA foreign_keys = OFF')
  reprendreDossiersEnOperations(db)
  db.exec('PRAGMA foreign_keys = ON')
  console.log('  (base vide : jeu d\'essai planté — 3 dossiers)')
}
const q = (s, ...p) => db.prepare(s).all(...p).map((r) => ({ ...r }))
const un = (s, ...p) => q(s, ...p)[0]
let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const uid = () => crypto.randomUUID()

// ═══════════════════════════════════════════════════════════
titre('Listes fermées')

ok(valeurDe(TYPES_LEAD, 'CALL_CENTER') === 'CALL_CENTER', 'une valeur du référentiel passe')
ok(valeurDe(TYPES_LEAD, 'callcenter') === null, 'une casse différente est refusée, pas normalisée en douce')
ok(valeurDe(TYPES_LEAD, "'; DROP TABLE dossier; --") === null, 'une valeur hostile est refusée')
ok(valeurDe(ETATS_DEVIS, '') === null, 'une valeur vide donne null, pas une chaîne vide')
ok(ROLES_INTERVENANT.length === 8, `${ROLES_INTERVENANT.length} rôles déclarés`)
ok(roleCommissionne('APPORTEUR') === true, "l'apporteur est marqué commissionné")
ok(roleCommissionne('MANAGER') === false, 'le manager ne l\'est pas')
ok(libelleRole('COMMERCIAL_TERRAIN') === 'Commercial terrain', 'les libellés sont lisibles')

// ═══════════════════════════════════════════════════════════
titre('Anomalies du parcours')

ok(anomaliesCommerciales({}).length === 0, 'un dossier vide ne déclenche rien')

const inverse = anomaliesCommerciales({ date_proposition: '2026-03-10', date_signature: '2026-02-01' })
ok(inverse.length === 1 && inverse[0].gravite === 'ERREUR', 'signature avant proposition : erreur')
ok(/version de fiche applicable/.test(inverse[0].message),
  'le message explique la conséquence réelle, pas seulement l\'incohérence')

ok(anomaliesCommerciales({ date_proposition: '2026-02-01', date_signature: '2026-03-10' }).length === 0,
  'des dates dans le bon ordre ne déclenchent rien')

const rdvInverse = anomaliesCommerciales({ date_rdv_planifie: '2026-03-10', date_rdv_visite: '2026-03-01' })
ok(rdvInverse.some((a) => a.gravite === 'ERREUR'), 'RDV visité avant d\'être planifié : erreur')

const signeSansDate = anomaliesCommerciales({ etat_devis: 'SIGNE' })
ok(signeSansDate.some((a) => a.gravite === 'ATTENTION'), 'devis signé sans date de signature : attention')

const nonConforme = anomaliesCommerciales({ etat_devis: 'ORIGINAL_RECU_NON_CONFORME' })
ok(/refusé au dépôt/.test(nonConforme[0]?.message || ''),
  'un original non conforme annonce le refus au dépôt')

ok(anomaliesCommerciales({ rdv_confirme: 1 }).some((a) => /confirmation/.test(a.message)),
  'RDV confirmé sans date de confirmation : signalé')

// ═══════════════════════════════════════════════════════════
titre('Critères de recherche')

ok(Object.keys(CRITERES).length >= 55, `${Object.keys(CRITERES).length} critères déclarés`)
ok(SECTIONS.includes('Parcours commercial'), 'la section Parcours commercial est affichable')
const critCommerciaux = Object.entries(CRITERES).filter(([, c]) => c.section === 'Parcours commercial')
ok(critCommerciaux.length === 10, `${critCommerciaux.length} critères dans la section`)

// Les critères sans colonne SQL ne doivent jamais produire un « null » interpolé.
const fIntervenant = construireFiltres({ intervenant: 'Dupont' })
ok(!/null/i.test(fIntervenant.where), 'le critère intervenant ne fabrique pas de SQL « null »')
ok(/EXISTS/.test(fIntervenant.where), 'il passe bien par un EXISTS')
ok(fIntervenant.params.length === 4, 'et lie ses quatre paramètres')

const fRole = construireFiltres({ role_tenu: 'APPORTEUR' })
ok(/EXISTS/.test(fRole.where) && fRole.params[0] === 'APPORTEUR', 'le critère rôle aussi')

// Le cloisonnement doit rester ajouté APRÈS, même avec ces nouveaux critères.
const fPortee = construireFiltres({ intervenant: 'X' }, { uniteId: 'u1' })
ok(/d\.unite_affaire_id IS \?/.test(fPortee.where), 'la portée est toujours appliquée')
ok(fPortee.params.at(-1) === 'u1', 'et en dernier paramètre')
ok(!fPortee.actifs.some((a) => a.cle === 'unite'),
  "elle n'apparaît pas dans les filtres actifs — l'utilisateur ne peut pas la retirer")

// ═══════════════════════════════════════════════════════════
titre('Le filtre intervenant ne duplique aucun dossier')

const dossiers = q('SELECT id, numero FROM dossier LIMIT 3')
if (dossiers.length === 0) {
  ok(false, 'aucun dossier pour ce contrôle')
} else {
  const cible = dossiers[0]
  db.prepare('DELETE FROM dossier_intervenant WHERE dossier_id = ?').run(cible.id)

  // Trois intervenants sur le MÊME dossier : c'est le cas qui casse une jointure naïve.
  for (const [role, nom] of [
    ['APPORTEUR', 'Martin Dupont'],
    ['COMMERCIAL_TERRAIN', 'Martin Dupont'],
    ['MANAGER', 'Martin Dupont'],
  ]) {
    db.prepare(`INSERT INTO dossier_intervenant (id, dossier_id, role, nom) VALUES (?,?,?,?)`)
      .run(uid(), cible.id, role, nom)
  }

  const { where, params } = construireFiltres({ intervenant: 'Dupont' })
  const lignes = q(`SELECT d.id FROM dossier d
                    JOIN beneficiaire b ON b.id = d.beneficiaire_id
                    JOIN site s ON s.id = d.site_id
                    JOIN fiche f ON f.id = d.fiche_id ${where}`, ...params)
  ok(lignes.length === 1, `le dossier à trois intervenants ne ressort qu'UNE fois (${lignes.length} ligne(s))`)
  ok(lignes[0]?.id === cible.id, 'et c\'est bien le bon dossier')

  // Recherche par prénom, par nom, et par nom complet.
  for (const terme of ['Martin', 'Dupont', 'Martin Dupont']) {
    const f = construireFiltres({ intervenant: terme })
    const n = q(`SELECT d.id FROM dossier d
                 JOIN beneficiaire b ON b.id = d.beneficiaire_id
                 JOIN site s ON s.id = d.site_id
                 JOIN fiche f ON f.id = d.fiche_id ${f.where}`, ...f.params).length
    ok(n === 1, `« ${terme} » retrouve le dossier, une seule fois`)
  }

  // Un intervenant qui a un COMPTE doit être retrouvé par son nom de compte.
  const compte = un('SELECT id, prenom, nom FROM utilisateur WHERE mot_de_passe IS NOT NULL LIMIT 1')
  if (compte) {
    const autre = dossiers[1] || cible
    db.prepare('DELETE FROM dossier_intervenant WHERE dossier_id = ? AND role = ?').run(autre.id, 'COMMERCIAL')
    db.prepare('INSERT INTO dossier_intervenant (id, dossier_id, role, utilisateur_id) VALUES (?,?,?,?)')
      .run(uid(), autre.id, 'COMMERCIAL', compte.id)
    const f = construireFiltres({ intervenant: compte.nom })
    const trouves = q(`SELECT DISTINCT d.id FROM dossier d
                       JOIN beneficiaire b ON b.id = d.beneficiaire_id
                       JOIN site s ON s.id = d.site_id
                       JOIN fiche f ON f.id = d.fiche_id ${f.where}`, ...f.params)
    ok(trouves.some((x) => x.id === autre.id),
      `un intervenant rattaché à un compte est retrouvé par son nom (${compte.nom})`)
    db.prepare('DELETE FROM dossier_intervenant WHERE dossier_id = ? AND utilisateur_id = ?').run(autre.id, compte.id)
  }

  // Le filtre par rôle.
  const fr = construireFiltres({ role_tenu: 'MANAGER' })
  const avecManager = q(`SELECT d.id FROM dossier d
                         JOIN beneficiaire b ON b.id = d.beneficiaire_id
                         JOIN site s ON s.id = d.site_id
                         JOIN fiche f ON f.id = d.fiche_id ${fr.where}`, ...fr.params)
  ok(avecManager.length === 1, 'le filtre par rôle retrouve le dossier une seule fois')

  db.prepare('DELETE FROM dossier_intervenant WHERE dossier_id = ?').run(cible.id)
}

// ═══════════════════════════════════════════════════════════
titre('Le parcours commercial ne touche pas au calcul')

const avantFige = un(`SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(marge_nette), 0), 2) AS s
                      FROM dossier WHERE date_calcul IS NOT NULL`)
const figeCible = un('SELECT id FROM dossier WHERE date_calcul IS NOT NULL LIMIT 1')
if (figeCible) {
  db.prepare(`UPDATE dossier SET type_lead = 'CALL_CENTER', etat_devis = 'SIGNE',
              date_signature = '2026-01-15', campagne = 'Test' WHERE id = ?`).run(figeCible.id)
  db.prepare('INSERT INTO dossier_intervenant (id, dossier_id, role, nom, taux_commission) VALUES (?,?,?,?,?)')
    .run(uid(), figeCible.id, 'APPORTEUR', 'Test Apporteur', 12)
  const apresFige = un(`SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(marge_nette), 0), 2) AS s
                        FROM dossier WHERE date_calcul IS NOT NULL`)
  ok(apresFige.n === avantFige.n && apresFige.s === avantFige.s,
    `renseigner le parcours et un apporteur à 12 % ne bouge pas la marge figée (${avantFige.s} €)`)
  ok(un('SELECT taux_commission AS t FROM dossier_intervenant WHERE dossier_id = ?', figeCible.id)?.t === 12,
    "le taux est bien conservé — mais reste indicatif, la commission vient de l'opération")
  db.prepare('DELETE FROM dossier_intervenant WHERE dossier_id = ?').run(figeCible.id)
} else {
  ok(false, 'aucun dossier figé pour ce contrôle')
}

// ═══════════════════════════════════════════════════════════
titre('Actions serveur')

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
  return { champs }
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

let serveur = false
try { serveur = (await fetch(B + '/connexion')).ok } catch { /* pas de serveur */ }
const compteTest = un("SELECT email FROM utilisateur WHERE mot_de_passe IS NOT NULL LIMIT 1")

if (!serveur || !compteTest) {
  console.log("\n  (partie HTTP ignorée : lancez ./tester.sh d'abord.)")
} else {
  const cl = client()
  const { html: hc } = await cl.page('/connexion')
  const fc = formulaire(hc, 'mot_de_passe')
  if (fc) await poster(cl, '/connexion', { ...fc.champs, email: compteTest.email, mot_de_passe: process.env.CEE_MDP_TEST || 'MotDePasseSolide2026' })

  if (!cl.jar.has('cee_session')) {
    console.log(`\n  (partie HTTP ignorée : connexion impossible pour ${compteTest.email}.)`)
  } else {
    const dv = un('SELECT id FROM dossier LIMIT 1')
    const p = await cl.page(`/dossiers/${dv.id}`)
    ok(p.statut === 200 && /Parcours commercial/.test(p.html), 'le bloc parcours commercial est rendu')
    ok(/Intervenants/.test(p.html), 'le bloc intervenants est rendu')

    const fCom = formulaire(p.html, 'name="type_lead"') || formulaire(p.html, 'name="num_devis"')
    if (!fCom) {
      ok(false, 'formulaire du parcours commercial introuvable')
    } else {
      await poster(cl, `/dossiers/${dv.id}`, {
        ...fCom.champs, dossier_id: dv.id, type_lead: 'PARRAINAGE',
        etat_devis: 'A_SIGNER', num_devis: 'DV-TEST-1', date_signature: '2026-04-01',
      })
      const apres = un('SELECT type_lead, etat_devis, num_devis, date_signature FROM dossier WHERE id = ?', dv.id)
      ok(apres.type_lead === 'PARRAINAGE', "le type de lead est enregistré")
      ok(apres.num_devis === 'DV-TEST-1', 'le n° de devis aussi')

      // Une valeur hors liste ne doit pas s'installer en base.
      await poster(cl, `/dossiers/${dv.id}`, {
        ...fCom.champs, dossier_id: dv.id, type_lead: 'INVENTE', etat_devis: 'AUSSI_INVENTE',
      })
      const poison = un('SELECT type_lead, etat_devis FROM dossier WHERE id = ?', dv.id)
      ok(poison.type_lead === null && poison.etat_devis === null,
        'une valeur hors référentiel est refusée (remise à vide), jamais écrite telle quelle')

      const trace = un(`SELECT COUNT(*) AS n FROM journal_champ
                        WHERE dossier_id = ? AND champ = 'Type de lead'`, dv.id).n
      ok(trace > 0, 'les écritures du parcours sont journalisées')
    }

    // Cloisonnement : une régie ne rattache pas d'intervenant hors de sa portée.
    const regie = un("SELECT email FROM utilisateur WHERE email = 'regie@netstrategy.fr'")
    if (!regie) {
      console.log('         (cloisonnement ignoré : compte de régie absent — lancez ./tester.sh)')
    } else {
      const clR = client()
      const { html: hr } = await clR.page('/connexion')
      const fr2 = formulaire(hr, 'mot_de_passe')
      if (fr2) await poster(clR, '/connexion', { ...fr2.champs, email: regie.email, mot_de_passe: 'MotDePasseRegie2026' })

      if (clR.jar.has('cee_session')) {
        const sien = un(`SELECT d.id FROM dossier d JOIN utilisateur u ON u.email = 'regie@netstrategy.fr'
                         WHERE d.unite_affaire_id IS u.unite_affaire_id LIMIT 1`)
        const etranger = un(`SELECT d.id FROM dossier d JOIN utilisateur u ON u.email = 'regie@netstrategy.fr'
                             WHERE d.unite_affaire_id IS NOT u.unite_affaire_id LIMIT 1`)
        if (sien && etranger) {
          const pS = await clR.page(`/dossiers/${sien.id}`)
          const fInt = formulaire(pS.html, 'name="dossier_id"', 'name="nom"')
          const nAv = un('SELECT COUNT(*) AS n FROM dossier_intervenant WHERE dossier_id = ?', etranger.id).n
          if (fInt) {
            await poster(clR, `/dossiers/${sien.id}`, {
              ...fInt.champs, dossier_id: etranger.id, role: 'APPORTEUR', nom: 'Intrus',
            })
          }
          const nAp = un('SELECT COUNT(*) AS n FROM dossier_intervenant WHERE dossier_id = ?', etranger.id).n
          ok(nAp === nAv, "l'action serveur refuse de rattacher un intervenant hors de la portée")
        }
      }
    }
  }
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
