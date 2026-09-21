import { all } from '../../../lib/db.js'
import { euros, nombre, eurosPrecis } from '../../../lib/marge.js'
import { operationsDuDossier, chantiersDuDossier } from '../../../lib/operations.js'
import {
  ajouterOperation, majOperation, supprimerOperation, valoriser,
  ajouterChantier, supprimerChantier,
} from '../../../lib/actions-operations.js'
import { ZONES_CLIMATIQUES, TYPES_CHAUFFAGE } from '../../../lib/referentiels-site.js'

/**
 * Les opérations d'un dossier, et ses chantiers.
 *
 * Le parti pris d'affichage découle de la règle de gel : une opération figée montre ses
 * montants arrêtés, une opération neuve montre qu'elle n'en a pas encore. Le total du
 * dossier ne compte que les premières, et on le dit — plutôt que d'afficher un total
 * « presque juste » que personne ne saurait rapprocher de sa facture.
 */

const jour = (v) => (v ? new Date(v).toLocaleDateString('fr-FR') : null)
const qte = (n, u) => `${nombre(n)}${u ? ` ${u}` : ''}`

export default function Operations({ dossierId, d, modifiable, voitMarge }) {
  const ops = operationsDuDossier(dossierId)
  const chantiers = chantiersDuDossier(dossierId)
  const fiches = all(`SELECT f.id, f.code, f.libelle FROM fiche f ORDER BY f.code`)
  const produits = all('SELECT id, marque, reference, designation FROM produit WHERE actif = 1 ORDER BY marque, reference')
  const installateurs = all('SELECT id, raison_sociale FROM installateur_rge ORDER BY raison_sociale')

  const enAttente = ops.filter((o) => !o.date_calcul)
  const figees = ops.filter((o) => o.date_calcul)
  const totalCumac = figees.reduce((s, o) => s + (Number(o.volume_cumac) || 0), 0)
  const totalMarge = figees.reduce((s, o) => s + (Number(o.marge_nette) || 0), 0)
  const totalVente = ops.reduce((s, o) => s + (Number(o.puv) || 0) * (Number(o.quantite) || 0), 0)

  const nomProduit = (o) =>
    o.produit_designation
      ? `${[o.produit_marque, o.produit_reference].filter(Boolean).join(' ')} — ${o.produit_designation}`.trim()
      : null

  return (
    <>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>
          Opérations
          <span className="tag" style={{ marginLeft: 8, textTransform: 'none' }}>
            {ops.length} opération{ops.length > 1 ? 's' : ''}
          </span>
          {enAttente.length > 0 && (
            <span className="tag" style={{ marginLeft: 6, textTransform: 'none', color: 'var(--warn)' }}>
              {enAttente.length} à valoriser
            </span>
          )}
        </h2>

        {enAttente.length > 0 && figees.length > 0 && (
          <div className="alert warn" style={{ marginTop: 4 }}>
            <b>Les totaux du dossier ne comptent pas encore toutes les opérations</b>
            {enAttente.length} opération{enAttente.length > 1 ? 's ne sont' : ' n\'est'} pas valorisée
            {enAttente.length > 1 ? 's' : ''} : {enAttente.map((o) => o.fiche_code).join(', ')}.
            Les montants du dossier restent ceux des opérations déjà figées — c'est ce qui
            empêche l'ajout d'une ligne de réécrire une marge déjà facturée. Valorisez-les
            quand vous voulez les y faire entrer.
          </div>
        )}

        {ops.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>Aucune opération.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Fiche</th>
                  <th>Chantier</th>
                  <th>Produit</th>
                  <th className="num">Quantité</th>
                  <th className="num">P.U.V</th>
                  <th className="num">Vente</th>
                  <th className="num">Volume cumac</th>
                  {voitMarge && <th className="num">Marge</th>}
                  <th>État</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.id} style={{ opacity: o.date_calcul ? 1 : 0.75 }}>
                    <td>
                      <b className="mono">{o.fiche_code}</b>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {o.fv_version} · {o.charte === 'CDP' ? 'Coup de pouce' : 'Hors coup de pouce'}
                      </div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {o.chantier_libelle || '—'}
                      {o.ville && <div className="muted" style={{ fontSize: 11.5 }}>{o.code_postal} {o.ville}</div>}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 220 }}>
                      {nomProduit(o) || <span className="muted">—</span>}
                      {o.installateur_nom && (
                        <div className="muted" style={{ fontSize: 11.5 }}>posé par {o.installateur_nom}</div>
                      )}
                    </td>
                    <td className="num mono">{qte(o.quantite, o.unite)}</td>
                    <td className="num mono">{o.puv == null ? '—' : eurosPrecis(o.puv)}</td>
                    <td className="num mono">{o.puv == null ? '—' : euros(o.puv * (o.quantite || 0))}</td>
                    <td className="num mono">
                      {o.volume_cumac == null ? '—' : `${nombre(o.volume_cumac / 1000)} MWh`}
                    </td>
                    {voitMarge && (
                      <td className="num mono" style={{ color: (o.marge_nette ?? 0) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                        {o.marge_nette == null ? '—' : euros(o.marge_nette)}
                      </td>
                    )}
                    <td style={{ fontSize: 11.5 }}>
                      {o.date_calcul
                        ? <span className="tag ok">figée le {jour(o.date_calcul)}</span>
                        : <span className="tag" style={{ color: 'var(--warn)' }}>à valoriser</span>}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} style={{ fontWeight: 700, borderTop: '2px solid var(--text)' }}>
                    Total du dossier
                    <span className="muted" style={{ fontWeight: 400 }}> — opérations figées seulement</span>
                  </td>
                  <td className="num mono" style={{ fontWeight: 700, borderTop: '2px solid var(--text)' }}>
                    {totalVente > 0 ? euros(totalVente) : '—'}
                  </td>
                  <td className="num mono" style={{ fontWeight: 700, borderTop: '2px solid var(--text)' }}>
                    {nombre(totalCumac / 1000)} MWh
                  </td>
                  {voitMarge && (
                    <td className="num mono"
                        style={{ fontWeight: 700, borderTop: '2px solid var(--text)', color: totalMarge >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                      {euros(totalMarge)}
                    </td>
                  )}
                  <td style={{ borderTop: '2px solid var(--text)' }}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          La colonne <b>Vente</b> est le chiffre d'affaires client (P.U.V × quantité) — sans rapport
          avec la prime CEE, qui vient du volume cumac et de la grille du deal. Les confondre
          est l'erreur la plus fréquente à la lecture d'un dossier.
        </p>
      </div>

      {/* ── Modifier une opération ────────────────────────────── */}
      {modifiable && ops.map((o) => (
        <form action={majOperation} className="card" key={o.id} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={o.id} />
          <h2 style={{ fontSize: 13 }}>
            {o.fiche_code} — {o.fiche_libelle}
            {!o.date_calcul && <span className="tag" style={{ marginLeft: 8, color: 'var(--warn)' }}>non valorisée</span>}
          </h2>
          <div className="grid k4">
            <div className="field">
              <label>Chantier</label>
              <select key={`c-${o.chantier_id}`} name="chantier_id" defaultValue={o.chantier_id || ''}>
                {chantiers.map((c) => (
                  <option key={c.id} value={c.id}>{c.libelle} — {c.ville}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Charte</label>
              <select key={`ch-${o.charte}`} name="charte" defaultValue={o.charte}>
                <option value="HORS_CDP">Hors coup de pouce</option>
                <option value="CDP">Coup de pouce</option>
              </select>
            </div>
            <div className="field">
              <label>Produit posé</label>
              <select key={`p-${o.produit_id || 'vide'}`} name="produit_id" defaultValue={o.produit_id || ''}>
                <option value="">—</option>
                {produits.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.marque, p.reference].filter(Boolean).join(' ')} — {p.designation}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Installateur</label>
              <select key={`i-${o.installateur_id || 'vide'}`} name="installateur_id" defaultValue={o.installateur_id || ''}>
                <option value="">—</option>
                {installateurs.map((i) => <option key={i.id} value={i.id}>{i.raison_sociale}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Quantité</label>
              <input key={`q-${o.quantite}`} type="number" step="any" name="quantite" defaultValue={o.quantite} />
            </div>
            <div className="field">
              <label>Unité</label>
              <input key={`u-${o.unite}`} name="unite" defaultValue={o.unite || ''} />
            </div>
            <div className="field">
              <label>Prix unitaire de vente (€)</label>
              <input key={`pu-${o.puv}`} type="number" step="0.01" name="puv" defaultValue={o.puv ?? ''} />
            </div>
                        {/* ── Les deux critères que certaines fiches font varier ──
                Sur AGRI-EQ-110 (séchage solaire), le barème forestier vaut 2,4 fois
                l'agricole. Laissés vides, le calcul refuse de conclure plutôt que de
                retenir un barème au hasard. Les fiches qui ne les utilisent pas les
                ignorent. */}
            <div className="field">
              <label>Produit séché</label>
              <select key={`tp-${o.type_produit || 'vide'}`} name="type_produit" defaultValue={o.type_produit || ''}>
                <option value="">— sans objet</option>
                <option value="AGRICOLE">Produits agricoles</option>
                <option value="FORESTIER">Produits forestiers</option>
              </select>
            </div>
            <div className="field">
              <label>Type d'installation</label>
              <select key={`ti-${o.type_installation || 'vide'}`} name="type_installation" defaultValue={o.type_installation || ''}>
                <option value="">— sans objet</option>
                <option value="SYSTEME_COMPLET">Système complet neuf</option>
                <option value="TOITURE_COUPLEE">Toiture couplée à l'existant</option>
              </select>
            </div>
            <div className="field">
              <label>Coût de pose (€)</label>
              <input key={`cp-${o.cout_pose}`} type="number" step="0.01" name="cout_pose" defaultValue={o.cout_pose ?? 0} />
            </div>
            <div className="field">
              <label>Taux d'apporteur (%)</label>
              <input key={`ta-${o.taux_apporteur}`} type="number" step="0.01" name="taux_apporteur" defaultValue={o.taux_apporteur ?? 0} />
            </div>
          </div>
          <div className="barre-actions" style={{ marginTop: 10 }}>
            <button className="btn primary">Enregistrer</button>
            {voitMarge && (
              <button className="btn" formAction={valoriser} name="operation_id" value={o.id}>
                Valoriser cette opération
              </button>
            )}
            {ops.length > 1 && (
              <button className="btn" formAction={supprimerOperation}>Supprimer</button>
            )}
          </div>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            Enregistrer ne recalcule rien : les montants restent ceux du dernier calcul tant
            que vous ne valorisez pas. Corriger une quantité ne réécrit donc jamais une marge
            déjà facturée par surprise.
          </p>
        </form>
      ))}

      {/* ── Ajouter une opération ─────────────────────────────── */}
      {modifiable && (
        <form action={ajouterOperation} className="card" style={{ marginTop: 10 }}>
          <input type="hidden" name="dossier_id" value={dossierId} />
          <h2 style={{ fontSize: 13 }}>Ajouter une opération</h2>
          <div className="grid k4">
            <div className="field">
              <label>Fiche</label>
              <select name="fiche_id" required defaultValue="">
                <option value="" disabled>choisir une fiche…</option>
                {fiches.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.libelle}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Chantier</label>
              <select name="chantier_id" defaultValue={chantiers[0]?.id || ''}>
                {chantiers.map((c) => <option key={c.id} value={c.id}>{c.libelle} — {c.ville}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Charte</label>
              <select name="charte" defaultValue="HORS_CDP">
                <option value="HORS_CDP">Hors coup de pouce</option>
                <option value="CDP">Coup de pouce</option>
              </select>
            </div>
            <div className="field">
              <label>Quantité</label>
              <input type="number" step="any" name="quantite" defaultValue="0" />
            </div>
            <div className="field">
              <label>Produit posé</label>
              <select name="produit_id" defaultValue="">
                <option value="">—</option>
                {produits.map((p) => (
                  <option key={p.id} value={p.id}>
                    {[p.marque, p.reference].filter(Boolean).join(' ')} — {p.designation}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Installateur</label>
              <select name="installateur_id" defaultValue="">
                <option value="">—</option>
                {installateurs.map((i) => <option key={i.id} value={i.id}>{i.raison_sociale}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Prix unitaire de vente (€)</label>
              <input type="number" step="0.01" name="puv" />
            </div>
                        <div className="field">
              <label>Produit séché</label>
              <select name="type_produit" defaultValue="">
                <option value="">— sans objet</option>
                <option value="AGRICOLE">Produits agricoles</option>
                <option value="FORESTIER">Produits forestiers</option>
              </select>
            </div>
            <div className="field">
              <label>Type d'installation</label>
              <select name="type_installation" defaultValue="">
                <option value="">— sans objet</option>
                <option value="SYSTEME_COMPLET">Système complet neuf</option>
                <option value="TOITURE_COUPLEE">Toiture couplée à l'existant</option>
              </select>
            </div>
            <div className="field">
              <label>Taux d'apporteur (%)</label>
              <input type="number" step="0.01" name="taux_apporteur" defaultValue="0" />
            </div>
          </div>
          <button className="btn primary" style={{ marginTop: 10 }}>Ajouter</button>
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            La version de fiche retenue est celle en vigueur à la date d'engagement du dossier,
            pas celle d'aujourd'hui : une opération ajoutée après coup reste jugée sur l'arrêté
            applicable au moment de la signature.
          </p>
        </form>
      )}

      {/* ── Chantiers ─────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 14 }}>
        <h2>
          Chantiers
          <span className="tag" style={{ marginLeft: 8, textTransform: 'none' }}>{chantiers.length}</span>
        </h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Un dossier peut couvrir plusieurs adresses. La <b>zone climatique de chaque chantier</b>
          {' '}sert au calcul de ses propres opérations : deux bâtiments d'un même dossier en zones
          différentes ne donnent pas le même volume cumac.
        </p>
        {chantiers.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>Aucun chantier.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Chantier</th><th>Adresse</th><th>Zone</th><th className="num">Surface</th>
                  <th className="num">Opérations</th><th></th>
                </tr>
              </thead>
              <tbody>
                {chantiers.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.libelle}
                      {c.principal ? <span className="tag ok" style={{ marginLeft: 6 }}>principal</span> : null}
                    </td>
                    <td style={{ fontSize: 12 }}>{c.adresse}, {c.code_postal} {c.ville}</td>
                    <td className="mono">{c.zone_climatique || '—'}</td>
                    <td className="num mono">{c.surface ? `${nombre(c.surface)} m²` : '—'}</td>
                    <td className="num">{c.nb_operations}</td>
                    <td>
                      {modifiable && !c.principal && c.nb_operations === 0 && (
                        <form action={supprimerChantier}>
                          <input type="hidden" name="id" value={c.id} />
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

        {modifiable && (
          <form action={ajouterChantier} style={{ marginTop: 14, borderTop: '1px solid var(--bord)', paddingTop: 14 }}>
            <input type="hidden" name="dossier_id" value={dossierId} />
            <b style={{ fontSize: 13 }}>Ajouter un chantier</b>
            <div className="grid k4" style={{ marginTop: 8 }}>
              <div className="field">
                <label>Libellé</label>
                <input name="libelle" placeholder="Bâtiment B" />
              </div>
              <div className="field">
                <label>Adresse</label>
                <input name="adresse" required />
              </div>
              <div className="field">
                <label>Code postal</label>
                <input name="code_postal" required />
              </div>
              <div className="field">
                <label>Ville</label>
                <input name="ville" required />
              </div>
              <div className="field">
                <label>Zone climatique</label>
                <select name="zone_climatique" defaultValue="">
                  <option value="">non renseignée</option>
                  {ZONES_CLIMATIQUES.map((z) => <option key={z.code} value={z.code}>{z.libelle}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Surface (m²)</label>
                <input type="number" step="any" name="surface" />
              </div>
              <div className="field">
                <label>Secteur d'activité</label>
                <input name="secteur_activite" defaultValue={d.secteur_activite || ''} />
              </div>
              <div className="field">
                <label style={{ marginTop: 22 }}>
                  <input type="checkbox" name="qpv" style={{ width: 'auto', marginRight: 7 }} />
                  Quartier prioritaire
                </label>
              </div>
            </div>
            <button className="btn primary" style={{ marginTop: 10 }}>Ajouter le chantier</button>
          </form>
        )}
      </div>
    </>
  )
}
