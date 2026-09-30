'use server'

import { revalidatePath } from 'next/cache'
import { get, run } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import { MOTIFS } from './rappels.js'

const uid = () => crypto.randomUUID()
const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null)

/** « 2026-10-01T09:30 » ou « 2026-10-01 » ; toute autre forme est refusée plutôt que devinée. */
function dateValide(v) {
  const s = txt(v)
  if (!s || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s)) throw new Error('Date de rappel invalide.')
  return s
}

function utilisateurValide(id) {
  if (!id) return null
  if (!get('SELECT 1 AS ok FROM utilisateur WHERE id = ? AND actif = 1', [id])) throw new Error('Utilisateur inconnu.')
  return id
}

/** Relit le rappel et vérifie que son dossier est dans la portée de l'appelant. */
function rappelDansPortee(u, id) {
  const r = get('SELECT id, dossier_id, fait_le FROM rappel WHERE id = ?', [id])
  if (!r) throw new Error('Rappel introuvable.')
  exigerPortee(u, r.dossier_id)
  return r
}

function rafraichir(dossierId) {
  revalidatePath('/rappels')
  revalidatePath(`/dossiers/${dossierId}`)
  revalidatePath('/', 'layout')
}

export async function creerRappel(formData) {
  const u = await exiger('dossier.voir')
  const dossierId = formData.get('dossier_id')
  exigerPortee(u, dossierId)
  const motif = txt(formData.get('motif'))
  if (!MOTIFS.includes(motif)) throw new Error('Motif inconnu.')
  // Sans attribution explicite, le rappel revient à celui qui le crée : un rappel
  // « à personne » est un rappel que personne ne fera.
  const attribue = formData.has('attribue_a') ? utilisateurValide(txt(formData.get('attribue_a'))) : u.id
  run(`INSERT INTO rappel (id, dossier_id, date_rappel, motif, commentaire, attribue_a, cree_par)
       VALUES (?,?,?,?,?,?,?)`,
    [uid(), dossierId, dateValide(formData.get('date_rappel')), motif, txt(formData.get('commentaire')), attribue, u.id])
  rafraichir(dossierId)
}

/** Clôture. Le compte rendu, s'il y en a un, est aussi versé aux notes du dossier. */
export async function terminerRappel(formData) {
  const u = await exiger('dossier.voir')
  const r = rappelDansPortee(u, formData.get('id'))
  if (r.fait_le) return
  const compteRendu = txt(formData.get('compte_rendu'))
  run(`UPDATE rappel SET fait_le = datetime('now'), fait_par = ?, compte_rendu = ? WHERE id = ?`, [u.id, compteRendu, r.id])
  const motif = get('SELECT motif FROM rappel WHERE id = ?', [r.id]).motif
  run('INSERT INTO note (id, dossier_id, canal, contenu, utilisateur_id) VALUES (?,?,?,?,?)',
    [uid(), r.dossier_id, 'RAPPEL', `Rappel « ${motif} » fait${compteRendu ? ` : ${compteRendu}` : '.'}`, u.id])
  rafraichir(r.dossier_id)
}

/** Reporter : change la date d'un rappel ouvert, et trace l'ancienne dans le commentaire. */
export async function reporterRappel(formData) {
  const u = await exiger('dossier.voir')
  const r = rappelDansPortee(u, formData.get('id'))
  if (r.fait_le) throw new Error('Ce rappel est déjà fait.')
  const nouvelle = dateValide(formData.get('date_rappel'))
  const avant = get('SELECT date_rappel, commentaire FROM rappel WHERE id = ?', [r.id])
  const trace = `Reporté du ${avant.date_rappel.replace('T', ' ')}`
  run('UPDATE rappel SET date_rappel = ?, commentaire = ? WHERE id = ?',
    [nouvelle, avant.commentaire ? `${avant.commentaire}\n${trace}` : trace, r.id])
  rafraichir(r.dossier_id)
}

export async function attribuerRappel(formData) {
  const u = await exiger('dossier.voir')
  const r = rappelDansPortee(u, formData.get('id'))
  run('UPDATE rappel SET attribue_a = ? WHERE id = ?', [utilisateurValide(txt(formData.get('attribue_a'))), r.id])
  rafraichir(r.dossier_id)
}

/** Rouvre un rappel clos par erreur. La note versée au dossier reste : elle a eu lieu. */
export async function rouvrirRappel(formData) {
  const u = await exiger('dossier.voir')
  const r = rappelDansPortee(u, formData.get('id'))
  run('UPDATE rappel SET fait_le = NULL, fait_par = NULL WHERE id = ?', [r.id])
  rafraichir(r.dossier_id)
}
