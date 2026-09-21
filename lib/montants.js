/**
 * L'arithmétique des montants, en un seul endroit et sans aucune dépendance.
 *
 * Ce module est volontairement minuscule et n'importe rien : il est utilisé aussi bien par
 * la projection des dossiers que par les migrations, et une migration ne doit jamais tirer
 * derrière elle la connexion à la base ou le journal.
 *
 * ── Pourquoi une seule fonction d'arrondi ──
 *
 * `ROUND()` de SQLite et `Math.round` de JavaScript ne départagent pas les demis de la même
 * façon. Tant que la reprise arrondissait en SQL et la projection en JS, les deux écritures
 * se battaient d'un centime sur certains dossiers à chaque resynchronisation — un contrôle
 * rouge en permanence, donc un contrôle qu'on finit par ne plus lire. Les deux côtés
 * appellent maintenant cette fonction-ci, et rien d'autre.
 */

/** Arrondi au centime. */
export const arrondi = (n) => Math.round((Number(n) || 0) * 100) / 100

/**
 * Le total d'une colonne sur un ensemble de lignes — vide si aucune ligne ne la renseigne.
 *
 * Zéro et « on ne sait pas » ne sont pas la même chose. Les exports du logiciel précédent
 * ne portent ni prime délégataire, ni commissions, ni marge : additionner du vide donnerait
 * « 0,00 € de marge » sur les 1 677 dossiers, une affirmation chiffrée que rien ne fonde et
 * qu'on lirait comme un fait. Une case vide se remarque et se remplit ; un zéro faux se
 * recopie dans un devis.
 */
export function totalOuVide(lignes, champ) {
  const renseignees = lignes.filter(
    (l) => l[champ] !== null && l[champ] !== undefined && l[champ] !== '')
  if (renseignees.length === 0) return null
  return arrondi(renseignees.reduce((s, l) => s + (Number(l[champ]) || 0), 0))
}
