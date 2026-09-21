import { lots, delegataires } from '../../lib/queries.js'
import { creerLot } from '../../lib/actions.js'
import { euros, nombre } from '../../lib/marge.js'

import { garde } from '../../lib/garde.js'

export const dynamic = 'force-dynamic'

const ETATS = {
  EN_CONSTITUTION: ['En constitution', '#d97706'],
  DEPOSE: ['Déposé', '#1d4ed8'],
  INSTRUIT: ['En instruction', '#8b5cf6'],
  VALIDE: ['Validé', '#059669'],
  REJETE: ['Rejeté', '#dc2626'],
}

export default async function Lots() {
  await garde('lot.gerer')
  const liste = lots()
  const organismes = delegataires()

  return (
    <>
      <h1>Lots de dépôt</h1>
      <p className="lede">
        Un lot regroupe les dossiers transmis ensemble à un délégataire. Le dépôt verrouille
        les dossiers du lot : après transmission, plus aucune modification n'est possible.
      </p>

      <form action={creerLot} className="card" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ marginBottom: 0, minWidth: 260 }}>
          <label>Organisme destinataire</label>
          <select name="organisme" defaultValue={organismes[0]?.nom || ''}>
            {organismes.map((o) => <option key={o.id} value={o.nom}>{o.nom}{o.oblige ? ` — ${o.oblige}` : ''}</option>)}
          </select>
        </div>
        <button className="btn primary">Créer un lot</button>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Numéro</th><th>Organisme</th><th>État</th><th>Date de dépôt</th>
              <th className="num">Dossiers</th><th className="num">Cumac (MWh)</th><th className="num">Chiffre d'affaires</th>
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && (
              <tr><td colSpan={7} className="muted" style={{ padding: 18 }}>Aucun lot pour l'instant.</td></tr>
            )}
            {liste.map((l) => {
              const [label, couleur] = ETATS[l.statut] || [l.statut, '#64748b']
              return (
                <tr key={l.id}>
                  <td><a href={`/lots/${l.id}`} className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{l.numero}</a></td>
                  <td>{l.organisme || '—'}</td>
                  <td><span className="pill" style={{ background: couleur }}>{label}</span></td>
                  <td className="mono">{l.date_depot ? new Date(l.date_depot).toLocaleDateString('fr-FR') : '—'}</td>
                  <td className="num mono">{l.nb_dossiers}</td>
                  <td className="num mono">{nombre(l.cumac / 1000)}</td>
                  <td className="num mono">{euros(l.ca)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
