import { garde } from '../../lib/garde.js'
import { db } from '../../lib/db.js'
import { listerSav, comptesSav, referentielSav } from '../../lib/sav.js'
import { utilisateursActifs } from '../../lib/rappels.js'

export const dynamic = 'force-dynamic'

export default async function ListeSav({ searchParams }) {
  const { u, portee } = await garde('dossier.voir')
  const sp = await searchParams
  const base = db()
  const statuts = referentielSav(base, 'STATUT')
  const types = referentielSav(base, 'TYPE')
  const motifs = referentielSav(base, 'MOTIF')
  const equipe = utilisateursActifs()
  const etat = ['ouverts', 'clos', 'tous'].includes(sp.etat) ? sp.etat : 'ouverts'
  const filtres = {
    etat, statutId: sp.statut || null, typeId: sp.type || null, motifId: sp.motif || null,
    attribueA: sp.qui === 'moi' ? u.id : sp.qui || null, q: (sp.q || '').trim() || null,
  }
  const liste = listerSav(base, { ...filtres, ...portee })
  const comptes = comptesSav(base, portee)
  const params = (changes) => new URLSearchParams(Object.fromEntries(Object.entries({ etat, statut: sp.statut, type: sp.type, motif: sp.motif, qui: sp.qui, q: sp.q, ...changes }).filter(([, v]) => v)))

  return (
    <>
      <h1>S.A.V</h1>
      <p className="lede">
        Tout incident qui rouvre un dossier : contrôle COFRAC ou PNCEE, refus ou arbitrage de
        l'organisme, pièce incohérente, reliquat de travaux. Un S.A.V s'ouvre depuis la fiche
        du dossier, onglet Suivi.
      </p>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <a href={`/sav?${params({ statut: '', etat: 'ouverts' })}`} className={`btn s${!sp.statut && etat === 'ouverts' ? ' primary' : ''}`}>Tous les S.A.V ouverts · {comptes.ouverts}</a>
        {statuts.filter((s) => !s.cloture).map((s) => (
          <a key={s.id} href={`/sav?${params({ statut: s.id, etat: 'ouverts' })}`} className={`btn s${sp.statut === s.id ? ' primary' : ''}`}>
            {s.libelle} · {comptes.parStatut[s.id] || 0}
          </a>
        ))}
        <a href={`/sav?${params({ statut: '', etat: 'clos' })}`} className={`btn s${etat === 'clos' ? ' primary' : ''}`}>Clôturés</a>
        <a href={`/sav?${params({ statut: '', etat: 'tous' })}`} className={`btn s${etat === 'tous' ? ' primary' : ''}`}>Tous</a>
      </div>

      <form className="card" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
        <input type="hidden" name="etat" value={etat} />
        {sp.statut && <input type="hidden" name="statut" value={sp.statut} />}
        <div className="field" style={{ marginBottom: 0, minWidth: 150 }}><label>Type</label>
          <select name="type" defaultValue={sp.type || ''}><option value="">Tous</option>{types.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</select></div>
        <div className="field" style={{ marginBottom: 0, minWidth: 190 }}><label>Motif</label>
          <select name="motif" defaultValue={sp.motif || ''}><option value="">Tous</option>{motifs.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}</select></div>
        <div className="field" style={{ marginBottom: 0, minWidth: 170 }}><label>Attribué à</label>
          <select name="qui" defaultValue={sp.qui || ''}>
            <option value="">Tout le monde</option><option value="moi">Moi</option><option value="personne">Personne</option>
            {equipe.filter((p) => p.id !== u.id).map((p) => <option key={p.id} value={p.id}>{p.prenom} {p.nom}</option>)}
          </select></div>
        <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 180 }}><label>N° S.A.V ou dossier, client, ville, problème</label>
          <input name="q" defaultValue={sp.q || ''} /></div>
        <button className="btn primary">Filtrer</button>
        <a className="btn" href={`/sav/export?${params({})}`}>Exporter (CSV)</a>
      </form>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th>S.A.V</th><th>Dossier</th><th>Statut dossier</th><th>Type</th><th>Statut S.A.V</th><th>Dates</th><th>Motif</th><th>Attribué à</th><th>Clôturé</th></tr>
          </thead>
          <tbody>
            {liste.length === 0 && <tr><td colSpan={9} className="muted" style={{ padding: 18 }}>Aucun S.A.V.</td></tr>}
            {liste.map((v) => (
              <tr key={v.id}>
                <td><a href={`/sav/${v.id}`} className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>{v.numero}</a></td>
                <td>
                  <a href={`/dossiers/${v.dossier_id}?onglet=suivi`} className="mono" style={{ color: 'var(--accent)' }}>{v.dossier_numero}</a>
                  <div style={{ fontSize: 12 }}>{v.client}</div>
                  <div className="muted" style={{ fontSize: 11.5 }}>{v.code_postal} {v.ville}</div>
                </td>
                <td>{v.statut_dossier || '—'}</td>
                <td>{v.type_libelle || '—'}</td>
                <td><span className="tag">{v.statut_libelle || '—'}</span></td>
                <td className="mono" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  ouvert {fr(v.ouvert_le)}
                  {(v.intervention_debut || v.date_intervention) && <div>interv. {fr(v.intervention_debut || v.date_intervention)}</div>}
                  {v.regle_le && <div>réglé {fr(v.regle_le)}</div>}
                </td>
                <td>{v.motif_libelle || '—'}</td>
                <td>{v.attribue_prenom ? `${v.attribue_prenom} ${v.attribue_nom}` : '—'}</td>
                <td>{v.cloture ? <span className="tag ok">oui</span> : <span className="tag warn">non</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function fr(d) { return d ? d.slice(0, 10).split('-').reverse().join('/') : '—' }
