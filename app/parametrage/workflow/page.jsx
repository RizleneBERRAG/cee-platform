import { all } from '../../../lib/db.js'
import { garde, a } from '../../../lib/garde.js'
import {
  enregistrerEtape, enregistrerStatut, supprimerStatut, enregistrerUnite,
} from '../../../lib/actions-parametrage.js'

export const dynamic = 'force-dynamic'

const AXES = [
  ['DOSSIER', 'Dossier'], ['ADMIN', 'Administratif'], ['FACTURATION', 'Facturation'],
  ['INSTALLATION', 'Installation'], ['COFRAC', 'Contrôle COFRAC'],
]

export default async function Workflow({ searchParams }) {
  const { u } = await garde('referentiel.gerer')
  const sp = await searchParams

  const etapes = all(`
    SELECT e.*, (SELECT COUNT(*) FROM statut s WHERE s.etape_id = e.id) AS nb_statuts
      FROM etape e ORDER BY e.ordre`)

  const statuts = all(`
    SELECT s.*, e.libelle AS etape_libelle,
           (SELECT COUNT(*) FROM dossier d WHERE d.statut_dossier_id = s.id
              OR d.statut_admin_id = s.id OR d.statut_facturation_id = s.id
              OR d.statut_installation_id = s.id OR d.statut_cofrac_id = s.id) AS nb_dossiers
      FROM statut s LEFT JOIN etape e ON e.id = s.etape_id
     ORDER BY s.axe, e.ordre, s.ordre`)

  const unites = all(`
    SELECT ua.*,
           (SELECT COUNT(*) FROM dossier d WHERE d.unite_affaire_id = ua.id) AS nb_dossiers,
           (SELECT COUNT(*) FROM utilisateur x WHERE x.unite_affaire_id = ua.id) AS nb_comptes
      FROM unite_affaire ua ORDER BY ua.actif DESC, ua.nom`)

  const parAxe = {}
  for (const s of statuts) (parAxe[s.axe] ||= []).push(s)

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}

      <div className="card plat" style={{ marginBottom: 14 }}>
        <div className="entete">
          <h2>Étapes du pipeline</h2>
          <p className="muted" style={{ fontSize: 12.5 }}>
            L'ordre commande l'affichage du tableau de bord et le choix du statut d'entrée
            attribué aux dossiers importés sans statut.
          </p>
        </div>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th style={{ width: 70 }}>Ordre</th><th>Libellé</th><th style={{ width: 90 }}>Couleur</th><th className="num">Statuts</th><th></th></tr></thead>
          <tbody>
            {etapes.map((e) => (
              <tr key={e.id}>
                <td colSpan={3} style={{ padding: 0 }}>
                  <form action={enregistrerEtape} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
                    <input type="hidden" name="id" value={e.id} />
                    <input name="ordre" type="number" defaultValue={e.ordre} style={{ width: 70 }} />
                    <input name="libelle" defaultValue={e.libelle} style={{ minWidth: 200 }} />
                    <input name="couleur" type="color" defaultValue={e.couleur || '#64748b'} style={{ width: 46, padding: 2, height: 30 }} />
                    <button className="btn s">Enregistrer</button>
                  </form>
                </td>
                <td className="num mono">{e.nb_statuts}</td>
                <td></td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={enregistrerEtape} style={{ display: 'flex', gap: 6, padding: '10px 17px 15px', flexWrap: 'wrap' }}>
          <input name="ordre" type="number" placeholder="ordre" defaultValue={etapes.length + 1} style={{ width: 80 }} />
          <input name="libelle" placeholder="Nouvelle étape" style={{ minWidth: 200 }} required />
          <input name="couleur" type="color" defaultValue="#64748b" style={{ width: 46, padding: 2, height: 30 }} />
          <button className="btn primary">Ajouter une étape</button>
        </form>
      </div>

      {AXES.map(([axe, libelleAxe]) => (
        <div className="card plat" key={axe} style={{ marginBottom: 14 }}>
          <div className="entete">
            <h2>Statuts — axe {libelleAxe}</h2>
            {axe === 'DOSSIER' && (
              <p className="muted" style={{ fontSize: 12.5 }}>
                La case <b>perdu</b> retire le dossier du portefeuille vivant : elle commande
                le taux de déperdition du tableau de bord et exclut le dossier de la marge
                prévisionnelle. Ce n'est pas qu'une couleur.
              </p>
            )}
          </div>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ width: 60 }}>Ordre</th><th>Libellé</th><th style={{ width: 150 }}>Étape</th>
                <th style={{ width: 70 }}>Couleur</th><th style={{ width: 70 }}>Perdu</th>
                <th className="num">Dossiers</th><th></th>
              </tr>
            </thead>
            <tbody>
              {(parAxe[axe] || []).map((s) => (
                <tr key={s.id}>
                  <td colSpan={5} style={{ padding: 0 }}>
                    <form action={enregistrerStatut} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="axe" value={axe} />
                      <input name="ordre" type="number" defaultValue={s.ordre} style={{ width: 62 }} />
                      <input name="libelle" defaultValue={s.libelle} style={{ minWidth: 175 }} />
                      <select name="etape_id" defaultValue={s.etape_id || ''} style={{ width: 150 }}>
                        <option value="">hors étape</option>
                        {etapes.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
                      </select>
                      <input name="couleur" type="color" defaultValue={s.couleur || '#64748b'} style={{ width: 44, padding: 2, height: 30 }} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                        <input type="checkbox" name="perdu" defaultChecked={!!s.perdu} style={{ width: 'auto' }} /> perdu
                      </label>
                      <button className="btn s">Enregistrer</button>
                    </form>
                  </td>
                  <td className="num mono">{s.nb_dossiers}</td>
                  <td className="right">
                    <form action={supprimerStatut} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={s.id} />
                      <button className="btn s danger" disabled={s.nb_dossiers > 0}>Supprimer</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={enregistrerStatut} style={{ display: 'flex', gap: 6, padding: '10px 17px 15px', flexWrap: 'wrap' }}>
            <input type="hidden" name="axe" value={axe} />
            <input name="ordre" type="number" placeholder="ordre" defaultValue={(parAxe[axe] || []).length} style={{ width: 80 }} />
            <input name="libelle" placeholder="Nouveau statut" style={{ minWidth: 175 }} required />
            <select name="etape_id" defaultValue="" style={{ width: 150 }}>
              <option value="">hors étape</option>
              {etapes.map((e) => <option key={e.id} value={e.id}>{e.libelle}</option>)}
            </select>
            <input name="couleur" type="color" defaultValue="#64748b" style={{ width: 44, padding: 2, height: 30 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <input type="checkbox" name="perdu" style={{ width: 'auto' }} /> perdu
            </label>
            <button className="btn primary">Ajouter</button>
          </form>
        </div>
      ))}

      {a(u, 'utilisateur.gerer') && (
        <div className="card plat">
          <div className="entete">
            <h2>Unités d'affaire</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Elles commandent le cloisonnement : un compte sans le droit « voir les dossiers de
              toutes les unités » ne voit que la sienne.
            </p>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Nom</th><th style={{ width: 150 }}>Type</th><th className="num">Dossiers</th><th className="num">Comptes</th><th></th></tr></thead>
            <tbody>
              {unites.map((x) => (
                <tr key={x.id}>
                  <td colSpan={2} style={{ padding: 0 }}>
                    <form action={enregistrerUnite} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
                      <input type="hidden" name="id" value={x.id} />
                      <input name="nom" defaultValue={x.nom} style={{ minWidth: 200 }} />
                      <select name="type" defaultValue={x.type} style={{ width: 150 }}>
                        <option value="SIEGE">Siège</option>
                        <option value="REGIE">Régie</option>
                        <option value="INSTALLATEUR">Installateur</option>
                        <option value="APPORTEUR">Apporteur</option>
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                        <input type="checkbox" name="actif" defaultChecked={!!x.actif} style={{ width: 'auto' }} /> active
                      </label>
                      <button className="btn s">Enregistrer</button>
                    </form>
                  </td>
                  <td className="num mono">{x.nb_dossiers}</td>
                  <td className="num mono">{x.nb_comptes}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={enregistrerUnite} style={{ display: 'flex', gap: 6, padding: '10px 17px 15px', flexWrap: 'wrap' }}>
            <input name="nom" placeholder="Nouvelle unité" style={{ minWidth: 200 }} required />
            <select name="type" defaultValue="REGIE" style={{ width: 150 }}>
              <option value="SIEGE">Siège</option>
              <option value="REGIE">Régie</option>
              <option value="INSTALLATEUR">Installateur</option>
              <option value="APPORTEUR">Apporteur</option>
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <input type="checkbox" name="actif" defaultChecked style={{ width: 'auto' }} /> active
            </label>
            <button className="btn primary">Ajouter</button>
          </form>
        </div>
      )}
    </>
  )
}
