'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import { creerSav, modifierSav, planifierInterventionSav } from './sav.js'

const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null)
const LIBELLES = {
  type_id: 'Type', motif_id: 'Motif', statut_id: 'Statut', attribue_a: 'Attribué à', probleme: 'Problème',
  observation: 'Observation', date_intervention: "Date d'intervention", cloture: 'Clôturé', regle_le: 'Réglé le',
}

/** Le S.A.V et son dossier, après contrôle du droit et de la portée. */
async function contexte(savId) {
  const u = await exiger('dossier.modifier')
  const v = get('SELECT * FROM sav WHERE id = ?', [savId])
  if (!v) throw new Error('S.A.V introuvable.')
  exigerPortee(u, v.dossier_id)
  return { u, v }
}

export async function creerSavAction(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('dossier_id') || '')
  exigerPortee(u, dossierId)
  const id = creerSav(db(), {
    dossierId, typeId: txt(formData.get('type_id')), motifId: txt(formData.get('motif_id')),
    statutId: txt(formData.get('statut_id')), attribueA: txt(formData.get('attribue_a')) || u.id,
    probleme: txt(formData.get('probleme')), par: u.id,
  })
  const v = get(`SELECT v.numero, m.libelle AS motif FROM sav v LEFT JOIN sav_referentiel m ON m.id = v.motif_id WHERE v.id = ?`, [id])
  journaliser({ entite: 'SAV', entiteId: id, dossierId, champ: 'S.A.V ouvert', ancienne: null, nouvelle: `${v.numero}${v.motif ? ` — ${v.motif}` : ''}`, utilisateurId: u.id })
  revalidatePath(`/dossiers/${dossierId}`)
  revalidatePath('/sav')
  redirect(`/sav/${id}`)
}

export async function modifierSavAction(formData) {
  const { u, v } = await contexte(String(formData.get('id')))
  const changes = modifierSav(db(), v.id, {
    typeId: txt(formData.get('type_id')), motifId: txt(formData.get('motif_id')), statutId: txt(formData.get('statut_id')),
    attribueA: txt(formData.get('attribue_a')), probleme: txt(formData.get('probleme')), observation: txt(formData.get('observation')),
    dateIntervention: txt(formData.get('date_intervention')), regleLe: txt(formData.get('regle_le')),
    cloture: !!formData.get('cloture'),
  })
  const apres = get('SELECT * FROM sav WHERE id = ?', [v.id])
  const lisible = (k, val) => {
    if (val == null || val === '') return null
    if (['type_id', 'motif_id', 'statut_id'].includes(k)) return get('SELECT libelle FROM sav_referentiel WHERE id = ?', [val])?.libelle
    if (k === 'attribue_a') { const p = get('SELECT prenom, nom FROM utilisateur WHERE id = ?', [val]); return p ? `${p.prenom} ${p.nom}` : val }
    if (k === 'cloture') return val ? 'oui' : 'non'
    return val
  }
  for (const k of changes) {
    journaliser({ entite: 'SAV', entiteId: v.id, dossierId: v.dossier_id, champ: `${v.numero} · ${LIBELLES[k]}`,
      ancienne: lisible(k, v[k]), nouvelle: lisible(k, apres[k]), utilisateurId: u.id })
  }
  if (changes.includes('cloture')) {
    run('INSERT INTO note (id, dossier_id, canal, contenu, utilisateur_id) VALUES (?,?,?,?,?)',
      [crypto.randomUUID(), v.dossier_id, 'SAV', `${v.numero} ${apres.cloture ? 'clôturé' : 'rouvert'}${apres.observation ? ` : ${apres.observation}` : '.'}`, u.id])
  }
  revalidatePath(`/sav/${v.id}`)
  revalidatePath('/sav')
  revalidatePath(`/dossiers/${v.dossier_id}`)
  redirect(`/sav/${v.id}?m=${encodeURIComponent(changes.length ? 'Enregistré.' : 'Rien à changer.')}`)
}

export async function planifierSavAction(formData) {
  const { u, v } = await contexte(String(formData.get('id')))
  const attribue = txt(formData.get('attribue_a'))
  if (attribue && attribue !== u.id && !u.permissions.includes('planning.tous')) {
    throw new Error("Vous ne pouvez attribuer une intervention qu'à vous-même.")
  }
  planifierInterventionSav(db(), v.id, { debut: txt(formData.get('debut')), attribueA: attribue, par: u.id })
  journaliser({ entite: 'SAV', entiteId: v.id, dossierId: v.dossier_id, champ: `${v.numero} · Intervention`, ancienne: null,
    nouvelle: txt(formData.get('debut')) || 'à planifier', utilisateurId: u.id })
  revalidatePath('/planning')
  revalidatePath(`/dossiers/${v.dossier_id}`)
  redirect(`/sav/${v.id}?m=${encodeURIComponent('Intervention S.A.V créée au planning.')}`)
}
