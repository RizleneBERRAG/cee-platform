import { db } from '../../../lib/db.js'
import { savDossier, referentielSav } from '../../../lib/sav.js'
import { utilisateursActifs } from '../../../lib/rappels.js'
import { creerSavAction } from '../../../lib/actions-sav.js'

const champ = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, font: 'inherit' }
const fr = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

/** Les S.A.V du dossier, et l'ouverture d'un nouveau. Le détail se traite sur la fiche du S.A.V. */
export default function SavDossier({ d, u, peutModifier }) {
  const base = db()
  const liste = savDossier(base, d.id)
  const opt = (cat) => referentielSav(base, cat).map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2>S.A.V</h2>
      {peutModifier && (
        <form action={creerSavAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <input type="hidden" name="dossier_id" value={d.id} />
          <div className="field" style={{ marginBottom: 0 }}><label>Type</label><select name="type_id" style={champ}><option value="">—</option>{opt('TYPE')}</select></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Motif</label><select name="motif_id" style={champ}><option value="">—</option>{opt('MOTIF')}</select></div>
          <div className="field" style={{ marginBottom: 0 }}><label>Attribué à</label>
            <select name="attribue_a" defaultValue={u.id} style={champ}>{utilisateursActifs().map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}</select></div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}><label>Problème</label>
            <input name="probleme" placeholder="Ce qui ne va pas…" style={{ ...champ, width: '100%' }} /></div>
          <button className="btn primary">Ouvrir un S.A.V</button>
        </form>
      )}
      {liste.length === 0 ? <p className="muted">Aucun S.A.V.</p> : (
        <table>
          <thead><tr><th>S.A.V</th><th>Type</th><th>Motif</th><th>Statut</th><th>Ouvert le</th><th>Attribué à</th><th>Problème</th></tr></thead>
          <tbody>
            {liste.map((v) => (
              <tr key={v.id} style={v.cloture ? { opacity: 0.6 } : undefined}>
                <td><a href={`/sav/${v.id}`} className="mono" style={{ color: 'var(--accent)' }}>{v.numero}</a></td>
                <td>{v.type_libelle || '—'}</td>
                <td>{v.motif_libelle || '—'}</td>
                <td>{v.cloture ? <span className="tag ok">clôturé {fr(v.regle_le)}</span> : <span className="tag warn">{v.statut_libelle || 'ouvert'}</span>}</td>
                <td className="mono">{fr(v.ouvert_le)}</td>
                <td>{v.attribue_prenom ? `${v.attribue_prenom} ${v.attribue_nom}` : '—'}</td>
                <td style={{ fontSize: 12.5 }}>{v.probleme}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
