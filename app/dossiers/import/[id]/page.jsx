import { get } from '../../../../lib/db.js'
import { garde } from '../../../../lib/garde.js'

export const dynamic = 'force-dynamic'

export default async function RapportImport({ params }) {
  await garde('dossier.importer')
  const { id } = await params
  const lot = get('SELECT * FROM import_lot WHERE id = ?', [id])
  if (!lot) return <p>Rapport introuvable.</p>

  let r
  try { r = JSON.parse(lot.rapport || '{}') } catch { r = {} }
  const rejets = r.rejets || []
  const av = r.avertissements || {}
  const simulation = !!lot.simulation

  // Les rejets se répètent : 400 lignes peuvent tenir en 3 causes. On regroupe pour rendre la liste actionnable.
  const familles = new Map()
  for (const rj of rejets) {
    const cle = rj.motif.replace(/«[^»]*»/g, '« … »')
    if (!familles.has(cle)) familles.set(cle, [])
    familles.get(cle).push(rj)
  }
  const groupes = [...familles.entries()].sort((a, b) => b[1].length - a[1].length)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            Rapport d'import{' '}
            <span className="pill" style={{ background: simulation ? 'var(--warn)' : 'var(--ok)', verticalAlign: 'middle' }}>
              {simulation ? 'Simulation' : 'Importé'}
            </span>
          </h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            <span className="mono">{lot.nom_fichier}</span> · {new Date(lot.created_at + 'Z').toLocaleString('fr-FR')}
          </p>
        </div>
        <a className="btn" href="/dossiers/import">Nouvel import</a>
      </div>

      {r.erreur && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <b>Fichier non exploitable</b>
          {r.erreur}
        </div>
      )}

      {simulation && !r.erreur && (
        <div className="alert warn" style={{ marginTop: 14 }}>
          <b>Rien n'a été écrit</b>
          C'est une simulation. Si ces chiffres vous conviennent, relancez le même fichier
          avec « Importer pour de bon ».
        </div>
      )}

      <div className="grid k4" style={{ marginTop: 14, marginBottom: 14 }}>
        <div className="card kpi"><div className="v">{r.lignes ?? 0}</div><div className="l">lignes lues</div></div>
        <div className="card kpi">
          <div className="v" style={{ color: 'var(--ok)' }}>{lot.crees}</div>
          <div className="l">{simulation ? 'seraient créés' : 'dossiers créés'}</div>
        </div>
        <div className="card kpi"><div className="v">{lot.ignores}</div><div className="l">déjà présents, ignorés</div></div>
        <div className="card kpi">
          <div className="v" style={{ color: lot.rejetes ? 'var(--danger)' : 'var(--ok)' }}>{lot.rejetes}</div>
          <div className="l">lignes rejetées</div>
        </div>
      </div>

      {(av.zoneDeduite > 0 || av.dealParDefaut > 0 || av.ficheHorsValidite > 0 || av.sansDeal > 0 || av.statutParDefaut > 0) && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Ce que l'import a dû supposer</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Rien de bloquant, mais ces valeurs ne viennent pas de votre fichier : elles ont été
            déduites. Si un montant vous surprend plus tard, regardez d'abord ici.
          </p>
          <table>
            <tbody>
              {av.zoneDeduite > 0 && (
                <tr>
                  <td className="num mono" style={{ width: 70, fontWeight: 600 }}>{av.zoneDeduite}</td>
                  <td>
                    zone climatique déduite du département.
                    {av.zoneIncertaine?.length > 0 && (
                      <>
                        {' '}<b style={{ color: 'var(--warn)' }}>
                          Dont les départements {av.zoneIncertaine.join(', ')}, où le zonage varie fortement à l'intérieur
                          du département — vérifiez ces dossiers à la main.
                        </b>
                      </>
                    )}
                  </td>
                </tr>
              )}
              {av.dealParDefaut > 0 && (
                <tr>
                  <td className="num mono" style={{ fontWeight: 600 }}>{av.dealParDefaut}</td>
                  <td>dossiers valorisés avec le deal par défaut, faute de deal nommé dans le fichier.</td>
                </tr>
              )}
              {av.ficheHorsValidite > 0 && (
                <tr>
                  <td className="num mono" style={{ fontWeight: 600, color: 'var(--danger)' }}>{av.ficheHorsValidite}</td>
                  <td>
                    dossiers dont la fiche n'était plus en vigueur à leur date d'engagement.
                    Ils sont importés avec un volume cumac à zéro — ils ne sont pas valorisables.
                  </td>
                </tr>
              )}
              {av.statutParDefaut > 0 && (
                <tr>
                  <td className="num mono" style={{ fontWeight: 600 }}>{av.statutParDefaut}</td>
                  <td>
                    dossiers placés à l'entrée du pipeline, faute de statut reconnu dans le fichier.
                    Sans statut ils seraient invisibles au tableau de bord et dans le radar.
                  </td>
                </tr>
              )}
              {av.sansDeal > 0 && (
                <tr>
                  <td className="num mono" style={{ fontWeight: 600, color: 'var(--warn)' }}>{av.sansDeal}</td>
                  <td>dossiers sans aucun deal applicable : créés, mais sans montants calculés.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {groupes.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '14px 18px 0' }}>
            <h2 style={{ margin: 0 }}>Lignes rejetées, par cause</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Corrigez dans votre fichier source puis réimportez-le entier : les dossiers déjà
              créés seront reconnus à leur référence externe et ne seront pas dupliqués.
            </p>
          </div>
          {groupes.map(([cause, lignes]) => (
            <div key={cause} style={{ borderTop: '1px solid var(--border)', padding: '12px 18px' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                <span className="pill" style={{ background: 'var(--danger)' }}>{lignes.length}</span>
                <b style={{ fontSize: 13.5 }}>{cause}</b>
              </div>
              <p className="muted mono" style={{ fontSize: 11.5, margin: '8px 0 0' }}>
                Lignes {lignes.slice(0, 25).map((l) => l.ligne).join(', ')}
                {lignes.length > 25 ? ` … et ${lignes.length - 25} autres` : ''}
              </p>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--accent)' }}>
                  Voir trois exemples
                </summary>
                <pre style={{
                  background: '#f6f7f9', border: '1px solid var(--border)', borderRadius: 7,
                  padding: 10, fontSize: 11, overflowX: 'auto', margin: '8px 0 0',
                }}>{lignes.slice(0, 3).map((l) => `ligne ${l.ligne} : ${l.extrait}`).join('\n')}</pre>
              </details>
            </div>
          ))}
        </div>
      )}

      {r.apercu?.length > 0 && (
        <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 18px 0' }}><h2 style={{ margin: 0 }}>Aperçu des premières lignes retenues</h2></div>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr><th>Ligne</th><th>Référence</th><th>Fiche</th><th>Version</th><th className="num">Quantité</th><th>Engagement</th><th>Zone</th></tr>
            </thead>
            <tbody>
              {r.apercu.map((a) => (
                <tr key={a.ligne}>
                  <td className="mono muted">{a.ligne}</td>
                  <td className="mono">{a.ref || '—'}</td>
                  <td className="mono">{a.fiche}</td>
                  <td className="mono muted">{a.version}</td>
                  <td className="num mono">{a.quantite}</td>
                  <td className="mono" style={{ fontSize: 12 }}>{a.dateEngagement}</td>
                  <td className="mono">{a.zone || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!simulation && lot.crees > 0 && (
        <p style={{ marginTop: 18 }}>
          <a className="btn primary" href="/dossiers">Voir les dossiers importés</a>
        </p>
      )}
      <p style={{ marginTop: 14 }}>
        <a href="/dossiers/import" style={{ color: 'var(--accent)' }}>← Retour à l'import</a>
      </p>
    </>
  )
}
