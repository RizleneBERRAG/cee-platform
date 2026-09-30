import { garde } from '../../lib/garde.js'

export const dynamic = 'force-dynamic'

const ONGLETS = [
  ['/parametrage/delegataires', 'Délégataires', 'deal.gerer'],
  ['/parametrage/deals', 'Deals et tarifs', 'deal.gerer'],
  ['/parametrage/rge', 'Installateurs RGE', 'referentiel.gerer'],
  ['/parametrage/pieces', 'Pièces et liasses', 'referentiel.gerer'],
  ['/parametrage/workflow', 'Étapes et statuts', 'referentiel.gerer'],
  ['/parametrage/controle', 'Bureaux de contrôle', 'referentiel.gerer'],
  ['/parametrage/catalogue', 'Catalogue produits', 'referentiel.gerer'],
  ['/parametrage/interventions', "Types d'intervention", 'referentiel.gerer'],
  ['/parametrage/sav', 'S.A.V', 'referentiel.gerer'],
  ['/parametrage/societes', 'Sociétés émettrices', 'referentiel.gerer'],
  ['/parametrage/listes', 'Autres listes', 'referentiel.gerer'],
]

export default async function LayoutParametrage({ children }) {
  const { u } = await garde()
  const visibles = ONGLETS.filter(([, , p]) => u.permissions.includes(p))

  return (
    <>
      <h1>Paramétrage</h1>
      <p className="lede">
        Tout ce qui se règle ici se réglait auparavant en SQL. Deux règles y sont tenues sans
        exception : <b>on ne supprime jamais ce qui est utilisé</b> — c'est désactivé — et
        <b> modifier un tarif ne recalcule aucun dossier déjà figé</b>.
      </p>
      <div className="chips">
        {visibles.map(([href, libelle]) => (
          <a key={href} href={href}>{libelle}</a>
        ))}
      </div>
      {children}
    </>
  )
}
