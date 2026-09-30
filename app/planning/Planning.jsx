'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  deplacerInterventionAction, modifierInterventionAction, confirmerInterventionAction,
  realiserInterventionAction, annulerInterventionAction, rouvrirInterventionAction,
} from '../../lib/actions-planning.js'

const STATUTS = {
  A_PLANIFIER: 'À planifier', PLANIFIEE: 'Planifiée', CONFIRMEE: 'Confirmée', REALISEE: 'Réalisée', ANNULEE: 'Annulée',
}
const FIGEE = (i) => i.statut === 'REALISEE' || i.statut === 'ANNULEE'
const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.']
const AUCUN = '__aucun'

const indexJour = (jours, jour) => jours.indexOf(jour)
/** 0 = lundi … 6 = dimanche. */
const jourSemaine = (j) => (new Date(`${j}T00:00:00Z`).getUTCDay() + 6) % 7
const heure = (h) => (h && h.length > 10 ? h.slice(11, 16) : '')
const nom = (p) => [p.prenom, p.nom].filter(Boolean).join(' ')

/**
 * La grille du planning : une ligne par personne, une colonne par jour.
 *
 * Construite ici plutôt qu'avec un composant de calendrier du commerce : la vue « par
 * ressource » de ces composants est payante, et ce dont on a besoin tient en une grille CSS.
 * Chaque ligne empile ses interventions en couloirs, pour que deux rendez-vous le même jour
 * restent lisibles côte à côte au lieu de se recouvrir.
 */
export default function Planning({ jours, aujourdhui, vue, lignes, interventions, aPlanifier, tous, moi, peutModifier }) {
  const router = useRouter()
  const [enCours, demarrer] = useTransition()
  const [erreur, setErreur] = useState(null)
  const [choisie, setChoisie] = useState(null)
  const [survol, setSurvol] = useState(null)

  const n = jours.length
  const largeur = vue === 'mois' ? 32 : 105
  const colonnes = `190px repeat(${n}, minmax(${largeur}px, 1fr))`

  // Les lignes, regroupées par rôle. « Non attribuées » d'abord : c'est ce qui reste à faire.
  const groupes = useMemo(() => {
    const out = []
    if (tous) out.push({ role: null, personnes: [{ id: AUCUN, prenom: 'Non attribuées', nom: '' }] })
    for (const p of lignes) {
      let g = out.find((x) => x.role === p.role)
      if (!g) { g = { role: p.role, personnes: [] }; out.push(g) }
      g.personnes.push(p)
    }
    return out
  }, [lignes, tous])

  // Position de chaque intervention : colonnes couvertes, puis couloir dans sa ligne.
  const parLigne = useMemo(() => {
    const m = new Map()
    for (const i of interventions) {
      const cle = i.attribuee_a || AUCUN
      const d = i.debut.slice(0, 10), f = (i.fin || i.debut).slice(0, 10)
      const s = d < jours[0] ? 0 : indexJour(jours, d)
      const e = f > jours[n - 1] ? n - 1 : indexJour(jours, f)
      if (s < 0 || e < 0) continue
      if (!m.has(cle)) m.set(cle, [])
      m.get(cle).push({ i, s, e })
    }
    for (const liste of m.values()) {
      const fins = []
      liste.sort((x, y) => x.s - y.s || x.i.debut.localeCompare(y.i.debut))
      for (const x of liste) {
        let c = fins.findIndex((fin) => fin < x.s)
        if (c === -1) { c = fins.length; fins.push(x.e) } else fins[c] = x.e
        x.couloir = c
      }
    }
    return m
  }, [interventions, jours, n])

  const tout = useMemo(() => [...interventions, ...aPlanifier], [interventions, aPlanifier])
  const selection = tout.find((i) => i.id === choisie) || null

  const deposer = (e, jour, personne) => {
    e.preventDefault()
    setSurvol(null)
    const id = e.dataTransfer.getData('text/intervention')
    if (!id) return
    setErreur(null)
    demarrer(async () => {
      const r = await deplacerInterventionAction(id, jour, personne === AUCUN ? null : personne)
      if (!r.ok) setErreur(r.message)
      router.refresh()
    })
  }
  const glisser = (e, i) => {
    e.dataTransfer.setData('text/intervention', i.id)
    e.dataTransfer.effectAllowed = 'move'
  }
  const deplacable = (i) => peutModifier && !FIGEE(i) && (tous || !i.attribuee_a || i.attribuee_a === moi)

  const classeJour = (j) => `${jourSemaine(j) >= 5 ? ' we' : ''}${j === aujourdhui ? ' auj' : ''}`

  return (
    <div className="pl">
      {erreur && <div className="alert danger"><b>Déplacement refusé</b>{erreur}</div>}

      {/* En vue mois, la liste d'attente passe au-dessus : les 31 colonnes ont besoin de toute la largeur. */}
      <div className={`pl-corps${vue === 'mois' ? ' mois' : ''}`}>
        <div className="pl-defile">
          <div className="pl-grille" style={{ minWidth: 190 + n * largeur }}>
            <div className="pl-rangee pl-entete" style={{ gridTemplateColumns: colonnes }}>
              <div className="pl-nom">{enCours ? 'Enregistrement…' : ''}</div>
              {jours.map((j, k) => (
                <div key={j} className={`pl-jour${classeJour(j)}`} title={j.split('-').reverse().join('/')}>
                  {vue === 'mois'
                    ? <><span>{JOURS[jourSemaine(j)].slice(0, 1).toUpperCase()}</span><b>{Number(j.slice(8))}</b></>
                    : <><span>{JOURS[k]}</span> <b>{j.slice(8)}/{j.slice(5, 7)}</b></>}
                </div>
              ))}
            </div>

            {groupes.map((g) => (
              <div key={g.role || AUCUN}>
                {g.role && <div className="pl-role">{g.role}</div>}
                {g.personnes.map((p) => {
                  const evts = parLigne.get(p.id) || []
                  const couloirs = Math.max(1, ...evts.map((x) => x.couloir + 1))
                  return (
                    <div key={p.id} className={`pl-rangee${p.id === AUCUN ? ' pl-aucun' : ''}`}
                         style={{ gridTemplateColumns: colonnes, gridTemplateRows: `repeat(${couloirs}, minmax(${vue === 'mois' ? 30 : 46}px, auto))` }}>
                      <div className="pl-nom" style={{ gridRow: `1 / span ${couloirs}` }}>
                        {p.id === AUCUN ? <i>Non attribuées</i> : nom(p)}
                        <small>{evts.length || ''}</small>
                      </div>
                      {jours.map((j, k) => (
                        <div key={j}
                             className={`pl-case${classeJour(j)}${survol === `${p.id}|${j}` ? ' cible' : ''}`}
                             style={{ gridColumn: k + 2, gridRow: `1 / span ${couloirs}` }}
                             onDragOver={(e) => { if (peutModifier) { e.preventDefault(); setSurvol(`${p.id}|${j}`) } }}
                             onDragLeave={() => setSurvol(null)}
                             onDrop={(e) => deposer(e, j, p.id)} />
                      ))}
                      {evts.map(({ i, s, e, couloir }) => (
                        <button key={i.id} type="button"
                                className={`pl-evt st-${i.statut}${choisie === i.id ? ' choisie' : ''}`}
                                style={{ gridColumn: `${s + 2} / ${e + 3}`, gridRow: couloir + 1, '--c': i.type_couleur }}
                                draggable={deplacable(i)}
                                onDragStart={(ev) => glisser(ev, i)}
                                onClick={() => setChoisie(i.id === choisie ? null : i.id)}
                                title={`${i.type_libelle} · ${i.client} · ${i.code_postal} ${i.ville}${heure(i.debut) ? ` · ${heure(i.debut)}` : ''} · ${STATUTS[i.statut]}`}>
                          {vue === 'mois'
                            ? <span className="pl-evt-l1">{i.client}</span>
                            : <>
                                <span className="pl-evt-l1">{heure(i.debut) && <b>{heure(i.debut)} </b>}{i.client}</span>
                                <span className="pl-evt-l2">{i.code_postal} {i.ville} · {i.type_libelle}</span>
                              </>}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
            {lignes.length === 0 && !tous && <p className="muted" style={{ padding: 14 }}>Aucune ligne à afficher.</p>}
          </div>
        </div>

        <aside className="pl-attente">
          <h2>À planifier <span className="tag">{aPlanifier.length}</span></h2>
          {aPlanifier.length === 0 && <p className="muted" style={{ fontSize: 12.5 }}>Rien en attente.</p>}
          {aPlanifier.map((i) => (
            <button key={i.id} type="button" className={`pl-carte${choisie === i.id ? ' choisie' : ''}`}
                    style={{ '--c': i.type_couleur }}
                    draggable={deplacable(i)} onDragStart={(ev) => glisser(ev, i)}
                    onClick={() => setChoisie(i.id === choisie ? null : i.id)}>
              <b>{i.client}</b>
              <span>{i.type_libelle}</span>
              <span className="muted">{i.code_postal} {i.ville}{i.attribuee_prenom ? ` · ${i.attribuee_prenom}` : ''}</span>
            </button>
          ))}
          {aPlanifier.length > 0 && peutModifier && (
            <p className="muted" style={{ fontSize: 11.5 }}>Glissez une carte sur un jour et une personne pour la planifier.</p>
          )}
        </aside>
      </div>

      {selection && <Detail i={selection} lignes={lignes} tous={tous} moi={moi} peutModifier={peutModifier && (tous || !selection.attribuee_a || selection.attribuee_a === moi)} fermer={() => setChoisie(null)} />}
    </div>
  )
}

function Detail({ i, lignes, tous, moi, peutModifier, fermer }) {
  const figee = FIGEE(i)
  const pourSaisie = (h) => (!h ? '' : h.length === 10 ? `${h}T08:00` : h)
  const personnes = tous ? lignes : lignes.filter((p) => p.id === moi)
  return (
    <div className="card pl-detail" style={{ borderLeft: `5px solid ${i.type_couleur}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>
          {i.type_libelle} — {i.client}{' '}
          <span className="tag">{STATUTS[i.statut]}</span>
        </h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <a className="btn s" href={`/dossiers/${i.dossier_id}?onglet=suivi`}>Ouvrir le dossier {i.numero}</a>
          <button type="button" className="btn s" onClick={fermer}>Fermer</button>
        </div>
      </div>
      <p className="muted" style={{ margin: '6px 0 10px', fontSize: 12.5 }}>
        {i.adresse}, {i.code_postal} {i.ville}{i.telephone ? ` · ${i.telephone}` : ''}
        {i.statut_dossier ? ` · dossier : ${i.statut_dossier}` : ''}
        {i.confirmee_le ? ` · confirmée le ${i.confirmee_le.slice(0, 10).split('-').reverse().join('/')}` : ''}
      </p>
      {i.commentaire && <p style={{ marginTop: 0, whiteSpace: 'pre-line' }}>{i.commentaire}</p>}
      {i.compte_rendu && <p style={{ marginTop: 0 }}><b>Compte rendu :</b> {i.compte_rendu}</p>}

      {peutModifier && !figee && (
        <>
          <form action={modifierInterventionAction} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 10 }}>
            <input type="hidden" name="id" value={i.id} />
            <div className="field" style={{ marginBottom: 0 }}><label>Début</label>
              <input type="datetime-local" name="debut" defaultValue={pourSaisie(i.debut)} key={`d-${i.id}-${i.debut}`} /></div>
            <div className="field" style={{ marginBottom: 0 }}><label>Fin</label>
              <input type="datetime-local" name="fin" defaultValue={pourSaisie(i.fin)} key={`f-${i.id}-${i.fin}`} /></div>
            <div className="field" style={{ marginBottom: 0, minWidth: 180 }}><label>Attribuée à</label>
              <select name="attribuee_a" defaultValue={i.attribuee_a || ''} key={`a-${i.id}-${i.attribuee_a}`}>
                <option value="">Personne</option>
                {personnes.map((p) => <option key={p.id} value={p.id}>{nom(p)}</option>)}
              </select></div>
            <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 200 }}><label>Commentaire</label>
              <input name="commentaire" defaultValue={i.commentaire || ''} key={`c-${i.id}`} /></div>
            <button className="btn primary">Enregistrer</button>
          </form>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {i.debut && i.statut !== 'CONFIRMEE' && (
              <form action={confirmerInterventionAction}><input type="hidden" name="id" value={i.id} />
                <button className="btn">Rendez-vous confirmé</button></form>
            )}
            {i.debut && (
              <form action={realiserInterventionAction} style={{ display: 'flex', gap: 4 }}>
                <input type="hidden" name="id" value={i.id} />
                <input name="compte_rendu" placeholder="Compte rendu…" style={{ width: 220 }} />
                <button className="btn">Réalisée</button></form>
            )}
            <form action={annulerInterventionAction} style={{ display: 'flex', gap: 4 }}>
              <input type="hidden" name="id" value={i.id} />
              <input name="motif" placeholder="Motif d'annulation…" style={{ width: 200 }} />
              <button className="btn danger">Annuler</button></form>
          </div>
        </>
      )}
      {peutModifier && figee && (
        <form action={rouvrirInterventionAction}><input type="hidden" name="id" value={i.id} />
          <button className="btn s">Rouvrir (saisie par erreur)</button></form>
      )}
    </div>
  )
}
