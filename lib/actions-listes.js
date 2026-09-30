'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, journaliser } from './db.js'
import { exiger } from './auth.js'
import { LISTES, enregistrerValeur, valeurListe } from './listes.js'

/** Enregistre une valeur d'une liste paramétrable. Les champs propres arrivent préfixés « d_ ». */
export async function enregistrerValeurAction(formData) {
  const u = await exiger('referentiel.gerer')
  const liste = String(formData.get('liste') || '')
  if (!LISTES[liste]) throw new Error('Liste inconnue.')
  const id = formData.get('id') ? String(formData.get('id')) : null
  const donnees = {}
  for (const ch of LISTES[liste].champs) donnees[ch.cle] = formData.get(`d_${ch.cle}`)
  const avant = id ? valeurListe(db(), id) : null
  let message = 'Enregistré.'
  try {
    const nid = enregistrerValeur(db(), liste, {
      id, libelle: formData.get('libelle'), donnees, ordre: formData.get('ordre'),
      actif: id ? !!formData.get('actif') : true, parDefaut: !!formData.get('par_defaut'),
    })
    journaliser({ entite: 'Liste', entiteId: nid, champ: LISTES[liste].titre, ancienne: avant?.libelle ?? null,
      nouvelle: `${formData.get('libelle')}${id && !formData.get('actif') ? ' (désactivé)' : ''}`, utilisateurId: u.id })
  } catch (e) {
    message = `Non enregistré — ${e.message}`
  }
  revalidatePath('/parametrage/listes')
  redirect(`/parametrage/listes?liste=${liste}&m=${encodeURIComponent(message)}`)
}
