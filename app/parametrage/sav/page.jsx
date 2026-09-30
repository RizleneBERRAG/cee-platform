import { all } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import { enregistrerReferentielSav } from '../../../lib/actions-parametrage.js'
import { CATEGORIES_SAV } from '../../../lib/referentiels-sav.js'

export const dynamic = 'force-dynamic'

export default async function ParametrageSav({ searchParams }) {
  await garde('referentiel.gerer')
  const sp = await searchParams
  const lignes = all(`
    SELECT r.*, (SELECT COUNT(*) FROM sav v WHERE v.type_id = r.id OR v.motif_id = r.id OR v.statut_id = r.id) AS nb
      FROM sav_referentiel r ORDER BY r.categorie, r.actif DESC, r.ordre, r.libelle`)

  const ligne = (categorie, r = {}) => (
    <form action={enregistrerReferentielSav} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
      <input type="hidden" name="categorie" value={categorie} />
      {r.id && <input type="hidden" name="id" value={r.id} />}
      <input name="ordre" type="number" defaultValue={r.ordre ?? 0} style={{ width: 64 }} aria-label="Ordre" />
      <input name="libelle" defaultValue={r.libelle || ''} placeholder="Libellé" required style={{ minWidth: 210 }} />
      {categorie === 'MOTIF' && <input name="description" defaultValue={r.description || ''} placeholder="Description" style={{ minWidth: 200, flex: 1 }} />}
      {categorie === 'STATUT' && (
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400 }} title="Choisir ce statut clôt le S.A.V">
          <input type="checkbox" name="cloture" defaultChecked={!!r.cloture} style={{ width: 'auto' }} /> clôt le S.A.V
        </label>
      )}
      {r.id && (
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" name="actif" defaultChecked={!!r.actif} style={{ width: 'auto' }} /> actif
        </label>
      )}
      <button className="btn s">{r.id ? 'Enregistrer' : 'Ajouter'}</button>
    </form>
  )

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}
      <div className="grid k2" style={{ alignItems: 'start' }}>
        {Object.entries(CATEGORIES_SAV).map(([cat, titre]) => (
          <div key={cat} className="card plat" style={cat === 'MOTIF' ? { gridColumn: '1 / -1' } : undefined}>
            <div className="entete"><h2>{titre} de S.A.V</h2></div>
            <table style={{ marginTop: 8 }}>
              <tbody>
                {lignes.filter((r) => r.categorie === cat).map((r) => (
                  <tr key={r.id} style={r.actif ? undefined : { opacity: 0.6 }}>
                    <td style={{ padding: 0 }}>{ligne(cat, r)}</td>
                    <td className="num mono muted" title="S.A.V qui le portent">{r.nb}</td>
                  </tr>
                ))}
                <tr><td colSpan={2} style={{ padding: 0 }}>{ligne(cat)}</td></tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  )
}
