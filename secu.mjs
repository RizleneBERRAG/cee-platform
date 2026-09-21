/**
 * Test de cloisonnement, en HTTP direct.
 *
 * On ne passe pas par un navigateur : masquer un bouton n'est pas une protection, et ce
 * qu'il faut prouver est que le SERVEUR refuse. On rejoue donc les requêtes telles qu'un
 * utilisateur mal intentionné les enverrait — URL forcées, actions serveur appelées à la main.
 */
import { DatabaseSync } from 'node:sqlite'

const B = 'http://localhost:3000'
const db = new DatabaseSync('db/cee.db')
const q = (s, ...p) => db.prepare(s).all(...p).map((r) => ({ ...r }))
let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

/** Client HTTP avec bocal à cookies, sans suivi automatique des redirections. */
function client() {
  const jar = new Map()
  return {
    jar,
    async fetch(url, opts = {}) {
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
      const r = await fetch(B + url, {
        ...opts, redirect: 'manual',
        headers: {
          ...(opts.headers || {}),
          // Next refuse les actions serveur dont l'Origin ne correspond pas à l'hôte :
          // c'est sa protection contre les requêtes inter-sites. Un navigateur l'envoie
          // toujours ; sans lui, l'action est silencieusement ignorée et le test ment.
          origin: B,
          ...(cookie ? { cookie } : {}),
        },
      })
      for (const sc of r.headers.getSetCookie?.() || []) {
        const [kv] = sc.split(';')
        const i = kv.indexOf('=')
        const k = kv.slice(0, i), v = kv.slice(i + 1)
        if (v === '' ) jar.delete(k); else jar.set(k, v)
      }
      return r
    },
    async page(url) {
      let r = await this.fetch(url)
      let sauts = 0
      while ([301, 302, 303, 307, 308].includes(r.status) && sauts++ < 5) {
        r = await this.fetch(new URL(r.headers.get('location'), B).pathname + new URL(r.headers.get('location'), B).search)
      }
      return { statut: r.status, html: await r.text(), url }
    },
  }
}

/**
 * Extrait le formulaire dont le HTML contient TOUS les marqueurs donnés.
 * Une même ligne du tableau porte trois formulaires qui partagent l'identifiant du compte :
 * un seul marqueur ne suffit donc pas à désigner le bon.
 */
function formulaire(html, ...marqueurs) {
  const forms = html.split('<form').slice(1).map((f) => '<form' + f.split('</form>')[0])
  const f = forms.find((x) => marqueurs.every((m) => x.includes(m)))
  if (!f) return null
  const action = /action="([^"]*)"/.exec(f)?.[1] || ''
  // Next rend l'identifiant d'action comme un input caché SANS attribut value :
  // il faut donc accepter les deux formes, sinon on perd le champ qui fait tout marcher.
  const champs = {}
  for (const m of f.matchAll(/<input\b([^>]*)>/g)) {
    const nom = /name="([^"]+)"/.exec(m[1])?.[1]
    if (!nom) continue
    champs[nom] = /value="([^"]*)"/.exec(m[1])?.[1] ?? ''
  }
  return { action, champs }
}

/**
 * Poste un formulaire d'action serveur.
 *
 * Sans JavaScript, Next exécute l'action puis RÉAFFICHE la page cible en 200 au lieu de
 * renvoyer une redirection : on juge donc sur le contenu rendu, pas sur l'en-tête Location.
 */
const poster = async (cl, url, donnees) => {
  // Next rend ces formulaires en multipart/form-data. Poster en urlencoded ne lève aucune
  // erreur : les champs arrivent simplement vides, et le test passe pour de mauvaises raisons.
  const body = new FormData()
  for (const [k, v] of Object.entries(donnees)) body.append(k, v)
  let r = await cl.fetch(url, { method: 'POST', body })
  let sauts = 0
  while ([301, 302, 303, 307, 308].includes(r.status) && sauts++ < 5) {
    const u = new URL(r.headers.get('location'), B)
    r = await cl.fetch(u.pathname + u.search)
  }
  return { statut: r.status, html: await r.text() }
}

// Ce test part d'une base vierge : il commence par le tout premier démarrage,
// quand aucun compte n'existe encore. Lancez ./relancer.sh avant.
if (q('SELECT COUNT(*) n FROM utilisateur WHERE mot_de_passe IS NOT NULL')[0].n > 0) {
  console.log('\nLa base contient déjà des comptes. Lancez ./relancer.sh puis relancez ce test.')
  process.exit(2)
}

// ═══════════════════════════════════════════════════════════
titre('Premier démarrage')
const gerant = client()
let r = await gerant.fetch('/dossiers')
ok(r.status === 307 && r.headers.get('location').endsWith('/connexion'), 'sans session, /dossiers renvoie vers /connexion')

let { html } = await gerant.page('/connexion')
ok(html.includes('Premier démarrage'), 'aucun compte : l\'écran propose la création du gérant')
const fPremier = formulaire(html, 'Créer le compte')
ok(!!fPremier, 'le formulaire de création est présent')

const champsBase = { ...fPremier.champs, prenom: 'Test', nom: 'Gérant', email: 'gerant@netstrategy.fr' }
let p2 = await poster(gerant, '/connexion', { ...champsBase, mot_de_passe: 'court1', confirmation: 'court1' })
ok(p2.html.includes('12 caractères'), 'mot de passe trop court : refusé')
ok(q('SELECT COUNT(*) n FROM utilisateur WHERE mot_de_passe IS NOT NULL')[0].n === 0, 'aucun compte n\'a été créé au passage')

p2 = await poster(gerant, '/connexion', { ...champsBase, mot_de_passe: 'MotDePasseSolide2026', confirmation: 'AutreChose2026xx' })
ok(p2.html.includes('ne correspondent pas'), 'confirmation différente : refusée')

p2 = await poster(gerant, '/connexion', { ...champsBase, mot_de_passe: 'MotDePasseSolide2026', confirmation: 'MotDePasseSolide2026' })
ok(gerant.jar.has('cee_session'), 'compte créé et cookie de session posé')

const emp = q('SELECT mot_de_passe FROM utilisateur WHERE email = ?', 'gerant@netstrategy.fr')[0]?.mot_de_passe
ok(!String(emp).includes('MotDePasseSolide2026'), 'le mot de passe n\'est nulle part en clair dans la base')
ok(String(emp).startsWith('scrypt$'), 'seule une empreinte scrypt est conservée')

titre('Le gérant voit tout')
;({ html } = await gerant.page('/'))
ok(html.includes('marge nette prévisionnelle'), 'il voit la marge au tableau de bord')
ok(html.includes('Comptes et rôles'), 'il a l\'entrée Comptes et rôles')
ok((await gerant.page('/utilisateurs')).html.includes('Ajouter un compte'), 'il accède à la gestion des comptes')
ok((await gerant.page('/simulateur')).html.includes('imulateur'), 'il accède au simulateur')

export { q, client, formulaire, poster, ok, titre, echecs, B, db }

// ═══════════════════════════════════════════════════════════
// Une régie, restreinte à son unité et sans accès aux montants.
titre('Mise en place d\'un compte Régie')
const unites = q('SELECT id, nom FROM unite_affaire ORDER BY nom')
const uniteRegie = unites[0]
const uniteAutre = unites[1]

let pg = await gerant.page('/utilisateurs')
const fCreer = formulaire(pg.html, 'Créer le compte')
const roleRegie = q("SELECT id FROM role WHERE code = 'REGIE'")[0]
await poster(gerant, '/utilisateurs', {
  ...fCreer.champs, prenom: 'Karim', nom: 'Régie', email: 'regie@netstrategy.fr',
  role_id: roleRegie.id, unite_affaire_id: uniteRegie.id,
})
const compteRegie = q('SELECT * FROM utilisateur WHERE email = ?', 'regie@netstrategy.fr')[0]
ok(compteRegie?.role_id === roleRegie.id && compteRegie?.unite_affaire_id === uniteRegie.id,
   'son rôle et son unité d\'affaire sont bien enregistrés')
ok(!!compteRegie, 'le compte régie est créé')
ok(compteRegie.mot_de_passe === null, 'il naît SANS mot de passe : inutilisable tel quel')

// Le gérant génère un lien ; il ne choisit pas le mot de passe à la place de l'intéressé.
pg = await gerant.page('/utilisateurs')
const fLien = formulaire(pg.html, `value="${compteRegie.id}"`, 'activation')
const rLien = await poster(gerant, '/utilisateurs', fLien.champs)
const token = q("SELECT id FROM session WHERE agent = 'activation' AND utilisateur_id = ?", compteRegie.id)[0]?.id
ok(!!token, 'un lien d\'activation est généré côté serveur')
ok(rLien.html.includes('/activation/') && rLien.html.includes(token || 'xxx'),
   'le gérant voit le lien affiché à l\'écran')

const regie = client()
const pAct = await regie.page(`/activation/${token}`)
ok(pAct.html.includes('Choisissez votre mot de passe') || pAct.html.includes('Bonjour'), 'le lien ouvre l\'écran de choix du mot de passe')
const fAct = formulaire(pAct.html, 'Activer et entrer')
await poster(regie, `/activation/${token}`, { ...fAct.champs, token, mot_de_passe: 'MotDePasseRegie2026', confirmation: 'MotDePasseRegie2026' })
ok(regie.jar.has('cee_session'), 'la régie a activé son compte et est connectée')
ok(q('SELECT COUNT(*) n FROM session WHERE id = ?', token)[0].n === 0, 'le lien d\'activation est consommé, il ne resservira pas')

// ═══════════════════════════════════════════════════════════
titre('La régie ne voit pas les montants')
let pr = await regie.page('/')
ok(!pr.html.includes('marge nette prévisionnelle'), 'aucune marge au tableau de bord')
ok(!pr.html.includes('Comptes et rôles'), 'pas d\'entrée Comptes et rôles dans la navigation')
ok(!pr.html.includes('Simulateur de marge'), 'pas d\'entrée Simulateur dans la navigation')

pr = await regie.page('/simulateur')
ok(pr.html.includes('Accès refusé'), 'en forçant /simulateur : refusé')
pr = await regie.page('/utilisateurs')
ok(pr.html.includes('Accès refusé'), 'en forçant /utilisateurs : refusé')
pr = await regie.page('/dossiers/import')
ok(pr.html.includes('Accès refusé'), 'en forçant /dossiers/import : refusé')
pr = await regie.page('/lots')
ok(pr.html.includes('Accès refusé'), 'en forçant /lots : refusé')

pr = await regie.page('/dossiers')
ok(!pr.html.includes('Marge nette'), 'la colonne Marge nette n\'est pas dans la liste des dossiers')

// ═══════════════════════════════════════════════════════════
titre('La régie ne voit que son unité')
const sien = q('SELECT id, numero FROM dossier WHERE unite_affaire_id = ? LIMIT 1', uniteRegie.id)[0]
const etranger = q('SELECT id, numero FROM dossier WHERE unite_affaire_id = ? LIMIT 1', uniteAutre.id)[0]
const totalBase = q('SELECT COUNT(*) n FROM dossier')[0].n
const totalSien = q('SELECT COUNT(*) n FROM dossier WHERE unite_affaire_id = ?', uniteRegie.id)[0].n

pr = await regie.page('/dossiers')
const affiche = Number((/([\d\s  ]+) dossiers?/.exec(pr.html.replace(/<[^>]*>/g, ' '))?.[1] || '0').replace(/\D/g, ''))
ok(affiche === totalSien && totalSien < totalBase, `la liste annonce ${affiche} dossiers (son unité) et non ${totalBase} (toute la base)`)

pr = await regie.page(`/dossiers/${sien.id}`)
ok(pr.html.includes(sien.numero), 'elle ouvre un dossier de son unité')
ok(pr.html.includes('ne vous sont pas accessibles'), 'les montants y sont remplacés par une explication')

pr = await regie.page(`/dossiers/${etranger.id}`)
ok(pr.html.includes('Dossier introuvable'), 'un dossier d\'une autre unité ressort « introuvable »')
ok(!pr.html.includes(etranger.numero), 'son numéro n\'apparaît nulle part — rien ne fuit')

const rExport = await regie.fetch(`/lots/${q('SELECT id FROM lot LIMIT 1')[0].id}/export`)
ok(rExport.status === 403, 'le téléchargement CSV d\'un lot est refusé en 403')


// ═══════════════════════════════════════════════════════════
// Le contrôle qui compte vraiment : on n'utilise plus l'interface.
// On reprend l'identifiant d'action serveur d'un formulaire auquel la régie a droit,
// et on le repointe sur un dossier d'une autre unité. C'est exactement ce que ferait
// quelqu'un avec la console de son navigateur.
titre('Contournement de l\'interface')

const pSien = await regie.page(`/dossiers/${sien.id}`)
const fMaj = formulaire(pSien.html, 'Modifier le dossier', 'name="id"')
ok(!!fMaj, 'la régie a bien le formulaire de modification sur SON dossier')

const avantEtranger = q('SELECT quantite FROM dossier WHERE id = ?', etranger.id)[0].quantite
await poster(regie, `/dossiers/${etranger.id}`, { ...fMaj.champs, id: etranger.id, quantite: '999999' })
const apresEtranger = q('SELECT quantite FROM dossier WHERE id = ?', etranger.id)[0].quantite
ok(avantEtranger === apresEtranger,
   `l'action serveur refuse de modifier un dossier d'une autre unité (quantité restée à ${apresEtranger})`)

// Même chose pour une action dont la régie n'a pas le droit du tout : le verrouillage.
const avantVerrou = q('SELECT verrouille FROM dossier WHERE id = ?', sien.id)[0].verrouille
const pGerantDossier = await gerant.page(`/dossiers/${sien.id}`)
const fVerrou = formulaire(pGerantDossier.html, 'Verrouiller')
await poster(regie, `/dossiers/${sien.id}`, { ...fVerrou.champs, id: sien.id })
const apresVerrou = q('SELECT verrouille FROM dossier WHERE id = ?', sien.id)[0].verrouille
ok(avantVerrou === apresVerrou, 'l\'action de verrouillage est refusée à un rôle qui n\'a pas ce droit')

// Et le journal doit porter le nom de la bonne personne.
titre('Journal attribué')
// La régie modifie SON dossier : le journal doit porter SON nom, pas celui du premier
// compte de la base comme c'était le cas avant l'authentification.
const avantSien = q('SELECT quantite FROM dossier WHERE id = ?', sien.id)[0].quantite
await poster(regie, `/dossiers/${sien.id}`, { ...fMaj.champs, id: sien.id, quantite: String(avantSien + 7) })
const apresSien = q('SELECT quantite FROM dossier WHERE id = ?', sien.id)[0].quantite
ok(apresSien === avantSien + 7, 'elle peut modifier son propre dossier')

const j = q(`SELECT jc.champ, jc.ancienne, jc.nouvelle, u.email
               FROM journal_champ jc JOIN utilisateur u ON u.id = jc.utilisateur_id
              WHERE jc.dossier_id = ? ORDER BY jc.created_at DESC, jc.rowid DESC LIMIT 1`, sien.id)[0]
ok(j?.email === 'regie@netstrategy.fr',
   `la modification est journalisée au nom de ${j?.email || 'personne'}, et non du premier compte de la base`)
ok(j?.champ === 'Quantité' && j?.nouvelle === String(avantSien + 7),
   `le journal garde l'ancienne et la nouvelle valeur (${j?.ancienne} → ${j?.nouvelle})`)

// ═══════════════════════════════════════════════════════════
titre('Session révoquée')
const sessionRegie = [...regie.jar.keys()].length
db.prepare('UPDATE utilisateur SET actif = 0 WHERE email = ?').run('regie@netstrategy.fr')
const pApres = await regie.page('/dossiers')
ok(pApres.html.includes('Connexion') || pApres.html.includes('Premier démarrage'),
   'un compte désactivé perd la main immédiatement, sans attendre l\'expiration du cookie')
db.prepare('UPDATE utilisateur SET actif = 1 WHERE email = ?').run('regie@netstrategy.fr')

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs === 0 ? 0 : 1)
