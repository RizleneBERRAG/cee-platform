import { get } from '../../../lib/db.js'
import { activerCompte } from '../../../lib/actions-auth.js'

export const dynamic = 'force-dynamic'

export default async function Activation({ params, searchParams }) {
  const { token } = await params
  const sp = await searchParams

  const s = get('SELECT * FROM session WHERE id = ? AND agent = ?', [token, 'activation'])
  const valide = s && new Date(s.expire_le) >= new Date()
  const compte = valide ? get('SELECT email, prenom, nom FROM utilisateur WHERE id = ?', [s.utilisateur_id]) : null

  return (
    <div className="ecran-auth">
      <div className="carte-auth">
        <div className="marque-auth">
          Plateforme CEE
          <small>Activation de votre compte</small>
        </div>

        {!valide ? (
          <>
            <div className="alert danger">
              <b>Lien inutilisable</b>
              Ce lien d'activation a expiré ou a déjà servi. Demandez-en un nouveau à votre gérant.
            </div>
            <p style={{ marginTop: 14 }}>
              <a href="/connexion" style={{ color: 'var(--accent)' }}>← Aller à la connexion</a>
            </p>
          </>
        ) : (
          <form action={activerCompte}>
            <input type="hidden" name="token" value={token} />
            <h2 style={{ marginTop: 0 }}>Bonjour {compte?.prenom}</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Choisissez votre mot de passe pour <b>{compte?.email}</b>.
              Personne d'autre ne le connaîtra, pas même la personne qui vous a créé le compte.
            </p>
            {sp?.e && <div className="alert danger" style={{ marginBottom: 14 }}>{sp.e}</div>}
            <label>Mot de passe<input name="mot_de_passe" type="password" required autoFocus autoComplete="new-password" /></label>
            <label>Confirmez<input name="confirmation" type="password" required autoComplete="new-password" /></label>
            <p className="muted" style={{ fontSize: 12 }}>Au moins 12 caractères, dont une lettre et un chiffre.</p>
            <button className="btn primary" style={{ width: '100%', marginTop: 6 }}>Activer et entrer</button>
          </form>
        )}
      </div>
    </div>
  )
}
