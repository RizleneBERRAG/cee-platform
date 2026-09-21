import { all, get } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import { enregistrerDelegataire, supprimerDelegataire } from '../../../lib/actions-parametrage.js'

export const dynamic = 'force-dynamic'

export default async function Delegataires({ searchParams }) {
  await garde('deal.gerer')
  const sp = await searchParams

  const lignes = all(`
    SELECT d.*,
           (SELECT COUNT(*) FROM dossier x WHERE x.delegataire_id = d.id) AS nb_dossiers,
           (SELECT COUNT(*) FROM deal dl WHERE dl.delegataire_id = d.id AND dl.actif = 1) AS nb_deals,
           (SELECT COUNT(*) FROM liasse l WHERE l.delegataire_id = d.id) AS nb_liasses
      FROM delegataire d ORDER BY d.actif DESC, d.nom`)

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}

      <div className="card plat">
        <div className="entete"><h2>Les délégataires</h2></div>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Nom</th><th>Obligé</th><th className="num">Dossiers</th>
              <th className="num">Deals</th><th className="num">Liasses</th><th>État</th><th></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((d) => (
              <tr key={d.id}>
                <td colSpan={2} style={{ padding: 0 }}>
                  <form action={enregistrerDelegataire} style={ligneForm}>
                    <input type="hidden" name="id" value={d.id} />
                    <input name="nom" defaultValue={d.nom} style={{ minWidth: 190 }} />
                    <input name="oblige" defaultValue={d.oblige || ''} placeholder="obligé" style={{ minWidth: 150 }} />
                    <label style={caseACocher}>
                      <input type="checkbox" name="actif" defaultChecked={!!d.actif} style={{ width: 'auto' }} /> actif
                    </label>
                    <button className="btn s">Enregistrer</button>
                  </form>
                </td>
                <td className="num mono">{d.nb_dossiers}</td>
                <td className="num mono">{d.nb_deals}</td>
                <td className="num mono">{d.nb_liasses}</td>
                <td>
                  {d.actif
                    ? <span className="tag ok">actif</span>
                    : <span className="tag">inactif</span>}
                </td>
                <td className="right">
                  <form action={supprimerDelegataire} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={d.id} />
                    <button className="btn s danger">
                      {d.nb_dossiers || d.nb_deals ? 'Désactiver' : 'Supprimer'}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 11.5, padding: '10px 17px 15px', margin: 0 }}>
          Un délégataire rattaché à des dossiers ou à des deals ne peut pas être supprimé :
          le bouton le désactive. Il disparaît des listes de choix, et les dossiers passés
          restent lisibles.
        </p>
      </div>

      <form action={enregistrerDelegataire} className="card" style={{ marginTop: 14 }}>
        <h2>Ajouter un délégataire</h2>
        <div className="grid k3">
          <div className="field"><label>Nom</label><input name="nom" required /></div>
          <div className="field"><label>Obligé</label><input name="oblige" placeholder="TotalEnergies, Esso…" /></div>
          <div className="field">
            <label>État</label>
            <label style={{ ...caseACocher, marginTop: 6 }}>
              <input type="checkbox" name="actif" defaultChecked style={{ width: 'auto' }} /> actif
            </label>
          </div>
        </div>
        <button className="btn primary">Créer</button>
      </form>
    </>
  )
}

const ligneForm = { display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }
const caseACocher = { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap' }
