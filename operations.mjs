/**
 * Contrôles du modèle par opérations.
 *
 * Le danger de ce modèle tient en une phrase : les totaux du dossier sont désormais une
 * PROJECTION de ses opérations. Si la projection dérive, la recherche, les exports, les
 * lots et le tableau de bord mentent tous en même temps, et rien ne le signale.
 *
 * Ce test attaque donc trois choses, dans l'ordre d'importance :
 *   1. la reprise ne perd rien et ne déplace aucun montant figé ;
 *   2. la projection est stable — la rejouer ne change rien ;
 *   3. la règle de gel tient : ajouter, modifier ou retirer une opération ne réécrit
 *      jamais une marge déjà figée sans qu'on l'ait demandé.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import { mettreANiveau, cheminSchemaParDefaut } from './lib/migrations.js'
import { appliquerManuelles } from './lib/migrations-manuelles.js'
import { planterJeuEssai } from './lib/jeu-essai.js'

const SOURCE = process.env.CEE_DB_SOURCE || 'db/cee.db'
const CIBLE = '/tmp/operations-test.db'

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const uid = () => crypto.randomUUID()
const cents = (n) => Math.round((Number(n) || 0) * 100)

if (!fs.existsSync(SOURCE)) {
  console.log(`Base source introuvable (${SOURCE}). Lancez ./relancer.sh d'abord.`)
  process.exit(2)
}
// ── Une copie de base ne doit rien hériter de la précédente ──
//
// SQLite range une partie des données validées dans des fichiers voisins (`-wal`, `-shm`).
// Copier la base par-dessus une ancienne copie sans les effacer, c'est greffer le journal
// d'hier sur les données d'aujourd'hui : la table et ses index se contredisent, une requête
// rend trois lignes et la suivante six. Vu pour de vrai, et très difficile à diagnostiquer.
for (const suffixe of ['', '-wal', '-shm']) fs.rmSync(CIBLE + suffixe, { force: true })
fs.copyFileSync(SOURCE, CIBLE)
process.env.CEE_DB_PATH = CIBLE

const brut = new DatabaseSync(CIBLE)

// ── De quoi travailler, même sur une plateforme neuve ──
//
// Ces contrôles cherchaient leurs cas dans la base réelle. Depuis qu'elle a été vidée,
// ils n'avaient plus rien à mordre. Le jeu d'essai n'est planté QUE si la base est vide :
// sur une base peuplée, ce sont toujours les vraies données qui sont contrôlées.
const _essai = planterJeuEssai(brut)
if (_essai.plante) console.log('  (base vide : jeu d\'essai planté — 3 dossiers)')
const q = (s, ...p) => brut.prepare(s).all(...p).map((r) => ({ ...r }))
const un = (s, ...p) => q(s, ...p)[0]

// ═══════════════════════════════════════════════════════════
titre('Reprise des dossiers existants')

const avant = un(`SELECT COUNT(*) AS dossiers,
                         SUM(CASE WHEN date_calcul IS NOT NULL THEN 1 ELSE 0 END) AS figes,
                         ROUND(COALESCE(SUM(marge_nette), 0), 2) AS marge,
                         ROUND(COALESCE(SUM(volume_cumac), 0), 2) AS volume
                  FROM dossier`)

brut.exec('PRAGMA foreign_keys = OFF')
const rapportSchema = mettreANiveau(brut, cheminSchemaParDefaut())
ok(rapportSchema.erreurs.length === 0, `mise à niveau du schéma sans erreur${rapportSchema.erreurs.length ? ' : ' + rapportSchema.erreurs.join(' | ') : ''}`)
const t0 = Date.now()
const rapport = appliquerManuelles(brut)
const msReprise = Date.now() - t0
brut.exec('PRAGMA foreign_keys = ON')
ok(rapport.erreurs.length === 0, `reprise sans erreur${rapport.erreurs.length ? ' : ' + rapport.erreurs.join(' | ') : ''}`)

const apres = un(`SELECT COUNT(*) AS dossiers,
                         SUM(CASE WHEN date_calcul IS NOT NULL THEN 1 ELSE 0 END) AS figes,
                         ROUND(COALESCE(SUM(marge_nette), 0), 2) AS marge,
                         ROUND(COALESCE(SUM(volume_cumac), 0), 2) AS volume
                  FROM dossier`)

ok(apres.dossiers === avant.dossiers, `les ${avant.dossiers} dossiers sont tous là`)
ok(apres.figes === avant.figes, `les ${avant.figes} dossiers figés le sont restés`)
ok(cents(apres.marge) === cents(avant.marge), `la marge totale est inchangée au centime (${avant.marge} €)`)
ok(cents(apres.volume) === cents(avant.volume), `le volume total est inchangé (${avant.volume} kWh cumac)`)

const orphelins = un(`SELECT COUNT(*) AS n FROM dossier d
                      WHERE NOT EXISTS (SELECT 1 FROM operation o WHERE o.dossier_id = d.id)`).n
ok(orphelins === 0, 'aucun dossier ne reste sans opération')

const sansChantier = un(`SELECT COUNT(*) AS n FROM operation WHERE chantier_id IS NULL`).n
ok(sansChantier === 0, 'aucune opération ne reste sans chantier')

const divergents = un(`SELECT COUNT(*) AS n FROM dossier d JOIN operation o ON o.dossier_id = d.id
                       WHERE COALESCE(d.marge_nette, -999999) <> COALESCE(o.marge_nette, -999999)`).n
ok(divergents === 0, 'chaque dossier repris porte exactement la marge de son opération')

const datesPerdues = un(`SELECT COUNT(*) AS n FROM dossier d JOIN operation o ON o.dossier_id = d.id
                         WHERE (d.date_calcul IS NULL) <> (o.date_calcul IS NULL)`).n
ok(datesPerdues === 0, "l'état figé/non figé a suivi sur chaque opération")

console.log(`         (reprise de ${avant.dossiers} dossiers en ${msReprise} ms)`)

// ── Rejouabilité ──
const avantRejeu = un('SELECT COUNT(*) AS n FROM operation').n
appliquerManuelles(brut)
ok(un('SELECT COUNT(*) AS n FROM operation').n === avantRejeu, 'rejouer la reprise ne duplique aucune opération')

// ═══════════════════════════════════════════════════════════
// Les modules lisent CEE_DB_PATH à l'import : on les charge maintenant.
const { synchroniserDossier, operationsDuDossier } = await import('./lib/operations.js')

titre('Stabilité de la projection')

const tousLesDossiers = q('SELECT id FROM dossier')
const photo = new Map(q(`SELECT id, volume_cumac, prime_delegataire, prime_beneficiaire,
                                commission_installateur, commission_apporteur, cout_pose,
                                marge_nette, date_calcul FROM dossier`).map((r) => [r.id, r]))

const t1 = Date.now()
for (const d of tousLesDossiers) synchroniserDossier(d.id)
const msSync = Date.now() - t1

let derives = 0
for (const [id, a] of photo) {
  const b = un(`SELECT volume_cumac, prime_delegataire, prime_beneficiaire, commission_installateur,
                       commission_apporteur, cout_pose, marge_nette, date_calcul
                FROM dossier WHERE id = ?`, id)
  for (const k of Object.keys(b)) {
    if (String(a[k] ?? '') !== String(b[k] ?? '')) {
      derives++
      if (derives <= 3) console.log(`         dérive : ${id.slice(0, 8)} ${k} ${a[k]} → ${b[k]}`)
    }
  }
}
ok(derives === 0, `resynchroniser les ${tousLesDossiers.length} dossiers ne change aucune valeur (${msSync} ms)`)

const bruitJournal = un("SELECT COUNT(*) AS n FROM journal_champ WHERE champ LIKE 'Total dossier%'").n
ok(bruitJournal === 0, 'et n\'écrit aucune ligne de journal inutile')

// Zéro et « inconnu » ne se confondent pas : les exports repris ne portent aucune marge,
// et la plateforme ne doit pas transformer cette absence en « 0,00 € ».
const vides = un(`SELECT COUNT(*) AS n FROM dossier d
                  WHERE d.marge_nette = 0 AND NOT EXISTS (
                    SELECT 1 FROM operation o
                    WHERE o.dossier_id = d.id AND o.date_calcul IS NOT NULL
                      AND o.marge_nette IS NOT NULL)`).n
ok(vides === 0, `aucun dossier n'affiche 0 € de marge faute de donnée (${vides} en affichent)`)

// On n'arrondit que NOTRE arithmétique. Les montants des opérations viennent de l'export du
// logiciel précédent, qui stocke des primes au dixième de centime (1 605,5585 €) : les
// arrondir éloignerait la plateforme de sa source. Ce contrôle interdit de « nettoyer » les
// lignes un jour par confort d'affichage.
const finesse = un(`SELECT COUNT(*) AS n FROM operation
                    WHERE prime_beneficiaire IS NOT NULL
                      AND prime_beneficiaire <> ROUND(prime_beneficiaire, 2)`).n
ok(finesse > 0,
  `les montants repris gardent la précision de la source (${finesse} opérations au dixième de centime)`)
const totauxRonds = un(`SELECT COUNT(*) AS n FROM dossier
                        WHERE prime_beneficiaire IS NOT NULL
                          AND prime_beneficiaire <> ROUND(prime_beneficiaire, 2)`).n
ok(totauxRonds === 0, `les totaux de dossier, eux, sont au centime (${totauxRonds} ne le sont pas)`)

// ═══════════════════════════════════════════════════════════
titre('Règle de gel : ajouter une opération ne réécrit pas les montants figés')

const cible = un(`SELECT d.id, d.marge_nette, d.volume_cumac, d.date_calcul, d.site_id, d.fiche_id,
                         d.fiche_version_id, d.deal_id
                  FROM dossier d WHERE d.date_calcul IS NOT NULL LIMIT 1`)

if (!cible) {
  ok(false, 'aucun dossier figé disponible pour ce contrôle')
} else {
  // ── Ne pas s'effondrer sur un dossier mal formé ──
  //
  // Ce contrôle prend le premier dossier figé qu'il trouve. Si celui-là n'a pas de
  // chantier — cas rencontré sur un dossier posé à la main —, la ligne suivante lisait
  // `chantier.id` sur un `undefined` et la suite s'arrêtait net, sur une erreur qui ne
  // parlait ni du gel ni des opérations. Un contrôle doit dire ce qui manque, pas
  // s'effondrer : on pose le chantier absent, comme le fait l'application elle-même.
  let chantier = un('SELECT id FROM chantier WHERE dossier_id = ? LIMIT 1', cible.id)
  if (!chantier) {
    const cid = uid()
    brut.prepare(`INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
                  VALUES (?,?,?,1,'Chantier principal',1)`).run(cid, cible.id, cible.site_id)
    chantier = { id: cid }
    console.log('         (le dossier visé n\'avait pas de chantier : il en a été posé un)')
  }
  const autreFiche = un(`SELECT f.id, fv.id AS vid FROM fiche f
                         JOIN fiche_version fv ON fv.fiche_id = f.id LIMIT 1`)
  if (!autreFiche) { ok(false, 'aucune fiche en base : ce contrôle a besoin d\'au moins une fiche'); process.exit(1) }
  // Combien d'opérations AVANT : sur les données réelles, 609 dossiers en ont plusieurs.
  // Compter en relatif plutôt qu'en absolu, sinon le contrôle ne teste que le jeu de démo.
  const opsAvant = operationsDuDossier(cible.id).length

  // 1. Ajout d'une opération NON valorisée.
  const opId = uid()
  brut.prepare(`INSERT INTO operation (id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id,
                                       charte, quantite, unite)
                VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(opId, cible.id, chantier.id, 2, autreFiche.id, autreFiche.vid, 'HORS_CDP', 50, 'U')
  synchroniserDossier(cible.id)

  const apresAjout = un('SELECT marge_nette, volume_cumac, date_calcul FROM dossier WHERE id = ?', cible.id)
  ok(cents(apresAjout.marge_nette) === cents(cible.marge_nette),
    `ajouter une opération non valorisée ne bouge pas la marge figée (${cible.marge_nette} €)`)
  ok(cents(apresAjout.volume_cumac) === cents(cible.volume_cumac),
    'ni le volume figé')
  ok(apresAjout.date_calcul === cible.date_calcul, 'ni la date de calcul du dossier')

  const vue = operationsDuDossier(cible.id)
  ok(vue.length === opsAvant + 1,
    `le dossier montre bien son opération de plus (${opsAvant} → ${vue.length})`)
  ok(vue.filter((o) => !o.date_calcul).length === 1, "et signale celle qui reste à valoriser")

  // 2. La valoriser la fait entrer dans les totaux — et seulement alors.
  brut.prepare(`UPDATE operation SET volume_cumac = 1000, prime_delegataire = 70,
                prime_beneficiaire = 35, commission_installateur = 15, commission_apporteur = 0,
                cout_pose = 0, marge_nette = 20, date_calcul = ? WHERE id = ?`)
    .run(new Date().toISOString(), opId)
  synchroniserDossier(cible.id)

  const apresValo = un('SELECT marge_nette, volume_cumac FROM dossier WHERE id = ?', cible.id)
  ok(cents(apresValo.marge_nette) === cents(cible.marge_nette) + 2000,
    'une fois valorisée, elle entre dans le total (+20,00 €)')
  ok(cents(apresValo.volume_cumac) === cents(cible.volume_cumac) + 100000,
    'et son volume aussi (+1 000 kWh cumac)')

  // 3. La retirer ramène exactement au point de départ.
  brut.prepare('DELETE FROM operation WHERE id = ?').run(opId)
  synchroniserDossier(cible.id)
  const apresRetrait = un('SELECT marge_nette, volume_cumac FROM dossier WHERE id = ?', cible.id)
  ok(cents(apresRetrait.marge_nette) === cents(cible.marge_nette),
    'retirer l\'opération ramène la marge à sa valeur d\'origine, au centime')
  ok(cents(apresRetrait.volume_cumac) === cents(cible.volume_cumac),
    'et le volume aussi — la projection est réversible')
}

// ═══════════════════════════════════════════════════════════
titre('Plusieurs chantiers, plusieurs zones climatiques')

const dChantier = un('SELECT id, site_id FROM dossier LIMIT 1')
const siteA = un('SELECT * FROM site WHERE id = ?', dChantier.site_id)
const siteB = uid()
brut.prepare(`INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique, secteur_activite)
              VALUES (?,?,?,?,?,?,?)`)
  .run(siteB, '2 rue du Test', '06000', 'Nice', '06', 'H3', siteA.secteur_activite)
const chB = uid()
brut.prepare(`INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
              VALUES (?,?,?,0,'Bâtiment B',2)`).run(chB, dChantier.id, siteB)

const { chantiersDuDossier } = await import('./lib/operations.js')
const ch = chantiersDuDossier(dChantier.id)
ok(ch.length >= 2, `le dossier porte ${ch.length} chantiers`)
ok(ch.some((c) => c.zone_climatique === 'H3'), 'le second chantier porte sa propre zone climatique')
ok(ch.filter((c) => c.principal).length === 1, 'un seul chantier est marqué principal')

const zonesDistinctes = new Set(ch.map((c) => c.zone_climatique).filter(Boolean)).size
ok(zonesDistinctes >= 1, `les chantiers exposent ${zonesDistinctes} zone(s) — le calcul lira celle de CHAQUE chantier, pas celle du dossier`)

// ═══════════════════════════════════════════════════════════
titre('Intégrité référentielle après reprise')

const opsSansFiche = un(`SELECT COUNT(*) AS n FROM operation o
                         LEFT JOIN fiche f ON f.id = o.fiche_id WHERE f.id IS NULL`).n
ok(opsSansFiche === 0, 'toutes les opérations pointent vers une fiche existante')

const opsSansVersion = un(`SELECT COUNT(*) AS n FROM operation o
                           LEFT JOIN fiche_version fv ON fv.id = o.fiche_version_id WHERE fv.id IS NULL`).n
ok(opsSansVersion === 0, 'et vers une version de fiche existante')

const chSansSite = un(`SELECT COUNT(*) AS n FROM chantier c
                       LEFT JOIN site s ON s.id = c.site_id WHERE s.id IS NULL`).n
ok(chSansSite === 0, 'tous les chantiers pointent vers un site existant')

const plusieursPrincipaux = un(`SELECT COUNT(*) AS n FROM (
    SELECT dossier_id FROM chantier WHERE principal = 1 GROUP BY dossier_id HAVING COUNT(*) > 1)`).n
ok(plusieursPrincipaux === 0, 'aucun dossier n\'a deux chantiers principaux')

// ═══════════════════════════════════════════════════════════
// Les contrôles ci-dessus portent sur une COPIE de la base. Ceux qui suivent passent par
// le serveur : ce sont les actions serveur, pas les fonctions, que l'utilisateur déclenche,
// et c'est là qu'un chemin d'écriture pourrait oublier de resynchroniser.
// ═══════════════════════════════════════════════════════════
titre('Les actions serveur respectent la règle de gel')

const B = 'http://localhost:3000'
const vivante = new DatabaseSync(process.env.CEE_DB_SOURCE || 'db/cee.db')
const qv = (s, ...p) => vivante.prepare(s).all(...p).map((r) => ({ ...r }))
const unv = (s, ...p) => qv(s, ...p)[0]

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

let serveurLa = false
try { serveurLa = (await fetch(B + '/connexion')).ok } catch { /* pas de serveur */ }

const compte = unv("SELECT email FROM utilisateur WHERE mot_de_passe IS NOT NULL LIMIT 1")

if (!serveurLa || !compte) {
  console.log("\n  (partie HTTP ignorée : lancez ./tester.sh d'abord, puis ce test.)")
} else {
  const cl = client()
  const { html: hc } = await cl.page('/connexion')
  const fc = formulaire(hc, 'mot_de_passe')
  if (fc) await poster(cl, '/connexion', { ...fc.champs, email: compte.email, mot_de_passe: process.env.CEE_MDP_TEST || 'MotDePasseSolide2026' })

  if (!cl.jar.has('cee_session')) {
    console.log(`\n  (partie HTTP ignorée : connexion impossible pour ${compte.email}.)`)
  } else {
    const dv = unv(`SELECT id, numero, marge_nette, volume_cumac, date_calcul
                    FROM dossier WHERE date_calcul IS NOT NULL LIMIT 1`)
    const p = await cl.page(`/dossiers/${dv.id}`)
    ok(p.statut === 200, 'la fiche dossier se charge avec le bloc opérations')
    ok(p.html.includes('Opérations'), 'le bloc opérations est rendu')
    ok(p.html.includes('Chantiers'), 'le bloc chantiers est rendu')

    const fiche = unv('SELECT id, code FROM fiche LIMIT 1')
    const fAjout = formulaire(p.html, 'name="fiche_id"', 'name="dossier_id"')
    if (!fAjout) {
      ok(false, "formulaire d'ajout d'opération introuvable")
    } else {
      const nAvant = unv('SELECT COUNT(*) AS n FROM operation WHERE dossier_id = ?', dv.id).n
      await poster(cl, `/dossiers/${dv.id}`, {
        ...fAjout.champs, dossier_id: dv.id, fiche_id: fiche.id,
        charte: 'HORS_CDP', quantite: '42', taux_apporteur: '0',
      })

      const nApres = unv('SELECT COUNT(*) AS n FROM operation WHERE dossier_id = ?', dv.id).n
      ok(nApres === nAvant + 1, `l'opération est créée par l'action serveur (${nAvant} → ${nApres})`)

      const dApres = unv('SELECT marge_nette, volume_cumac, date_calcul FROM dossier WHERE id = ?', dv.id)
      ok(cents(dApres.marge_nette) === cents(dv.marge_nette),
        "ET les montants figés du dossier n'ont pas bougé d'un centime")
      ok(cents(dApres.volume_cumac) === cents(dv.volume_cumac), 'ni le volume figé')
      ok(dApres.date_calcul === dv.date_calcul, 'ni la date de calcul')

      const rechargee = await cl.page(`/dossiers/${dv.id}`)
      ok(/à valoriser/.test(rechargee.html), "l'écran signale l'opération restée à valoriser")

      // Nettoyage : on ne laisse pas de trace dans la base de travail.
      const neuve = unv('SELECT id FROM operation WHERE dossier_id = ? ORDER BY ordre DESC LIMIT 1', dv.id)
      vivante.prepare('DELETE FROM operation WHERE id = ?').run(neuve.id)
    }

    // ── La vraie question : une régie peut-elle poser une opération hors de son unité ? ──
    // Le gérant, lui, a `dossier.tous` : le tester avec son compte ne prouverait rien.
    // On rejoue donc l'appel avec le compte de régie créé par secu.mjs.
    const regie = unv("SELECT email FROM utilisateur WHERE email = 'regie@netstrategy.fr'")
    if (!regie) {
      console.log('         (contrôle de cloisonnement ignoré : compte de régie absent — lancez ./tester.sh)')
    } else {
      const clR = client()
      const { html: hr } = await clR.page('/connexion')
      const fr2 = formulaire(hr, 'mot_de_passe')
      if (fr2) await poster(clR, '/connexion', { ...fr2.champs, email: regie.email, mot_de_passe: 'MotDePasseRegie2026' })

      if (!clR.jar.has('cee_session')) {
        console.log('         (contrôle de cloisonnement ignoré : connexion régie impossible)')
      } else {
        const sien = unv(`SELECT d.id FROM dossier d
                          JOIN utilisateur u ON u.email = 'regie@netstrategy.fr'
                          WHERE d.unite_affaire_id IS u.unite_affaire_id LIMIT 1`)
        const etranger = unv(`SELECT d.id FROM dossier d
                              JOIN utilisateur u ON u.email = 'regie@netstrategy.fr'
                              WHERE d.unite_affaire_id IS NOT u.unite_affaire_id LIMIT 1`)
        const fiche3 = unv('SELECT id FROM fiche LIMIT 1')

        if (!sien || !etranger) {
          console.log('         (contrôle de cloisonnement ignoré : pas de dossier des deux côtés)')
        } else {
          const pSien = await clR.page(`/dossiers/${sien.id}`)
          const fOp = formulaire(pSien.html, 'name="fiche_id"', 'name="dossier_id"')
          ok(!!fOp, "la régie a bien le formulaire d'ajout d'opération sur SON dossier")

          const nAv = unv('SELECT COUNT(*) AS n FROM operation WHERE dossier_id = ?', etranger.id).n
          if (fOp) {
            // Même formulaire, mais pointé sur un dossier d'une autre unité.
            await poster(clR, `/dossiers/${sien.id}`, {
              ...fOp.champs, dossier_id: etranger.id, fiche_id: fiche3.id,
              charte: 'HORS_CDP', quantite: '999',
            })
          }
          const nAp = unv('SELECT COUNT(*) AS n FROM operation WHERE dossier_id = ?', etranger.id).n
          ok(nAp === nAv,
            `l'action serveur refuse d'ajouter une opération sur le dossier d'une autre unité (${nAv} opération(s), inchangé)`)

          // Et la suppression, qui est l'autre porte d'entrée.
          const opEtrangere = unv('SELECT id FROM operation WHERE dossier_id = ? LIMIT 1', etranger.id)
          if (opEtrangere) {
            await poster(clR, `/dossiers/${sien.id}`, { id: opEtrangere.id })
            const existeEncore = unv('SELECT COUNT(*) AS n FROM operation WHERE id = ?', opEtrangere.id).n
            ok(existeEncore === 1, "et refuse d'en supprimer une hors de sa portée")
          }
        }
      }
    }
  }
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
