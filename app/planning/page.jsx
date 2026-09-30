import { garde, a } from '../../lib/garde.js'
import { db } from '../../lib/db.js'
import {
  periode, ajouterJours, typesIntervention, interventionsPeriode, interventionsAPlanifier,
  ressources, comptesParType,
} from '../../lib/planning.js'
import { aujourdhui } from '../../lib/rappels.js'
import Planning from './Planning.jsx'

export const dynamic = 'force-dynamic'

/** node:sqlite rend des objets sans prototype, que React refuse d'envoyer à un composant client. */
const plats = (lignes) => lignes.map((l) => ({ ...l }))

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

export default async function PagePlanning({ searchParams }) {
  const { u, portee } = await garde('dossier.voir')
  const sp = await searchParams
  const base = db()

  const tous = a(u, 'planning.tous')
  const vue = sp.vue === 'mois' ? 'mois' : 'semaine'
  const reference = /^\d{4}-\d{2}-\d{2}$/.test(sp.date || '') ? sp.date : aujourdhui()
  // Sans le droit de voir toute l'équipe, on ne voit que son propre planning — quoi que dise l'adresse.
  const qui = tous ? (sp.qui === 'moi' ? 'moi' : 'tous') : 'moi'
  const attribueeA = qui === 'moi' ? u.id : null

  const types = typesIntervention(base)
  const type = types.find((t) => t.id === sp.type) || null
  const jours = periode(vue, reference)
  const premier = jours[0], dernier = jours[jours.length - 1]

  const opts = { ...portee, attribueeA, typeId: type?.id || null }
  const interventions = interventionsPeriode(base, premier, dernier, opts)
  const aPlanifier = interventionsAPlanifier(base, opts)
  const lignes = ressources(base, interventions, { seulement: qui === 'moi' ? u.id : null })
  const comptes = comptesParType(base, premier, dernier, { ...portee, attribueeA })

  const precedent = vue === 'mois' ? `${ajouterJours(premier, -1).slice(0, 7)}-01` : ajouterJours(premier, -7)
  const suivant = vue === 'mois' ? ajouterJours(dernier, 1) : ajouterJours(premier, 7)
  const lien = (changes) => {
    const p = new URLSearchParams({ vue, date: reference, ...(type ? { type: type.id } : {}), ...(tous ? { qui } : {}), ...changes })
    for (const [k, v] of [...p]) if (!v) p.delete(k)
    return `/planning?${p}`
  }
  const titre = vue === 'mois'
    ? `${MOIS[Number(premier.slice(5, 7)) - 1]} ${premier.slice(0, 4)}`
    : `du ${fr(premier)} au ${fr(dernier)}`

  return (
    <>
      <h1>Planning{type ? ` — ${type.libelle}` : ''}</h1>
      <p className="lede">
        Glissez une intervention sur un autre jour ou une autre personne pour la déplacer.
        Les interventions se créent depuis la fiche du dossier, onglet Suivi.
      </p>

      <div className="chips" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        <a href={lien({ type: '' })} className={`btn s${!type ? ' primary' : ''}`}>Tous les calendriers</a>
        {types.map((t) => (
          <a key={t.id} href={lien({ type: t.id })} className={`btn s${type?.id === t.id ? ' primary' : ''}`}
             style={type?.id === t.id ? { background: t.couleur, borderColor: t.couleur } : { borderLeft: `4px solid ${t.couleur}` }}>
            {t.libelle}{comptes[t.id] ? ` · ${comptes[t.id]}` : ''}
          </a>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <a href={lien({ date: precedent })} className="btn" aria-label="Période précédente">←</a>
        <a href={lien({ date: aujourdhui() })} className="btn">Aujourd'hui</a>
        <a href={lien({ date: suivant })} className="btn" aria-label="Période suivante">→</a>
        <b style={{ margin: '0 8px', textTransform: vue === 'mois' ? 'capitalize' : 'none' }}>{titre}</b>
        <span style={{ flex: 1 }} />
        <a href={lien({ vue: 'semaine' })} className={`btn s${vue === 'semaine' ? ' primary' : ''}`}>7 jours</a>
        <a href={lien({ vue: 'mois' })} className={`btn s${vue === 'mois' ? ' primary' : ''}`}>Mois</a>
        {tous && (
          <>
            <span style={{ width: 8 }} />
            <a href={lien({ qui: 'tous' })} className={`btn s${qui === 'tous' ? ' primary' : ''}`}>Toute l'équipe</a>
            <a href={lien({ qui: 'moi' })} className={`btn s${qui === 'moi' ? ' primary' : ''}`}>Mon planning</a>
          </>
        )}
      </div>

      <Planning
        jours={jours}
        aujourdhui={aujourdhui()}
        vue={vue}
        lignes={plats(lignes)}
        interventions={plats(interventions)}
        aPlanifier={plats(aPlanifier)}
        tous={tous}
        moi={u.id}
        peutModifier={a(u, 'dossier.modifier')}
      />
    </>
  )
}

function fr(jour) {
  return jour.split('-').reverse().join('/')
}
