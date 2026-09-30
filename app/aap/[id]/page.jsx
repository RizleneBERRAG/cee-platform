import { garde, a } from '../../../lib/garde.js'
import { db, all } from '../../../lib/db.js'
import { lireAppel, dossiersAppelables, STATUTS_AAP } from '../../../lib/aap.js'
import { statutsParAxe } from '../../../lib/queries.js'
import {
  ajouterDossiersAction, retirerDossierAction, majLigneAction, majEnteteAction, changerEtapeAction,
  statuerDossiersAppelAction,
} from '../../../lib/actions-aap.js'
import { euros, nombre } from '../../../lib/marge.js'

export const dynamic = 'force-dynamic'

const AXES = [
  ['statut_dossier_id', 'DOSSIER', 'Statut dossier'],
  ['statut_admin_id', 'ADMIN', 'Statut administratif'],
  ['statut_facturation_id', 'FACTURATION', 'Facturation'],
]

export default async function FicheAppel({ params, searchParams }) {
  const { u } = await garde('lot.gerer')
  if (!a(u, 'marge.voir')) return <p className="muted">Cet écran demande le droit de voir la marge.</p>
  const { id } = await params
  const sp = await searchParams
  const x = lireAppel(db(), id)
  if (!x) return <p>Appel à paiement introuvable.</p>

  const t = x.totaux
  const enCreation = x.statut === 'EN_CREATION'
  const facturee = x.statut === 'PAIEMENT_ATTENDU' || x.statut === 'PAYE'
  const ttc = facturee ? x.total_ttc : t.ttc
  const lotsDuDelegataire = enCreation ? all(`SELECT DISTINCT l.id, l.numero FROM lot l JOIN dossier d ON d.lot_id = l.id
    WHERE d.delegataire_id = ? ORDER BY l.numero DESC`, [x.delegataire_id]) : []
  const filtreLot = sp.lot === 'aucun' ? null : sp.lot || x.lot_id || null
  const candidats = enCreation ? dossiersAppelables(db(), x.delegataire_id, { lotId: filtreLot }) : []
  const entites = all('SELECT id, raison_sociale FROM entite_emettrice WHERE actif = 1 ORDER BY raison_sociale')
  const ecartRecu = x.statut === 'PAYE' ? Math.round((x.montant_recu - x.total_ttc) * 100) / 100 : null
  const aujourdhui = new Date().toISOString().slice(0, 10)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            {x.numero}{' '}
            <span className="pill" style={{ background: STATUTS_AAP[x.statut].couleur, verticalAlign: 'middle' }}>{STATUTS_AAP[x.statut].libelle}</span>
          </h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {x.delegataire_nom}{x.delegataire_oblige ? ` (mandataire de ${x.delegataire_oblige})` : ''}
            {x.lot_numero ? <> · <a href={`/lots/${x.lot_id}`} style={{ color: 'var(--accent)' }}>{x.lot_numero}</a></> : ''}
            {x.numero_facture ? ` · facture ${x.numero_facture} du ${fr(x.date_facture)}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {t.nb > 0 && <a className="btn" href={`/aap/${x.id}/facture`} target="_blank" rel="noopener">{facturee ? `Facture ${x.numero_facture}` : 'Aperçu de la facture'}</a>}
          <a className="btn" href="/aap">← Tous les appels</a>
        </div>
      </div>

      {sp?.m && <div className={`alert ${/non émise|refusé/.test(sp.m) ? 'danger' : 'ok'}`} style={{ marginTop: 14 }}><b>Appel à paiement</b>{sp.m}</div>}
      {t.lignesEcart > 0 && (
        <div className="alert warn" style={{ marginTop: 14 }}>
          <b>{t.lignesEcart} dossier(s) validé(s) autrement que déposé(s)</b>
          Écart de volume : {nombre(t.ecartCumac / 1000)} MWh · écart de prime : {euros(t.ecartPrime)}.{facturee ? ' Facturé tel que validé par le délégataire.' : " Vérifiez l'AAF avant de facturer."}
        </div>
      )}
      {ecartRecu !== null && ecartRecu !== 0 && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <b>Le virement ne correspond pas à la facture</b>
          Reçu {euros(x.montant_recu)} pour {euros(x.total_ttc)} facturés : écart de {euros(ecartRecu)}.
        </div>
      )}

      <div className="grid k4" style={{ marginTop: 14, marginBottom: 14 }}>
        <div className="card kpi"><div className="v">{t.nb}</div><div className="l">dossiers</div></div>
        <div className="card kpi"><div className="v">{nombre((facturee ? x.total_cumac : t.cumac) / 1000)}</div><div className="l">MWh cumac validés{t.ecartCumac ? ` (${nombre(t.ecartCumac / 1000)} vs déposé)` : ''}</div></div>
        <div className="card kpi"><div className="v">{euros(facturee ? x.total_ht : t.ht)}</div><div className="l">prime HT{t.prixMwh ? ` · ${euros(t.prixMwh)} / MWh` : ''}</div></div>
        <div className="card kpi"><div className="v">{euros(ttc)}</div><div className="l">TTC (TVA {nombre(x.taux_tva)} %){x.statut === 'PAYE' ? ` · reçu ${euros(x.montant_recu)} le ${fr(x.date_paiement)}` : ''}</div></div>
      </div>

      <div className="grid k2" style={{ alignItems: 'start' }}>
        <form action={majEnteteAction} className="card" style={{ margin: 0 }}>
          <input type="hidden" name="id" value={x.id} />
          <h2>Appel à facturation du délégataire</h2>
          <div className="grid k2">
            <div className="field"><label>N° de l'AAF</label><input name="num_aaf" defaultValue={x.num_aaf || ''} /></div>
            <div className="field"><label>Date de l'AAF</label><input type="date" name="date_aaf" defaultValue={x.date_aaf || ''} /></div>
            <div className="field"><label>Société qui facture</label>
              <select name="entite_id" defaultValue={x.entite_id || ''} disabled={facturee}>
                <option value="">—</option>{entites.map((e) => <option key={e.id} value={e.id}>{e.raison_sociale}</option>)}
              </select></div>
            <div className="field"><label>TVA (%)</label><input type="number" step="any" name="taux_tva" defaultValue={x.taux_tva} disabled={facturee} /></div>
          </div>
          <div className="field"><label>Commentaire</label><input name="commentaire" defaultValue={x.commentaire || ''} /></div>
          <button className="btn primary">Enregistrer</button>
        </form>

        <div className="card" style={{ margin: 0 }}>
          <h2>Étape suivante</h2>
          {enCreation && (
            <>
              <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>
                Reportez sur chaque ligne ce que le délégataire a validé, puis validez l'appel : les montants ne bougeront plus.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <form action={changerEtapeAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="geste" value="valider" />
                  <button className="btn primary" disabled={!t.nb}>Valider l'appel</button></form>
                <form action={changerEtapeAction}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="geste" value="supprimer" />
                  <button className="btn danger">Supprimer l'appel</button></form>
              </div>
            </>
          )}
          {x.statut === 'VALIDE' && (
            <>
              <form action={changerEtapeAction} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input type="hidden" name="id" value={x.id} /><input type="hidden" name="geste" value="emettre" />
                <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
                  La facture prend le prochain numéro de la série de {x.entite_nom || 'la société choisie'}. Si vous l'avez
                  déjà émise dans un autre logiciel, saisissez son numéro : aucun numéro de la série ne sera consommé.
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <input name="numero_externe" placeholder="N° de facture émise ailleurs (facultatif)" style={{ flex: 1, minWidth: 220 }} />
                  <button className="btn primary">Émettre la facture</button>
                </div>
              </form>
              <form action={changerEtapeAction} style={{ marginTop: 8 }}><input type="hidden" name="id" value={x.id} /><input type="hidden" name="geste" value="rouvrir" />
                <button className="btn s">Rouvrir pour corriger</button></form>
            </>
          )}
          {facturee && (
            <form action={changerEtapeAction} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="geste" value="paiement" />
              <div className="field" style={{ marginBottom: 0 }}><label>Reçu le</label>
                <input type="date" name="date_paiement" defaultValue={x.date_paiement || aujourdhui} required /></div>
              <div className="field" style={{ marginBottom: 0 }}><label>Montant reçu (€)</label>
                <input type="number" step="0.01" name="montant_recu" defaultValue={x.montant_recu ?? x.total_ttc} required /></div>
              <button className="btn primary">{x.statut === 'PAYE' ? 'Corriger le paiement' : 'Paiement reçu'}</button>
            </form>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 14, padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '14px 18px 0' }}><h2 style={{ margin: 0 }}>Dossiers de l'appel</h2></div>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr><th>Dossier</th><th>Lot</th><th>Bénéficiaire</th><th>Fiche</th>
              <th className="num">Déposé (MWh)</th><th className="num">Validé (MWh)</th><th className="num">Prime attendue</th><th className="num">Prime HT validée</th><th className="num">Écart</th><th></th></tr>
          </thead>
          <tbody>
            {x.lignes.length === 0 && <tr><td colSpan={10} className="muted" style={{ padding: 18 }}>Aucun dossier : ajoutez-en ci-dessous.</td></tr>}
            {x.lignes.map((l) => {
              const ecart = Math.round(((l.prime_ht || 0) - (l.prime_attendue || 0)) * 100) / 100
              return (
                <tr key={l.id}>
                  <td><a href={`/dossiers/${l.dossier_id}`} className="mono" style={{ color: 'var(--accent)' }}>{l.numero}</a></td>
                  <td className="mono muted">{l.lot_numero || '—'}</td>
                  <td>{l.client}</td>
                  <td className="mono">{l.fiche_code}</td>
                  <td className="num mono">{nombre((l.cumac_depose || 0) / 1000)}</td>
                  <td className="num">{enCreation
                    ? <input form={`ligne-${l.id}`} name="cumac_valide" type="number" step="any" defaultValue={l.cumac_valide ?? ''} title="kWh cumac validés" style={{ width: 120, textAlign: 'right' }} />
                    : <span className="mono">{nombre((l.cumac_valide || 0) / 1000)}</span>}</td>
                  <td className="num mono">{euros(l.prime_attendue)}</td>
                  <td className="num">{enCreation
                    ? <input form={`ligne-${l.id}`} name="prime_ht" type="number" step="0.01" defaultValue={l.prime_ht ?? ''} style={{ width: 110, textAlign: 'right' }} />
                    : <span className="mono">{euros(l.prime_ht)}</span>}</td>
                  <td className="num mono" style={{ color: ecart < 0 ? 'var(--danger)' : ecart > 0 ? 'var(--ok)' : undefined }}>{ecart ? euros(ecart) : '—'}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {enCreation && (
                      <>
                        <form id={`ligne-${l.id}`} action={majLigneAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="ligne_id" value={l.id} /><input type="hidden" name="appel_id" value={x.id} />
                          <button className="btn s">OK</button>
                        </form>{' '}
                        <form action={retirerDossierAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="appel_id" value={x.id} /><input type="hidden" name="dossier_id" value={l.dossier_id} />
                          <button className="btn s">Retirer</button>
                        </form>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {enCreation && x.lignes.length > 0 && (
          <p className="muted" style={{ fontSize: 11.5, padding: '0 18px 12px' }}>
            Volume validé en <b>kWh cumac</b>, tel que sur l'AAF. Une case vide reprend le déposé.
          </p>
        )}
      </div>

      {enCreation && (
        <form action={ajouterDossiersAction} className="card" style={{ marginTop: 14 }}>
          <input type="hidden" name="appel_id" value={x.id} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Ajouter des dossiers de {x.delegataire_nom}</h2>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
              <a href={`/aap/${x.id}?lot=aucun`} className={`btn s${!filtreLot ? ' primary' : ''}`}>Tous les lots</a>
              {lotsDuDelegataire.map((l) => <a key={l.id} href={`/aap/${x.id}?lot=${l.id}`} className={`btn s${filtreLot === l.id ? ' primary' : ''}`}>{l.numero}</a>)}
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12.5 }}>Seuls les dossiers valorisés (montants figés), de ce délégataire et hors de tout autre appel sont proposés.</p>
          {candidats.length === 0 ? <p className="muted">Aucun dossier disponible.</p> : (
            <>
              <table>
                <thead><tr><th style={{ width: 34 }}></th><th>Dossier</th><th>Lot</th><th>Bénéficiaire</th><th>Fiche</th><th className="num">MWh cumac</th><th className="num">Prime</th></tr></thead>
                <tbody>
                  {candidats.map((d) => (
                    <tr key={d.id}>
                      <td><input type="checkbox" name="dossier_id" value={d.id} defaultChecked /></td>
                      <td className="mono">{d.numero}</td><td className="mono muted">{d.lot_numero || '—'}</td>
                      <td>{d.client}</td><td className="mono">{d.fiche_code}</td>
                      <td className="num mono">{nombre((d.volume_cumac || 0) / 1000)}</td>
                      <td className="num mono">{euros(d.prime_delegataire)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button className="btn primary" style={{ marginTop: 10 }}>Ajouter les dossiers cochés</button>
            </>
          )}
        </form>
      )}

      {t.nb > 0 && (
        <form action={statuerDossiersAppelAction} className="card" style={{ marginTop: 14 }}>
          <input type="hidden" name="id" value={x.id} />
          <h2>Statuer les {t.nb} dossiers de l'appel</h2>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
            Chaque dossier garde sa ligne au journal. Un axe laissé sur « — » n'est pas modifié.
          </p>
          <div className="grid k3">
            {AXES.map(([champ, axe, label]) => (
              <div className="field" key={champ}><label>{label}</label>
                <select name={champ} defaultValue="">
                  <option value="">—</option>
                  {statutsParAxe(axe).map((s) => <option key={s.id} value={s.id}>{s.etape ? `${s.etape} · ` : ''}{s.libelle}</option>)}
                </select></div>
            ))}
          </div>
          <button className="btn primary">Appliquer aux dossiers</button>
        </form>
      )}
    </>
  )
}

function fr(d) { return d ? d.slice(0, 10).split('-').reverse().join('/') : '—' }
