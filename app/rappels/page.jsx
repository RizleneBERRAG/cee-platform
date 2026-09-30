import { garde } from '../../lib/garde.js'
import { listerRappels, compteurs, utilisateursActifs, MOTIFS, PANIERS, aujourdhui } from '../../lib/rappels.js'
import { attribuerRappel, rouvrirRappel } from '../../lib/actions-rappels.js'
import { ActionsRappel, dateHeure } from './ActionsRappel.jsx'

export const dynamic = 'force-dynamic'

const COULEURS = { retard: 'var(--danger)', jour: 'var(--accent)', avenir: '#64748b', faits: 'var(--ok)' }

export default async function Rappels({ searchParams }) {
  const { u, portee } = await garde('dossier.voir')
  const sp = await searchParams
  const panier = PANIERS[sp.panier] ? sp.panier : 'jour'
  // Par défaut, chacun voit les siens : c'est sa liste de la journée. « Tous » sert au manager.
  const qui = sp.qui || 'moi'
  const attribueA = qui === 'moi' ? u.id : qui === 'tous' ? null : qui
  const motif = MOTIFS.includes(sp.motif) ? sp.motif : null
  const q = (sp.q || '').trim() || null

  const liste = listerRappels({ panier, attribueA, motif, q, ...portee })
  const n = compteurs({ attribueA: attribueA === 'personne' ? null : attribueA, ...portee })
  const equipe = utilisateursActifs()

  const lien = (changes) => {
    const p = new URLSearchParams({ panier, qui, ...(motif ? { motif } : {}), ...(q ? { q } : {}), ...changes })
    return `/rappels?${p}`
  }

  return (
    <>
      <h1>Rappels</h1>
      <p className="lede">
        Qui rappeler, et quand. Un rappel se crée depuis la fiche d'un dossier ; une fois fait,
        son compte rendu rejoint les notes du dossier.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {Object.entries(PANIERS).map(([cle, label]) => (
          <a key={cle} href={lien({ panier: cle })} className="btn"
             style={cle === panier ? { borderColor: COULEURS[cle], color: COULEURS[cle], fontWeight: 600 } : {}}>
            {label}{cle in n ? <> · <b>{n[cle]}</b></> : null}
          </a>
        ))}
      </div>

      <form className="card" style={{ marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <input type="hidden" name="panier" value={panier} />
        <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <label>Attribué à</label>
          <select name="qui" defaultValue={qui}>
            <option value="moi">Moi</option>
            <option value="tous">Toute l'équipe</option>
            <option value="personne">Personne</option>
            {equipe.filter((p) => p.id !== u.id).map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, minWidth: 200 }}>
          <label>Motif</label>
          <select name="motif" defaultValue={motif || ''}>
            <option value="">Tous</option>
            {MOTIFS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}>
          <label>Client, dossier, ville, commentaire</label>
          <input name="q" defaultValue={q || ''} />
        </div>
        <button className="btn primary">Filtrer</button>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{panier === 'faits' ? 'Fait le' : 'Date'}</th><th>Client</th><th>Dossier</th><th>Lieu</th>
              <th>Motif</th><th>Commentaire</th><th>Attribué à</th><th></th>
            </tr>
          </thead>
          <tbody>
            {liste.length === 0 && (
              <tr><td colSpan={8} className="muted" style={{ padding: 18 }}>Aucun rappel dans ce panier.</td></tr>
            )}
            {liste.map((r) => (
              <tr key={r.id}>
                <td className="mono" style={{ whiteSpace: 'nowrap', color: !r.fait_le && r.date_rappel.slice(0, 10) < aujourdhui() ? 'var(--danger)' : undefined }}>
                  {r.fait_le ? dateHeure(r.fait_le, true) : dateHeure(r.date_rappel)}
                </td>
                <td>
                  {r.client || '—'}
                  {r.telephone && <div className="muted mono" style={{ fontSize: 11.5 }}>{r.telephone}</div>}
                </td>
                <td><a href={`/dossiers/${r.dossier_id}?onglet=suivi`} className="mono" style={{ color: 'var(--accent)' }}>{r.numero}</a></td>
                <td>{r.code_postal} {r.ville}</td>
                <td><span className="tag">{r.motif}</span></td>
                <td style={{ maxWidth: 280, whiteSpace: 'pre-line', fontSize: 12.5 }}>
                  {r.commentaire}
                  {r.compte_rendu && <div style={{ marginTop: 4 }}><b>Compte rendu :</b> {r.compte_rendu}</div>}
                </td>
                <td>
                  {r.fait_le ? nomComplet(r.attribue_prenom, r.attribue_nom) : (
                    <form action={attribuerRappel} style={{ display: 'flex', gap: 4 }}>
                      <input type="hidden" name="id" value={r.id} />
                      <select name="attribue_a" defaultValue={r.attribue_a || ''} style={{ fontSize: 12, padding: '3px 6px' }}>
                        <option value="">Personne</option>
                        {equipe.map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
                      </select>
                      <button className="btn s">OK</button>
                    </form>
                  )}
                </td>
                <td style={{ minWidth: 230 }}>
                  {r.fait_le ? (
                    <form action={rouvrirRappel}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="btn s">Rouvrir</button>
                    </form>
                  ) : <ActionsRappel id={r.id} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function nomComplet(prenom, nom) {
  return prenom || nom ? `${prenom || ''} ${nom || ''}`.trim() : '—'
}
