import { lot, dossiersDuLot, dossiersDeposables, calculDossier } from '../../../lib/queries.js'
import { completude } from '../../../lib/documents.js'
import { affecterAuLot, retirerDuLot, deposerLot } from '../../../lib/actions.js'
import { euros, nombre } from '../../../lib/marge.js'
import { garde, a } from '../../../lib/garde.js'
import { statutsParAxe } from '../../../lib/queries.js'
import { statuerLotAction } from '../../../lib/actions-lots.js'
import { creerAppelAction } from '../../../lib/actions-aap.js'
import { db } from '../../../lib/db.js'
import { delegataireDuLot, STATUTS_AAP } from '../../../lib/aap.js'

const ETATS = {
  EN_CONSTITUTION: ['En constitution', 'var(--warn)'],
  DEPOSE: ['Déposé', 'var(--accent)'],
  INSTRUIT: ['En instruction', '#8b5cf6'],
  VALIDE: ['Validé', 'var(--ok)'],
  REJETE: ['Rejeté', 'var(--danger)'],
}
const AXES = [
  ['statut_dossier_id', 'DOSSIER', 'Statut dossier'],
  ['statut_admin_id', 'ADMIN', 'Statut administratif'],
  ['statut_facturation_id', 'FACTURATION', 'Facturation'],
]

export const dynamic = 'force-dynamic'

export default async function FicheLot({ params, searchParams }) {
  const { u } = await garde('lot.gerer')
  const { id } = await params
  const sp = await searchParams
  const l = lot(id)
  if (!l) return <p>Lot introuvable.</p>

  const dedans = dossiersDuLot(id)
  const candidats = l.statut === 'EN_CONSTITUTION' ? dossiersDeposables() : []
  const ouvert = l.statut === 'EN_CONSTITUTION'

  const analyses = dedans.map((d) => ({ d, comp: completude(d), calc: calculDossier(d, { tauxApporteur: 8 }) }))
  const bloquants = analyses.filter((a) => !a.calc.eligibilite.applicable || (!a.comp.sansLiasse && !a.comp.deposable))
  const cumac = dedans.reduce((s, d) => s + (d.volume_cumac || 0), 0)
  const ca = dedans.reduce((s, d) => s + (d.prime_delegataire || 0), 0)
  const [etatLibelle, etatCouleur] = ETATS[l.statut] || [l.statut, '#64748b']
  const voitMontants = a(u, 'marge.voir')
  const appels = voitMontants ? db().prepare(`SELECT DISTINCT a.id, a.numero, a.statut FROM appel_paiement a
    LEFT JOIN appel_paiement_ligne x ON x.appel_id = a.id LEFT JOIN dossier d ON d.id = x.dossier_id
    WHERE a.lot_id = ? OR d.lot_id = ? ORDER BY a.numero`).all(id, id) : []
  const delegataireConnu = !!delegataireDuLot(db(), id)

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            {l.numero}{' '}
            <span key={l.statut} className="pill" style={{ background: etatCouleur, verticalAlign: 'middle' }}>
              {etatLibelle}
            </span>
          </h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {l.organisme || 'Organisme non défini'}
            {l.date_depot ? ` · déposé le ${new Date(l.date_depot).toLocaleDateString('fr-FR')}` : ''}
            {l.reference_emmy ? ` · EMMY ${l.reference_emmy}` : ''}
            {appels.map((x) => (
              <span key={x.id}> · <a href={`/aap/${x.id}`} style={{ color: 'var(--accent)' }}>{x.numero}</a> ({STATUTS_AAP[x.statut]?.libelle.toLowerCase()})</span>
            ))}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {dedans.length > 0 && (
            <a className="btn" href={`/lots/${l.id}/export`}>Récapitulatif interne (CSV)</a>
          )}
          {/* Deux liens, deux usages qu'il ne faut pas confondre : le récapitulatif interne
              sert à relire le lot ; le tableau de dépôt est celui qui part au délégataire et
              ne sort que si toutes les lignes sont complètes. Le contrôle, lui, ne
              télécharge rien : il dit ce qui manque. */}
          {dedans.length > 0 && (
            <>
              <a className="btn" href={`/lots/${l.id}/depot?controle=1`} target="_blank" rel="noopener">
                Contrôler le tableau de dépôt
              </a>
              <a className="btn" href={`/lots/${l.id}/depot`}>Tableau de dépôt</a>
            </>
          )}
          {ouvert && a(u, 'lot.deposer') && (
            <form action={deposerLot}>
              <input type="hidden" name="lot_id" value={l.id} />
              <button className="btn primary" disabled={dedans.length === 0 || bloquants.length > 0}>
                Déposer le lot
              </button>
            </form>
          )}
        </div>
      </div>

      {sp?.m && <div className="alert ok" style={{ marginTop: 14 }}><b>Lot</b>{sp.m}</div>}
      {bloquants.length > 0 && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <b>{bloquants.length} dossier(s) bloquent le dépôt</b>
          Un dossier non éligible ou dont une pièce obligatoire manque ne peut pas partir :
          il serait rejeté et ferait monter votre taux de non-conformité.
        </div>
      )}
      {!ouvert && (
        <div className="alert ok" style={{ marginTop: 14 }}>
          <b>Lot déposé</b>
          Les {dedans.length} dossiers de ce lot sont verrouillés. Toute correction demande un déverrouillage explicite, qui reste tracé.
        </div>
      )}

      <div className="grid k4" style={{ marginTop: 14, marginBottom: 14 }}>
        <div className="card kpi"><div className="v">{dedans.length}</div><div className="l">dossiers au lot</div></div>
        <div className="card kpi"><div className="v">{nombre(cumac / 1000)}</div><div className="l">MWh cumac</div></div>
        {a(u, 'marge.voir') && (
          <div className="card kpi"><div className="v">{euros(ca)}</div><div className="l">chiffre d'affaires</div></div>
        )}
        <div className="card kpi">
          <div className="v" style={{ color: bloquants.length ? 'var(--danger)' : 'var(--ok)' }}>{bloquants.length}</div>
          <div className="l">dossiers bloquants</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ padding: '14px 18px 0' }}><h2 style={{ margin: 0 }}>Contenu du lot</h2></div>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr><th>N°</th><th>Bénéficiaire</th><th>Fiche</th><th>Éligibilité</th><th>Pièces</th><th className="num">Cumac (MWh)</th><th></th></tr>
          </thead>
          <tbody>
            {analyses.length === 0 && <tr><td colSpan={7} className="muted" style={{ padding: 18 }}>Lot vide.</td></tr>}
            {analyses.map(({ d, comp, calc }) => (
              <tr key={d.id}>
                <td><a href={`/dossiers/${d.id}`} className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{d.numero}</a></td>
                <td>{d.raison_sociale}</td>
                <td className="mono">{d.fiche_code}</td>
                <td>
                  {calc.eligibilite.applicable
                    ? <span className="tag" style={{ background: '#ecfdf5', color: '#065f46' }}>OK</span>
                    : <span className="tag" style={{ background: '#fef2f2', color: '#991b1b' }}>Hors validité</span>}
                </td>
                <td>
                  {comp.sansLiasse
                    ? <span className="muted" style={{ fontSize: 12 }}>pas de liasse</span>
                    : <BadgePieces comp={comp} />}
                </td>
                <td className="num mono">{nombre((d.volume_cumac || calc.cumac.cumac) / 1000)}</td>
                <td className="right">
                  {ouvert && (
                    <form action={retirerDuLot} style={{ display: 'inline' }}>
                      <input type="hidden" name="dossier_id" value={d.id} />
                      <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }}>Retirer</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ouvert && (
        <form action={affecterAuLot} className="card" style={{ marginTop: 14 }}>
          <input type="hidden" name="lot_id" value={l.id} />
          <h2>Ajouter des dossiers</h2>
          {candidats.length === 0 ? (
            <p className="muted">Aucun dossier disponible : seuls les dossiers en phase Valorisation, hors lot, sont proposés.</p>
          ) : (
            <>
              <table>
                <thead><tr><th style={{ width: 34 }}></th><th>N°</th><th>Bénéficiaire</th><th>Fiche</th><th>Éligibilité</th><th>Pièces</th><th className="num">Cumac (MWh)</th></tr></thead>
                <tbody>
                  {candidats.map((d) => {
                    const comp = completude(d)
                    const calc = calculDossier(d, { tauxApporteur: 8 })
                    const pret = calc.eligibilite.applicable && (comp.sansLiasse || comp.deposable)
                    return (
                      <tr key={d.id}>
                        <td><input type="checkbox" name="dossier_id" value={d.id} defaultChecked={false} /></td>
                        <td className="mono">{d.numero}</td>
                        <td>{d.raison_sociale}</td>
                        <td className="mono">{d.fiche_code}</td>
                        <td>
                          {calc.eligibilite.applicable
                            ? <span className="tag" style={{ background: '#ecfdf5', color: '#065f46' }}>OK</span>
                            : <span className="tag" style={{ background: '#fef2f2', color: '#991b1b' }}>Hors validité</span>}
                        </td>
                        <td>
                          {comp.sansLiasse
                            ? <span className="muted" style={{ fontSize: 12 }}>—</span>
                            : <BadgePieces comp={comp} />}
                        </td>
                        <td className="num mono">{nombre(calc.cumac.cumac / 1000)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <button className="btn primary" style={{ marginTop: 12 }}>Ajouter au lot</button>
            </>
          )}
        </form>
      )}

      {!ouvert && dedans.length > 0 && (
        <form action={statuerLotAction} className="card" style={{ marginTop: 14 }}>
          <input type="hidden" name="lot_id" value={l.id} />
          <h2>Statuer le lot et ses {dedans.length} dossiers</h2>
          <p className="muted" style={{ fontSize: 12.5, marginTop: -6 }}>
            Au retour du délégataire : l'état du lot, sa référence EMMY, et le statut de tous ses
            dossiers d'un coup. Chaque dossier garde sa ligne au journal ; un axe laissé sur « — »
            n'est pas modifié.
          </p>
          <div className="grid k4">
            <div className="field"><label>État du lot</label>
              <select name="etat" defaultValue={l.statut}>
                {['DEPOSE', 'INSTRUIT', 'VALIDE', 'REJETE'].map((k) => <option key={k} value={k}>{ETATS[k][0]}</option>)}
              </select></div>
            <div className="field"><label>Référence EMMY</label><input name="reference_emmy" defaultValue={l.reference_emmy || ''} /></div>
          </div>
          <div className="grid k3">
            {AXES.map(([champ, axe, label]) => (
              <div className="field" key={champ}><label>{label} des dossiers</label>
                <select name={champ} defaultValue="">
                  <option value="">—</option>
                  {statutsParAxe(axe).map((s) => <option key={s.id} value={s.id}>{s.etape ? `${s.etape} · ` : ''}{s.libelle}</option>)}
                </select></div>
            ))}
          </div>
          <button className="btn primary">Appliquer</button>
        </form>
      )}

      {!ouvert && voitMontants && dedans.length > 0 && (
        <form action={creerAppelAction} className="card" style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="hidden" name="lot_id" value={l.id} />
          <div style={{ flex: 1, minWidth: 260 }}>
            <h2 style={{ margin: 0 }}>Appel à paiement</h2>
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
              {delegataireConnu
                ? "Crée un appel avec les dossiers valorisés de ce lot qui ne sont dans aucun autre appel. Vous y reporterez ce que le délégataire a validé."
                : `Le délégataire de ce lot n'est pas identifié (organisme « ${l.organisme || '—'} » absent des délégataires) : créez l'appel depuis l'écran des appels à paiement.`}
            </p>
          </div>
          <button className="btn primary" disabled={!delegataireConnu}>Créer l'appel à paiement</button>
        </form>
      )}

      <p style={{ marginTop: 18 }}><a href="/lots" style={{ color: 'var(--accent)' }}>← Retour aux lots</a></p>
    </>
  )
}

/**
 * Le pourcentage mesure la PRÉSENCE des pièces obligatoires ; la couleur, leur VALIDATION.
 * Afficher « 100 % » en orange sans rien dire de plus se lit comme une contradiction :
 * on nomme donc explicitement ce qui manque encore.
 */
function BadgePieces({ comp }) {
  const etat = comp.complet
    ? { fond: 'var(--ok)', texte: `${comp.tauxComplet} %` }
    : comp.deposable
      ? { fond: 'var(--warn)', texte: `${comp.tauxComplet} % · ${comp.aValider.length} à valider` }
      : { fond: 'var(--danger)', texte: `${comp.tauxComplet} % · ${comp.manquants.length} manquante${comp.manquants.length > 1 ? 's' : ''}` }
  return <span className="pill" style={{ background: etat.fond, whiteSpace: 'nowrap' }}>{etat.texte}</span>
}
