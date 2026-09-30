import { garde, a } from '../../lib/garde.js'
import { db, all } from '../../lib/db.js'
import { listerAppels, comptesParStatut, STATUTS_AAP } from '../../lib/aap.js'
import { creerAppelAction } from '../../lib/actions-aap.js'
import { euros, nombre } from '../../lib/marge.js'

export const dynamic = 'force-dynamic'

export default async function AppelsPaiement({ searchParams }) {
  const { u } = await garde('lot.gerer')
  if (!a(u, 'marge.voir')) {
    return <><h1>Appels à paiement</h1><p className="muted">Cet écran n'est fait que de montants : il demande le droit de voir la marge.</p></>
  }
  const sp = await searchParams
  const statut = STATUTS_AAP[sp.statut] ? sp.statut : null
  const delegataires = all('SELECT id, nom FROM delegataire WHERE actif = 1 ORDER BY nom')
  const lots = all("SELECT id, numero FROM lot WHERE statut <> 'EN_CONSTITUTION' ORDER BY numero DESC")
  const filtres = { statut, delegataireId: sp.delegataire || null, lotId: sp.lot || null, q: (sp.q || '').trim() || null }
  const liste = listerAppels(db(), filtres)
  const comptes = comptesParStatut(db())
  const total = (k) => liste.reduce((s, x) => s + (Number(x[k]) || 0), 0)
  const lien = (s) => `/aap?${new URLSearchParams({ ...(s ? { statut: s } : {}), ...(sp.delegataire ? { delegataire: sp.delegataire } : {}) })}`

  return (
    <>
      <h1>Appels à paiement</h1>
      <p className="lede">
        Du volume validé par le délégataire au virement reçu : l'appel regroupe les dossiers,
        porte la facture qui lui est adressée, et signale tout écart — volume rogné, prix
        différent, paiement incomplet.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <a href={lien(null)} className={`btn${!statut ? ' primary' : ''}`}>Tous</a>
        {Object.entries(STATUTS_AAP).map(([k, s]) => (
          <a key={k} href={lien(k)} className={`btn${statut === k ? ' primary' : ''}`}
             style={statut === k ? { background: s.couleur, borderColor: s.couleur } : { borderLeft: `4px solid ${s.couleur}` }}>
            {s.libelle} · <b>{comptes[k]}</b>
          </a>
        ))}
      </div>

      <div className="grid k2" style={{ marginBottom: 14, alignItems: 'start' }}>
        <form className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: 0 }}>
          {statut && <input type="hidden" name="statut" value={statut} />}
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}><label>Délégataire</label>
            <select name="delegataire" defaultValue={sp.delegataire || ''}>
              <option value="">Tous</option>{delegataires.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
            </select></div>
          <div className="field" style={{ marginBottom: 0, minWidth: 130 }}><label>Lot de dépôt</label>
            <select name="lot" defaultValue={sp.lot || ''}>
              <option value="">Tous</option>{lots.map((l) => <option key={l.id} value={l.id}>{l.numero}</option>)}
            </select></div>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 140 }}><label>N° AAP, AAF ou facture</label>
            <input name="q" defaultValue={sp.q || ''} /></div>
          <button className="btn">Filtrer</button>
        </form>
        <form action={creerAppelAction} className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', margin: 0 }}>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}><label>Nouvel appel pour le délégataire</label>
            <select name="delegataire_id" required>
              {delegataires.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
            </select></div>
          <button className="btn primary">Créer l'appel</button>
          <p className="muted" style={{ fontSize: 11.5, margin: 0, width: '100%' }}>Ou depuis un lot déposé : bouton « Créer l'appel à paiement » sur la fiche du lot.</p>
        </form>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Appel</th><th>N° AAF</th><th>Facture</th><th>Délégataire</th><th>Créé le</th><th>Statut</th><th>Payé le</th>
              <th className="num">Dossiers</th><th className="num">MWh cumac</th><th className="num">Prime HT</th><th className="num">TVA</th><th className="num">Prime TTC</th><th className="num">Écart</th>
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={13} className="muted" style={{ padding: 18 }}>Aucun appel à paiement.</td></tr>}
            {liste.map((x) => (
              <tr key={x.id}>
                <td><a href={`/aap/${x.id}`} className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{x.numero}</a>
                  {x.lot_numero && <div className="muted" style={{ fontSize: 11 }}>{x.lot_numero}</div>}</td>
                <td className="mono">{x.num_aaf || '—'}</td>
                <td className="mono">{x.numero_facture || '—'}</td>
                <td>{x.delegataire_nom}</td>
                <td className="mono">{fr(x.cree_le)}</td>
                <td><span className="pill" style={{ background: STATUTS_AAP[x.statut]?.couleur }}>{STATUTS_AAP[x.statut]?.libelle}</span></td>
                <td className="mono">{x.date_paiement ? fr(x.date_paiement) : '—'}</td>
                <td className="num mono">{x.nb}</td>
                <td className="num mono">{nombre((x.cumac || 0) / 1000)}</td>
                <td className="num mono">{euros(x.ht)}</td>
                <td className="num mono">{euros(x.tva)}</td>
                <td className="num mono">{euros(x.ttc)}</td>
                <td className="num mono" style={{ color: x.ecartPrime < 0 ? 'var(--danger)' : undefined }}>{x.ecartPrime ? euros(x.ecartPrime) : '—'}</td>
              </tr>
            ))}
          </tbody>
          {liste.length > 1 && (
            <tfoot>
              <tr style={{ fontWeight: 600 }}>
                <td colSpan={7}>Total de la sélection</td>
                <td className="num mono">{total('nb')}</td><td className="num mono">{nombre(total('cumac') / 1000)}</td>
                <td className="num mono">{euros(total('ht'))}</td><td className="num mono">{euros(total('tva'))}</td>
                <td className="num mono">{euros(total('ttc'))}</td><td className="num mono">{euros(total('ecartPrime'))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  )
}

function fr(d) { return d ? d.slice(0, 10).split('-').reverse().join('/') : '—' }
