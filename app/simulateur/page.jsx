import { fichesAvecVersions, deals } from '../../lib/queries.js'
import Simulateur from './Simulateur.jsx'

import { garde } from '../../lib/garde.js'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await garde('marge.voir')
  const fiches = fichesAvecVersions()
  const listeDeals = deals()
  return (
    <>
      <h1>Simulateur de marge</h1>
      <p className="lede">
        La marge nette avant engagement, pas après le dépôt. Le calcul croise la fiche et sa version,
        la zone climatique, le secteur d'activité, la charte, le régime du bénéficiaire, la présence de
        MaPrimeRénov' et la version du deal.
      </p>
      <Simulateur fiches={fiches} deals={listeDeals} />
    </>
  )
}
