import { garde } from '../../../lib/garde.js'
import { db } from '../../../lib/db.js'
import { LISTES, valeursListe, usages } from '../../../lib/listes.js'
import { enregistrerValeurAction } from '../../../lib/actions-listes.js'

export const dynamic = 'force-dynamic'

const TYPES_SAISIE = { date: 'date', couleur: 'color' }

export default async function Listes({ searchParams }) {
  await garde('referentiel.gerer')
  const sp = await searchParams
  const cle = LISTES[sp.liste] ? sp.liste : 'amo'
  const def = LISTES[cle]
  const valeurs = valeursListe(db(), cle, { tous: true })
  const groupes = {}
  for (const [k, l] of Object.entries(LISTES)) (groupes[l.groupe] ||= []).push([k, l])

  const ligne = (v = null) => (
    <form action={enregistrerValeurAction} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '5px 10px', flexWrap: 'wrap' }}>
      <input type="hidden" name="liste" value={cle} />
      {v && <input type="hidden" name="id" value={v.id} />}
      <input name="ordre" type="number" defaultValue={v?.ordre ?? 0} style={{ width: 60 }} aria-label="Ordre" />
      <input name="libelle" defaultValue={v?.libelle || ''} placeholder={def.libelle} required style={{ minWidth: 200, flex: 1 }} aria-label={def.libelle} />
      {def.champs.map((ch) => {
        const val = v?.donnees?.[ch.cle]
        return (
          <input key={ch.cle} name={`d_${ch.cle}`} type={TYPES_SAISIE[ch.type] || 'text'}
                 defaultValue={Array.isArray(val) ? val.join(' ') : val ?? (ch.type === 'couleur' ? '#64748b' : '')}
                 placeholder={ch.libelle} aria-label={ch.libelle} title={ch.libelle}
                 style={ch.type === 'couleur' ? { width: 42, padding: 2, height: 32 } : { width: ch.type === 'iban' ? 260 : 150 }} />
        )
      })}
      {def.parDefaut && (
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" name="par_defaut" defaultChecked={!!v?.par_defaut} style={{ width: 'auto' }} /> par défaut
        </label>
      )}
      {v && (
        <label style={{ display: 'flex', gap: 5, alignItems: 'center', fontWeight: 400 }}>
          <input type="checkbox" name="actif" defaultChecked={!!v.actif} style={{ width: 'auto' }} /> actif
        </label>
      )}
      <button className="btn s">{v ? 'Enregistrer' : 'Ajouter'}</button>
    </form>
  )

  return (
    <>
      {sp?.m && <div className={`alert ${sp.m.startsWith('Non') ? 'danger' : 'ok'}`}><b>{def.titre}</b>{sp.m}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 230px) 1fr', gap: 14, alignItems: 'start' }} className="listes-grille">
        <nav className="card plat" style={{ padding: 10 }} aria-label="Listes">
          {Object.entries(groupes).map(([g, items]) => (
            <div key={g} style={{ marginBottom: 8 }}>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em', margin: '4px 6px' }}>{g}</div>
              {items.map(([k, l]) => (
                <a key={k} href={`/parametrage/listes?liste=${k}`}
                   style={{ display: 'block', padding: '5px 8px', borderRadius: 6, fontSize: 13, background: k === cle ? 'var(--accent-clair)' : undefined, color: k === cle ? 'var(--accent)' : undefined, fontWeight: k === cle ? 600 : 400 }}>
                  {l.titre}
                </a>
              ))}
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11.5, margin: '10px 6px 0' }}>
            Les <b>régies</b> sont les unités d'affaire : <a href="/parametrage/workflow" style={{ color: 'var(--accent)' }}>Étapes et statuts</a>.
          </div>
        </nav>

        <div className="card plat">
          <div className="entete"><h2>{def.titre}</h2></div>
          <p className="muted" style={{ fontSize: 12.5 }}>
            {def.usage ? <>Sert à : {def.usage}</> : <><b>Cette liste n'est encore lue par aucun écran.</b> Elle est prête pour la suite ; la remplir ne change rien pour l'instant.</>}
            {' '}Une valeur ne se supprime pas : désactivée, elle sort des choix et reste lisible là où elle a servi.
          </p>
          <table style={{ marginTop: 6 }}>
            <thead><tr><th>Ordre · {def.libelle}{def.champs.map((c) => ` · ${c.libelle}`).join('')}</th><th className="num">Utilisée</th></tr></thead>
            <tbody>
              {valeurs.map((v) => (
                <tr key={v.id} style={v.actif ? undefined : { opacity: 0.55 }}>
                  <td style={{ padding: 0 }}>{ligne(v)}</td>
                  <td className="num mono muted">{usages(db(), v.id) || '—'}</td>
                </tr>
              ))}
              <tr><td colSpan={2} style={{ padding: 0 }}>{ligne()}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
