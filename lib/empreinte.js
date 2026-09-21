/**
 * Empreintes de secrets — mots de passe du personnel, codes d'accès des clients.
 *
 * ── Pourquoi ce fichier existe séparément ──
 *
 * Ce code vivait dans `lib/auth.js`, qui importe `next/headers` pour lire les cookies.
 * Conséquence : impossible de hacher quoi que ce soit en dehors d'une requête Next — ni
 * dans un script, ni dans un test. L'espace client a buté dessus le premier.
 *
 * Le calcul d'une empreinte ne dépend ni du web ni d'une requête. Il est donc ici, sans
 * aucune dépendance, et `auth.js` comme `acces-client.js` s'en servent.
 *
 * ── Le choix de scrypt ──
 *
 * Volontairement lent et gourmand en mémoire : une fuite de la base ne donne pas les
 * secrets. La comparaison est à temps constant, pour qu'un secret presque juste ne se
 * distingue pas d'un secret très faux au chronomètre.
 */
import crypto from 'node:crypto'

const SCRYPT = { N: 16384, r: 8, p: 1, longueur: 64 }

export function hacher(secret) {
  const sel = crypto.randomBytes(16)
  const empreinte = crypto.scryptSync(String(secret).normalize('NFKC'), sel, SCRYPT.longueur, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 256 * 1024 * 1024,
  })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${sel.toString('base64')}$${empreinte.toString('base64')}`
}

export function verifier(secret, stocke) {
  if (!stocke) return false
  const parts = String(stocke).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, sel, empreinte] = parts
  try {
    const attendu = Buffer.from(empreinte, 'base64')
    const calcule = crypto.scryptSync(String(secret).normalize('NFKC'), Buffer.from(sel, 'base64'), attendu.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024,
    })
    return crypto.timingSafeEqual(attendu, calcule)
  } catch {
    return false
  }
}
