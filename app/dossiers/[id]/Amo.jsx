import { db } from '../../../lib/db.js'
import { valeursListe } from '../../../lib/listes.js'
import { majAmo } from '../../../lib/actions-technique.js'

/**
 * MaPrimeRénov' parcours accompagné : l'AMO / MAR, sa prestation, le mandataire Anah.
 * Les intervenants se choisissent dans les listes du paramétrage ; la valeur marquée « par
 * défaut » est proposée sur un dossier qui n'en a pas encore.
 */
export default function Amo({ d, modifiable }) {
  const amo = valeursListe(db(), 'amo')
  const mandataires = valeursListe(db(), 'mandataire_anah')
  const defaut = (liste) => liste.find((x) => x.par_defaut)?.id || ''
  const options = (liste) => liste.map((x) => <option key={x.id} value={x.id}>{x.libelle}{x.donnees.siret ? ` — ${x.donnees.siret}` : ''}</option>)

  return (
    <form action={majAmo} className="card" style={{ marginTop: 14 }}>
      <input type="hidden" name="dossier_id" value={d.id} />
      <h2>AMO / MAR — MaPrimeRénov' accompagné</h2>
      {amo.length + mandataires.length === 0 && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
          Aucun AMO ni mandataire au paramétrage : ajoutez-les dans{' '}
          <a href="/parametrage/listes?liste=amo" style={{ color: 'var(--accent)' }}>Paramétrage › Autres listes</a>.
        </p>
      )}
      <div className="grid k4">
        <div className="field"><label>AMO / MAR</label>
          <select key={`amo-${d.amo_id}`} name="amo_id" defaultValue={d.amo_id || defaut(amo)} disabled={!modifiable}>
            <option value="">—</option>{options(amo)}
          </select></div>
        <div className="field"><label>Montant de la prestation (€)</label>
          <input key={`am-${d.amo_montant}`} name="amo_montant" type="number" step="0.01" defaultValue={d.amo_montant ?? ''} disabled={!modifiable} /></div>
        <div className="field"><label>Nature de la prestation</label>
          <input key={`an-${d.amo_nature}`} name="amo_nature" defaultValue={d.amo_nature || ''} disabled={!modifiable} placeholder="Accompagnement complet, audit…" /></div>
        <div className="field"><label>Mandataire Anah</label>
          <select key={`ma-${d.mandataire_anah_id}`} name="mandataire_anah_id" defaultValue={d.mandataire_anah_id || defaut(mandataires)} disabled={!modifiable}>
            <option value="">—</option>{options(mandataires)}
          </select></div>
      </div>
      <button className="btn primary" disabled={!modifiable}>Enregistrer</button>
    </form>
  )
}
