import { all } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import { enregistrerTypeIntervention } from '../../../lib/actions-parametrage.js'

export const dynamic = 'force-dynamic'

export default async function TypesIntervention({ searchParams }) {
  await garde('referentiel.gerer')
  const sp = await searchParams
  const types = all(`
    SELECT t.*, (SELECT COUNT(*) FROM intervention i WHERE i.type_id = t.id) AS nb
      FROM type_intervention t ORDER BY t.actif DESC, t.ordre, t.libelle`)

  const ligne = (t = {}) => (
    <form action={enregistrerTypeIntervention} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
      {t.id && <input type="hidden" name="id" value={t.id} />}
      <input type="color" name="couleur" defaultValue={t.couleur || '#64748b'} style={{ width: 42, padding: 2, height: 32 }} aria-label="Couleur" />
      <input name="libelle" defaultValue={t.libelle || ''} placeholder="Libellé" required style={{ minWidth: 220 }} />
      <input name="description" defaultValue={t.description || ''} placeholder="Description" style={{ minWidth: 240, flex: 1 }} />
      <input name="ordre" type="number" defaultValue={t.ordre ?? 0} style={{ width: 70 }} aria-label="Ordre" />
      {t.id && (
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" name="actif" defaultChecked={!!t.actif} style={{ width: 'auto' }} /> actif
        </label>
      )}
      <button className="btn s">{t.id ? 'Enregistrer' : 'Ajouter'}</button>
    </form>
  )

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}
      <div className="card plat">
        <div className="entete"><h2>Types d'intervention</h2></div>
        <p className="muted" style={{ fontSize: 12.5 }}>
          Chaque type est un calendrier du planning. Un type ne se supprime pas : désactivé, il
          disparaît des listes, et les interventions passées gardent leur libellé.
          La <b>pose</b> réalisée renseigne la date de pose du dossier, la <b>fin de pose</b> sa date
          d'achèvement, le <b>rendez-vous commercial</b> la date de visite — si elles sont vides.
        </p>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Type</th><th className="num">Interventions</th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} style={t.actif ? undefined : { opacity: 0.6 }}>
                <td style={{ padding: 0 }}>{ligne(t)}</td>
                <td className="num mono">{t.nb}</td>
              </tr>
            ))}
            <tr><td colSpan={2} style={{ padding: 0 }}>{ligne()}</td></tr>
          </tbody>
        </table>
      </div>
    </>
  )
}
