import { PERMISSIONS } from '../../lib/permissions.js'
import { garde } from '../../lib/garde.js'

export const dynamic = 'force-dynamic'

export default async function Refus({ searchParams }) {
  const { u } = await garde()
  const sp = await searchParams
  const p = sp?.p

  return (
    <div className="refus">
      <h1>Accès refusé</h1>
      <p className="lede">
        {p && PERMISSIONS[p]
          ? <>Cet écran demande le droit « {PERMISSIONS[p]} », que votre rôle <b>{u.role}</b> n'a pas.</>
          : <>Votre rôle <b>{u.role}</b> ne donne pas accès à cet écran.</>}
      </p>
      <p className="muted" style={{ fontSize: 13 }}>
        Si vous en avez besoin pour votre travail, demandez-le à votre gérant : il peut
        l'ouvrir à votre rôle sans qu'on touche au code.
      </p>
      <p style={{ marginTop: 18 }}>
        <a className="btn primary" href="/">Retour au tableau de bord</a>
      </p>
    </div>
  )
}
