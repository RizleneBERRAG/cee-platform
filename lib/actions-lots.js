'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { statuerDossiers } from './statuts-masse.js'

/**
 * « Modification des statuts (dépôt / dossiers) », comme chez Pixel : l'état du lot et le
 * statut de tous ses dossiers, en un geste.
 *
 * Un lot en constitution n'a pas d'état à changer ici : il part par « Déposer le lot », qui
 * contrôle les pièces et verrouille les dossiers. Ce formulaire prend la suite — instruction,
 * validation ou rejet par le délégataire — et c'est lui qui manquait : un lot déposé le
 * restait pour toujours.
 */
const ETATS_APRES_DEPOT = ['DEPOSE', 'INSTRUIT', 'VALIDE', 'REJETE']
const LIBELLES = { DEPOSE: 'Déposé', INSTRUIT: 'En instruction', VALIDE: 'Validé', REJETE: 'Rejeté' }
const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null)

export async function statuerLotAction(formData) {
  const u = await exiger('lot.gerer')
  const lotId = String(formData.get('lot_id'))
  const l = get('SELECT * FROM lot WHERE id = ?', [lotId])
  if (!l) throw new Error('Lot introuvable.')

  const etat = txt(formData.get('etat'))
  const messages = []
  if (etat && etat !== l.statut) {
    if (l.statut === 'EN_CONSTITUTION') throw new Error("Un lot en constitution se dépose d'abord : c'est le dépôt qui contrôle les pièces et verrouille les dossiers.")
    if (!ETATS_APRES_DEPOT.includes(etat)) throw new Error('État de lot inconnu.')
    run('UPDATE lot SET statut = ? WHERE id = ?', [etat, lotId])
    journaliser({ entite: 'Lot', entiteId: lotId, champ: 'État', ancienne: LIBELLES[l.statut] || l.statut, nouvelle: LIBELLES[etat], utilisateurId: u.id })
    messages.push(`Lot passé « ${LIBELLES[etat]} ».`)
  }

  const reference = txt(formData.get('reference_emmy'))
  if (formData.has('reference_emmy') && reference !== (l.reference_emmy || null)) {
    run('UPDATE lot SET reference_emmy = ? WHERE id = ?', [reference, lotId])
    journaliser({ entite: 'Lot', entiteId: lotId, champ: 'Référence EMMY', ancienne: l.reference_emmy, nouvelle: reference, utilisateurId: u.id })
    messages.push('Référence EMMY enregistrée.')
  }

  const ids = db().prepare('SELECT id FROM dossier WHERE lot_id = ?').all(lotId).map((r) => r.id)
  const n = statuerDossiers(db(), ids, {
    statut_dossier_id: txt(formData.get('statut_dossier_id')),
    statut_admin_id: txt(formData.get('statut_admin_id')),
    statut_facturation_id: txt(formData.get('statut_facturation_id')),
  }, { utilisateurId: u.id })
  if (n) messages.push(`${n} changement(s) de statut sur ${ids.length} dossier(s).`)

  revalidatePath(`/lots/${lotId}`)
  revalidatePath('/lots')
  for (const d of ids) revalidatePath(`/dossiers/${d}`)
  redirect(`/lots/${lotId}?m=${encodeURIComponent(messages.join(' ') || 'Rien à changer.')}`)
}
