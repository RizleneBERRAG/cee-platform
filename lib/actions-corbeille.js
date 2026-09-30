'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import { mettreALaCorbeille, recuperer, supprimerDefinitivement } from './corbeille.js'
import { effacerSiOrphelin } from './fichiers.js'

const vers = (m) => redirect(`/corbeille?m=${encodeURIComponent(m)}`)

export async function mettreALaCorbeilleAction(formData) {
  const u = await exiger('dossier.supprimer')
  const id = String(formData.get('dossier_id') || '')
  exigerPortee(u, id)
  try {
    mettreALaCorbeille(db(), id, { motif: formData.get('motif'), par: u.id })
  } catch (e) {
    redirect(`/dossiers/${id}?m=${encodeURIComponent(e.message)}`)
  }
  const numero = db().prepare('SELECT numero FROM dossier WHERE id = ?').get(id)?.numero
  revalidatePath('/', 'layout')
  vers(`${numero} est dans la corbeille. Il n'apparaît plus nulle part ; « Récupérer » le remet tel quel.`)
}

/** Un ou plusieurs dossiers (cases cochées). La portée est vérifiée pour chacun. */
export async function recupererAction(formData) {
  const u = await exiger('dossier.supprimer')
  const ids = formData.getAll('dossier_id').map(String)
  for (const id of ids) { exigerPortee(u, id, { corbeille: true }); recuperer(db(), id, { par: u.id }) }
  revalidatePath('/', 'layout')
  vers(ids.length ? `${ids.length} dossier(s) récupéré(s).` : 'Aucun dossier coché.')
}

export async function supprimerDefinitivementAction(formData) {
  const u = await exiger('dossier.supprimer')
  const ids = formData.getAll('dossier_id').map(String)
  if (!ids.length) vers('Aucun dossier coché.')
  if (formData.get('confirme') !== 'oui') vers("Suppression définitive non faite : cochez la case de confirmation. Elle ne se rattrape pas.")
  const faits = [], refus = []
  for (const id of ids) {
    exigerPortee(u, id, { corbeille: true })
    try {
      const r = supprimerDefinitivement(db(), id, { par: u.id })
      for (const f of r.orphelins) effacerSiOrphelin(f.empreinte, f.extension, false)
      faits.push(r.numero)
    } catch (e) {
      const numero = db().prepare('SELECT numero FROM dossier WHERE id = ?').get(id)?.numero || id
      refus.push(`${numero} — ${e.message.replace(/^Suppression définitive impossible : /, '')}`)
    }
  }
  revalidatePath('/', 'layout')
  vers([faits.length ? `${faits.length} dossier(s) supprimé(s) définitivement : ${faits.join(', ')}.` : null,
    refus.length ? `Refusé : ${refus.join(' | ')}` : null].filter(Boolean).join(' '))
}
