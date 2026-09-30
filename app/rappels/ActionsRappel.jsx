import { terminerRappel, reporterRappel } from '../../lib/actions-rappels.js'

/** Faire ou reporter. Partagé avec la fiche dossier. */
export function ActionsRappel({ id }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <form action={terminerRappel} style={{ display: 'flex', gap: 4 }}>
        <input type="hidden" name="id" value={id} />
        <input name="compte_rendu" placeholder="Compte rendu…" style={{ flex: 1, fontSize: 12, padding: '3px 6px' }} />
        <button className="btn s primary">Fait</button>
      </form>
      <form action={reporterRappel} style={{ display: 'flex', gap: 4 }}>
        <input type="hidden" name="id" value={id} />
        <input type="datetime-local" name="date_rappel" required style={{ flex: 1, fontSize: 12, padding: '3px 6px' }} />
        <button className="btn s">Reporter</button>
      </form>
    </div>
  )
}

/** `utc` : les horodatages SQLite (« 2026-09-30 12:00:00 ») sont en UTC ; les dates de rappel sont locales. */
export function dateHeure(v, utc = false) {
  if (!v) return '—'
  const d = new Date(utc ? v.replace(' ', 'T') + 'Z' : v.length === 10 ? `${v}T00:00` : v)
  const jour = d.toLocaleDateString('fr-FR')
  return v.length === 10 ? jour : `${jour} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
