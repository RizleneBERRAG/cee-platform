import { db } from '../../../lib/db.js'
import { interventionsDossier, typesIntervention } from '../../../lib/planning.js'
import { STATUTS_INTERVENTION } from '../../../lib/referentiels-planning.js'
import { utilisateursActifs } from '../../../lib/rappels.js'
import {
  creerInterventionAction, realiserInterventionAction, annulerInterventionAction,
} from '../../../lib/actions-planning.js'

const champ = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, font: 'inherit' }
const quand = (h) => {
  if (!h) return null
  const jour = h.slice(0, 10).split('-').reverse().join('/')
  return h.length > 10 ? `${jour} ${h.slice(11, 16)}` : jour
}

/**
 * Les interventions du dossier : ce qui est prévu chez le client, et ce qui a eu lieu.
 * Laisser la date vide crée une intervention « à planifier » : elle attend dans la colonne
 * de droite du planning qu'on la glisse sur un jour.
 */
export default function Interventions({ d, u, peutModifier }) {
  const liste = interventionsDossier(db(), d.id)
  const types = typesIntervention(db())
  const tous = u.permissions.includes('planning.tous')
  const equipe = tous ? utilisateursActifs() : utilisateursActifs().filter((p) => p.id === u.id)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2>Interventions</h2>
      {peutModifier && (
        <form key={`itv-${liste.length}`} action={creerInterventionAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <input type="hidden" name="dossier_id" value={d.id} />
          <div className="field" style={{ marginBottom: 0 }}><label>Type</label>
            <select name="type_id" style={champ}>{types.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</select></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Début (vide = à planifier)</label>
            <input type="datetime-local" name="debut" style={champ} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Fin</label>
            <input type="datetime-local" name="fin" style={champ} /></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Attribuée à</label>
            <select name="attribuee_a" defaultValue={tous ? '' : u.id} style={champ}>
              {tous && <option value="">Personne</option>}
              {equipe.map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
            </select></div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}><label>Commentaire</label>
            <input name="commentaire" style={{ ...champ, width: '100%' }} /></div>
          <button className="btn primary">Créer</button>
        </form>
      )}

      {liste.length === 0 ? <p className="muted">Aucune intervention.</p> : (
        <table>
          <thead><tr><th>Type</th><th>Quand</th><th>Attribuée à</th><th>Statut</th><th>Commentaire</th><th></th></tr></thead>
          <tbody>
            {liste.map((i) => {
              const st = STATUTS_INTERVENTION[i.statut] || { libelle: i.statut, couleur: '#64748b' }
              return (
                <tr key={i.id}>
                  <td><span className="tag" style={{ borderLeft: `4px solid ${i.type_couleur}` }}>{i.type_libelle}</span></td>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {i.debut
                      ? <a href={`/planning?date=${i.debut.slice(0, 10)}&type=${i.type_id}`} style={{ color: 'var(--accent)' }}>{quand(i.debut)}</a>
                      : <span className="muted">à planifier</span>}
                    {i.fin && i.fin.slice(0, 10) !== (i.debut || '').slice(0, 10) ? ` → ${quand(i.fin)}` : ''}
                  </td>
                  <td>{i.attribuee_prenom ? `${i.attribuee_prenom} ${i.attribuee_nom}` : '—'}</td>
                  <td><span className="pill" style={{ background: st.couleur }}>{st.libelle}</span></td>
                  <td style={{ fontSize: 12.5, whiteSpace: 'pre-line' }}>
                    {i.commentaire}
                    {i.compte_rendu && <div><b>Compte rendu :</b> {i.compte_rendu}</div>}
                  </td>
                  <td style={{ minWidth: 220 }}>
                    {peutModifier && st.modifiable && (tous || !i.attribuee_a || i.attribuee_a === u.id) && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {i.debut && (
                          <form action={realiserInterventionAction} style={{ display: 'flex', gap: 4 }}>
                            <input type="hidden" name="id" value={i.id} />
                            <input name="compte_rendu" placeholder="Compte rendu…" style={{ flex: 1, fontSize: 12, padding: '3px 6px' }} />
                            <button className="btn s primary">Réalisée</button>
                          </form>
                        )}
                        <form action={annulerInterventionAction} style={{ display: 'flex', gap: 4 }}>
                          <input type="hidden" name="id" value={i.id} />
                          <input name="motif" placeholder="Motif…" style={{ flex: 1, fontSize: 12, padding: '3px 6px' }} />
                          <button className="btn s danger">Annuler</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
