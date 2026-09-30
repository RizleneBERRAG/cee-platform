'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import { CHAMPS_BENEFICIAIRE, TYPES_BENEFICIAIRE, REGIMES_REVENU } from './referentiels-beneficiaire.js'

const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null)

/**
 * Le bénéficiaire ne se modifiait que par l'espace client, sur proposition. Une faute de
 * frappe dans un SIRET relevée par l'ADV devait passer par le client.
 *
 * Le régime de revenu décide du barème (classique, précaire, grande précarité) : il est
 * refusé sur un dossier verrouillé, comme tout ce qui touche au calcul.
 */
export async function majBeneficiaire(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('dossier_id') || '')
  exigerPortee(u, dossierId)

  const d = get('SELECT beneficiaire_id, verrouille FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant de le modifier.')

  const avant = get('SELECT * FROM beneficiaire WHERE id = ?', [d.beneficiaire_id])
  const valeurs = {}
  for (const champ of Object.keys(CHAMPS_BENEFICIAIRE)) {
    if (formData.has(champ)) valeurs[champ] = txt(formData.get(champ))
  }

  const erreur = (m) => redirect(`/dossiers/${dossierId}?onglet=beneficiaire&benef=${encodeURIComponent(m)}`)
  // Une valeur reprise d'un import peut sortir des listes : on la laisse en place, mais on
  // n'accepte d'en changer que pour une valeur connue.
  const change = (champ) => champ in valeurs && String(valeurs[champ] ?? '') !== String(avant[champ] ?? '')
  const type = valeurs.type ?? avant.type
  if (change('type') && !TYPES_BENEFICIAIRE.some(([v]) => v === type)) erreur('Type de bénéficiaire inconnu.')
  if (change('regime_revenu') && !REGIMES_REVENU.some(([v]) => v === valeurs.regime_revenu)) erreur('Régime de revenu inconnu.')
  if (type !== 'PARTICULIER' && 'raison_sociale' in valeurs && !valeurs.raison_sociale) {
    erreur("La raison sociale d'une société ne peut pas rester vide : rien n'a été enregistré.")
  }
  if (valeurs.siret) {
    valeurs.siret = valeurs.siret.replace(/\s/g, '')
    if (!/^\d{14}$/.test(valeurs.siret)) erreur('Le SIRET doit compter 14 chiffres : rien n\'a été enregistré.')
  }

  for (const [champ, valeur] of Object.entries(valeurs)) {
    if (String(avant[champ] ?? '') === String(valeur ?? '')) continue
    run(`UPDATE beneficiaire SET ${champ} = ? WHERE id = ?`, [champ === 'regime_revenu' ? valeur || 'CLASSIQUE' : valeur, d.beneficiaire_id])
    journaliser({
      entite: 'Bénéficiaire', entiteId: d.beneficiaire_id, dossierId, champ: CHAMPS_BENEFICIAIRE[champ],
      ancienne: avant[champ], nouvelle: valeur, utilisateurId: u.id,
    })
  }

  revalidatePath(`/dossiers/${dossierId}`)
}
