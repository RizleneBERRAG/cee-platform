import { enregistrerDimensionnement, reporterDimensionnement } from './dimensionnement-actions.js'
import { nombre } from '../../../lib/marge.js'

/**
 * L'écran du bureau d'études.
 *
 * ── Ce qu'il met côte à côte, et pourquoi ──
 *
 * À gauche, ce que le client a déclaré. À droite, ce que le bureau d'études en conclut.
 * Les deux sur le même écran, parce que dimensionner sans avoir les volumes et l'énergie
 * disponible sous les yeux revient à les retrouver dans un autre onglet — et à recopier.
 *
 * ── Ce que l'écran ne fait pas ──
 *
 * Il ne propose aucune puissance. Ce calcul dépend du produit, de l'eau à retirer, du
 * débit et de la technologie : il appartient à l'ingénieur. Un champ pré-rempli avec une
 * valeur « estimée » finirait validé sans être relu.
 *
 * La seule chose qu'il se permet, c'est de suggérer le TYPE DE PRODUIT quand l'activité
 * déclarée est nette — et d'afficher pourquoi. Sur AGRI-EQ-110 le barème forestier vaut
 * 2,4 fois l'agricole : la suggestion s'affiche, elle ne s'impose pas.
 */
export default function Dimensionnement({ dossierId, etat, cumac, peutModifier }) {
  // L'opération EN COURS — pas la première venue. Sur un dossier qui porte déjà une
  // opération figée, reprendre `operations[0]` affichait les critères d'une opération
  // ancienne (souvent vides) et laissait croire que le report n'avait rien enregistré.
  const enCours = etat.operations.find((o) => !o.date_calcul) || etat.operations[0]

  const bloquants = etat.anomalies.filter((a) => a.niveau === 'BLOQUANT')
  const avertissements = etat.anomalies.filter((a) => a.niveau !== 'BLOQUANT')
  const renseignees = etat.entrees.filter((e) => e.valeur !== '' && e.valeur !== null
    && !(Array.isArray(e.valeur) && e.valeur.length === 0))

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <h2>Dimensionnement — bureau d'études</h2>

      {bloquants.length > 0 && (
        <div className="alert danger" style={{ marginBottom: 10 }}>
          <b>À corriger avant de dimensionner</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {bloquants.map((a, i) => <li key={i}>{a.message}</li>)}
          </ul>
        </div>
      )}
      {avertissements.length > 0 && (
        <div className="alert warn" style={{ marginBottom: 10 }}>
          <b>À vérifier</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {avertissements.map((a, i) => <li key={i}>{a.message}</li>)}
          </ul>
        </div>
      )}

      <div className="grid k2" style={{ gap: 18 }}>
        {/* ── Ce que le client a déclaré ── */}
        <div>
          <h3 style={{ fontSize: 13.5, marginTop: 0 }}>Déclaré par le client</h3>
          {renseignees.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              La fiche de qualification n’est pas encore remplie. Ouvrez un accès client, ou
              saisissez-la depuis l’espace de suivi.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <tbody>
                {renseignees.map((e) => (
                  <tr key={e.cle} style={{ borderBottom: '1px solid #f0f2f5' }}>
                    <td style={{ padding: '4px 0', color: 'var(--muted)' }}>{e.libelle}</td>
                    <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 600 }}>
                      {Array.isArray(e.valeur) ? e.valeur.join(', ') : String(e.valeur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Ce que le bureau d'études conclut ── */}
        <div>
          <h3 style={{ fontSize: 13.5, marginTop: 0 }}>Conclusions</h3>
          <form action={enregistrerDimensionnement} style={{ display: 'grid', gap: 9 }}>
            <input type="hidden" name="id" value={dossierId} />
            {etat.sortie.map((c) => (
              <div className="field" key={c.cle}>
                <label htmlFor={c.cle}>{c.libelle}</label>
                {c.def?.type === 'texte_long' ? (
                  <textarea id={c.cle} name={c.cle} rows={3} defaultValue={c.valeur} disabled={!peutModifier} />
                ) : (
                  <input id={c.cle} name={c.cle} type="number" step="any" min="0"
                         defaultValue={c.valeur} disabled={!peutModifier} />
                )}
              </div>
            ))}
            <button className="btn" disabled={!peutModifier}>Enregistrer le dimensionnement</button>
            <p className="muted" style={{ fontSize: 11.5, margin: 0 }}>
              Enregistrer ne change aucun montant. C’est le report ci-dessous qui alimente le calcul.
            </p>
          </form>
        </div>
      </div>

      {/* ── Le report dans l'opération ── */}
      <div style={{ borderTop: '1px solid #e6e9ee', marginTop: 16, paddingTop: 14 }}>
        <h3 style={{ fontSize: 13.5, marginTop: 0 }}>Porter le dimensionnement dans le calcul CEE</h3>

        {!etat.reportable ? (
          <p className="muted" style={{ fontSize: 13 }}>
            Renseignez d’abord la <b>puissance thermique</b> : c’est elle qui porte tout le calcul —
            la fiche AGRI-EQ-110 s’exprime en kWh cumac par kW installé.
          </p>
        ) : (
          <form action={reporterDimensionnement} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <input type="hidden" name="id" value={dossierId} />

            <div className="field" style={{ minWidth: 210 }}>
              <label htmlFor="type_produit">Produit séché</label>
              <select id="type_produit" name="type_produit"
                      defaultValue={enCours?.type_produit || etat.suggestionProduit || ''}>
                <option value="">— à choisir</option>
                <option value="AGRICOLE">Produits agricoles</option>
                <option value="FORESTIER">Produits forestiers</option>
              </select>
              <p className="muted" style={{ fontSize: 11, marginTop: 3 }}>{etat.motifSuggestion}</p>
            </div>

            <div className="field" style={{ minWidth: 230 }}>
              <label htmlFor="type_installation">Type d’installation</label>
              <select id="type_installation" name="type_installation"
                      defaultValue={enCours?.type_installation || ''}>
                <option value="">— à choisir</option>
                <option value="SYSTEME_COMPLET">Système complet neuf</option>
                <option value="TOITURE_COUPLEE">Toiture couplée à l’existant</option>
              </select>
              <p className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                Le barème « toiture couplée » vaut environ le quart du système complet.
              </p>
            </div>

            <div className="field" style={{ minWidth: 120 }}>
              <label>Puissance retenue</label>
              <div className="mono" style={{ fontSize: 15, fontWeight: 700, padding: '6px 0' }}>
                {nombre(etat.puissance)} kW
              </div>
            </div>

            <button className="btn primary" disabled={!peutModifier} style={{ marginBottom: 12 }}>
              {etat.operations.some((o) => !o.date_calcul) ? 'Mettre à jour l’opération' : 'Créer l’opération'}
            </button>
          </form>
        )}

        {/* Le résultat, quand l'opération existe déjà. */}
        {cumac && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#f6f8f6', borderRadius: 6, fontSize: 13.5 }}>
            {cumac.complet ? (
              <>
                Volume calculé : <b className="mono">{nombre(cumac.cumac / 1000)} MWh cumac</b>
                <span className="muted" style={{ fontSize: 12 }}> — {cumac.detail}</span>
              </>
            ) : (
              <span style={{ color: 'var(--danger)' }}>{cumac.detail}</span>
            )}
          </div>
        )}

        {etat.operations.some((o) => o.date_calcul) && (
          <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
            Une opération de ce dossier est déjà <b>figée</b>. Un nouveau report créera une
            opération supplémentaire plutôt que de réécrire des montants déjà calculés.
          </p>
        )}
      </div>
    </div>
  )
}
