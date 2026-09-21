/**
 * Test du paramétrage, en HTTP direct.
 *
 * Ce qu'il doit prouver, dans l'ordre d'importance :
 *  1. changer un tarif ne recalcule JAMAIS un dossier figé ;
 *  2. on ne supprime pas ce qui est utilisé ;
 *  3. rien de tout cela n'est accessible sans le droit correspondant, même en appelant
 *     les actions serveur à la main.
 */
import { DatabaseSync } from 'node:sqlite'

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

function client() {
  const jar = new Map()
  const F = async (url, opts = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    const r = await fetch(B + url, { ...opts, redirect: 'manual',
      headers: { ...(opts.headers || {}), origin: B, ...(cookie ? { cookie } : {}) } })
    for (const sc of r.headers.getSetCookie?.() || []) {
      const kv = sc.split(';')[0]; const i = kv.indexOf('=')
      const k = kv.slice(0, i), v = kv.slice(i + 1)
      if (v === '') jar.delete(k); else jar.set(k, v)
    }
    return r
  }
  const suivre = async (r) => {
    let s = 0
    while ([301, 302, 303, 307, 308].includes(r.status) && s++ < 5) {
      const u = new URL(r.headers.get('location'), B)
      r = await F(u.pathname + u.search)
    }
    return { statut: r.status, html: await r.text() }
  }
  return {
    jar, F,
    page: (url) => F(url).then(suivre),
    poster: async (url, donnees) => {
      const body = new FormData()
      for (const [k, v] of Object.entries(donnees)) {
        if (Array.isArray(v)) v.forEach((x) => body.append(k, x)); else body.append(k, v)
      }
      return suivre(await F(url, { method: 'POST', body }))
    },
  }
}

const formulaire = (html, ...marqueurs) => {
  const forms = html.split('<form').slice(1).map((f) => '<form' + f.split('</form>')[0])
  const f = forms.find((x) => marqueurs.every((m) => x.includes(m)))
  if (!f) return null
  const champs = {}
  for (const m of f.matchAll(/<input\b([^>]*)>/g)) {
    const n = /name="([^"]+)"/.exec(m[1])?.[1]
    if (n) champs[n] = /value="([^"]*)"/.exec(m[1])?.[1] ?? ''
  }
  return { champs }
}

// ── Connexion du gérant ──
const g = client()
let p = await g.page('/connexion')
if (p.html.includes('Premier démarrage')) {
  const f = formulaire(p.html, 'Créer le compte')
  await g.poster('/connexion', { ...f.champs, prenom: 'T', nom: 'Gérant', email: 'gerant@netstrategy.fr',
    mot_de_passe: 'MotDePasseSolide2026', confirmation: 'MotDePasseSolide2026' })
} else {
  const f = formulaire(p.html, 'Se connecter')
  await g.poster('/connexion', { ...f.champs, email: 'gerant@netstrategy.fr', mot_de_passe: 'MotDePasseSolide2026' })
}
ok(g.jar.has('cee_session'), 'le gérant est connecté')

// ═══════════════════════════════════════════════════════════
titre('Un tarif modifié ne recalcule aucun dossier figé')

const deal = un(`SELECT dl.* FROM deal dl
  WHERE (SELECT COUNT(*) FROM dossier d WHERE d.deal_id = dl.id AND d.date_calcul IS NOT NULL) > 0
  LIMIT 1`)
ok(!!deal, `un deal porte des dossiers figés : « ${deal?.libelle} ${deal?.version} »`)

const figesAvant = q('SELECT id, marge_nette, prime_delegataire, date_calcul FROM dossier WHERE deal_id = ? AND date_calcul IS NOT NULL', deal.id)
const nbDeals = un('SELECT COUNT(*) AS n FROM deal').n
console.log(`       ${figesAvant.length} dossiers figés, marge totale ${Math.round(figesAvant.reduce((s, d) => s + (d.marge_nette || 0), 0))} €`)

p = await g.page('/parametrage/deals')
const fRatios = formulaire(p.html, `value="${deal.id}"`, 'r_deleg_precaire_sans_mpr')
ok(!!fRatios, 'le formulaire des ratios est présent')

// On double le ratio le plus structurant.
const nouveauRatio = Number(deal.r_deleg_classique_sans_mpr) * 2 + 3
const res = await g.poster('/parametrage/deals', {
  ...fRatios.champs, id: deal.id,
  r_deleg_classique_sans_mpr: String(nouveauRatio),
})

const figesApres = q('SELECT id, marge_nette, prime_delegataire, date_calcul FROM dossier WHERE id IN (' + figesAvant.map(() => '?').join(',') + ')', ...figesAvant.map((d) => d.id))
const inchanges = figesApres.every((a) => {
  const b = figesAvant.find((x) => x.id === a.id)
  return a.marge_nette === b.marge_nette && a.prime_delegataire === b.prime_delegataire && a.date_calcul === b.date_calcul
})
ok(inchanges, `les ${figesApres.length} dossiers figés ont EXACTEMENT les mêmes montants qu'avant`)

const nouvelle = un('SELECT * FROM deal WHERE libelle = ? AND id <> ? ORDER BY date_debut DESC LIMIT 1', deal.libelle, deal.id)
ok(un('SELECT COUNT(*) AS n FROM deal').n === nbDeals + 1, 'une nouvelle version du deal a été créée')
ok(nouvelle && Number(nouvelle.r_deleg_classique_sans_mpr) === nouveauRatio, `la nouvelle version porte le ratio modifié (${nouveauRatio} €/MWh)`)
ok(un('SELECT actif FROM deal WHERE id = ?', deal.id).actif === 0, 'l\'ancienne version est archivée')
ok(Number(un('SELECT r_deleg_classique_sans_mpr AS r FROM deal WHERE id = ?', deal.id).r) === Number(deal.r_deleg_classique_sans_mpr), 'l\'ancienne version garde ses ratios d\'origine')
ok(res.html.includes('Aucun dossier n') || res.html.includes('recalculé'), 'l\'écran le dit explicitement')

const j = un('SELECT champ, ancienne, nouvelle FROM journal_champ WHERE entite = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', 'Deal')
ok(!!j, `le changement est journalisé : « ${j?.champ} » ${j?.ancienne} → ${j?.nouvelle}`)

// ═══════════════════════════════════════════════════════════
titre('On ne supprime pas ce qui est utilisé')

const dg = un(`SELECT d.*, (SELECT COUNT(*) FROM dossier x WHERE x.delegataire_id = d.id) AS n
  FROM delegataire d WHERE (SELECT COUNT(*) FROM dossier x WHERE x.delegataire_id = d.id) > 0 LIMIT 1`)
p = await g.page('/parametrage/delegataires')
const fSup = formulaire(p.html, `value="${dg.id}"`, 'Désactiver')
ok(!!fSup, `le bouton dit « Désactiver » pour « ${dg.nom} » (${dg.n} dossiers), pas « Supprimer »`)
const r2 = await g.poster('/parametrage/delegataires', fSup.champs)
ok(un('SELECT COUNT(*) AS n FROM delegataire WHERE id = ?', dg.id).n === 1, 'le délégataire existe toujours')
ok(un('SELECT actif FROM delegataire WHERE id = ?', dg.id).actif === 0, 'il est désactivé')
ok(un('SELECT COUNT(*) AS n FROM dossier WHERE delegataire_id = ?', dg.id).n === dg.n, `ses ${dg.n} dossiers sont intacts`)

const td = un(`SELECT td.*, (SELECT COUNT(*) FROM document_dossier dd WHERE dd.type_document_id = td.id) AS n
  FROM type_document td WHERE (SELECT COUNT(*) FROM document_dossier dd WHERE dd.type_document_id = td.id) > 0 LIMIT 1`)
p = await g.page('/parametrage/pieces')
const fTd = formulaire(p.html, `value="${td.id}"`, 'Supprimer')
const r3 = await g.poster('/parametrage/pieces', fTd.champs)
ok(un('SELECT COUNT(*) AS n FROM type_document WHERE id = ?', td.id).n === 1, `« ${td.libelle} » n'est pas supprimé (${td.n} pièces le portent)`)
ok(r3.html.includes('ne peut pas être supprimé'), 'et l\'écran explique pourquoi')

const st = un(`SELECT s.* FROM statut s WHERE (SELECT COUNT(*) FROM dossier d WHERE d.statut_dossier_id = s.id) > 0 LIMIT 1`)
const nStatut = un('SELECT COUNT(*) AS n FROM dossier WHERE statut_dossier_id = ?', st.id).n
p = await g.page('/parametrage/workflow')
const fSt = formulaire(p.html, `value="${st.id}"`, 'Supprimer')
if (fSt) {
  const r4 = await g.poster('/parametrage/workflow', fSt.champs)
  ok(un('SELECT COUNT(*) AS n FROM statut WHERE id = ?', st.id).n === 1, `le statut « ${st.libelle} » n'est pas supprimé (${nStatut} dossiers)`)
}

// ═══════════════════════════════════════════════════════════
titre('Un changement de paramétrage qui a des conséquences les annonce')

const stPerdu = un(`SELECT s.* FROM statut s WHERE s.axe = 'DOSSIER' AND s.perdu = 0
  AND (SELECT COUNT(*) FROM dossier d WHERE d.statut_dossier_id = s.id) > 0 LIMIT 1`)
p = await g.page('/parametrage/workflow')
const fPerdu = formulaire(p.html, `value="${stPerdu.id}"`, 'name="perdu"')
const r5 = await g.poster('/parametrage/workflow', { ...fPerdu.champs, id: stPerdu.id, axe: 'DOSSIER',
  libelle: stPerdu.libelle, ordre: String(stPerdu.ordre), couleur: stPerdu.couleur, perdu: 'on' })
ok(un('SELECT perdu FROM statut WHERE id = ?', stPerdu.id).perdu === 1, `« ${stPerdu.libelle} » compte désormais comme perdu`)
ok(r5.html.includes('déperdition'), 'l\'écran prévient de l\'effet sur le tableau de bord')
db.prepare('UPDATE statut SET perdu = 0 WHERE id = ?').run(stPerdu.id)

// ═══════════════════════════════════════════════════════════
titre('Aucun accès sans le droit — y compris hors interface')

const regie = client()
const c = un('SELECT id FROM utilisateur WHERE email = ?', 'regie@netstrategy.fr')
if (!c) {
  console.log('       (pas de compte régie dans cette base — passez ./tester.sh d\'abord)')
} else {
  // Le compte régie a été créé par secu.mjs avec ce mot de passe.
  const pc = await regie.page('/connexion')
  const fc = formulaire(pc.html, 'Se connecter')
  await regie.poster('/connexion', { ...fc.champs, email: 'regie@netstrategy.fr', mot_de_passe: 'MotDePasseRegie2026' })
  ok(regie.jar.has('cee_session'), 'la régie est connectée')

  const vue = await regie.page('/parametrage/deals')
  ok(vue.html.includes('Accès refusé'), 'en forçant /parametrage/deals : refusé')
  ok((await regie.page('/parametrage/pieces')).html.includes('Accès refusé'), '/parametrage/pieces : refusé')
  ok((await regie.page('/parametrage/workflow')).html.includes('Accès refusé'), '/parametrage/workflow : refusé')
  ok(!(await regie.page('/')).html.includes('Paramétrage'), 'aucune entrée Paramétrage dans sa navigation')

  // Le contrôle qui compte : appeler l'action serveur directement.
  const dealCible = un('SELECT * FROM deal WHERE actif = 1 LIMIT 1')
  const avantRatio = Number(dealCible.r_deleg_classique_sans_mpr)
  const pg = await g.page('/parametrage/deals')
  const fVol = formulaire(pg.html, `value="${dealCible.id}"`, 'r_deleg_precaire_sans_mpr')
  await regie.poster('/parametrage/deals', { ...fVol.champs, id: dealCible.id, r_deleg_classique_sans_mpr: '999' })
  const apresRatio = Number(un('SELECT r_deleg_classique_sans_mpr AS r FROM deal WHERE id = ?', dealCible.id).r)
  ok(apresRatio === avantRatio, `l'action serveur refuse : le ratio est resté à ${apresRatio} €/MWh, pas 999`)
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
