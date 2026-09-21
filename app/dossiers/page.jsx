import {
  rechercher, compter, totaux, construireFiltres, optionsRecherche,
  colonnesVisibles, COLONNES, COLONNES_PAR_DEFAUT, CRITERES,
} from '../../lib/recherche.js'
import { calculDossier } from '../../lib/queries.js'
import { completude } from '../../lib/documents.js'
import { euros, nombre } from '../../lib/marge.js'
import { garde, a } from '../../lib/garde.js'
import { FormulaireRecherche } from './FormulaireRecherche.jsx'

export const dynamic = 'force-dynamic'

const TAILLES = [25, 50, 100, 200]

export default async function Dossiers({ searchParams }) {
  const { u, portee } = await garde('dossier.voir')
  const voitMarge = a(u, 'marge.voir')
  const sp = await searchParams

  // Les paramètres d'URL arrivent en chaîne ou en tableau selon qu'ils sont répétés.
  const un = (v) => (Array.isArray(v) ? v[0] : v)
  const plusieurs = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v])

  const valeurs = {}
  for (const cle of [...Object.keys(CRITERES), 'q']) {
    const v = un(sp?.[cle])
    if (v !== undefined && String(v).trim() !== '') valeurs[cle] = String(v)
  }

  const tri = un(sp?.tri) || 'numero'
  const sens = un(sp?.sens) === 'asc' ? 'asc' : 'desc'
  const par = TAILLES.includes(Number(un(sp?.par))) ? Number(un(sp.par)) : 50
  const page = Math.max(1, Number(un(sp?.page)) || 1)

  const colChoisies = plusieurs(sp?.col)
  const colonnes = colonnesVisibles(colChoisies.length ? colChoisies : COLONNES_PAR_DEFAUT, voitMarge)

  const total = compter(valeurs, portee)
  const pages = Math.max(1, Math.ceil(total / par))
  const pageSure = Math.min(page, pages)
  const lignes = rechercher(valeurs, portee, { tri, sens, limite: par, decalage: (pageSure - 1) * par })
  const t = totaux(valeurs, portee)
  const { actifs } = construireFiltres(valeurs, portee)
  const options = optionsRecherche(portee)

  // Reconstruit l'adresse en changeant ce qu'il faut et en gardant le reste.
  const lien = (modifs = {}, retire = []) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries(valeurs)) if (!retire.includes(k)) p.set(k, v)
    for (const c of colChoisies) p.append('col', c)
    p.set('tri', tri); p.set('sens', sens); p.set('par', String(par))
    if (pageSure > 1) p.set('page', String(pageSure))
    for (const [k, v] of Object.entries(modifs)) {
      if (v === null) p.delete(k); else p.set(k, String(v))
    }
    return `/dossiers?${p}`
  }
  const lienTri = (cle) => lien({ tri: cle, sens: tri === cle && sens === 'desc' ? 'asc' : 'desc', page: null })
  // L'export reprend exactement la recherche en cours, pagination mise à part.
  const lienExport = `/dossiers/export?${lien({ page: null }).split('?')[1]}`
  const premier = total === 0 ? 0 : (pageSure - 1) * par + 1
  const dernier = Math.min(pageSure * par, total)

  return (
    <>
      <div className="barre-resultat" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>Dossiers</h1>
        <div className="barre-actions">
          {a(u, 'dossier.creer') && <a href="/dossiers/nouveau" className="btn primary">+ Nouveau dossier</a>}
          {a(u, 'dossier.importer') && <a href="/dossiers/import" className="btn">Importer</a>}
          {total > 0 && <a className="btn" href={lienExport}>Exporter (CSV)</a>}
        </div>
      </div>
      <p className="lede" style={{ marginBottom: 14 }}>
        {Object.keys(CRITERES).length} critères de recherche, colonnes au choix, tri sur chaque
        colonne. Le cumac et la marge sont recalculés à l'affichage d'après la version de fiche
        et le deal de chaque dossier.
      </p>

      <FormulaireRecherche
        valeurs={{ ...valeurs, tri, sens, par }}
        options={options}
        colonnes={colonnes}
        voitMarge={voitMarge}
        // Le panneau reste replié même quand des filtres sont actifs : après une recherche,
        // on veut voir le résultat, pas le formulaire. Les pastilles ci-dessous disent
        // ce qui est filtré et permettent de l'ajuster sans tout rouvrir.
        ouvert={un(sp?.avance) === '1'}
      />

      {actifs.length > 0 && (
        <div className="filtres-actifs">
          <span className="muted" style={{ fontSize: 11.5 }}>Filtres :</span>
          {actifs.map((f) => (
            <span className="filtre-actif" key={f.cle}>
              {f.libelle} <b>{f.valeur}</b>
              <a href={lien({ page: null }, [f.cle])} title={`Retirer « ${f.libelle} »`} aria-label={`Retirer ${f.libelle}`}>×</a>
            </span>
          ))}
          <a href="/dossiers" className="btn s" style={{ marginLeft: 4 }}>Tout effacer</a>
        </div>
      )}

      <div className="barre-resultat">
        <div className="compte-resultat">
          <b>{nombre(total)}</b> dossier{total > 1 ? 's' : ''}
          {total > 0 && <> · lignes {nombre(premier)} à {nombre(dernier)}</>}
          {total > 0 && <> · <b>{nombre(t.cumac / 1000)}</b> MWh cumac</>}
          {voitMarge && total > 0 && <> · <b>{euros(t.marge)}</b> de marge nette</>}
        </div>
        <div className="barre-actions">
          <span className="muted" style={{ fontSize: 11.5 }}>Par page</span>
          {TAILLES.map((n) => (
            <a key={n} href={lien({ par: n, page: null })}
               className={`btn s${n === par ? ' primary' : ''}`}>{n}</a>
          ))}
        </div>
      </div>

      <div className="card plat">
        <div className="tableau-defilant">
          <table>
            <thead>
              <tr>
                {colonnes.map((cle) => {
                  const c = COLONNES[cle]
                  const actif = tri === cle
                  return (
                    <th key={cle} className={c.num ? 'num' : undefined}>
                      {c.tri ? (
                        <a className={`tri${actif ? ' actif' : ''}`} href={lienTri(cle)}>
                          {c.libelle}
                          <span className="fleche">{actif ? (sens === 'asc' ? '▲' : '▼') : '⇅'}</span>
                        </a>
                      ) : c.libelle}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {lignes.length === 0 && (
                <tr>
                  <td colSpan={colonnes.length} className="vide">
                    Aucun dossier ne correspond.
                    {actifs.length > 0 && <> Retirez un filtre ci-dessus pour élargir.</>}
                  </td>
                </tr>
              )}
              {lignes.map((d) => {
                const c = calculDossier(d, { tauxApporteur: 8 })
                return (
                  <tr key={d.id}>
                    {colonnes.map((cle) => (
                      <Cellule key={cle} cle={cle} d={d} c={c} />
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="pagination">
          <a className="btn" href={lien({ page: 1 })} style={pageSure <= 1 ? inerte : undefined}>« Début</a>
          <a className="btn" href={lien({ page: pageSure - 1 })} style={pageSure <= 1 ? inerte : undefined}>‹ Précédent</a>
          <span className="page-num">page {nombre(pageSure)} sur {nombre(pages)}</span>
          <a className="btn" href={lien({ page: pageSure + 1 })} style={pageSure >= pages ? inerte : undefined}>Suivant ›</a>
          <a className="btn" href={lien({ page: pages })} style={pageSure >= pages ? inerte : undefined}>Fin »</a>
        </div>
      )}
    </>
  )
}

const inerte = { pointerEvents: 'none', opacity: 0.35 }

function Cellule({ cle, d, c }) {
  const num = COLONNES[cle]?.num
  const classe = num ? 'num mono' : undefined

  switch (cle) {
    case 'numero':
      return <td><a href={`/dossiers/${d.id}`} className="lien-dossier">{d.numero}</a></td>
    case 'ref_externe': return <td className="mono muted">{d.ref_externe || '—'}</td>
    case 'beneficiaire': return <td>{d.raison_sociale || '—'}</td>
    case 'siret': return <td className="mono muted" style={{ fontSize: 11.5 }}>{d.siret || '—'}</td>
    case 'contact': return <td>{[d.benef_prenom, d.benef_nom].filter(Boolean).join(' ') || '—'}</td>
    case 'telephone': return <td className="mono">{d.telephone || '—'}</td>
    case 'ville': return <td>{d.ville || '—'}</td>
    case 'code_postal': return <td className="mono">{d.code_postal || '—'}</td>
    case 'departement': return <td className="mono">{d.departement || '—'}</td>
    case 'zone': return <td className="mono">{d.zone_climatique || '—'}</td>
    case 'qpv': return <td>{d.qpv ? <span className="tag warn">QPV</span> : <span className="muted">—</span>}</td>
    case 'fiche': return <td className="mono">{d.fiche_code}</td>
    case 'version': return <td className="mono muted">{d.fv_version}</td>
    case 'quantite': return <td className={classe}>{nombre(d.quantite)} {d.unite_variable || ''}</td>
    case 'statut':
      return <td><span className="pill" style={{ background: d.statut_couleur || '#94a3b8' }}>{d.statut_libelle || 'sans statut'}</span></td>
    case 'etape': return <td>{d.etape_libelle || '—'}</td>
    case 'cofrac': return <td>{d.cofrac_libelle || <span className="muted">—</span>}</td>
    case 'eligibilite':
      return (
        <td>
          {c.eligibilite.applicable
            ? <span className="tag ok">OK</span>
            : <span className="tag danger" title={c.eligibilite.motif}>Hors validité</span>}
        </td>
      )
    case 'pieces': {
      const comp = completude(d)
      if (comp.sansLiasse) return <td className="muted">—</td>
      return (
        <td>
          <span className="pill" style={{ background: comp.complet ? 'var(--ok)' : comp.deposable ? 'var(--warn)' : 'var(--danger)' }}>
            {comp.tauxComplet} %
          </span>
        </td>
      )
    }
    case 'unite': return <td>{d.unite_nom || '—'}</td>
    case 'delegataire': return <td>{d.delegataire_nom || '—'}</td>
    case 'lot':
      return <td>{d.lot_id ? <a href={`/lots/${d.lot_id}`} className="lien-dossier">{d.lot_numero}</a> : <span className="muted">—</span>}</td>
    case 'engagement': return <td className="mono">{fr(d.date_engagement)}</td>
    case 'pose': return <td className="mono">{fr(d.date_pose)}</td>
    case 'depot': return <td className="mono">{fr(d.date_depot)}</td>
    case 'cumac':
      return <td className={classe}>{c.eligibilite.applicable ? nombre(c.cumac.cumac / 1000) : '—'}</td>
    case 'ca':
      return <td className={classe}>{d.prime_delegataire != null ? euros(d.prime_delegataire) : '—'}</td>
    case 'prime':
      return <td className={classe}>{d.prime_beneficiaire != null ? euros(d.prime_beneficiaire) : '—'}</td>
    case 'marge':
      return (
        <td className={classe}>
          {c.eligibilite.applicable && c.valorisation
            ? <span style={{ color: c.valorisation.margeNette >= 0 ? undefined : 'var(--danger)' }}>
                {euros(c.valorisation.margeNette)}
              </span>
            : '—'}
        </td>
      )
    default: return <td className="muted">—</td>
  }
}

function fr(d) {
  if (!d) return '—'
  const x = new Date(d)
  return Number.isNaN(x.getTime()) ? '—' : x.toLocaleDateString('fr-FR')
}
