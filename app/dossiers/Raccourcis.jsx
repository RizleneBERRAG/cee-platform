'use client'

import { useEffect } from 'react'

/**
 * Deux raccourcis, pas plus.
 *
 * Dans un outil ouvert toute la journée, la barre de recherche est la première chose qu'on
 * veut atteindre. « / » l'atteint sans quitter le clavier — c'est la convention de GitHub,
 * Slack et Gmail, donc elle ne s'apprend pas. « Échap » vide et rend la main.
 *
 * Volontairement aucun autre : un raccourci qu'on n'attend pas est un piège, pas un gain.
 */
export default function Raccourcis() {
  useEffect(() => {
    const champ = () => document.querySelector('input[name="q"]')

    const surTouche = (e) => {
      const cible = e.target
      const dansUnChamp = cible instanceof HTMLElement &&
        (/^(INPUT|TEXTAREA|SELECT)$/.test(cible.tagName) || cible.isContentEditable)

      if (e.key === '/' && !dansUnChamp && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const c = champ()
        if (!c) return
        e.preventDefault()
        c.focus()
        c.select()
        return
      }

      if (e.key === 'Escape' && cible === champ()) {
        cible.value = ''
        cible.blur()
      }
    }

    window.addEventListener('keydown', surTouche)
    return () => window.removeEventListener('keydown', surTouche)
  }, [])

  return null
}
