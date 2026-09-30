'use client'

import { useEffect, useState } from 'react'

/**
 * Onglets de la fiche dossier.
 *
 * Tous les panneaux sont rendus par le serveur et restent montés : changer d'onglet ne
 * recharge rien et ne perd pas une saisie en cours. Seul l'affichage bascule.
 *
 * L'onglet ouvert survit à un enregistrement : il est inscrit dans l'adresse (`?onglet=`,
 * pour pouvoir envoyer un lien direct) et gardé pour ce dossier le temps de la session —
 * certaines actions renvoient sur l'adresse nue du dossier, et ramener l'utilisateur sur
 * la synthèse après chaque enregistrement le ferait chercher où il en était.
 */
export default function Onglets({ dossierId, onglets, panneaux, initial }) {
  const cles = onglets.map((o) => o.cle)
  const [actif, setActif] = useState(cles.includes(initial) ? initial : cles[0])

  // Un lien vers un autre onglet du même dossier (?onglet=…) ne remonte pas le composant :
  // on suit donc la valeur reçue du serveur, puis on amène la section visée à l'écran.
  useEffect(() => {
    if (initial && cles.includes(initial)) {
      setActif(initial)
      if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView({ block: 'start' })
      return
    }
    try {
      const garde = sessionStorage.getItem(`onglet:${dossierId}`)
      if (garde && cles.includes(garde)) setActif(garde)
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossierId, initial])

  const choisir = (cle) => {
    setActif(cle)
    try { sessionStorage.setItem(`onglet:${dossierId}`, cle) } catch {}
    const url = new URL(window.location.href)
    url.searchParams.set('onglet', cle)
    // Les messages d'une action (?m=, ?piece=, ?site=…) concernaient l'onglet qu'on quitte.
    for (const k of ['m', 'piece', 'site', 'benef']) url.searchParams.delete(k)
    window.history.replaceState(null, '', url)
  }

  const clavier = (e, i) => {
    const pas = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!pas) return
    e.preventDefault()
    const suivant = cles[(i + pas + cles.length) % cles.length]
    choisir(suivant)
    document.getElementById(`onglet-${suivant}`)?.focus()
  }

  return (
    <>
      <div className="onglets" role="tablist" aria-label="Sections du dossier">
        {onglets.map((o, i) => (
          <button
            key={o.cle}
            id={`onglet-${o.cle}`}
            type="button"
            role="tab"
            aria-selected={actif === o.cle}
            aria-controls={`panneau-${o.cle}`}
            tabIndex={actif === o.cle ? 0 : -1}
            className={actif === o.cle ? 'on' : ''}
            onClick={() => choisir(o.cle)}
            onKeyDown={(e) => clavier(e, i)}
          >
            {o.titre}
            {o.badge ? <span className={`compte ${o.ton || ''}`}>{o.badge}</span> : null}
          </button>
        ))}
      </div>
      {onglets.map((o) => (
        <div key={o.cle} id={`panneau-${o.cle}`} role="tabpanel" aria-labelledby={`onglet-${o.cle}`}
             hidden={actif !== o.cle} className="panneau">
          {panneaux[o.cle]}
        </div>
      ))}
    </>
  )
}
