import { garde } from '../../../lib/garde.js'
import { db, all } from '../../../lib/db.js'
import { CHAMPS_SOCIETE } from '../../../lib/societes.js'
import { controlerFacture } from '../../../lib/facture.js'
import { valeursListe } from '../../../lib/listes.js'
import { enregistrerSocieteAction } from '../../../lib/actions-societes.js'

export const dynamic = 'force-dynamic'

const GROUPES = [...new Set(CHAMPS_SOCIETE.map(([, , , g]) => g))]

export default async function Societes({ searchParams }) {
  await garde('referentiel.gerer')
  const sp = await searchParams
  const base = db()
  const societes = all('SELECT * FROM entite_emettrice ORDER BY actif DESC, par_defaut DESC, raison_sociale')
  const installateurs = all('SELECT id, raison_sociale FROM installateur_rge WHERE actif = 1 ORDER BY raison_sociale')
  const comptes = valeursListe(base, 'compte_bancaire')
  const certifs = (e) => (e.installateur_id ? all('SELECT * FROM certification_rge WHERE installateur_id = ?', [e.installateur_id]) : [])

  const formulaire = (e = null) => (
    <form action={enregistrerSocieteAction}>
      {e && <input type="hidden" name="id" value={e.id} />}
      {GROUPES.map((g) => (
        <fieldset key={g} style={{ border: 0, padding: 0, margin: '0 0 10px' }}>
          <legend className="sous-titre">{g}</legend>
          <div className="grid k4">
            {CHAMPS_SOCIETE.filter(([, , , gr]) => gr === g).map(([col, libelle, type]) => (
              <div className="field" key={col} style={type === 'texte' && /mentions|conditions/.test(col) ? { gridColumn: 'span 2' } : undefined}>
                <label>{libelle}</label>
                {type === 'installateur' ? (
                  <select name={col} defaultValue={e?.[col] || ''}><option value="">—</option>{installateurs.map((i) => <option key={i.id} value={i.id}>{i.raison_sociale}</option>)}</select>
                ) : type === 'compte' ? (
                  <select name={col} defaultValue={e?.[col] || ''}>
                    <option value="">—</option>{comptes.map((c) => <option key={c.id} value={c.id}>{c.libelle} — {c.donnees.iban}</option>)}
                  </select>
                ) : (
                  <input name={col} defaultValue={e?.[col] ?? ''} required={type === 'requis' || type === 'code'}
                         inputMode={['nombre', 'entier', 'siren', 'siret'].includes(type) ? 'decimal' : undefined} />
                )}
              </div>
            ))}
          </div>
        </fieldset>
      ))}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Logo (PNG, JPEG ou WebP, 300 Ko au plus)</label>
          <input type="file" name="logo" accept="image/png,image/jpeg,image/webp" />
        </div>
        {e?.logo && <img src={e.logo} alt="" style={{ maxHeight: 48, maxWidth: 140 }} />}
        {e?.logo && <label style={{ display: 'flex', gap: 5, fontWeight: 400 }}><input type="checkbox" name="retirer_logo" style={{ width: 'auto' }} /> retirer le logo</label>}
        <label style={{ display: 'flex', gap: 5, fontWeight: 400 }}><input type="checkbox" name="par_defaut" defaultChecked={!!e?.par_defaut} style={{ width: 'auto' }} /> société par défaut</label>
        {e && <label style={{ display: 'flex', gap: 5, fontWeight: 400 }}><input type="checkbox" name="actif" defaultChecked={!!e.actif} style={{ width: 'auto' }} /> active</label>}
      </div>
      {!comptes.length && (
        <p className="muted" style={{ fontSize: 12 }}>
          Aucun compte bancaire : ajoutez-en dans <a href="/parametrage/listes?liste=compte_bancaire" style={{ color: 'var(--accent)' }}>Autres listes › Comptes bancaires</a> pour que l'IBAN figure sur les factures.
        </p>
      )}
      <button className="btn primary">{e ? 'Enregistrer' : 'Créer la société'}</button>
    </form>
  )

  return (
    <>
      {sp?.m && <div className={`alert ${sp.m.startsWith('Non') ? 'danger' : 'ok'}`}><b>Sociétés émettrices</b>{sp.m}</div>}
      <p className="muted" style={{ fontSize: 12.5 }}>
        Les sociétés au nom desquelles partent devis, factures et appels à paiement. Chacune a sa
        propre série de numéros. Ce qui manque est signalé en tête : c'est exactement ce que
        l'émission refusera.
      </p>

      {societes.map((e) => {
        const anomalies = controlerFacture(e, certifs(e))
        const bloquants = anomalies.filter((x) => x.niveau === 'BLOQUANT')
        return (
          <details key={e.id} className="card plat" style={{ marginBottom: 12, padding: '12px 16px', opacity: e.actif ? 1 : 0.65 }} open={sp.id === e.id}>
            <summary style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              {e.logo ? <img src={e.logo} alt="" style={{ maxHeight: 26, maxWidth: 90 }} /> : null}
              <b>{e.raison_sociale}</b>
              <span className="mono muted" style={{ fontSize: 12 }}>{e.code}</span>
              {e.par_defaut ? <span className="tag ok">par défaut</span> : null}
              {!e.actif && <span className="tag">désactivée</span>}
              {e.actif ? (bloquants.length
                ? <span className="tag danger">{bloquants.length} blocage(s) : devis et factures refusés</span>
                : <span className="tag ok">prête à émettre</span>) : null}
              <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>
                devis {e.devis_prefixe || '—'} n° {e.devis_compteur || 0} · factures {e.facture_prefixe || '—'} n° {e.facture_compteur || 0}
                {e.devis_annee || e.facture_annee ? ` (${e.facture_annee || e.devis_annee})` : ''}
              </span>
            </summary>
            {anomalies.length > 0 && (
              <ul style={{ margin: '12px 0', paddingLeft: 18, fontSize: 12.5 }}>
                {anomalies.map((x, k) => <li key={k} style={{ color: x.niveau === 'BLOQUANT' ? 'var(--danger)' : 'var(--warn)' }}>{x.message}</li>)}
              </ul>
            )}
            <div style={{ marginTop: 12 }}>{formulaire(e)}</div>
          </details>
        )
      })}

      <details className="card plat" style={{ padding: '12px 16px' }} open={sp.nouvelle === '1'}>
        <summary style={{ cursor: 'pointer' }}><b>Nouvelle société émettrice</b></summary>
        <div style={{ marginTop: 12 }}>{formulaire()}</div>
      </details>
    </>
  )
}
