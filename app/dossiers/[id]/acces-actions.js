'use server'

/**
 * Côté gérant : ouvrir un accès client, le révoquer, arbitrer une proposition.
 *
 * Toutes ces actions passent par `exiger()` : ce sont des opérations du personnel, sur le
 * dossier d'un client. Rien ici n'est atteignable depuis l'espace client.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, journaliser } from '../../../lib/db.js'
import { exiger } from '../../../lib/auth.js'
import { ouvrirAcces, revoquerAcces } from '../../../lib/acces-client.js'
import { arbitrer } from '../../../lib/propositions.js'

export async function creerAccesClient(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('id') || '')

  const { identifiant, code } = ouvrirAcces(db(), dossierId, u.id)
  journaliser({ entite: 'Dossier', entiteId: dossierId, champ: 'Accès client',
    ancienne: null, nouvelle: identifiant, utilisateurId: u.id })

  revalidatePath(`/dossiers/${dossierId}`)
  // Le code ne sera plus jamais lisible : il n'est stocké que sous forme d'empreinte.
  // Il transite donc une seule fois, ici, dans le message de retour.
  redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(
    `Accès créé. Identifiant : ${identifiant} — Code : ${code}. Notez-le : il ne sera plus affiché.`)}`)
}

export async function revoquerAccesClient(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('id') || '')
  const accesId = String(formData.get('acces_id') || '')

  revoquerAcces(db(), accesId, u.id)
  journaliser({ entite: 'Dossier', entiteId: dossierId, champ: 'Accès client révoqué',
    ancienne: accesId, nouvelle: null, utilisateurId: u.id })

  revalidatePath(`/dossiers/${dossierId}`)
  redirect(`/dossiers/${dossierId}?m=${encodeURIComponent('Accès révoqué. La session en cours est coupée.')}`)
}

/**
 * Arbitre une proposition, champ par champ.
 *
 * Le formulaire porte, pour chaque ligne, un choix `decision_<id>` et éventuellement une
 * valeur amendée `valeur_<id>`. Rien n'est appliqué en bloc : c'est tout l'intérêt.
 */
export async function arbitrerProposition(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('id') || '')
  const propositionId = String(formData.get('proposition_id') || '')

  const decisions = {}
  for (const [cle, valeur] of formData.entries()) {
    const m = /^decision_(.+)$/.exec(cle)
    if (!m) continue
    const champId = m[1]
    decisions[champId] = {
      decision: String(valeur),
      valeur: formData.get(`valeur_${champId}`) ?? null,
      motif: String(formData.get(`motif_${champId}`) || '').trim() || null,
    }
  }

  const r = arbitrer(db(), propositionId, decisions, u.id)
  revalidatePath(`/dossiers/${dossierId}`)

  if (!r.ok) {
    redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(r.motifs.join(' '))}`)
  }

  journaliser({ entite: 'Dossier', entiteId: dossierId, champ: 'Proposition client arbitrée',
    ancienne: propositionId, nouvelle: `${r.appliques.length} champ(s) appliqué(s)`, utilisateurId: u.id })

  const message = [
    `${r.appliques.length} modification(s) appliquée(s).`,
    ...r.conflits,
  ].join(' ')
  redirect(`/dossiers/${dossierId}?m=${encodeURIComponent(message)}`)
}
