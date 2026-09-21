/**
 * Authentification par session.
 *
 * Choix de conception, dans l'ordre d'importance :
 *
 * 1. **Le mot de passe n'est jamais stocké.** Seule une empreinte scrypt l'est, avec un sel
 *    propre à chaque compte. scrypt est volontairement lent et gourmand en mémoire : une
 *    fuite de la base ne donne pas les mots de passe.
 * 2. **Le cookie ne porte qu'un jeton opaque.** Aucun identifiant, aucun rôle, aucune date
 *    d'expiration côté client — rien qu'un utilisateur pourrait modifier pour changer ses droits.
 *    Tout est relu en base à chaque requête, donc désactiver un compte le déconnecte aussitôt.
 * 3. **Aucun mot de passe par défaut n'existe.** Un compte créé n'a pas d'empreinte tant que
 *    son détenteur ne l'a pas activé : impossible d'oublier de changer un « admin/admin ».
 * 4. **La comparaison est à temps constant**, et un identifiant inconnu coûte le même temps
 *    qu'un mot de passe faux — sinon le temps de réponse trahit les comptes existants.
 */
import crypto from 'node:crypto'
import { cookies } from 'next/headers'
import { verifier } from './empreinte.js'
import { all, get, run } from './db.js'

const COOKIE = 'cee_session'
const DUREE_JOURS = 7
const SCRYPT = { N: 16384, r: 8, p: 1, longueur: 64 }

// ── Mots de passe ────────────────────────────────────────────

/** Règles minimales. Volontairement sobres : une règle trop tordue pousse au post-it. */
export function verifierRobustesse(mdp) {
  const m = String(mdp || '')
  if (m.length < 12) return 'Le mot de passe doit faire au moins 12 caractères.'
  if (!/[a-zà-ÿ]/i.test(m)) return 'Le mot de passe doit contenir au moins une lettre.'
  if (!/\d/.test(m)) return 'Le mot de passe doit contenir au moins un chiffre.'
  return null
}

// Le calcul d'empreinte vit dans `lib/empreinte.js` : il ne dépend ni du web ni d'une
// requête, et le garder ici rendait impossible de hacher un secret hors d'une page Next.
// Ré-exporté pour que les appelants existants n'aient rien à changer.
export { hacher, verifier } from './empreinte.js'

// ── Sessions ─────────────────────────────────────────────────

const jeton = () => crypto.randomBytes(32).toString('base64url')

export async function ouvrirSession(utilisateurId, agent = null) {
  const id = jeton()
  const expire = new Date(Date.now() + DUREE_JOURS * 86400000).toISOString()
  run('INSERT INTO session (id, utilisateur_id, expire_le, agent) VALUES (?,?,?,?)',
    [id, utilisateurId, expire, agent])
  run('UPDATE utilisateur SET derniere_connexion = ?, echecs = 0, bloque_jusqua = NULL WHERE id = ?',
    [new Date().toISOString(), utilisateurId])
  const c = await cookies()
  c.set(COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expire),
  })
  return id
}

export async function fermerSession() {
  const c = await cookies()
  const id = c.get(COOKIE)?.value
  if (id) run('DELETE FROM session WHERE id = ?', [id])
  c.delete(COOKIE)
}

/** Ferme toutes les sessions d'un compte — après un changement de mot de passe ou une désactivation. */
export function revoquerSessions(utilisateurId) {
  run('DELETE FROM session WHERE utilisateur_id = ?', [utilisateurId])
}

/**
 * L'utilisateur de la requête en cours, permissions résolues, ou null.
 * Relu en base à chaque appel : un compte désactivé perd la main immédiatement.
 */
export async function utilisateurConnecte() {
  let id
  try { id = (await cookies()).get(COOKIE)?.value } catch { return null }
  if (!id) return null

  const ligne = get(
    `SELECT u.*, r.nom AS role_nom, r.code AS role_code, r.permissions AS role_permissions,
            ua.nom AS unite_nom, s.expire_le
       FROM session s
       JOIN utilisateur u ON u.id = s.utilisateur_id
       LEFT JOIN role r ON r.id = u.role_id
       LEFT JOIN unite_affaire ua ON ua.id = u.unite_affaire_id
      WHERE s.id = ?`,
    [id]
  )
  if (!ligne) return null
  if (new Date(ligne.expire_le) < new Date()) { run('DELETE FROM session WHERE id = ?', [id]); return null }
  if (!ligne.actif) return null

  let permissions = []
  try { permissions = JSON.parse(ligne.role_permissions || '[]') } catch { permissions = [] }

  return {
    id: ligne.id,
    email: ligne.email,
    nom: ligne.nom,
    prenom: ligne.prenom,
    role: ligne.role_nom,
    roleCode: ligne.role_code,
    uniteId: ligne.unite_affaire_id,
    uniteNom: ligne.unite_nom,
    doitChangerMdp: !!ligne.doit_changer_mdp,
    permissions,
  }
}

/** Y a-t-il au moins un compte utilisable ? Sinon l'application propose la création du premier. */
export function aucunCompteActif() {
  return get('SELECT COUNT(*) AS n FROM utilisateur WHERE mot_de_passe IS NOT NULL AND actif = 1').n === 0
}

// ── Tentatives de connexion ──────────────────────────────────

const BLOCAGE_APRES = 8
const BLOCAGE_MINUTES = 15

/**
 * Vérifie un couple e-mail / mot de passe.
 * Renvoie { utilisateur } ou { erreur } — jamais de détail sur ce qui a échoué,
 * pour ne pas révéler quels e-mails existent.
 */
export function authentifier(email, mdp) {
  const GENERIQUE = 'Identifiants incorrects.'
  const u = get('SELECT * FROM utilisateur WHERE email = ?', [String(email || '').trim().toLowerCase()])

  if (u?.bloque_jusqua && new Date(u.bloque_jusqua) > new Date()) {
    const reste = Math.ceil((new Date(u.bloque_jusqua) - new Date()) / 60000)
    return { erreur: `Trop de tentatives. Réessayez dans ${reste} minute${reste > 1 ? 's' : ''}.` }
  }

  // Même travail cryptographique que le compte existe ou non : sans cela, une réponse
  // instantanée signalerait « cet e-mail n'existe pas ».
  const empreinte = u?.mot_de_passe || hacher(crypto.randomBytes(16).toString('hex'))
  const ok = verifier(mdp, empreinte)

  if (!u || !u.mot_de_passe || !u.actif || !ok) {
    if (u) {
      const echecs = (u.echecs || 0) + 1
      const bloque = echecs >= BLOCAGE_APRES
        ? new Date(Date.now() + BLOCAGE_MINUTES * 60000).toISOString()
        : null
      run('UPDATE utilisateur SET echecs = ?, bloque_jusqua = ? WHERE id = ?', [echecs, bloque, u.id])
    }
    return { erreur: GENERIQUE }
  }

  return { utilisateur: u }
}

// ── Gardes ───────────────────────────────────────────────────

/** À appeler en tête de toute action serveur. Lève si l'utilisateur n'a pas le droit. */
export async function exiger(permission) {
  const u = await utilisateurConnecte()
  if (!u) throw new Error('Session expirée : reconnectez-vous.')
  if (permission && !u.permissions.includes(permission)) {
    throw new Error(`Action refusée : il vous manque le droit « ${permission} ».`)
  }
  return u
}

export function roles() {
  return all('SELECT * FROM role ORDER BY nom')
}

export function purgerSessionsExpirees() {
  run('DELETE FROM session WHERE expire_le < ?', [new Date().toISOString()])
}
