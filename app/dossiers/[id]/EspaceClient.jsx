import { creerAccesClient, revoquerAccesClient, arbitrerProposition } from './acces-actions.js'
import { CHAMPS_CLIENT } from '../../../lib/propositions.js'

/**
 * Le panneau « Espace client » de la fiche dossier.
 *
 * Deux choses y vivent : les accès délivrés au client, et les propositions qu'il a
 * soumises. L'arbitrage se fait **ligne par ligne** — c'est le point de tout le mécanisme.
 * Un bouton « tout accepter » aurait l'air pratique et ferait exactement ce que le client
 * a demandé, sans que personne ne l'ait lu.
 */

const LIBELLES = Object.fromEntries(CHAMPS_CLIENT.map((c) => [c.champ, c.libelle]))
const libelle = (champ) => LIBELLES[champ]
  || ({ 'site.age_batiment_tranche': 'Âge du bâtiment', 'site.type_chauffage': 'Type de chauffage' }[champ])
  || champ

const dt = (d) => (d ? new Date(d).toLocaleString('fr-FR') : '—')

export default function EspaceClient({ dossierId, acces, propositions, peutModifier }) {
  const actifs = acces.filter((a) => !a.revoque_le)

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Espace client</h2>

      {/* ── Les accès ── */}
      {actifs.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>
          Aucun accès ouvert. Le client ne peut pas consulter son dossier.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Identifiant</th>
              <th style={{ textAlign: 'left' }}>Ouvert le</th>
              <th style={{ textAlign: 'left' }}>Dernière visite</th>
              <th className="num">Visites</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {actifs.map((a) => (
              <tr key={a.id}>
                <td className="mono">{a.identifiant}</td>
                <td>{dt(a.cree_le)}</td>
                <td>{a.derniere_visite ? dt(a.derniere_visite) : <span className="muted">jamais</span>}</td>
                <td className="num">{a.visites}</td>
                <td style={{ textAlign: 'right' }}>
                  {peutModifier && (
                    <form action={revoquerAccesClient}>
                      <input type="hidden" name="id" value={dossierId} />
                      <input type="hidden" name="acces_id" value={a.id} />
                      <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }}>Révoquer</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {peutModifier && (
        <form action={creerAccesClient} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={dossierId} />
          <button className="btn primary" style={{ fontSize: 13 }}>
            {actifs.length ? 'Générer un nouvel accès' : 'Générer un accès client'}
          </button>
          <span className="muted" style={{ fontSize: 11.5, marginLeft: 10 }}>
            Le code n’est affiché qu’une fois : il n’est pas conservé en clair.
          </span>
        </form>
      )}

      {/* ── Les propositions en attente ── */}
      <h3 style={{ fontSize: 14, marginTop: 22 }}>
        Modifications proposées par le client
        {propositions.length > 0 && ` (${propositions.length} en attente)`}
      </h3>

      {propositions.length === 0 ? (
        <p className="muted" style={{ fontSize: 13 }}>Aucune demande en attente.</p>
      ) : propositions.map((p) => (
        <form action={arbitrerProposition} key={p.id}
              style={{ border: '1px solid var(--bordure, #ddd)', borderRadius: 6, padding: 12, marginTop: 10 }}>
          <input type="hidden" name="id" value={dossierId} />
          <input type="hidden" name="proposition_id" value={p.id} />

          <div className="muted" style={{ fontSize: 12 }}>Soumise le {dt(p.soumise_le)}</div>
          {p.message && (
            <p style={{ fontSize: 13, fontStyle: 'italic', margin: '6px 0 10px' }}>« {p.message} »</p>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Champ</th>
                <th style={{ textAlign: 'left' }}>Actuel</th>
                <th style={{ textAlign: 'left' }}>Proposé</th>
                <th style={{ textAlign: 'left' }}>Décision</th>
              </tr>
            </thead>
            <tbody>
              {p.champs.map((c) => (
                <tr key={c.id} style={{ borderTop: '1px solid #eee' }}>
                  <td style={{ padding: '6px 4px' }}>{libelle(c.champ)}</td>
                  <td style={{ padding: '6px 4px', color: 'var(--muted)' }}>
                    {c.valeur_avant || <em>vide</em>}
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 600 }}>
                    {c.valeur_proposee || <em>vide</em>}
                  </td>
                  <td style={{ padding: '6px 4px' }}>
                    {/* Le défaut est « Refuser » : une proposition non lue ne doit pas
                        s'appliquer par inadvertance. */}
                    <select name={`decision_${c.id}`} defaultValue="REFUSE" style={{ fontSize: 12.5 }}>
                      <option value="ACCEPTE">Accepter</option>
                      <option value="AMENDE">Amender</option>
                      <option value="REFUSE">Refuser</option>
                    </select>
                    <input name={`valeur_${c.id}`} placeholder="valeur amendée"
                           defaultValue={c.valeur_proposee ?? ''}
                           style={{ display: 'block', marginTop: 4, width: '100%', fontSize: 12.5 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button className="btn primary" style={{ marginTop: 10, fontSize: 13 }} disabled={!peutModifier}>
            Appliquer ces décisions
          </button>
        </form>
      ))}
    </div>
  )
}
