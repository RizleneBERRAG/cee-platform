import { redirect } from 'next/navigation'
import { utilisateurConnecte } from '../../lib/auth.js'

export const dynamic = 'force-dynamic'

export default async function Parametrage() {
  const u = await utilisateurConnecte()
  if (!u) redirect('/connexion')
  // On ouvre sur le premier onglet auquel la personne a droit.
  if (u.permissions.includes('deal.gerer')) redirect('/parametrage/delegataires')
  if (u.permissions.includes('referentiel.gerer')) redirect('/parametrage/rge')
  redirect('/refus?p=referentiel.gerer')
}
