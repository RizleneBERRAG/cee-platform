import { db } from '../../../lib/db.js'
import { preparerFacture } from '../../../lib/facture.js'
import { euros } from '../../../lib/marge.js'

/**
 * Les pièces comptables du dossier, et l'acompte.
 *
 * Tout ce qui a été émis reste listé — factures annulées et avoirs compris : c'est quand
 * une pièce a été corrigée qu'on a besoin de relire l'originale. L'état de chacune est
 * calculé ici, pas stocké : une facture est « annulée » parce qu'un avoir la désigne.
 *
 * L'émission passe par la route de facture en POST, dans un nouvel onglet : c'est le seul
 * geste qui consomme un numéro de la série, et il ne doit pas pouvoir se rejouer.
 */
const NATURE = { FACTURE: 'Facture', ACOMPTE: 'Acompte', AVOIR: 'Avoir' }

export default function Facturation({ dossierId, peutEmettre }) {
  const base = db()
  const pieces = base.prepare(`
    SELECT f.id, f.numero, f.type, f.date_emission, f.total_ttc, f.reste_a_payer, f.annule_facture_id,
           f.imputee_sur_id, f.acomptes_ttc,
           (SELECT numero FROM facture a WHERE a.annule_facture_id = f.id) AS annulee_par,
           (SELECT numero FROM facture o WHERE o.id = f.annule_facture_id) AS annule,
           (SELECT i.numero FROM facture i WHERE i.id = f.imputee_sur_id
              AND NOT EXISTS (SELECT 1 FROM facture x WHERE x.annule_facture_id = i.id)) AS deduit_de
      FROM facture f WHERE f.dossier_id = ? ORDER BY f.cree_le`).all(dossierId)
  const p = preparerFacture(base, dossierId)
  const facturee = pieces.some((f) => f.type === 'FACTURE' && !f.annulee_par)
  const lien = (id) => `/dossiers/${dossierId}/facture?facture=${id}`

  const etat = (f) => {
    if (f.annulee_par) return <span className="tag danger">annulée par {f.annulee_par}</span>
    if (f.type === 'AVOIR') return <span className="tag">annule {f.annule}</span>
    if (f.type === 'ACOMPTE') return f.deduit_de
      ? <span className="tag ok">déduit de {f.deduit_de}</span>
      : <span className="tag warn">à déduire</span>
    return <span className="tag ok">valable</span>
  }

  return (
    <div className="card" style={{ marginTop: 14 }} id="facturation">
      <h2>Facturation</h2>

      {p && (
        <div className="grid k4" style={{ marginBottom: 12 }}>
          <div><div className="muted" style={{ fontSize: 11.5 }}>Total TTC des travaux</div><b className="mono">{euros(p.totaux.ttc)}</b></div>
          <div><div className="muted" style={{ fontSize: 11.5 }}>Prime CEE déduite</div><b className="mono">{p.totaux.primeDeduite === null ? '—' : euros(p.totaux.primeDeduite)}</b></div>
          <div><div className="muted" style={{ fontSize: 11.5 }}>Acomptes à déduire</div><b className="mono">{euros(p.acomptesTtc)}</b></div>
          <div><div className="muted" style={{ fontSize: 11.5 }}>Reste à facturer au client</div><b className="mono">{euros(p.net)}</b></div>
        </div>
      )}

      {pieces.length === 0 ? <p className="muted">Aucune pièce émise sur ce dossier.</p> : (
        <table style={{ marginBottom: 12 }}>
          <thead><tr><th>Numéro</th><th>Nature</th><th>Émise le</th><th className="num">TTC</th><th>État</th><th></th></tr></thead>
          <tbody>
            {pieces.map((f) => (
              <tr key={f.id}>
                <td><a href={lien(f.id)} target="_blank" rel="noopener" className="mono" style={{ color: 'var(--accent)' }}>{f.numero}</a></td>
                <td>{NATURE[f.type] || f.type}</td>
                <td className="mono">{new Date(f.date_emission).toLocaleDateString('fr-FR')}</td>
                <td className="num mono">{euros(f.total_ttc)}</td>
                <td>{etat(f)}</td>
                <td className="right">
                  {peutEmettre && f.type !== 'AVOIR' && !f.annulee_par && !f.deduit_de && (
                    <form method="post" action={`/dossiers/${dossierId}/facture?avoir=${f.id}`} target="_blank" style={{ display: 'inline' }}>
                      <button className="btn s danger">Annuler par un avoir</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {peutEmettre && !facturee && (
        <form method="post" action={`/dossiers/${dossierId}/facture?acompte`} target="_blank"
              style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <input type="hidden" name="acompte" value="" />
          <div className="field" style={{ marginBottom: 0, width: 150 }}>
            <label>Acompte (% du net)</label>
            <input type="number" name="pourcentage" min="1" max="100" step="any" defaultValue="30" />
          </div>
          <div className="field" style={{ marginBottom: 0, width: 170 }}>
            <label>ou montant TTC (€)</label>
            <input type="number" name="montant" min="0" step="0.01" placeholder="vide = %" />
          </div>
          <button className="btn" formMethod="get" formAction={`/dossiers/${dossierId}/facture`}>Aperçu</button>
          <button className="btn primary">Émettre la facture d'acompte</button>
        </form>
      )}
      {peutEmettre && !facturee && (
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
          Le montant saisi l'emporte sur le pourcentage. L'acompte est ventilé par taux de TVA
          comme le devis, et la facture finale le déduira d'elle-même.
        </p>
      )}
    </div>
  )
}
