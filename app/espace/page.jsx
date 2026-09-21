import { redirect } from 'next/navigation'
import { connexionClient, accesCourant } from './actions.js'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Suivi de votre dossier' }

/**
 * L'entrée de l'espace client.
 *
 * Deux champs, rien d'autre : pas de création de compte, pas de mot de passe oublié, pas
 * d'inscription. L'accès est délivré par le gérant et révocable d'une ligne. Tout ce qui
 * ressemblerait à un compte durable amènerait ses propres problèmes — réinitialisation par
 * mail, compte qui survit au dossier — pour un besoin qui dure quelques semaines.
 */
export default async function Espace({ searchParams }) {
  if (await accesCourant()) redirect('/espace/dossier')
  const { m } = await searchParams

  return (
    <main style={{ maxWidth: 420, margin: '8vh auto', padding: '0 20px' }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Suivi de votre dossier</h1>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Saisissez l’identifiant et le code qui vous ont été communiqués.
      </p>

      {m && (
        <div style={{ border: '1px solid var(--danger)', background: '#fdf0f0', color: '#7a1f1f',
                      padding: '9px 11px', borderRadius: 6, fontSize: 13, margin: '14px 0' }}>
          {m}
        </div>
      )}

      <form action={connexionClient} style={{ display: 'grid', gap: 12, marginTop: 18 }}>
        <div className="field">
          <label htmlFor="identifiant">Identifiant</label>
          <input id="identifiant" name="identifiant" required autoComplete="off"
                 placeholder="XXXX-XXXX-XXXX" style={{ textTransform: 'uppercase' }} />
        </div>
        <div className="field">
          <label htmlFor="code">Code d’accès</label>
          <input id="code" name="code" required autoComplete="off" type="password"
                 placeholder="XXXXX-XXXXX" />
        </div>
        <button className="btn primary">Accéder à mon dossier</button>
      </form>

      <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 22 }}>
        Ces identifiants sont personnels. Si vous les avez perdus, contactez votre
        interlocuteur : un nouveau code sera généré — l’ancien ne peut pas être retrouvé.
      </p>
    </main>
  )
}
