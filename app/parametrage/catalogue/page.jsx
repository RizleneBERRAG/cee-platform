import { all, db } from '../../../lib/db.js'
import { valeursListe } from '../../../lib/listes.js'
import { garde } from '../../../lib/garde.js'
import { enregistrerProduit, supprimerProduit } from '../../../lib/actions-operations.js'

export const dynamic = 'force-dynamic'

/**
 * Catalogue des produits posés.
 *
 * Ce que le délégataire contrôle n'est pas « une pompe à chaleur » mais une référence
 * précise, avec ses caractéristiques, et il vérifie qu'elle correspond à la fiche
 * d'opération déclarée. Tant que le produit est un champ libre sur le devis, la même
 * référence s'écrit de six façons et rien n'est vérifiable — ni par nous, ni par eux.
 */
export default async function PageCatalogue() {
  await garde('referentiel.gerer')

  const produits = all(`
    SELECT p.*, f.code AS fiche_code,
           (SELECT COUNT(*) FROM operation o WHERE o.produit_id = p.id) AS nb_operations
    FROM produit p LEFT JOIN fiche f ON f.id = p.fiche_id
    ORDER BY p.actif DESC, p.marque, p.reference`)
  const fiches = all('SELECT id, code, libelle FROM fiche ORDER BY code')

  return (
    <>
      <div className="card">
        <h2>Catalogue produits ({produits.length})</h2>
        {produits.length === 0 ? (
          <p className="muted" style={{ marginTop: 0 }}>
            Aucun produit. Tant que le catalogue est vide, les opérations se saisissent sans
            produit : c'est possible, mais le dossier sera moins facile à défendre au contrôle.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Marque</th><th>Référence</th><th>Désignation</th>
                  <th>Fiche</th><th className="num">Posé sur</th><th></th>
                </tr>
              </thead>
              <tbody>
                {produits.map((p) => (
                  <tr key={p.id} style={{ opacity: p.actif ? 1 : 0.6 }}>
                    <td>{p.marque || '—'}</td>
                    <td className="mono">{p.reference || '—'}</td>
                    <td style={{ fontSize: 12, maxWidth: 340 }}>
                      {p.designation}
                      {!p.actif && <span className="tag" style={{ marginLeft: 6 }}>inactif</span>}
                    </td>
                    <td className="mono">{p.fiche_code || '—'}</td>
                    <td className="num">{p.nb_operations}</td>
                    <td>
                      <form action={supprimerProduit}>
                        <input type="hidden" name="id" value={p.id} />
                        <button className="btn s">{p.nb_operations > 0 ? 'Désactiver' : 'Supprimer'}</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 11.5, marginTop: 10 }}>
          Un produit déjà posé sur des dossiers est désactivé, jamais supprimé : le supprimer
          effacerait ce qui a réellement été installé sur des chantiers passés.
        </p>
      </div>

      <form action={enregistrerProduit} className="card" style={{ marginTop: 14 }}>
        <h2>Ajouter un produit</h2>
        <div className="grid k4">
          <div className="field">
            <label>Marque</label>
            <input name="marque" list="liste-marques" />
            <datalist id="liste-marques">{valeursListe(db(), 'marque').map((x) => <option key={x.id} value={x.libelle} />)}</datalist>
          </div>
          <div className="field">
            <label>Référence</label>
            <input name="reference" />
          </div>
          <div className="field">
            <label>Désignation</label>
            <input name="designation" required />
          </div>
          <div className="field">
            <label>Unité</label>
            <input name="unite" placeholder="U, m², kW…" />
          </div>
          <div className="field">
            <label>Fiche d'opération</label>
            <select name="fiche_id" defaultValue="">
              <option value="">— toutes</option>
              {fiches.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.libelle}</option>)}
            </select>
          </div>
          <div className="field">
            <label style={{ marginTop: 22 }}>
              <input type="checkbox" name="actif" defaultChecked style={{ width: 'auto', marginRight: 7 }} />
              Actif
            </label>
          </div>
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Caractéristiques techniques</label>
          <textarea name="description" rows={3}
                    placeholder="Puissance, rendement, dimensions… ce que le contrôleur rapprochera de la fiche." />
        </div>
        <button className="btn primary" style={{ marginTop: 10 }}>Ajouter</button>
      </form>
    </>
  )
}
