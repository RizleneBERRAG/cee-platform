import { all, get } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import { creerDeal, majRatios, basculerDeal } from '../../../lib/actions-parametrage.js'
import { COMBINAISONS, LIGNES, NOMS_REGIME, colonne, anomaliesRatios } from '../../../lib/ratios.js'
import { MODES_REVERSEMENT } from '../../../lib/marge.js'
import { eurosPrecis } from '../../../lib/marge.js'

export const dynamic = 'force-dynamic'

export default async function Deals({ searchParams }) {
  await garde('deal.gerer')
  const sp = await searchParams

  const deals = all(`
    SELECT dl.*, dg.nom AS delegataire_nom,
           (SELECT COUNT(*) FROM dossier d WHERE d.deal_id = dl.id) AS nb_dossiers,
           (SELECT COUNT(*) FROM dossier d WHERE d.deal_id = dl.id AND d.date_calcul IS NOT NULL) AS nb_figes
      FROM deal dl JOIN delegataire dg ON dg.id = dl.delegataire_id
     ORDER BY dl.actif DESC, dg.nom, dl.libelle, dl.version`)
  const delegataires = all('SELECT id, nom FROM delegataire WHERE actif = 1 ORDER BY nom')

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}

      <div className="alert warn">
        <b>Ce que change une modification de ratios</b>
        Si des dossiers sont déjà <b>figés</b> sur un deal, changer ses ratios ne les touche pas :
        une nouvelle version du deal est créée, l'ancienne est archivée, et les dossiers figés
        gardent les montants calculés avec la grille de l'époque. C'est ce qui empêche une
        correction de tarif de réécrire silencieusement toute votre marge historique.
      </div>

      {deals.map((d) => (
        <div className="card" key={d.id} style={{ marginBottom: 14, opacity: d.actif ? 1 : 0.62 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div>
              <b style={{ fontSize: 14.5 }}>{d.libelle}</b>{' '}
              <span className="tag mono">{d.version}</span>{' '}
              {d.par_defaut ? <span className="tag ok">par défaut</span> : null}
              {!d.actif ? <span className="tag">archivé</span> : null}
              <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
                {d.delegataire_nom} · en vigueur depuis le {fr(d.date_debut)}
                {d.date_fin ? ` jusqu'au ${fr(d.date_fin)}` : ''}
                {' · '}
                <b>{d.nb_dossiers}</b> dossier{d.nb_dossiers > 1 ? 's' : ''}
                {d.nb_figes > 0 && <>, dont <b style={{ color: 'var(--warn)' }}>{d.nb_figes} figé{d.nb_figes > 1 ? 's' : ''}</b></>}
              </div>
            </div>
            <div className="barre-actions">
              <form action={basculerDeal}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="champ" value="par_defaut" />
                <button className="btn s" disabled={!d.actif}>{d.par_defaut ? 'Retirer le défaut' : 'Mettre par défaut'}</button>
              </form>
              <form action={basculerDeal}>
                <input type="hidden" name="id" value={d.id} />
                <input type="hidden" name="champ" value="actif" />
                <button className="btn s">{d.actif ? 'Archiver' : 'Réactiver'}</button>
              </form>
            </div>
          </div>

          {/* Les anomalies sont montrées sur le deal concerné, pas seulement après un
              enregistrement : une grille déjà fausse doit se signaler d'elle-même. */}
          {(() => {
            const a = anomaliesRatios(d, d.mode_reversement)
            if (a.length === 0) return null
            const erreurs = a.filter((x) => x.gravite === 'ERREUR')
            return (
              <div className={erreurs.length ? 'alert danger' : 'alert warn'} style={{ marginBottom: 10 }}>
                <b>{erreurs.length ? 'Grille incohérente' : 'Valeur inhabituelle'}</b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {a.map((x, i) => <li key={i} style={{ marginBottom: 3 }}>{x.message}</li>)}
                </ul>
              </div>
            )
          })()}

          <form action={majRatios}>
            <input type="hidden" name="id" value={d.id} />

            {/* ── Le mode de reversement ──
                Tant qu'il n'est pas choisi, aucune marge n'est calculée sur ce contrat.
                C'est délibéré : une marge fausse sur tout un portefeuille ne se voit pas,
                une marge absente se voit tout de suite. */}
            <div className="field" style={{ maxWidth: 520, marginBottom: 12 }}>
              <label htmlFor={`mode-${d.id}`}>
                Prime cédée et commission installateur — comment se combinent-elles ?
              </label>
              <select id={`mode-${d.id}`} name="mode_reversement"
                      defaultValue={d.mode_reversement || ''} disabled={!d.actif}>
                <option value="">Pas encore tranché — aucune marge ne sera calculée</option>
                {MODES_REVERSEMENT.map((m) => (
                  <option key={m.code} value={m.code}>{m.libelle}</option>
                ))}
              </select>
              <p className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                {MODES_REVERSEMENT.find((m) => m.code === d.mode_reversement)?.aide
                  || "Choisissez-en un pour que les marges de ce contrat se calculent."}
              </p>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>En €/MWh cumac</th>
                    {COMBINAISONS.map(([r, m]) => (
                      <th key={r + m} className="num">
                        {NOMS_REGIME[r] || r}<br />
                        <span style={{ fontWeight: 400, textTransform: 'none' }}>{m}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LIGNES.map((ligne) => (
                    <tr key={ligne}>
                      <td style={{ whiteSpace: 'nowrap' }}>{ligne}</td>
                      {COMBINAISONS.map(([r, m]) => {
                        const c = colonne(ligne, r, m)
                        return (
                          <td key={c} className="num">
                            <input
                              key={`${c}-${d[c]}`} name={c} type="number" step="0.01"
                              defaultValue={d[c] ?? ''} placeholder="—" disabled={!d.actif}
                              style={{ width: 92, textAlign: 'right', padding: '4px 6px', fontSize: 12.5 }}
                            />
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ fontWeight: 700, borderTop: '2px solid var(--text)' }}>Marge brute</td>
                    {COMBINAISONS.map(([r, m]) => {
                      // ── Pas de marge sans tarif délégataire ──
                      //
                      // Si ce que verse le délégataire n'est pas renseigné, la soustraction
                      // n'a pas de sens : la faire en traitant le vide comme un zéro
                      // afficherait une marge négative bien rouge, tirée de rien. On
                      // affiche un tiret. C'est le cas sur les douze contrats repris, en
                      // précaire hors MaPrimeRénov' — l'ancien logiciel n'a pas ce champ.
                      const verse = d[colonne('Versé par le délégataire', r, m)]
                      if (verse === null || verse === undefined || verse === '') {
                        return (
                          <td key={r + m} className="num mono" title="Tarif du délégataire non renseigné"
                              style={{ fontWeight: 700, borderTop: '2px solid var(--text)', color: 'var(--muted)' }}>
                            —
                          </td>
                        )
                      }
                      const brute = Number(verse)
                        - (d[colonne('Prime cédée au bénéficiaire', r, m)] ?? 0)
                        - (d[colonne('Commission installateur', r, m)] ?? 0)
                      return (
                        <td key={r + m} className="num mono"
                            style={{ fontWeight: 700, borderTop: '2px solid var(--text)', color: brute >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                          {eurosPrecis(brute)}
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              La marge brute est ce qui reste <b>par MWh cumac</b>, avant commission d'apporteur et coût de pose.
              Elle se recalcule à l'enregistrement.
            </p>
            <button className="btn primary" disabled={!d.actif}>Enregistrer les ratios</button>
          </form>
        </div>
      ))}

      <form action={creerDeal} className="card">
        <h2>Créer un deal</h2>
        <div className="grid k4">
          <div className="field"><label>Libellé</label><input name="libelle" required placeholder="Deal standard" /></div>
          <div className="field">
            <label>Délégataire</label>
            <select name="delegataire_id" required defaultValue="">
              <option value="" disabled>choisir…</option>
              {delegataires.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </div>
          <div className="field"><label>Version</label><input name="version" defaultValue="V1" /></div>
          <div className="field"><label>En vigueur à partir du</label><input name="date_debut" type="date" /></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>En €/MWh cumac</th>
                {COMBINAISONS.map(([r, m]) => (
                  <th key={r + m} className="num">
                    {NOMS_REGIME[r] || r}<br />
                    <span style={{ fontWeight: 400, textTransform: 'none' }}>{m}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LIGNES.map((ligne) => (
                <tr key={ligne}>
                  <td style={{ whiteSpace: 'nowrap' }}>{ligne}</td>
                  {COMBINAISONS.map(([r, m]) => (
                    <td key={colonne(ligne, r, m)} className="num">
                      <input name={colonne(ligne, r, m)} type="number" step="0.01" defaultValue="" placeholder="—"
                             style={{ width: 92, textAlign: 'right', padding: '4px 6px', fontSize: 12.5 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, margin: '10px 0' }}>
          <input type="checkbox" name="par_defaut" style={{ width: 'auto' }} />
          Deal par défaut — appliqué aux dossiers importés sans deal nommé
        </label>
        <button className="btn primary">Créer le deal</button>
      </form>
    </>
  )
}

function fr(d) {
  if (!d) return '—'
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('fr-FR')
}
