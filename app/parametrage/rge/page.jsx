import { all } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import { enregistrerInstallateur, ajouterCertification, supprimerCertification } from '../../../lib/actions-parametrage.js'

export const dynamic = 'force-dynamic'

export default async function Rge({ searchParams }) {
  await garde('referentiel.gerer')
  const sp = await searchParams
  const aujourdhui = new Date().toISOString().slice(0, 10)
  const dansTroisMois = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10)

  const installateurs = all(`
    SELECT i.*,
           (SELECT COUNT(*) FROM dossier d WHERE d.installateur_id = i.id) AS nb_dossiers
      FROM installateur_rge i ORDER BY i.actif DESC, i.raison_sociale`)
  const certifs = all('SELECT * FROM certification_rge ORDER BY date_fin DESC')
  const parInstallateur = {}
  for (const c of certifs) (parInstallateur[c.installateur_id] ||= []).push(c)

  // Une pose faite par un installateur dont la certification était échue à la date des travaux
  // fait rejeter le dossier au dépôt. C'est une alerte, pas une décoration.
  const expirees = certifs.filter((c) => c.date_fin < aujourdhui)
  const bientot = certifs.filter((c) => c.date_fin >= aujourdhui && c.date_fin <= dansTroisMois)

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}

      {bientot.length > 0 && (
        <div className="alert warn">
          <b>{bientot.length} certification{bientot.length > 1 ? 's' : ''} expire{bientot.length > 1 ? 'nt' : ''} dans les trois mois</b>
          Une pose réalisée après l'échéance par un installateur non recertifié fait rejeter
          le dossier au dépôt. Réclamez le renouvellement avant de planifier de nouveaux chantiers.
        </div>
      )}

      {installateurs.map((i) => {
        const liste = parInstallateur[i.id] || []
        const valide = liste.some((c) => c.date_debut <= aujourdhui && c.date_fin >= aujourdhui)
        return (
          <div className="card" key={i.id} style={{ marginBottom: 12, opacity: i.actif ? 1 : 0.62 }}>
            <form action={enregistrerInstallateur} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <input type="hidden" name="id" value={i.id} />
              <input name="raison_sociale" defaultValue={i.raison_sociale} style={{ minWidth: 220 }} />
              <input name="siret" defaultValue={i.siret || ''} placeholder="SIRET" style={{ minWidth: 150 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                <input type="checkbox" name="actif" defaultChecked={!!i.actif} style={{ width: 'auto' }} /> actif
              </label>
              <button className="btn s">Enregistrer</button>
              <span className="muted" style={{ fontSize: 12 }}>{i.nb_dossiers} dossier{i.nb_dossiers > 1 ? 's' : ''}</span>
              {valide
                ? <span className="tag ok">certifié aujourd'hui</span>
                : <span className="tag danger">aucune certification valide aujourd'hui</span>}
            </form>

            <table>
              <thead><tr><th>Certification</th><th>N°</th><th>Du</th><th>Au</th><th>État</th><th></th></tr></thead>
              <tbody>
                {liste.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 12 }}>Aucune certification enregistrée.</td></tr>}
                {liste.map((c) => {
                  const echue = c.date_fin < aujourdhui
                  const proche = !echue && c.date_fin <= dansTroisMois
                  return (
                    <tr key={c.id}>
                      <td>{c.libelle}</td>
                      <td className="mono muted" style={{ fontSize: 11.5 }}>{c.numero || '—'}</td>
                      <td className="mono">{fr(c.date_debut)}</td>
                      <td className="mono">{fr(c.date_fin)}</td>
                      <td>
                        {echue ? <span className="tag danger">échue</span>
                          : proche ? <span className="tag warn">expire bientôt</span>
                          : <span className="tag ok">valide</span>}
                      </td>
                      <td className="right">
                        <form action={supprimerCertification} style={{ display: 'inline' }}>
                          <input type="hidden" name="id" value={c.id} />
                          <button className="btn s">Retirer</button>
                        </form>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <form action={ajouterCertification} style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <input type="hidden" name="installateur_id" value={i.id} />
              <input name="libelle" placeholder="Qualibat 7131, RGE Éco Artisan…" style={{ minWidth: 220 }} required />
              <input name="numero" placeholder="n°" style={{ width: 120 }} />
              <input name="date_debut" type="date" required style={{ width: 150 }} />
              <input name="date_fin" type="date" required style={{ width: 150 }} />
              <button className="btn s">Ajouter</button>
            </form>
          </div>
        )
      })}

      <form action={enregistrerInstallateur} className="card">
        <h2>Ajouter un installateur</h2>
        <div className="grid k3">
          <div className="field"><label>Raison sociale</label><input name="raison_sociale" required /></div>
          <div className="field"><label>SIRET</label><input name="siret" /></div>
          <div className="field">
            <label>État</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, marginTop: 6 }}>
              <input type="checkbox" name="actif" defaultChecked style={{ width: 'auto' }} /> actif
            </label>
          </div>
        </div>
        <button className="btn primary">Créer</button>
      </form>

      {expirees.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Certifications échues</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
            Conservées volontairement : ce qui compte pour un dossier, c'est que la certification
            ait été valide <b>à la date des travaux</b>, pas aujourd'hui. Les effacer rendrait
            invérifiable la conformité des dossiers passés.
          </p>
        </div>
      )}
    </>
  )
}

function fr(d) {
  if (!d) return '—'
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('fr-FR')
}
