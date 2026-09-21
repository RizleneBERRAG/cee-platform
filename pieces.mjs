/**
 * Test du stockage des pièces, en HTTP direct.
 * On essaie de récupérer un fichier qu'on n'a pas le droit de voir, de déposer un fichier
 * hostile, et de faire écrire l'application hors de son répertoire.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

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
    jar, F, brut: F,
    page: (url) => F(url).then(suivre),
    poster: async (url, donnees, fichiers = {}) => {
      const body = new FormData()
      // Un <input type="file"> n'a pas d'attribut value : l'extracteur le ramène à ''.
      // Si on l'ajoute avant le vrai fichier, formData.get() renvoie la chaîne vide et
      // l'action croit qu'aucun fichier n'a été joint. On écarte donc les clés de fichier.
      for (const [k, v] of Object.entries(donnees)) {
        if (k in fichiers) continue
        body.append(k, v)
      }
      for (const [k, { contenu, nom, type }] of Object.entries(fichiers)) {
        body.append(k, new File([contenu], nom, { type: type || 'application/octet-stream' }))
      }
      return suivre(await F(url, { method: 'POST', body }))
    },
  }
}
const formulaire = (html, ...m) => {
  const forms = html.split('<form').slice(1).map((f) => '<form' + f.split('</form>')[0])
  const f = forms.find((x) => m.every((k) => x.includes(k)))
  if (!f) return null
  const champs = {}
  for (const mm of f.matchAll(/<input\b([^>]*)>/g)) {
    const n = /name="([^"]+)"/.exec(mm[1])?.[1]
    if (n) champs[n] = /value="([^"]*)"/.exec(mm[1])?.[1] ?? ''
  }
  return { champs }
}

// ── Connexions ──
const g = client()
let p = await g.page('/connexion')
const fg = formulaire(p.html, p.html.includes('Premier démarrage') ? 'Créer le compte' : 'Se connecter')
if (p.html.includes('Premier démarrage')) {
  await g.poster('/connexion', { ...fg.champs, prenom: 'T', nom: 'G', email: 'gerant@netstrategy.fr',
    mot_de_passe: 'MotDePasseSolide2026', confirmation: 'MotDePasseSolide2026' })
} else {
  await g.poster('/connexion', { ...fg.champs, email: 'gerant@netstrategy.fr', mot_de_passe: 'MotDePasseSolide2026' })
}
ok(g.jar.has('cee_session'), 'le gérant est connecté')

const unites = q('SELECT id, nom FROM unite_affaire ORDER BY nom')
const dossier = un('SELECT d.id, d.numero, d.unite_affaire_id FROM dossier d WHERE d.unite_affaire_id = ? AND d.verrouille = 0 LIMIT 1', unites[0].id)
const autre = un('SELECT d.id, d.numero FROM dossier d WHERE d.unite_affaire_id = ? AND d.verrouille = 0 LIMIT 1', unites[1].id)

// ═══════════════════════════════════════════════════════════
titre('Dépôt d\'un vrai fichier')
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('Attestation sur l\'honneur — contenu de test. '.repeat(40))])
p = await g.page(`/dossiers/${dossier.id}`)
const fDepot = formulaire(p.html, 'name="fichier"')
ok(!!fDepot, 'le formulaire de dépôt est présent')
const typeId = /name="type_document_id"[^>]*>\s*<option value="([^"]+)"/.exec(p.html)?.[1]
  || un('SELECT id FROM type_document LIMIT 1').id

const avant = un('SELECT COUNT(*) AS n FROM document_dossier WHERE dossier_id = ?', dossier.id).n
await g.poster(`/dossiers/${dossier.id}`, { ...fDepot.champs, dossier_id: dossier.id, type_document_id: typeId },
  { fichier: { contenu: pdf, nom: 'Attestation RGE.pdf', type: 'application/pdf' } })
const doc = un('SELECT * FROM document_dossier WHERE dossier_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', dossier.id)
ok(un('SELECT COUNT(*) AS n FROM document_dossier WHERE dossier_id = ?', dossier.id).n === avant + 1, 'la pièce est enregistrée')
ok(doc.empreinte && /^[a-f0-9]{64}$/.test(doc.empreinte), 'une empreinte SHA-256 est stockée')
ok(doc.taille === pdf.length, `la taille est exacte (${doc.taille} octets)`)
ok(doc.type_mime === 'application/pdf', 'le type est application/pdf')
ok(doc.depose_par, 'le déposant est enregistré')

const surDisque = path.join('fichiers', doc.empreinte.slice(0, 2), doc.empreinte.slice(2, 4), `${doc.empreinte}.pdf`)
ok(fs.existsSync(surDisque), 'le fichier est sur le disque, nommé par son empreinte')
ok(Buffer.compare(fs.readFileSync(surDisque), pdf) === 0, 'son contenu est identique à l\'octet près')

titre('Relecture par la route gardée')
let r = await g.brut(`/piece/${doc.id}`)
const recu = Buffer.from(await r.arrayBuffer())
ok(r.status === 200, 'le gérant récupère la pièce')
ok(Buffer.compare(recu, pdf) === 0, 'le fichier servi est identique à celui déposé')
ok(r.headers.get('content-disposition')?.startsWith('attachment'), 'par défaut : téléchargement, pas affichage')
ok(r.headers.get('x-content-type-options') === 'nosniff', 'le navigateur ne devine pas le type')
ok((r.headers.get('content-security-policy') || '').includes('sandbox'), 'aucun script ne peut s\'exécuter depuis le fichier')
r = await g.brut(`/piece/${doc.id}?apercu=1`)
ok(r.headers.get('content-disposition')?.startsWith('inline'), 'l\'aperçu d\'un PDF est autorisé en ligne')

titre('Déduplication')
const n1 = fs.readdirSync('fichiers', { recursive: true }).filter((f) => String(f).endsWith('.pdf')).length
await g.poster(`/dossiers/${autre.id}`, { ...fDepot.champs, dossier_id: autre.id, type_document_id: typeId },
  { fichier: { contenu: pdf, nom: 'Le meme document.pdf', type: 'application/pdf' } })
const doc2 = un('SELECT * FROM document_dossier WHERE dossier_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', autre.id)
const n2 = fs.readdirSync('fichiers', { recursive: true }).filter((f) => String(f).endsWith('.pdf')).length
ok(doc2.empreinte === doc.empreinte, 'le même contenu sur deux dossiers partage l\'empreinte')
ok(n1 === n2, `un seul fichier sur le disque pour les deux pièces (${n2} fichiers PDF)`)

titre('Fichiers hostiles refusés')
for (const [libelle, contenu, nom] of [
  ['un HTML renommé .pdf', Buffer.from('<html><script>alert(document.cookie)</script></html>'), 'facture.pdf'],
  ['un SVG porteur de script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg'],
  ['un script shell', Buffer.from('#!/bin/sh\nrm -rf /'), 'attestation.pdf'],
]) {
  const nAvant = un('SELECT COUNT(*) AS n FROM document_dossier').n
  const res = await g.poster(`/dossiers/${dossier.id}`, { ...fDepot.champs, dossier_id: dossier.id, type_document_id: typeId },
    { fichier: { contenu, nom, type: 'application/pdf' } })
  const nApres = un('SELECT COUNT(*) AS n FROM document_dossier').n
  ok(nApres === nAvant && res.html.includes('Pièce refusée'), `${libelle} : refusé, rien n'est enregistré`)
}

titre('Nom de fichier hostile')
const nAvantT = un('SELECT COUNT(*) AS n FROM document_dossier').n
const pdf2 = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('autre contenu de test')])
await g.poster(`/dossiers/${dossier.id}`, { ...fDepot.champs, dossier_id: dossier.id, type_document_id: typeId },
  { fichier: { contenu: pdf2, nom: '../../../../etc/passwd.pdf', type: 'application/pdf' } })
const docT = un('SELECT * FROM document_dossier WHERE dossier_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', dossier.id)
ok(un('SELECT COUNT(*) AS n FROM document_dossier').n === nAvantT + 1, 'le fichier est accepté (son contenu est valide)')
ok(docT.nom_fichier === 'etc_passwd.pdf', `le nom est nettoyé : « ${docT.nom_fichier} »`)
ok(!fs.existsSync('/etc/passwd.pdf') && !fs.existsSync('etc/passwd.pdf'), 'rien n\'a été écrit hors du répertoire de stockage')
const attenduT = path.join('fichiers', docT.empreinte.slice(0, 2), docT.empreinte.slice(2, 4), `${docT.empreinte}.pdf`)
ok(fs.existsSync(attenduT), 'le fichier est bien à l\'emplacement dérivé de son empreinte')

titre('Cloisonnement de l\'accès aux fichiers')
const regie = client()
const cr = un('SELECT id FROM utilisateur WHERE email = ?', 'regie@netstrategy.fr')
if (!cr) { console.log('       (pas de compte régie — lancez ./tester.sh d\'abord)') }
else {
  const pc = await regie.page('/connexion')
  await regie.poster('/connexion', { ...formulaire(pc.html, 'Se connecter').champs,
    email: 'regie@netstrategy.fr', mot_de_passe: 'MotDePasseRegie2026' })
  ok(regie.jar.has('cee_session'), 'la régie est connectée')
  const uniteRegie = un('SELECT unite_affaire_id AS u FROM utilisateur WHERE email = ?', 'regie@netstrategy.fr').u
  const sien = doc.dossier_id === dossier.id && dossier.unite_affaire_id === uniteRegie ? doc : null

  const rInterdit = await regie.brut(`/piece/${doc2.id}`)
  const docAutreUnite = un('SELECT unite_affaire_id AS u FROM dossier WHERE id = ?', autre.id).u
  if (docAutreUnite !== uniteRegie) {
    ok(rInterdit.status === 404, 'la pièce d\'un dossier d\'une autre unité renvoie 404, pas 403')
    ok((await rInterdit.text()).includes('introuvable'), 'le message ne révèle pas que la pièce existe')
  }
}

titre('Accès sans session')
const anonyme = await fetch(`${B}/piece/${doc.id}`, { redirect: 'manual' })
ok([401, 307, 302].includes(anonyme.status), `sans session : refusé (${anonyme.status})`)
ok(anonyme.status !== 200, 'et surtout : le fichier n\'est pas servi')

titre('Fichier altéré sur le disque')
const sauvegarde = fs.readFileSync(surDisque)
fs.writeFileSync(surDisque, Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('CONTENU SUBSTITUE')]))
const rAltere = await g.brut(`/piece/${doc.id}`)
ok(rAltere.status === 409, 'un fichier dont l\'empreinte ne correspond plus n\'est pas servi (409)')
fs.writeFileSync(surDisque, sauvegarde)
ok((await g.brut(`/piece/${doc.id}`)).status === 200, 'une fois restauré, il est servi à nouveau')

titre('Suppression et orphelins')
const empreintePartagee = doc.empreinte
await g.poster(`/dossiers/${dossier.id}`, { document_id: doc.id })
p = await g.page(`/dossiers/${dossier.id}`)
const fRetirer = formulaire(p.html, `value="${doc.id}"`, 'Retirer')
if (fRetirer) {
  await g.poster(`/dossiers/${dossier.id}`, { ...fRetirer.champs, document_id: doc.id })
  const restantes = un('SELECT COUNT(*) AS n FROM document_dossier WHERE empreinte = ?', empreintePartagee).n
  ok(restantes > 0, `une autre pièce partage encore l'empreinte (${restantes})`)
  ok(fs.existsSync(surDisque), 'le fichier n\'est PAS effacé : il sert encore à un autre dossier')
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
