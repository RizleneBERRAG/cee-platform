'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, journaliser } from './db.js'
import { exiger } from './auth.js'
import { CHAMPS_SOCIETE, enregistrerSociete, logoEnImage } from './societes.js'

const LIBELLES = { ...Object.fromEntries(CHAMPS_SOCIETE.map(([c, l]) => [c, l])), logo: 'Logo', actif: 'Active', par_defaut: 'Par défaut' }

export async function enregistrerSocieteAction(formData) {
  const u = await exiger('referentiel.gerer')
  const id = formData.get('id') ? String(formData.get('id')) : null
  const brut = {}
  for (const [col] of CHAMPS_SOCIETE) if (formData.has(col)) brut[col] = formData.get(col)
  let cible = id, message
  try {
    const fichier = formData.get('logo')
    const logo = formData.get('retirer_logo') ? null
      : fichier && typeof fichier === 'object' && fichier.size > 0 ? logoEnImage(await fichier.arrayBuffer()) : undefined
    const r = enregistrerSociete(db(), id, brut, { logo, parDefaut: !!formData.get('par_defaut'), actif: id ? !!formData.get('actif') : true })
    cible = r.id
    const apres = db().prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(r.id)
    // Le logo est une image intégrée : on trace qu'il a changé, pas son contenu.
    const lisible = (k, ligne) => (k === 'logo' ? (ligne?.logo ? 'logo' : null) : ligne?.[k] ?? null)
    for (const k of r.changes) {
      journaliser({ entite: 'Societe', entiteId: r.id, champ: k === 'création' ? 'Création' : LIBELLES[k] || k,
        ancienne: k === 'création' ? null : lisible(k, r.avant), nouvelle: k === 'création' ? apres.raison_sociale : lisible(k, apres),
        utilisateurId: u.id })
    }
    message = r.changes.length ? 'Enregistré.' : 'Rien à changer.'
  } catch (e) {
    message = `Non enregistré — ${e.message}`
  }
  revalidatePath('/parametrage/societes')
  redirect(`/parametrage/societes?${cible ? `id=${cible}&` : ''}m=${encodeURIComponent(message)}`)
}
