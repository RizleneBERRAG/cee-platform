import { utilisateurConnecte } from '../../lib/auth.js'
import { changerMonMotDePasse, deconnexion } from '../../lib/actions-auth.js'
import { PERMISSIONS } from '../../lib/permissions.js'
import { all } from '../../lib/db.js'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Compte({ searchParams }) {
  const u = await utilisateurConnecte()
  if (!u) redirect('/connexion')
  const sp = await searchParams

  const sessions = all(
    `SELECT id, cree_le, expire_le, agent FROM session
      WHERE utilisateur_id = ? AND (agent IS NULL OR agent <> 'activation')
      ORDER BY cree_le DESC`,
    [u.id]
  )

  return (
    <>
      <h1>Mon compte</h1>
      <p className="lede">{u.prenom} {u.nom} · {u.email}</p>

      {sp?.premier && (
        <div className="alert warn">
          <b>Choisissez votre mot de passe</b>
          Votre compte a été créé avec un mot de passe provisoire. Changez-le pour continuer.
        </div>
      )}
      {sp?.ok && <div className="alert ok"><b>Mot de passe modifié</b>Vos autres sessions ont été fermées.</div>}
      {sp?.e && <div className="alert danger">{sp.e}</div>}

      <div className="grid k2" style={{ marginTop: 14 }}>
        <form action={changerMonMotDePasse} className="card">
          <h2>Changer mon mot de passe</h2>
          <div className="field">
            <label>Mot de passe actuel</label>
            <input name="actuel" type="password" required autoComplete="current-password" />
          </div>
          <div className="field">
            <label>Nouveau mot de passe</label>
            <input name="nouveau" type="password" required autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirmez le nouveau</label>
            <input name="confirmation" type="password" required autoComplete="new-password" />
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Au moins 12 caractères, dont une lettre et un chiffre. Changer votre mot de passe
            ferme toutes vos autres sessions ouvertes.
          </p>
          <button className="btn primary">Changer le mot de passe</button>
        </form>

        <div>
          <div className="card">
            <h2>Ce que votre rôle vous permet</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Rôle <b>{u.role || 'aucun'}</b>
              {!u.permissions.includes('dossier.tous') && u.uniteNom
                ? <> — vous ne voyez que les dossiers de <b>{u.uniteNom}</b>.</>
                : null}
            </p>
            <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, lineHeight: 1.8 }}>
              {u.permissions.length === 0
                ? <li className="muted">Aucun droit n'est attribué à votre rôle.</li>
                : u.permissions.map((p) => <li key={p}>{PERMISSIONS[p] || p}</li>)}
            </ul>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Mes sessions ouvertes</h2>
            <table>
              <thead><tr><th>Ouverte le</th><th>Expire le</th></tr></thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="mono" style={{ fontSize: 12 }}>{new Date(s.cree_le + 'Z').toLocaleString('fr-FR')}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{new Date(s.expire_le).toLocaleString('fr-FR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={deconnexion} style={{ marginTop: 12 }}>
              <button className="btn">Se déconnecter</button>
            </form>
          </div>
        </div>
      </div>
    </>
  )
}
