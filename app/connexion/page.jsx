import { aucunCompteActif, utilisateurConnecte } from '../../lib/auth.js'
import { connexion, creerPremierCompte } from '../../lib/actions-auth.js'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Connexion({ searchParams }) {
  const sp = await searchParams
  if (await utilisateurConnecte()) redirect('/')
  const premierDemarrage = aucunCompteActif()

  return (
    <div className="ecran-auth">
      <div className="carte-auth">
        <div className="marque-auth">
          Plateforme CEE
          <small>Certificats d'économies d'énergie</small>
        </div>

        {sp?.e && <div className="alert danger" style={{ marginBottom: 14 }}>{sp.e}</div>}

        {premierDemarrage ? (
          <form action={creerPremierCompte}>
            <h2 style={{ marginTop: 0 }}>Premier démarrage</h2>
            <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
              Aucun compte n'existe encore. Créez celui du gérant : il aura tous les droits,
              y compris la gestion des autres comptes.
            </p>
            <div className="grid k2" style={{ gap: 10 }}>
              <label>Prénom<input name="prenom" required autoComplete="given-name" /></label>
              <label>Nom<input name="nom" required autoComplete="family-name" /></label>
            </div>
            <label>Adresse e-mail<input name="email" type="email" required autoComplete="username" /></label>
            <label>Mot de passe<input name="mot_de_passe" type="password" required autoComplete="new-password" /></label>
            <label>Confirmez le mot de passe<input name="confirmation" type="password" required autoComplete="new-password" /></label>
            <p className="muted" style={{ fontSize: 12 }}>
              Au moins 12 caractères, dont une lettre et un chiffre. Il n'est pas stocké :
              seule une empreinte l'est, et elle ne permet pas de le retrouver.
            </p>
            <button className="btn primary" style={{ width: '100%', marginTop: 6 }}>Créer le compte et entrer</button>
          </form>
        ) : (
          <form action={connexion}>
            <h2 style={{ marginTop: 0 }}>Connexion</h2>
            <label>Adresse e-mail<input name="email" type="email" required autoFocus autoComplete="username" /></label>
            <label>Mot de passe<input name="mot_de_passe" type="password" required autoComplete="current-password" /></label>
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }}>Se connecter</button>
            <p className="muted" style={{ fontSize: 12, marginTop: 14, marginBottom: 0 }}>
              Mot de passe oublié ? Demandez à votre gérant un lien d'activation :
              il vous laissera en choisir un nouveau sans que personne d'autre ne le connaisse.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
