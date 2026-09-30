import './globals.css'
import { utilisateurConnecte } from '../lib/auth.js'
import { deconnexion } from '../lib/actions-auth.js'
import { compteurs } from '../lib/rappels.js'

export const metadata = {
  title: 'Plateforme CEE',
  description: "Gestion des dossiers de Certificats d'Économies d'Énergie",
}

/** Chaque entrée porte la permission qui la conditionne. Rien n'est affiché « au cas où ». */
const LIENS = [
  ['/', 'Tableau de bord', null],
  ['/dossiers', 'Dossiers', 'dossier.voir'],
  ['/rappels', 'Rappels', 'dossier.voir'],
  ['/planning', 'Planning', 'dossier.voir'],
  ['/sav', 'S.A.V', 'dossier.voir'],
  ['/lots', 'Lots de dépôt', 'lot.gerer'],
  ['/aap', 'Appels à paiement', 'lot.gerer'],
  ['/simulateur', 'Simulateur de marge', 'marge.voir'],
  ['/referentiel', 'Référentiel des fiches', null],
  ['/parametrage', 'Paramétrage', 'referentiel.gerer'],
  ['/utilisateurs', 'Comptes et rôles', 'utilisateur.gerer'],
  ['/corbeille', 'Corbeille', 'dossier.supprimer'],
  // Le guide est un fichier statique : il reste lisible même quand l'application ne
  // démarre pas, et c'est justement là qu'on en a le plus besoin.
  ['/aide.html', "Guide d'utilisation", null],
]

export default async function RootLayout({ children }) {
  const u = await utilisateurConnecte()

  // Les écrans d'authentification se dessinent seuls, sans coquille ni navigation.
  // La garde d'accès elle-même est posée par app/(protege)/layout.jsx : la faire ici
  // empêcherait d'afficher la page de connexion.
  if (!u) {
    return (
      <html lang="fr">
        <body>{children}</body>
      </html>
    )
  }

  const visibles = LIENS.filter(([, , perm]) => !perm || u.permissions.includes(perm))
  // Ce qui attend la personne connectée aujourd'hui : du jour + en retard.
  let aFaire = 0
  if (u.permissions.includes('dossier.voir')) {
    const portee = u.permissions.includes('dossier.tous') ? {} : { uniteId: u.uniteId ?? '—aucune—' }
    const n = compteurs({ attribueA: u.id, ...portee })
    aFaire = n.jour + n.retard
  }

  return (
    <html lang="fr">
      <body>
        <div className="shell">
          <aside className="side">
            <div className="brand">
              Plateforme CEE
              <small>Prototype — tranche verticale</small>
            </div>
            <nav>
              {visibles.map(([href, label]) => (
                <a key={href} href={href}>
                  {label}
                  {href === '/rappels' && aFaire > 0 && <span className="badge-nav">{aFaire}</span>}
                </a>
              ))}
            </nav>
            <div className="compte">
              <a href="/compte" className="compte-nom">
                {u.prenom} {u.nom}
                <small>
                  {u.role || 'sans rôle'}
                  {!u.permissions.includes('dossier.tous') && u.uniteNom ? ` · ${u.uniteNom}` : ''}
                </small>
              </a>
              <form action={deconnexion}>
                <button className="lien-deco">Se déconnecter</button>
              </form>
            </div>
          </aside>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  )
}
