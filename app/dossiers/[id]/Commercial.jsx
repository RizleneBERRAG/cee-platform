import { all, db } from '../../../lib/db.js'
import { valeursListe } from '../../../lib/listes.js'
import { majCommercial, ajouterIntervenant, retirerIntervenant } from '../../../lib/actions-commercial.js'
import {
  ROLES_INTERVENANT, TYPES_LEAD, ETATS_DEVIS,
  libelleRole, anomaliesCommerciales, roleCommissionne,
} from '../../../lib/referentiels-commercial.js'

/**
 * Parcours commercial du dossier : d'où il vient, qui l'a porté, où en est le devis.
 *
 * Les anomalies affichées ne sont pas des fautes de frappe mais des trous de suivi — un
 * devis signé sans date de signature, un original non conforme. Chacune correspond à un
 * dossier qui restera bloqué au dépôt sans que personne ne s'en aperçoive.
 */

const opt = (liste) => liste.map(([v, l]) => <option key={v} value={v}>{l}</option>)
const jour = (v) => (v || '').slice(0, 10)

export default function Commercial({ dossierId, d, modifiable }) {
  const intervenants = all(`
    SELECT i.*, u.prenom, u.nom AS nom_compte, u.email, ua.nom AS unite_nom
    FROM dossier_intervenant i
    LEFT JOIN utilisateur u ON u.id = i.utilisateur_id
    LEFT JOIN unite_affaire ua ON ua.id = i.unite_affaire_id
    WHERE i.dossier_id = ?
    ORDER BY i.created_at`, [dossierId])

  const collaborateurs = all(`
    SELECT u.id, u.prenom, u.nom, ua.nom AS unite_nom
    FROM utilisateur u LEFT JOIN unite_affaire ua ON ua.id = u.unite_affaire_id
    WHERE u.actif = 1 ORDER BY u.nom, u.prenom`)

  const anomalies = anomaliesCommerciales(d)
  const nomDe = (i) => (i.utilisateur_id ? `${i.prenom} ${i.nom_compte}` : i.nom)

  return (
    <>
      <form action={majCommercial} className="card" style={{ marginTop: 14 }}>
        <input type="hidden" name="dossier_id" value={dossierId} />
        <h2>Parcours commercial</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Le canal et les dates ne servent pas qu'à l'historique : c'est ce qui permet de
          répondre à <b>« quel canal rapporte le plus de marge »</b>, question qu'aucun écran
          ne savait poser tant que la source était un champ libre.
        </p>

        {anomalies.length > 0 && (
          <div className={anomalies.some((a) => a.gravite === 'ERREUR') ? 'alert danger' : 'alert warn'}
               style={{ marginBottom: 12 }}>
            <b>{anomalies.some((a) => a.gravite === 'ERREUR') ? 'Dates incohérentes' : 'Suivi incomplet'}</b>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {anomalies.map((a, i) => <li key={i} style={{ marginBottom: 3 }}>{a.message}</li>)}
            </ul>
          </div>
        )}

        <div className="grid k4">
          <div className="field">
            <label>Type de lead</label>
            <select key={`tl-${d.type_lead || 'vide'}`} name="type_lead" defaultValue={d.type_lead || ''} disabled={!modifiable}>
              <option value="">—</option>{opt(TYPES_LEAD)}
            </select>
          </div>
          <div className="field">
            <label>Source du lead</label>
            {/* Suggestions tirées du paramétrage ; une source saisie librement reste acceptée. */}
            <input key={`sl-${d.source_lead}`} name="source_lead" list="liste-source-lead" defaultValue={d.source_lead || ''} disabled={!modifiable} />
            <datalist id="liste-source-lead">{valeursListe(db(), 'source_lead').map((x) => <option key={x.id} value={x.libelle} />)}</datalist>
          </div>
          <div className="field">
            <label>Campagne</label>
            <input key={`ca-${d.campagne}`} name="campagne" defaultValue={d.campagne || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label style={{ marginTop: 22 }}>
              <input key={`rc-${d.rdv_confirme}`} type="checkbox" name="rdv_confirme"
                     defaultChecked={!!d.rdv_confirme} style={{ width: 'auto', marginRight: 7 }} disabled={!modifiable} />
              RDV confirmé
            </label>
          </div>
          <div className="field">
            <label>Date de confirmation</label>
            <input key={`dc-${d.date_confirmation}`} type="date" name="date_confirmation"
                   defaultValue={jour(d.date_confirmation)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>RDV planifié le</label>
            <input key={`dp-${d.date_rdv_planifie}`} type="date" name="date_rdv_planifie"
                   defaultValue={jour(d.date_rdv_planifie)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>RDV visité le</label>
            <input key={`dv-${d.date_rdv_visite}`} type="date" name="date_rdv_visite"
                   defaultValue={jour(d.date_rdv_visite)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>N° de devis</label>
            <input key={`nd-${d.num_devis}`} name="num_devis" defaultValue={d.num_devis || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Date de proposition</label>
            <input key={`dpr-${d.date_proposition}`} type="date" name="date_proposition"
                   defaultValue={jour(d.date_proposition)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Date de signature</label>
            <input key={`ds-${d.date_signature}`} type="date" name="date_signature"
                   defaultValue={jour(d.date_signature)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>État du devis</label>
            <select key={`ed-${d.etat_devis || 'vide'}`} name="etat_devis" defaultValue={d.etat_devis || ''} disabled={!modifiable}>
              <option value="">—</option>{opt(ETATS_DEVIS)}
            </select>
          </div>
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!modifiable}>Enregistrer</button>
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          La <b>date de signature</b> détermine l'arrêté applicable au dossier. C'est la date
          la plus lourde de conséquences de cet écran : une erreur ici rend l'éligibilité
          indéfendable au contrôle.
        </p>
      </form>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>
          Intervenants
          <span className="tag" style={{ marginLeft: 8, textTransform: 'none' }}>{intervenants.length}</span>
        </h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Sept personnes touchent un dossier avant sa signature. Tant qu'une seule était
          enregistrée, aucune performance commerciale n'était calculable — et personne ne
          savait, six mois plus tard, qui avait vendu quoi.
        </p>

        {intervenants.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>Aucun intervenant rattaché.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Rôle</th><th>Personne</th><th>Unité</th><th className="num">Taux</th><th></th>
                </tr>
              </thead>
              <tbody>
                {intervenants.map((i) => (
                  <tr key={i.id}>
                    <td>{libelleRole(i.role) || i.role}</td>
                    <td>
                      {nomDe(i)}
                      {!i.utilisateur_id && (
                        <span className="tag" style={{ marginLeft: 6, textTransform: 'none' }}>externe</span>
                      )}
                      {i.email && <div className="muted" style={{ fontSize: 11.5 }}>{i.email}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{i.unite_nom || '—'}</td>
                    <td className="num mono">
                      {i.taux_commission == null ? '—' : `${String(i.taux_commission).replace('.', ',')} %`}
                    </td>
                    <td>
                      {modifiable && (
                        <form action={retirerIntervenant}>
                          <input type="hidden" name="id" value={i.id} />
                          <button className="btn s">Retirer</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {intervenants.some((i) => i.taux_commission != null) && (
          <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
            Les taux affichés ici sont <b>indicatifs</b>. La commission qui entre réellement
            dans la marge est celle saisie sur l'opération : deux endroits qui calculent de
            l'argent finissent par diverger, et c'est celui qu'on oublie qui fausse les comptes.
          </p>
        )}

        {modifiable && (
          <form action={ajouterIntervenant} style={{ marginTop: 14, borderTop: '1px solid var(--bord)', paddingTop: 14 }}>
            <input type="hidden" name="dossier_id" value={dossierId} />
            <b style={{ fontSize: 13 }}>Rattacher une personne</b>
            <div className="grid k4" style={{ marginTop: 8 }}>
              <div className="field">
                <label>Rôle</label>
                <select name="role" required defaultValue="">
                  <option value="" disabled>choisir…</option>
                  {ROLES_INTERVENANT.map(([v, l, c]) => (
                    <option key={v} value={v}>{l}{c ? ' (commissionné)' : ''}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Collaborateur</label>
                <select name="utilisateur_id" defaultValue="">
                  <option value="">— personne extérieure</option>
                  {collaborateurs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.prenom} {c.nom}{c.unite_nom ? ` · ${c.unite_nom}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Ou nom (sans compte)</label>
                <input name="nom" placeholder="Télé-opérateur de plateau…" />
              </div>
              <div className="field">
                <label>Taux indicatif (%)</label>
                <input type="number" step="0.01" name="taux_commission" />
              </div>
            </div>
            <button className="btn primary" style={{ marginTop: 10 }}>Rattacher</button>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
              Si vous choisissez un collaborateur, le nom libre est ignoré : garder les deux
              ferait exister la même personne sous deux formes et dédoublerait les statistiques.
            </p>
          </form>
        )}
      </div>
    </>
  )
}
