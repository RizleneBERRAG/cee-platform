'use server'

/**
 * Les actions du bureau d'études.
 *
 * Deux gestes : enregistrer le dimensionnement, et le porter dans une opération. Le second
 * est séparé du premier à dessein — enregistrer une hypothèse ne doit pas changer la prime.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, journaliser } from '../../../lib/db.js'
import { exiger } from '../../../lib/auth.js'
import { enregistrerReponses, definitionQualification } from '../../../lib/fiche-qualification.js'
import { CHAMPS_DIMENSIONNEMENT, reporterDansOperation } from '../../../lib/dimensionnement.js'
import { synchroniserDossier } from '../../../lib/operations.js'

export async function enregistrerDimensionnement(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('id') || '')

  const valeurs = {}
  for (const cle of CHAMPS_DIMENSIONNEMENT) {
    if (formData.has(cle)) valeurs[cle] = formData.get(cle)
  }

  const r = enregistrerReponses(db(), dossierId, valeurs, u.id)
  revalidatePath(`/dossiers/${dossierId}`)
  if (!r.ok) redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(r.motifs.join(' '))}`)

  journaliser({ entite: 'Dossier', entiteId: dossierId, champ: 'Dimensionnement',
    ancienne: null, nouvelle: `${r.ecrits} valeur(s)`, utilisateurId: u.id })
  redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(
    'Dimensionnement enregistré. Il ne change aucun montant tant qu\'il n\'est pas reporté dans une opération.')}`)
}

export async function reporterDimensionnement(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('id') || '')

  const r = reporterDansOperation(db(), dossierId, {
    typeProduit: String(formData.get('type_produit') || ''),
    typeInstallation: String(formData.get('type_installation') || ''),
    utilisateurId: u.id,
  })

  revalidatePath(`/dossiers/${dossierId}`)
  if (!r.ok) redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(r.motifs.join(' '))}`)

  journaliser({
    entite: 'Dossier', entiteId: dossierId,
    champ: r.creee ? 'Opération créée depuis le dimensionnement' : 'Opération mise à jour depuis le dimensionnement',
    ancienne: null, nouvelle: `${r.puissance} kW`, utilisateurId: u.id,
  })
  // Le total du dossier suit ses opérations : on resynchronise, sans rien figer.
  synchroniserDossier(dossierId, u.id)

  redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(
    `${r.creee ? 'Opération créée' : 'Opération mise à jour'} avec ${r.puissance} kW. `
    + `Le volume cumac est calculé ; les montants ne sont figés que si vous lancez le calcul.`)}`)
}
