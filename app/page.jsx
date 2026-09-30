import { pipeline, radarConformite, radarPar, alertesReglementaires, dossiersVivants, calculDossier } from '../lib/queries.js'
import { euros, nombre } from '../lib/marge.js'
import { garde, a } from '../lib/garde.js'

export const dynamic = 'force-dynamic'

export default async function Dashboard() {
  const { u, portee } = await garde()
  const voitMarge = a(u, 'marge.voir')
  const lignes = pipeline(portee)
  const radar = radarConformite(portee)
  const radarFiche = radarPar('fiche', portee)
  const alertes = alertesReglementaires(portee)
  const dossiers = dossiersVivants(portee)

  const total = lignes.reduce((s, l) => s + l.n, 0)
  const perdus = lignes.filter((l) => l.perdu).reduce((s, l) => s + l.n, 0)
  const valorisation = lignes.filter((l) => l.etape === 'Valorisation').reduce((s, l) => s + l.n, 0)

  // Valorisation prévisionnelle sur la totalité du portefeuille vivant, sans échantillonnage.
  let cumacTotal = 0
  let margeTotale = 0
  let nonEligibles = 0
  for (const d of dossiers) {
    const c = calculDossier(d, { coutPose: 0, tauxApporteur: 8 })
    if (!c.eligibilite.applicable) { nonEligibles++; continue }
    cumacTotal += c.cumac.cumac
    margeTotale += c.valorisation?.margeNette || 0
  }

  const parEtape = {}
  for (const l of lignes) {
    if (!l.etape) continue
    parEtape[l.etape] = parEtape[l.etape] || { couleur: l.couleur, n: 0, statuts: [] }
    parEtape[l.etape].n += l.n
    parEtape[l.etape].statuts.push(l)
  }

  const koGlobal = radar.reduce((s, r) => s + r.ko, 0)
  const ctrlGlobal = radar.reduce((s, r) => s + r.controles, 0)
  const tauxGlobal = ctrlGlobal ? Math.round((koGlobal / ctrlGlobal) * 1000) / 10 : 0

  return (
    <>
      <h1>Tableau de bord</h1>
      <p className="lede">
        Vue consolidée du portefeuille : avancement, risque réglementaire et marge prévisionnelle.
      </p>

      {alertes.length > 0 && (
        <div className="alert danger">
          <b>{alertes.length} dossier{alertes.length > 1 ? 's' : ''} engagé{alertes.length > 1 ? 's' : ''} sur une fiche qui n'était plus applicable</b>
          Ces dossiers ont une date d'engagement postérieure à la fin de validité de leur fiche d'opération.
          Ils seront rejetés au dépôt. <a href="/referentiel" style={{ textDecoration: 'underline' }}>Voir le référentiel</a>
        </div>
      )}

      {tauxGlobal > 14 ? (
        <div className="alert danger">
          <b>Taux de non-conformité : {tauxGlobal} % — plafond réglementaire dépassé</b>
          Le plafond est de 14 % d'opérations non satisfaisantes en 2026 (12 % en 2027, 10 % en 2028),
          arrêté du 27 juillet 2026. Au-delà : annulation de volumes, suspension des demandes, interdiction de déposer.
        </div>
      ) : (
        <div className="alert ok">
          <b>Taux de non-conformité : {tauxGlobal} % — sous le plafond de 14 %</b>
          Marge de sécurité de {Math.round((14 - tauxGlobal) * 10) / 10} points avant le seuil 2026.
        </div>
      )}

      <div className="grid k4" style={{ marginBottom: 18 }}>
        <div className="card kpi">
          <div className="v">{nombre(total)}</div>
          <div className="l">dossier{total > 1 ? 's' : ''} au portefeuille</div>
        </div>
        <div className="card kpi">
          <div className="v">{total ? Math.round((perdus / total) * 100) : 0} %</div>
          <div className="l">déperdition ({nombre(perdus)} dossiers perdus)</div>
        </div>
        <div className="card kpi">
          <div className="v">{nombre(cumacTotal / 1000)}</div>
          <div className="l">
            MWh cumac éligibles
            {nonEligibles > 0 && <> · {nombre(nonEligibles)} dossier{nonEligibles > 1 ? 's' : ''} hors validité exclu{nonEligibles > 1 ? 's' : ''}</>}
          </div>
        </div>
        {voitMarge ? (
          <div className="card kpi">
            <div className="v">{euros(margeTotale)}</div>
            <div className="l">marge nette prévisionnelle sur {nombre(dossiers.length)} dossier{dossiers.length > 1 ? 's' : ''} vivant{dossiers.length > 1 ? 's' : ''}</div>
          </div>
        ) : (
          <div className="card kpi">
            <div className="v">{nombre(valorisation)}</div>
            <div className="l">dossiers en phase de valorisation</div>
          </div>
        )}
      </div>

      <div className="grid k2">
        <div className="card">
          <h2>Pipeline</h2>
          {Object.entries(parEtape).map(([etape, d]) => (
            <div key={etape} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <b style={{ fontSize: 13 }}>{etape}</b>
                <span className="mono muted">{nombre(d.n)}</span>
              </div>
              <div className="bar">
                <span style={{ width: `${total ? (d.n / total) * 100 : 0}%`, background: d.couleur }} />
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {d.statuts.filter((s) => s.n > 0).map((s) => s.orphelin ? (
                  <span key={s.statut} className="tag">à classer · {s.n}</span>
                ) : (
                  <a key={s.statut} href={`/dossiers?statut=${encodeURIComponent(s.statut)}`} className="tag">
                    {s.statut} · {s.n}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>Radar de conformité</h2>
          <TableRadar titre="Par unité d'affaire" lignes={radar} />
          <div style={{ height: 14 }} />
          <TableRadar titre="Par fiche d'opération" lignes={radarFiche} />
          <p className="muted" style={{ marginTop: 10, fontSize: 12 }}>
            Plafond réglementaire d'opérations non satisfaisantes : 14 % en 2026, 12 % en 2027, 10 % en 2028
            (arrêté du 27 juillet 2026).
          </p>
        </div>
      </div>

      {alertes.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Dossiers engagés hors validité de fiche</h2>
          <table>
            <thead>
              <tr><th>Dossier</th><th>Bénéficiaire</th><th>Fiche</th><th>Engagement</th><th>Fin de validité</th><th>Arrêté</th></tr>
            </thead>
            <tbody>
              {alertes.slice(0, 15).map((a) => (
                <tr key={a.id}>
                  <td><a href={`/dossiers/${a.id}`} className="mono" style={{ color: 'var(--accent)' }}>{a.numero}</a></td>
                  <td>{a.raison_sociale}</td>
                  <td className="mono">{a.fiche_code}</td>
                  <td className="mono">{fr(a.date_engagement)}</td>
                  <td className="mono">{fr(a.date_fin)}</td>
                  <td className="muted" style={{ fontSize: 12 }}>{a.arrete_reference}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function TableRadar({ titre, lignes }) {
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
        {titre}
      </div>
      <table>
        <thead>
          <tr><th>{titre.includes('unité') ? 'Unité' : 'Fiche'}</th><th className="num">Contrôles</th><th className="num">KO</th><th className="num">Taux</th></tr>
        </thead>
        <tbody>
          {lignes.map((r) => (
            <tr key={r.cle}>
              <td className={titre.includes('unité') ? '' : 'mono'}>{r.cle}</td>
              <td className="num mono">{r.controles}</td>
              <td className="num mono">{r.ko}</td>
              <td className="num">
                <span className="pill" style={{ background: r.depasse ? 'var(--danger)' : r.taux > 10 ? 'var(--warn)' : 'var(--ok)' }}>
                  {r.taux} %
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function fr(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('fr-FR')
}
