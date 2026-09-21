import { all } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'
import {
  enregistrerTypeDocument, supprimerTypeDocument, enregistrerLiasse, majContenuLiasse,
} from '../../../lib/actions-parametrage.js'

export const dynamic = 'force-dynamic'

export default async function Pieces({ searchParams }) {
  await garde('referentiel.gerer')
  const sp = await searchParams

  const types = all(`
    SELECT td.*,
           (SELECT COUNT(*) FROM document_dossier dd WHERE dd.type_document_id = td.id) AS nb_pieces,
           (SELECT COUNT(*) FROM liasse_item li WHERE li.type_document_id = td.id) AS nb_liasses
      FROM type_document td ORDER BY td.libelle`)

  const liasses = all(`
    SELECT l.*, dg.nom AS delegataire_nom
      FROM liasse l LEFT JOIN delegataire dg ON dg.id = l.delegataire_id
     ORDER BY l.actif DESC, dg.nom, l.fiche_code, l.libelle`)
  const items = all('SELECT * FROM liasse_item')
  const parLiasse = {}
  for (const i of items) (parLiasse[i.liasse_id] ||= []).push(i)

  const delegataires = all('SELECT id, nom FROM delegataire WHERE actif = 1 ORDER BY nom')
  const fiches = all('SELECT code FROM fiche ORDER BY code')

  return (
    <>
      {sp?.m && <div className="alert ok"><b>Paramétrage</b>{sp.m}</div>}

      <div className="alert warn">
        <b>C'est ce paramétrage qui bloque un dépôt</b>
        Une liasse dit quelles pièces sont exigées pour un couple délégataire / fiche. Un dossier
        auquel il manque une pièce <b>obligatoire</b> ne peut pas partir en lot : il serait rejeté
        et ferait monter votre taux de non-conformité. Les pièces facultatives, elles, n'empêchent rien.
      </div>

      <div className="card plat" style={{ marginBottom: 14 }}>
        <div className="entete"><h2>Types de pièces</h2></div>
        <table style={{ marginTop: 10 }}>
          <thead><tr><th>Code</th><th>Libellé</th><th className="num">Pièces</th><th className="num">Liasses</th><th></th></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id}>
                <td colSpan={2} style={{ padding: 0 }}>
                  <form action={enregistrerTypeDocument} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
                    <input type="hidden" name="id" value={t.id} />
                    <input name="code" defaultValue={t.code} className="mono" style={{ width: 170 }} />
                    <input name="libelle" defaultValue={t.libelle} style={{ minWidth: 230 }} />
                    <button className="btn s">Enregistrer</button>
                  </form>
                </td>
                <td className="num mono">{t.nb_pieces}</td>
                <td className="num mono">{t.nb_liasses}</td>
                <td className="right">
                  <form action={supprimerTypeDocument} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={t.id} />
                    <button className="btn s danger" disabled={t.nb_pieces > 0}>Supprimer</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={enregistrerTypeDocument} style={{ display: 'flex', gap: 6, padding: '10px 17px 15px', flexWrap: 'wrap' }}>
          <input name="code" placeholder="CODE_PIECE" className="mono" style={{ width: 170 }} required />
          <input name="libelle" placeholder="Libellé lisible" style={{ minWidth: 230 }} required />
          <button className="btn primary">Ajouter un type</button>
        </form>
      </div>

      {liasses.map((l) => {
        const dedans = new Map((parLiasse[l.id] || []).map((i) => [i.type_document_id, i]))
        const nbObligatoires = [...dedans.values()].filter((i) => i.obligatoire).length
        return (
          <div className="card" key={l.id} style={{ marginBottom: 12, opacity: l.actif ? 1 : 0.62 }}>
            <form action={enregistrerLiasse} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <input type="hidden" name="id" value={l.id} />
              <input name="libelle" defaultValue={l.libelle} style={{ minWidth: 220 }} />
              <select name="delegataire_id" defaultValue={l.delegataire_id || ''} style={{ width: 180 }}>
                <option value="">tous délégataires</option>
                {delegataires.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
              </select>
              <select name="fiche_code" defaultValue={l.fiche_code || ''} style={{ width: 160 }}>
                <option value="">toutes fiches</option>
                {fiches.map((f) => <option key={f.code} value={f.code}>{f.code}</option>)}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
                <input type="checkbox" name="actif" defaultChecked={!!l.actif} style={{ width: 'auto' }} /> active
              </label>
              <button className="btn s">Enregistrer l'en-tête</button>
              <span className="muted" style={{ fontSize: 12 }}>
                {dedans.size} pièce{dedans.size > 1 ? 's' : ''}, dont {nbObligatoires} obligatoire{nbObligatoires > 1 ? 's' : ''}
              </span>
            </form>

            <form action={majContenuLiasse}>
              <input type="hidden" name="liasse_id" value={l.id} />
              <table>
                <thead><tr><th style={{ width: 90 }}>Dans la liasse</th><th style={{ width: 100 }}>Obligatoire</th><th>Pièce</th></tr></thead>
                <tbody>
                  {types.map((t) => {
                    const i = dedans.get(t.id)
                    return (
                      <tr key={t.id}>
                        <td><input type="checkbox" name="type" value={t.id} defaultChecked={!!i} style={{ width: 'auto' }} /></td>
                        <td><input type="checkbox" name="obligatoire" value={t.id} defaultChecked={!!i?.obligatoire} style={{ width: 'auto' }} /></td>
                        <td>{t.libelle} <span className="mono muted" style={{ fontSize: 11 }}>{t.code}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <button className="btn primary" style={{ marginTop: 10 }}>Enregistrer le contenu</button>
            </form>
          </div>
        )
      })}

      <form action={enregistrerLiasse} className="card">
        <h2>Créer une liasse</h2>
        <p className="muted" style={{ marginTop: -6, fontSize: 12.5 }}>
          La liasse la plus précise l'emporte : une liasse propre à un couple délégataire + fiche
          prend le pas sur une liasse définie pour la fiche seule, elle-même prioritaire sur
          une liasse définie pour le délégataire seul.
        </p>
        <div className="grid k4">
          <div className="field"><label>Libellé</label><input name="libelle" required placeholder="Liasse standard BAT-TH-122" /></div>
          <div className="field">
            <label>Délégataire</label>
            <select name="delegataire_id" defaultValue="">
              <option value="">tous</option>
              {delegataires.map((d) => <option key={d.id} value={d.id}>{d.nom}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Fiche</label>
            <select name="fiche_code" defaultValue="">
              <option value="">toutes</option>
              {fiches.map((f) => <option key={f.code} value={f.code}>{f.code}</option>)}
            </select>
          </div>
          <div className="field">
            <label>État</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, marginTop: 6 }}>
              <input type="checkbox" name="actif" defaultChecked style={{ width: 'auto' }} /> active
            </label>
          </div>
        </div>
        <button className="btn primary">Créer la liasse</button>
      </form>
    </>
  )
}
