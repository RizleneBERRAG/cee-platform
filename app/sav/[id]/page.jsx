import { garde, a } from '../../../lib/garde.js'
import { db, all } from '../../../lib/db.js'
import { lireSav, referentielSav } from '../../../lib/sav.js'
import { utilisateursActifs } from '../../../lib/rappels.js'
import { modifierSavAction, planifierSavAction } from '../../../lib/actions-sav.js'

export const dynamic = 'force-dynamic'

const opt = (liste) => liste.map((r) => <option key={r.id} value={r.id}>{r.libelle}</option>)

export default async function FicheSav({ params, searchParams }) {
  const { u, portee } = await garde('dossier.voir')
  const { id } = await params
  const sp = await searchParams
  const base = db()
  const v = lireSav(base, id)
  // Un S.A.V d'un dossier hors portée ressort « introuvable », comme le dossier lui-même.
  if (!v || (portee.uniteId !== undefined && (v.unite_affaire_id ?? null) !== (portee.uniteId ?? null))) return <p>S.A.V introuvable.</p>

  const peut = a(u, 'dossier.modifier')
  const tous = a(u, 'planning.tous')
  const equipe = utilisateursActifs()
  const historique = all(`SELECT j.*, u.prenom, u.nom FROM journal_champ j LEFT JOIN utilisateur u ON u.id = j.utilisateur_id
                          WHERE j.entite = 'SAV' AND j.entite_id = ? ORDER BY j.created_at DESC, j.rowid DESC`, [id])
  const supprime = base.prepare('SELECT supprime_le FROM dossier WHERE id = ?').get(v.dossier_id)?.supprime_le

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            {v.numero}{' '}
            <span className="pill" style={{ background: v.cloture ? 'var(--ok)' : 'var(--warn)', verticalAlign: 'middle' }}>{v.cloture ? 'Clôturé' : v.statut_libelle || 'Ouvert'}</span>
          </h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            <a href={`/dossiers/${v.dossier_id}?onglet=suivi`} style={{ color: 'var(--accent)' }}>{v.dossier_numero}</a>
            {' '}· {v.client} · {v.code_postal} {v.ville}{v.telephone ? ` · ${v.telephone}` : ''}
            {v.statut_dossier ? ` · dossier : ${v.statut_dossier}` : ''}
          </p>
        </div>
        <a className="btn" href="/sav">← Tous les S.A.V</a>
      </div>

      {sp?.m && <div className="alert ok" style={{ marginTop: 14 }}><b>S.A.V</b>{sp.m}</div>}
      {supprime && <div className="alert danger" style={{ marginTop: 14 }}><b>Le dossier est dans la corbeille</b>Ce S.A.V n'apparaît plus dans les listes tant que le dossier n'est pas récupéré.</div>}

      <div className="grid k2" style={{ marginTop: 14, alignItems: 'start' }}>
        <form action={modifierSavAction} className="card" style={{ margin: 0 }}>
          <input type="hidden" name="id" value={v.id} />
          <h2>Le S.A.V</h2>
          <div className="grid k2">
            <div className="field"><label>Type</label>
              <select name="type_id" defaultValue={v.type_id || ''} disabled={!peut}><option value="">—</option>{opt(referentielSav(base, 'TYPE'))}</select></div>
            <div className="field"><label>Motif</label>
              <select name="motif_id" defaultValue={v.motif_id || ''} disabled={!peut}><option value="">—</option>{opt(referentielSav(base, 'MOTIF'))}</select></div>
            <div className="field"><label>Statut</label>
              <select name="statut_id" defaultValue={v.statut_id || ''} disabled={!peut}><option value="">—</option>{opt(referentielSav(base, 'STATUT'))}</select></div>
            <div className="field"><label>Attribué à</label>
              <select name="attribue_a" defaultValue={v.attribue_a || ''} disabled={!peut}>
                <option value="">Personne</option>{equipe.map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
              </select></div>
            <div className="field"><label>Ouvert le</label><input value={fr(v.ouvert_le)} disabled /></div>
            <div className="field"><label>Date d'intervention S.A.V</label>
              <input type="date" name="date_intervention" defaultValue={(v.intervention_debut || v.date_intervention || '').slice(0, 10)} disabled={!peut || !!v.intervention_id}
                     title={v.intervention_id ? "Elle suit l'intervention du planning" : undefined} /></div>
            <div className="field"><label>Réglé le</label><input type="date" name="regle_le" defaultValue={v.regle_le || ''} disabled={!peut} /></div>
            <div className="field"><label style={{ marginTop: 22, display: 'flex', gap: 7, alignItems: 'center' }}>
              <input type="checkbox" name="cloture" defaultChecked={!!v.cloture} disabled={!peut} style={{ width: 'auto' }} /> Clôturé</label></div>
          </div>
          <div className="field"><label>Problème</label><textarea name="probleme" rows={4} defaultValue={v.probleme || ''} disabled={!peut} /></div>
          <div className="field"><label>Observation</label><textarea name="observation" rows={3} defaultValue={v.observation || ''} disabled={!peut} /></div>
          <p className="muted" style={{ fontSize: 11.5 }}>Choisir le statut « Réglé » clôt le S.A.V ; décocher « Clôturé » le rouvre.</p>
          {peut && <button className="btn primary">Enregistrer</button>}
        </form>

        <div>
          <div className="card" style={{ margin: 0 }}>
            <h2>Intervention S.A.V</h2>
            {v.intervention_id ? (
              <p style={{ margin: 0 }}>
                {v.intervention_debut ? <>Prévue le <b>{fr(v.intervention_debut)}</b>{v.intervention_debut.length > 10 ? ` à ${v.intervention_debut.slice(11, 16)}` : ''}</> : <>À planifier</>}
                {' '}· <a href={v.intervention_debut ? `/planning?date=${v.intervention_debut.slice(0, 10)}` : '/planning'} style={{ color: 'var(--accent)' }}>voir au planning</a>
              </p>
            ) : peut ? (
              <form action={planifierSavAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <input type="hidden" name="id" value={v.id} />
                <div className="field" style={{ marginBottom: 0 }}><label>Date (vide = à planifier)</label><input type="datetime-local" name="debut" /></div>
                <div className="field" style={{ marginBottom: 0 }}><label>Technicien</label>
                  <select name="attribue_a" defaultValue={tous ? (v.attribue_a || '') : u.id}>
                    {tous && <option value="">Personne</option>}
                    {(tous ? equipe : equipe.filter((p) => p.id === u.id)).map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
                  </select></div>
                <button className="btn">Planifier</button>
              </form>
            ) : <p className="muted">Aucune intervention.</p>}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Historique</h2>
            {historique.length === 0 ? <p className="muted">Rien encore.</p> : (
              <table>
                <tbody>
                  {historique.map((j) => (
                    <tr key={j.id}>
                      <td className="mono muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{quand(j.created_at)}</td>
                      <td>{j.champ.replace(`${v.numero} · `, '')}</td>
                      <td>{j.ancienne ? <><span className="muted">{j.ancienne}</span> → </> : null}<b>{j.nouvelle ?? '—'}</b></td>
                      <td className="muted">{j.prenom ? `${j.prenom} ${j.nom}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function fr(d) { return d ? d.slice(0, 10).split('-').reverse().join('/') : '—' }

/** Les horodatages SQLite sont en UTC : on les affiche à l'heure locale. */
function quand(h) {
  const d = new Date(`${h.replace(' ', 'T')}Z`)
  return `${d.toLocaleDateString('fr-FR')} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
}
