/**
 * L'accès du client à son dossier.
 *
 * ── Le principe : un lien vers un dossier, pas un compte ──
 *
 * Le client ne devient pas utilisateur de la plateforme. Il reçoit un identifiant et un
 * code pour SON dossier, et rien d'autre. Ce choix évite tout ce qu'un compte traîne
 * derrière lui — mot de passe oublié, réinitialisation par mail, compte qui survit au
 * dossier — et il rend la révocation triviale : une ligne, et l'accès n'existe plus.
 *
 * ── Ce qui est public et ce qui ne l'est pas ──
 *
 * L'identifiant voyage dans l'URL : il est public par construction, et on le traite comme
 * tel. Le code d'accès, lui, n'est stocké que sous forme d'empreinte scrypt, comme un mot
 * de passe — parce que c'en est un. Il est affiché **une seule fois**, à la création. S'il
 * est perdu, on en génère un nouveau ; on ne le retrouve pas, et c'est la preuve qu'il
 * n'est stocké nulle part.
 *
 * ── Pourquoi un alphabet sans I, l, O, 0, 1 ──
 *
 * Ce code sera dicté au téléphone et recopié à la main. Un zéro pris pour un O, c'est un
 * appel au support pour un problème qui n'existe pas. On retire les caractères qui se
 * confondent plutôt que d'expliquer au client comment les distinguer.
 */
import crypto from 'node:crypto'
import { hacher, verifier } from './empreinte.js'

/** Alphabet sans les caractères qui se confondent à l'œil ou à l'oreille. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** Tire une chaîne aléatoire dans l'alphabet, sans biais modulo. */
function tirer(longueur) {
  const out = []
  while (out.length < longueur) {
    // On rejette les octets qui déborderaient : un simple `% 31` favoriserait les
    // premières lettres. Le biais serait invisible et affaiblirait le tirage.
    for (const o of crypto.randomBytes(longueur * 2)) {
      if (o >= 248) continue
      out.push(ALPHABET[o % ALPHABET.length])
      if (out.length === longueur) break
    }
  }
  return out.join('')
}

/** L'identifiant public, en groupes lisibles : `K7MP-3XRD-9TFA`. */
export function genererIdentifiant() {
  return [tirer(4), tirer(4), tirer(4)].join('-')
}

/**
 * Le code d'accès : 10 caractères de l'alphabet réduit.
 *
 * Soit environ 31^10, un peu moins de 50 bits. Ce n'est pas un secret d'État, mais l'accès
 * ne donne qu'un dossier en lecture, il est révocable, et la tentative en force est
 * ralentie par scrypt à la vérification. Plus long serait indictable au téléphone.
 */
export function genererCode() {
  return [tirer(5), tirer(5)].join('-')
}

/**
 * Ouvre un accès pour un dossier.
 *
 * Renvoie le code **en clair** : c'est la seule fois où il existe ailleurs que dans la
 * tête du client. L'appelant doit l'afficher immédiatement et ne pas le conserver.
 */
export function ouvrirAcces(db, dossierId, utilisateurId = null) {
  const id = crypto.randomUUID()
  const identifiant = genererIdentifiant()
  const code = genererCode()

  db.prepare(`INSERT INTO acces_client (id, dossier_id, identifiant, secret_empreinte, cree_par)
              VALUES (?,?,?,?,?)`).run(id, dossierId, identifiant, hacher(code), utilisateurId)

  return { id, identifiant, code, dossierId }
}

/**
 * Révoque un accès. Le dossier n'est pas touché.
 *
 * Les sessions ouvertes sont supprimées dans la foulée : sans cela, un client déjà connecté
 * garderait la main jusqu'à l'expiration de son jeton, et « révoquer » ne voudrait rien
 * dire pendant plusieurs heures.
 */
export function revoquerAcces(db, accesId, utilisateurId = null) {
  const r = db.prepare(`UPDATE acces_client SET revoque_le = datetime('now'), revoque_par = ?
                        WHERE id = ? AND revoque_le IS NULL`).run(utilisateurId, accesId)
  db.prepare('DELETE FROM session_client WHERE acces_client_id = ?').run(accesId)
  return r.changes > 0
}

/**
 * Vérifie un couple identifiant/code et renvoie l'accès, ou null.
 *
 * ── Le détail qui compte ──
 *
 * On calcule l'empreinte **même quand l'identifiant est inconnu**. Sans cela, une réponse
 * immédiate signalerait « cet identifiant n'existe pas » et une réponse lente « il existe,
 * mais le code est faux » : de quoi énumérer les identifiants valides au chronomètre.
 * On paie donc le scrypt dans tous les cas.
 */
export function verifierAcces(db, identifiant, code) {
  const a = db.prepare(`SELECT * FROM acces_client
                        WHERE identifiant = ? AND revoque_le IS NULL`)
    .get(String(identifiant || '').trim().toUpperCase())

  const empreinteFactice = '$scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
  const bon = verifier(String(code || '').trim().toUpperCase(), a ? a.secret_empreinte : empreinteFactice)
  if (!a || !bon) return null

  db.prepare(`UPDATE acces_client SET derniere_visite = datetime('now'), visites = visites + 1
              WHERE id = ?`).run(a.id)
  return a
}

/** Les accès d'un dossier, sans jamais exposer l'empreinte. */
export function accesDuDossier(db, dossierId) {
  return db.prepare(`SELECT id, identifiant, cree_le, derniere_visite, visites, revoque_le
                     FROM acces_client WHERE dossier_id = ? ORDER BY cree_le DESC`).all(dossierId)
}

// ── La session du client ─────────────────────────────────────
//
// Volontairement séparée de celle du personnel. Deux mécanismes distincts pour deux
// publics distincts : un défaut sur l'un ne doit pas ouvrir l'autre, et un client n'est
// pas un utilisateur de la plateforme — il n'a ni rôle, ni permission, ni compte.

export const COOKIE_CLIENT = 'cee_client'

/** Durée courte, et c'est délibéré : ces liens circulent par mail et par SMS. */
export const DUREE_SESSION_CLIENT_HEURES = 8

export function ouvrirSessionClient(db, accesId, agent = null) {
  const id = crypto.randomBytes(32).toString('base64url')
  const expire = new Date(Date.now() + DUREE_SESSION_CLIENT_HEURES * 3600000).toISOString()
  db.prepare('INSERT INTO session_client (id, acces_client_id, expire_le, agent) VALUES (?,?,?,?)')
    .run(id, accesId, expire, agent)
  return { id, expire }
}

/**
 * L'accès associé à un jeton de session, ou null.
 *
 * Relu en base à chaque appel, et joint à `acces_client` : un accès révoqué par le gérant
 * coupe immédiatement la session en cours, sans attendre son expiration. C'est tout
 * l'intérêt de ne rien mettre dans le cookie.
 */
export function sessionClient(db, jetonSession) {
  if (!jetonSession) return null
  const r = db.prepare(`
    SELECT sc.id AS session_id, sc.expire_le, a.*
      FROM session_client sc
      JOIN acces_client a ON a.id = sc.acces_client_id
     WHERE sc.id = ? AND a.revoque_le IS NULL`).get(String(jetonSession))
  if (!r) return null
  if (new Date(r.expire_le) < new Date()) {
    db.prepare('DELETE FROM session_client WHERE id = ?').run(r.session_id)
    return null
  }
  return r
}

export function fermerSessionClient(db, jetonSession) {
  if (jetonSession) db.prepare('DELETE FROM session_client WHERE id = ?').run(String(jetonSession))
}

/** Purge : une session expirée n'a aucune raison de rester en base. */
export function purgerSessionsClient(db) {
  return db.prepare("DELETE FROM session_client WHERE expire_le < datetime('now')").run().changes
}
