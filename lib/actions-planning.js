'use server'

import { revalidatePath } from 'next/cache'
import { db, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import {
  creerIntervention, deplacerIntervention, modifierIntervention, confirmerIntervention,
  annulerIntervention, realiserIntervention, rouvrirIntervention,
} from './planning.js'

/**
 * Les actions du planning. Trois contrôles, toujours dans cet ordre :
 *
 * 1. le droit de modifier un dossier ;
 * 2. la portée — le dossier de l'intervention doit être visible de l'appelant ;
 * 3. sans le droit « planning.tous », on n'organise que SES interventions : on ne touche pas
 *    à celles d'un collègue, et on ne donne pas de travail à quelqu'un d'autre.
 */
const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null)

async function contexte(interventionId = null, dossierId = null) {
  const u = await exiger('dossier.modifier')
  let i = null
  if (interventionId) {
    i = get('SELECT id, dossier_id, attribuee_a, statut FROM intervention WHERE id = ?', [interventionId])
    if (!i) throw new Error('Intervention introuvable.')
    dossierId = i.dossier_id
  }
  exigerPortee(u, dossierId)
  const tous = u.permissions.includes('planning.tous')
  if (i && !tous && i.attribuee_a && i.attribuee_a !== u.id) {
    throw new Error("Cette intervention est attribuée à un collègue : seul un responsable du planning peut la modifier.")
  }
  return { u, i, dossierId, tous }
}

function attributionPermise(ctx, attribueeA) {
  if (!attribueeA || ctx.tous || attribueeA === ctx.u.id) return attribueeA || null
  throw new Error("Vous ne pouvez attribuer une intervention qu'à vous-même.")
}

function noter(dossierId, contenu, u) {
  run('INSERT INTO note (id, dossier_id, canal, contenu, utilisateur_id) VALUES (?,?,?,?,?)',
    [crypto.randomUUID(), dossierId, 'PLANNING', contenu, u.id])
}

function rafraichir(dossierId) {
  revalidatePath('/planning')
  if (dossierId) revalidatePath(`/dossiers/${dossierId}`)
}

export async function creerInterventionAction(formData) {
  const ctx = await contexte(null, String(formData.get('dossier_id') || ''))
  creerIntervention(db(), {
    dossierId: ctx.dossierId,
    typeId: txt(formData.get('type_id')),
    debut: txt(formData.get('debut')),
    fin: txt(formData.get('fin')),
    attribueeA: attributionPermise(ctx, txt(formData.get('attribuee_a'))),
    commentaire: txt(formData.get('commentaire')),
    par: ctx.u.id,
  })
  rafraichir(ctx.dossierId)
}

/**
 * Appelée par le glisser-déposer. Elle RENVOIE l'erreur au lieu de la lever : l'écran
 * l'affiche et remet la carte à sa place, plutôt que de tomber sur une page d'erreur.
 */
export async function deplacerInterventionAction(id, jour, attribueeA) {
  try {
    const ctx = await contexte(id)
    deplacerIntervention(db(), id, { jour, attribueeA: attributionPermise(ctx, attribueeA) })
    rafraichir(ctx.dossierId)
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e.message }
  }
}

export async function modifierInterventionAction(formData) {
  const id = String(formData.get('id') || '')
  const ctx = await contexte(id)
  modifierIntervention(db(), id, {
    debut: txt(formData.get('debut')),
    fin: txt(formData.get('fin')),
    attribueeA: attributionPermise(ctx, txt(formData.get('attribuee_a'))),
    commentaire: txt(formData.get('commentaire')),
  })
  rafraichir(ctx.dossierId)
}

export async function confirmerInterventionAction(formData) {
  const id = String(formData.get('id') || '')
  const ctx = await contexte(id)
  confirmerIntervention(db(), id, { par: ctx.u.id })
  rafraichir(ctx.dossierId)
}

export async function annulerInterventionAction(formData) {
  const id = String(formData.get('id') || '')
  const ctx = await contexte(id)
  const motif = txt(formData.get('motif'))
  const t = get(`SELECT t.libelle FROM intervention i JOIN type_intervention t ON t.id = i.type_id WHERE i.id = ?`, [id])
  annulerIntervention(db(), id, { motif })
  noter(ctx.dossierId, `${t.libelle} annulée${motif ? ` : ${motif}` : '.'}`, ctx.u)
  rafraichir(ctx.dossierId)
}

export async function realiserInterventionAction(formData) {
  const id = String(formData.get('id') || '')
  const ctx = await contexte(id)
  const compteRendu = txt(formData.get('compte_rendu'))
  const t = get(`SELECT t.libelle FROM intervention i JOIN type_intervention t ON t.id = i.type_id WHERE i.id = ?`, [id])
  const date = realiserIntervention(db(), id, { compteRendu })
  if (date) {
    journaliser({ entite: 'Dossier', entiteId: date.dossierId, dossierId: date.dossierId, champ: date.champ,
      ancienne: null, nouvelle: date.nouvelle, utilisateurId: ctx.u.id })
  }
  noter(ctx.dossierId, `${t.libelle} réalisée${compteRendu ? ` : ${compteRendu}` : '.'}`, ctx.u)
  rafraichir(ctx.dossierId)
}

export async function rouvrirInterventionAction(formData) {
  const id = String(formData.get('id') || '')
  const ctx = await contexte(id)
  rouvrirIntervention(db(), id)
  rafraichir(ctx.dossierId)
}
