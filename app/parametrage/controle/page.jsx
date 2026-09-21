import { all } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import { enregistrerBureau, supprimerBureau } from '../../../lib/actions-technique.js'

export const dynamic = 'force-dynamic'

const fr = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—')
const aujourdhui = () => new Date().toISOString().slice(0, 10)

/**
 * Référentiel des bureaux de contrôle.
 *
 * La seule raison d'être de cet écran est la **date de fin d'accréditation**. Un contrôle
 * réalisé après l'échéance d'un bureau ne vaut rien : le dossier est rejeté au dépôt, des
 * mois plus tard, quand plus personne ne fait le lien avec une accréditation périmée.
 * Porter la date ici permet de le voir à la saisie du contrôle, pas au rejet.
 */
export default async function PageControle() {
  await garde('referentiel.gerer')

  const bureaux = all(`
    SELECT b.*, (SELECT COUNT(*) FROM controle c WHERE c.bureau_controle_id = b.id) AS nb_controles
    FROM bureau_controle b ORDER BY b.actif DESC, b.nom`)

  const jour = aujourdhui()
  const dans90 = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)
  const perimes = bureaux.filter((b) => b.actif && b.date_fin_accreditation && b.date_fin_accreditation < jour)
  const bientot = bureaux.filter((b) => b.actif && b.date_fin_accreditation && b.date_fin_accreditation >= jour && b.date_fin_accreditation <= dans90)
  const sansDate = bureaux.filter((b) => b.actif && !b.date_fin_accreditation)

  return (
    <>
      <div className="alert warn">
        <b>Pourquoi la date d'accréditation compte</b>
        Un contrôle réalisé après l'échéance d'accréditation du bureau n'est pas opposable :
        le dossier est rejeté au dépôt, longtemps après, quand le lien avec la date n'est plus
        évident. Renseignez-la ici, et l'alerte apparaîtra sur le dossier au moment de la saisie.
      </div>

      {perimes.length > 0 && (
        <div className="alert danger">
          <b>{perimes.length} bureau{perimes.length > 1 ? 'x' : ''} à l'accréditation périmée</b>
          {perimes.map((b) => `${b.nom} (fin le ${fr(b.date_fin_accreditation)})`).join(' · ')}
        </div>
      )}
      {bientot.length > 0 && (
        <div className="alert warn">
          <b>Accréditation à échéance sous 90 jours</b>
          {bientot.map((b) => `${b.nom} (fin le ${fr(b.date_fin_accreditation)})`).join(' · ')}
        </div>
      )}
      {sansDate.length > 0 && (
        <div className="alert warn">
          <b>{sansDate.length} bureau{sansDate.length > 1 ? 'x' : ''} sans date d'accréditation</b>
          Tant que la date manque, aucune vérification n'est possible pour ces bureaux :
          {' '}{sansDate.map((b) => b.nom).join(' · ')}
        </div>
      )}

      <div className="card">
        <h2>Bureaux de contrôle ({bureaux.length})</h2>
        {bureaux.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>Aucun bureau enregistré.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Fin d'accréditation</th>
                  <th className="num">Contrôles</th>
                  <th>État</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bureaux.map((b) => {
                  const perime = b.date_fin_accreditation && b.date_fin_accreditation < jour
                  return (
                    <tr key={b.id} style={{ opacity: b.actif ? 1 : 0.6 }}>
                      <td>
                        <form action={enregistrerBureau} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input type="hidden" name="id" value={b.id} />
                          <input type="hidden" name="actif" value={b.actif ? '1' : ''} />
                          <input name="nom" defaultValue={b.nom} style={{ minWidth: 190 }} />
                          <input type="date" name="date_fin_accreditation"
                                 defaultValue={(b.date_fin_accreditation || '').slice(0, 10)} />
                          <button className="btn s">Enregistrer</button>
                        </form>
                      </td>
                      <td className={perime ? 'mono' : 'mono muted'}
                          style={perime ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                        {fr(b.date_fin_accreditation)}
                      </td>
                      <td className="num">{b.nb_controles}</td>
                      <td>
                        {!b.actif ? <span className="tag">inactif</span>
                          : perime ? <span className="tag" style={{ color: 'var(--danger)' }}>périmé</span>
                          : <span className="tag ok">valide</span>}
                      </td>
                      <td>
                        <form action={supprimerBureau}>
                          <input type="hidden" name="id" value={b.id} />
                          <button className="btn s">
                            {b.nb_controles > 0 ? 'Désactiver' : 'Supprimer'}
                          </button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Un bureau déjà rattaché à un contrôle n'est jamais supprimé : il est désactivé.
          Le supprimer effacerait la preuve que le contrôle a eu lieu, et par qui.
        </p>
      </div>

      <form action={enregistrerBureau} className="card" style={{ marginTop: 14 }}>
        <h2>Ajouter un bureau de contrôle</h2>
        <div className="grid k3">
          <div className="field">
            <label>Nom</label>
            <input name="nom" required />
          </div>
          <div className="field">
            <label>Fin d'accréditation</label>
            <input type="date" name="date_fin_accreditation" />
          </div>
          <div className="field">
            <label style={{ marginTop: 22 }}>
              <input type="checkbox" name="actif" defaultChecked style={{ width: 'auto', marginRight: 7 }} />
              Actif
            </label>
          </div>
        </div>
        <button className="btn primary">Ajouter</button>
      </form>
    </>
  )
}
