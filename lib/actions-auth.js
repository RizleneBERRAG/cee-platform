'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { get, run, all, journaliser } from './db.js'
import {
  hacher, verifier, verifierRobustesse, authentifier, ouvrirSession, fermerSession,
  revoquerSessions, utilisateurConnecte, aucunCompteActif, exiger,
} from './auth.js'
import { ROLES_PAR_DEFAUT, TOUTES } from './permissions.js'

const uid = () => crypto.randomUUID()
const mail = (v) => String(v || '').trim().toLowerCase()

/** Crée les rôles par défaut s'ils n'existent pas encore. Idempotent. */
function assurerRoles() {
  for (const r of ROLES_PAR_DEFAUT) {
    const existant = get('SELECT id FROM role WHERE code = ?', [r.code])
    if (existant) continue
    // Le jeu de démonstration contient déjà des rôles nommés : on les récupère plutôt
    // que d'en créer un doublon portant le même nom.
    const parNom = get('SELECT id FROM role WHERE nom = ?', [r.nom])
    if (parNom) {
      run('UPDATE role SET code = ?, permissions = ? WHERE id = ?', [r.code, JSON.stringify(r.permissions), parNom.id])
    } else {
      run('INSERT INTO role (id, nom, code, permissions) VALUES (?,?,?,?)',
        [uid(), r.nom, r.code, JSON.stringify(r.permissions)])
    }
  }
}

export async function connexion(formData) {
  const email = mail(formData.get('email'))
  const mdp = String(formData.get('mot_de_passe') || '')

  const { utilisateur, erreur } = authentifier(email, mdp)
  if (erreur) redirect(`/connexion?e=${encodeURIComponent(erreur)}`)

  await ouvrirSession(utilisateur.id, String(formData.get('agent') || '').slice(0, 200) || null)
  redirect(utilisateur.doit_changer_mdp ? '/compte?premier=1' : '/')
}

export async function deconnexion() {
  await fermerSession()
  redirect('/connexion')
}

/**
 * Création du tout premier compte, au premier démarrage.
 * Refusée dès qu'un compte utilisable existe — sinon ce serait une porte ouverte.
 */
export async function creerPremierCompte(formData) {
  if (!aucunCompteActif()) redirect('/connexion')

  const email = mail(formData.get('email'))
  const mdp = String(formData.get('mot_de_passe') || '')
  const confirmation = String(formData.get('confirmation') || '')
  const nom = String(formData.get('nom') || '').trim()
  const prenom = String(formData.get('prenom') || '').trim()

  const echec = (m) => redirect(`/connexion?e=${encodeURIComponent(m)}`)
  if (!email.includes('@')) echec('Adresse e-mail invalide.')
  if (!nom || !prenom) echec('Renseignez votre nom et votre prénom.')
  if (mdp !== confirmation) echec('Les deux mots de passe ne correspondent pas.')
  const faiblesse = verifierRobustesse(mdp)
  if (faiblesse) echec(faiblesse)

  assurerRoles()
  const roleGerant = get('SELECT id FROM role WHERE code = ?', ['GERANT'])

  // Le jeu de démonstration crée des comptes sans mot de passe. Si l'e-mail choisi
  // correspond à l'un d'eux, on l'active plutôt que d'en créer un second.
  const existant = get('SELECT id FROM utilisateur WHERE email = ?', [email])
  const id = existant?.id || uid()
  if (existant) {
    run('UPDATE utilisateur SET nom=?, prenom=?, role_id=?, mot_de_passe=?, actif=1, doit_changer_mdp=0 WHERE id=?',
      [nom, prenom, roleGerant?.id || null, hacher(mdp), id])
  } else {
    run(`INSERT INTO utilisateur (id, email, nom, prenom, role_id, actif, mot_de_passe, doit_changer_mdp)
         VALUES (?,?,?,?,?,1,?,0)`,
      [id, email, nom, prenom, roleGerant?.id || null, hacher(mdp)])
  }

  journaliser({ entite: 'Utilisateur', entiteId: id, champ: 'Création du premier compte', ancienne: null, nouvelle: email, utilisateurId: id })
  await ouvrirSession(id)
  redirect('/')
}

/** Changement de son propre mot de passe. L'ancien est exigé, même en première connexion. */
export async function changerMonMotDePasse(formData) {
  const u = await exiger(null)
  const actuel = String(formData.get('actuel') || '')
  const nouveau = String(formData.get('nouveau') || '')
  const confirmation = String(formData.get('confirmation') || '')

  const echec = (m) => redirect(`/compte?e=${encodeURIComponent(m)}`)
  const ligne = get('SELECT mot_de_passe FROM utilisateur WHERE id = ?', [u.id])
  if (!verifier(actuel, ligne?.mot_de_passe)) echec('Le mot de passe actuel est incorrect.')
  if (nouveau !== confirmation) echec('Les deux nouveaux mots de passe ne correspondent pas.')
  if (verifier(nouveau, ligne?.mot_de_passe)) echec('Le nouveau mot de passe doit être différent de l\'ancien.')
  const faiblesse = verifierRobustesse(nouveau)
  if (faiblesse) echec(faiblesse)

  run('UPDATE utilisateur SET mot_de_passe = ?, doit_changer_mdp = 0 WHERE id = ?', [hacher(nouveau), u.id])
  journaliser({ entite: 'Utilisateur', entiteId: u.id, champ: 'Mot de passe changé', ancienne: null, nouvelle: 'par l\'intéressé', utilisateurId: u.id })

  // Les autres sessions tombent : changer son mot de passe doit chasser qui était déjà entré.
  revoquerSessions(u.id)
  await ouvrirSession(u.id)
  redirect('/compte?ok=1')
}

// ── Administration des comptes ───────────────────────────────

export async function creerUtilisateur(formData) {
  const u = await exiger('utilisateur.gerer')
  const email = mail(formData.get('email'))
  const nom = String(formData.get('nom') || '').trim()
  const prenom = String(formData.get('prenom') || '').trim()
  const roleId = String(formData.get('role_id') || '') || null
  const uniteId = String(formData.get('unite_affaire_id') || '') || null

  const echec = (m) => redirect(`/utilisateurs?e=${encodeURIComponent(m)}`)
  if (!email.includes('@')) echec('Adresse e-mail invalide.')
  if (!nom || !prenom) echec('Nom et prénom sont obligatoires.')
  if (get('SELECT id FROM utilisateur WHERE email = ?', [email])) echec('Un compte utilise déjà cette adresse.')

  // Le compte naît sans mot de passe : il n'est pas utilisable tant qu'il n'a pas été activé.
  // Aucun mot de passe provisoire n'est donc inventé, ni transmis, ni oublié en base.
  const id = uid()
  run(`INSERT INTO utilisateur (id, email, nom, prenom, role_id, unite_affaire_id, actif, mot_de_passe)
       VALUES (?,?,?,?,?,?,1,NULL)`,
    [id, email, nom, prenom, roleId, uniteId])
  journaliser({ entite: 'Utilisateur', entiteId: id, champ: 'Compte créé', ancienne: null, nouvelle: email, utilisateurId: u.id })
  revalidatePath('/utilisateurs')
  redirect(`/utilisateurs?cree=${encodeURIComponent(email)}`)
}

/**
 * Génère un lien d'activation à usage unique, que le gérant transmet au nouvel arrivant.
 * L'intéressé choisit lui-même son mot de passe : personne d'autre ne le connaît jamais.
 */
export async function genererLienActivation(formData) {
  const u = await exiger('utilisateur.gerer')
  const cible = String(formData.get('utilisateur_id') || '')
  const c = get('SELECT id, email FROM utilisateur WHERE id = ?', [cible])
  if (!c) throw new Error('Compte introuvable.')

  run('DELETE FROM session WHERE utilisateur_id = ? AND agent = ?', [cible, 'activation'])
  const id = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
  run('INSERT INTO session (id, utilisateur_id, expire_le, agent) VALUES (?,?,?,?)',
    [id, cible, new Date(Date.now() + 48 * 3600000).toISOString(), 'activation'])
  journaliser({ entite: 'Utilisateur', entiteId: cible, champ: 'Lien d\'activation généré', ancienne: null, nouvelle: c.email, utilisateurId: u.id })
  revalidatePath('/utilisateurs')
  redirect(`/utilisateurs?activation=${id}`)
}

/** Activation par le détenteur du lien : il pose son mot de passe, le jeton est consommé. */
export async function activerCompte(formData) {
  const token = String(formData.get('token') || '')
  const mdp = String(formData.get('mot_de_passe') || '')
  const confirmation = String(formData.get('confirmation') || '')
  const echec = (m) => redirect(`/activation/${token}?e=${encodeURIComponent(m)}`)

  const s = get('SELECT * FROM session WHERE id = ? AND agent = ?', [token, 'activation'])
  if (!s || new Date(s.expire_le) < new Date()) redirect('/connexion?e=' + encodeURIComponent('Lien d\'activation expiré ou déjà utilisé.'))
  if (mdp !== confirmation) echec('Les deux mots de passe ne correspondent pas.')
  const faiblesse = verifierRobustesse(mdp)
  if (faiblesse) echec(faiblesse)

  run('UPDATE utilisateur SET mot_de_passe = ?, actif = 1, doit_changer_mdp = 0, echecs = 0, bloque_jusqua = NULL WHERE id = ?',
    [hacher(mdp), s.utilisateur_id])
  run('DELETE FROM session WHERE id = ?', [token])
  journaliser({ entite: 'Utilisateur', entiteId: s.utilisateur_id, champ: 'Compte activé', ancienne: null, nouvelle: 'mot de passe défini', utilisateurId: s.utilisateur_id })

  await ouvrirSession(s.utilisateur_id)
  redirect('/')
}

export async function majUtilisateur(formData) {
  const u = await exiger('utilisateur.gerer')
  const id = String(formData.get('id') || '')
  const avant = get('SELECT * FROM utilisateur WHERE id = ?', [id])
  if (!avant) throw new Error('Compte introuvable.')

  const champs = {
    role_id: ['Rôle', String(formData.get('role_id') || '') || null],
    unite_affaire_id: ['Unité d\'affaire', String(formData.get('unite_affaire_id') || '') || null],
    actif: ['Actif', formData.get('actif') ? 1 : 0],
  }

  // Garde-fou : on ne peut pas se retirer à soi-même le droit de gérer les comptes,
  // ni désactiver le dernier gérant — sinon plus personne ne peut administrer l'outil.
  if (id === u.id && !champs.actif[1]) throw new Error('Vous ne pouvez pas désactiver votre propre compte.')
  const roleGerant = get('SELECT id FROM role WHERE code = ?', ['GERANT'])
  if (roleGerant && avant.role_id === roleGerant.id && (champs.role_id[1] !== roleGerant.id || !champs.actif[1])) {
    const restants = get(
      'SELECT COUNT(*) AS n FROM utilisateur WHERE role_id = ? AND actif = 1 AND mot_de_passe IS NOT NULL AND id <> ?',
      [roleGerant.id, id]
    ).n
    if (restants === 0) throw new Error('C\'est le dernier gérant actif : nommez-en un autre avant de le rétrograder.')
  }

  const noms = { role_id: 'role', unite_affaire_id: 'unite_affaire' }
  for (const [champ, [label, valeur]] of Object.entries(champs)) {
    if (String(avant[champ] ?? '') === String(valeur ?? '')) continue
    run(`UPDATE utilisateur SET ${champ} = ? WHERE id = ?`, [valeur, id])
    const lisible = (v) => {
      if (!noms[champ]) return v
      if (!v) return '—'
      return get(`SELECT ${champ === 'role_id' ? 'nom' : 'nom'} AS n FROM ${noms[champ]} WHERE id = ?`, [v])?.n || v
    }
    journaliser({ entite: 'Utilisateur', entiteId: id, champ: label, ancienne: lisible(avant[champ]), nouvelle: lisible(valeur), utilisateurId: u.id })
  }

  // Un compte désactivé ou dont le rôle change perd ses sessions : les droits sont relus en base,
  // mais couper la session évite qu'il continue sa navigation en cours.
  if (!champs.actif[1] || avant.role_id !== champs.role_id[1]) revoquerSessions(id)

  revalidatePath('/utilisateurs')
  redirect('/utilisateurs?maj=1')
}

export async function majPermissionsRole(formData) {
  const u = await exiger('utilisateur.gerer')
  const id = String(formData.get('role_id') || '')
  const r = get('SELECT * FROM role WHERE id = ?', [id])
  if (!r) throw new Error('Rôle introuvable.')

  const choisies = formData.getAll('permission').map(String).filter((p) => TOUTES.includes(p))

  // On ne laisse pas retirer « utilisateur.gerer » au rôle du dernier gérant :
  // c'est le scénario classique où l'on se ferme la porte de l'extérieur.
  if (r.code === 'GERANT' && !choisies.includes('utilisateur.gerer')) {
    throw new Error('Le rôle Gérant doit garder le droit de gérer les comptes.')
  }

  const avant = JSON.parse(r.permissions || '[]')
  run('UPDATE role SET permissions = ? WHERE id = ?', [JSON.stringify(choisies), id])
  journaliser({
    entite: 'Role', entiteId: id, champ: `Permissions du rôle ${r.nom}`,
    ancienne: avant.join(', '), nouvelle: choisies.join(', '), utilisateurId: u.id,
  })
  revalidatePath('/utilisateurs')
  redirect('/utilisateurs?maj=1')
}

export async function fermerToutesSessions(formData) {
  const u = await exiger('utilisateur.gerer')
  const id = String(formData.get('utilisateur_id') || '')
  revoquerSessions(id)
  const c = get('SELECT email FROM utilisateur WHERE id = ?', [id])
  journaliser({ entite: 'Utilisateur', entiteId: id, champ: 'Sessions révoquées', ancienne: null, nouvelle: c?.email || id, utilisateurId: u.id })
  revalidatePath('/utilisateurs')
  redirect('/utilisateurs?maj=1')
}

/** Utilisé par les écrans d'administration. */
export async function donneesComptes() {
  await exiger('utilisateur.gerer')
  assurerRoles()
  return {
    utilisateurs: all(`
      SELECT u.*, r.nom AS role_nom, r.code AS role_code, ua.nom AS unite_nom,
             (SELECT COUNT(*) FROM session s WHERE s.utilisateur_id = u.id AND s.agent IS NOT 'activation') AS sessions
        FROM utilisateur u
        LEFT JOIN role r ON r.id = u.role_id
        LEFT JOIN unite_affaire ua ON ua.id = u.unite_affaire_id
       ORDER BY u.actif DESC, u.nom`),
    roles: all('SELECT * FROM role ORDER BY nom'),
    unites: all('SELECT id, nom FROM unite_affaire WHERE actif = 1 ORDER BY nom'),
  }
}
