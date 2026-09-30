import { garde } from '../../lib/garde.js'
import { db } from '../../lib/db.js'
import { listerCorbeille, obstaclesDefinitifs } from '../../lib/corbeille.js'
import { unites } from '../../lib/queries.js'
import { recupererAction, supprimerDefinitivementAction } from '../../lib/actions-corbeille.js'

export const dynamic = 'force-dynamic'

export default async function Corbeille({ searchParams }) {
  const { u, portee } = await garde('dossier.supprimer')
  const sp = await searchParams
  const base = db()
  const tous = u.permissions.includes('dossier.tous')
  const filtreUnite = tous && sp.unite ? { uniteId: sp.unite === 'aucune' ? null : sp.unite } : {}
  const liste = listerCorbeille(base, { ...portee, ...filtreUnite })
  const obstacles = Object.fromEntries(liste.map((d) => [d.id, obstaclesDefinitifs(base, d.id)]))

  return (
    <>
      <h1>Corbeille</h1>
      <p className="lede">
        Les dossiers supprimés n'apparaissent plus nulle part — listes, totaux, planning, rappels —
        et leur client n'a plus accès à son espace. « Récupérer » les remet exactement comme ils
        étaient. La suppression définitive, elle, efface le dossier et tout ce qui n'appartient
        qu'à lui : elle ne se rattrape pas.
      </p>

      {sp?.m && <div className={`alert ${/Refusé|non faite/.test(sp.m) ? 'warn' : 'ok'}`}><b>Corbeille</b>{sp.m}</div>}

      {tous && (
        <form className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 14 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 220 }}><label>Unité d'affaire</label>
            <select name="unite" defaultValue={sp.unite || ''}>
              <option value="">Toutes</option><option value="aucune">Sans unité</option>
              {unites().map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select></div>
          <button className="btn">Filtrer</button>
        </form>
      )}

      <form className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th style={{ width: 34 }}></th><th>Dossier</th><th>Client</th><th>Fiche</th><th>Chantier</th><th>Supprimé le</th><th>Par</th><th>Motif</th><th>Suppression définitive</th></tr>
          </thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: 18 }}>La corbeille est vide.</td></tr>}
            {liste.map((d) => (
              <tr key={d.id}>
                <td><input type="checkbox" name="dossier_id" value={d.id} aria-label={`Sélectionner ${d.numero}`} /></td>
                <td><a href={`/dossiers/${d.id}`} className="mono" style={{ color: 'var(--accent)' }}>{d.numero}</a>
                  {d.unite_nom && <div className="muted" style={{ fontSize: 11 }}>{d.unite_nom}</div>}</td>
                <td>{d.client}</td>
                <td className="mono">{d.fiche_code}</td>
                <td>{d.code_postal} {d.ville}</td>
                <td className="mono" style={{ whiteSpace: 'nowrap' }}>{quand(d.supprime_le)}</td>
                <td>{d.par_prenom ? `${d.par_prenom} ${d.par_nom}` : '—'}</td>
                <td style={{ fontSize: 12.5 }}>{d.motif_suppression}</td>
                <td style={{ fontSize: 12 }}>
                  {obstacles[d.id].length === 0
                    ? <span className="tag">possible</span>
                    : <span className="muted">impossible : {obstacles[d.id].join(' ; ')}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {liste.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
            <button className="btn primary" formAction={recupererAction}>Récupérer la sélection</button>
            <span style={{ flex: 1 }} />
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
              <input type="checkbox" name="confirme" value="oui" style={{ width: 'auto' }} />
              Je confirme : la suppression définitive ne se rattrape pas
            </label>
            <button className="btn danger" formAction={supprimerDefinitivementAction}>Supprimer définitivement</button>
          </div>
        )}
      </form>
    </>
  )
}

/** Horodatage SQLite (UTC) affiché à l'heure locale. */
function quand(h) {
  const d = new Date(`${h.replace(' ', 'T')}Z`)
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
