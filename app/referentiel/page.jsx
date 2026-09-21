import { fichesAvecVersions } from '../../lib/queries.js'
import { garde, a } from '../../lib/garde.js'

export const dynamic = 'force-dynamic'

export default async function Referentiel({ searchParams }) {
  const { u } = await garde()
  const sp = await searchParams
  const fiches = fichesAvecVersions()
  const aujourdhui = new Date()

  const etat = (f) => {
    if (!f.date_fin) return { label: 'En vigueur', couleur: 'var(--ok)' }
    const fin = new Date(f.date_fin)
    if (fin <= aujourdhui) return { label: f.motif_fin === 'suppression' ? 'Supprimée' : 'Échue', couleur: 'var(--danger)' }
    return { label: 'Fin programmée', couleur: 'var(--warn)' }
  }

  const supprimees = fiches.filter((f) => etat(f).label === 'Supprimée')

  return (
    <>
      <h1>Référentiel des fiches</h1>
      <p className="lede">
        Chaque fiche est versionnée et datée. Un dossier est rattaché à la version en vigueur à sa date
        d'engagement : une suppression par arrêté ne réécrit jamais l'historique déjà calculé.
      </p>

      <p style={{ marginTop: -12, marginBottom: 16 }}>
        {a(u, 'referentiel.gerer') && <a href="/referentiel/import" className="btn primary">Importer des fiches (CSV)</a>}
      </p>

      {sp?.import && (
        <div className="alert ok">
          <b>Import terminé</b>
          {(() => {
            const [c, v, i] = String(sp.import).split('-')
            return `${c} fiche(s) créée(s), ${v} version(s) ajoutée(s), ${i} ligne(s) ignorée(s).`
          })()}
        </div>
      )}

      {supprimees.length > 0 && (
        <div className="alert warn">
          <b>{supprimees.length} fiche{supprimees.length > 1 ? 's' : ''} supprimée{supprimees.length > 1 ? 's' : ''} au référentiel</b>
          {supprimees.map((f) => f.code).join(', ')} — aucun nouvel engagement n'est valorisable sur ces fiches.
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Code</th><th>Secteur</th><th>Libellé</th><th>Version</th>
              <th>Validité</th><th>État</th><th className="num">Dossiers</th><th>Arrêté</th>
            </tr>
          </thead>
          <tbody>
            {fiches.map((f) => {
              const e = etat(f)
              return (
                <tr key={f.version_id}>
                  <td className="mono" style={{ fontWeight: 600 }}>{f.code}</td>
                  <td><span className="tag">{f.secteur}</span></td>
                  <td style={{ maxWidth: 320 }}>{f.libelle}</td>
                  <td className="mono muted">{f.version}</td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {fr(f.date_effet)} → {f.date_fin ? fr(f.date_fin) : '…'}
                  </td>
                  <td><span className="pill" style={{ background: e.couleur }}>{e.label}</span></td>
                  <td className="num mono">{f.nb_dossiers}</td>
                  <td className="muted" style={{ fontSize: 11.5, maxWidth: 260 }}>{f.arrete_reference || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Comment la formule est décrite</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Les coefficients ne sont pas codés en dur : ils sont stockés en données sur la version de fiche.
          Appliquer un nouvel arrêté revient à créer une version, pas à livrer du code.
        </p>
        {fiches.filter((f) => JSON.parse(f.coefficients || '[]').length > 1).slice(0, 2).map((f) => (
          <div key={f.version_id} style={{ marginTop: 12 }}>
            <b className="mono">{f.code}</b> — {f.formule_type}, en kWh cumac par {f.unite_variable}
            <table style={{ marginTop: 6 }}>
              <thead><tr><th>Critères</th><th className="num">Coefficient</th></tr></thead>
              <tbody>
                {JSON.parse(f.coefficients).map((c, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {Object.keys(c.criteres || {}).length
                        ? Object.entries(c.criteres).map(([k, v]) => `${k} = ${v}`).join(', ')
                        : 'défaut'}
                    </td>
                    <td className="num mono">{c.valeur}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  )
}

function fr(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR')
}
