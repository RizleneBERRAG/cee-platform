'use server'

/**
 * Les actions de l'espace client.
 *
 * Tout ici part du principe que le visiteur n'est **pas** de confiance : il n'a ni compte,
 * ni rôle, ni permission. Chaque action relit sa session en base, retrouve le dossier par
 * cette session — jamais par un identifiant passé dans le formulaire — et ne peut écrire
 * que dans `proposition`. Aucune de ces actions ne touche au dossier.
 */
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { db } from '../../lib/db.js'
import {
  verifierAcces, ouvrirSessionClient, sessionClient, fermerSessionClient,
  COOKIE_CLIENT, DUREE_SESSION_CLIENT_HEURES,
} from '../../lib/acces-client.js'
import { soumettre, champsClient } from '../../lib/propositions.js'
import { AGES_BATIMENT, TYPES_CHAUFFAGE } from '../../lib/referentiels-site.js'

const REFERENTIELS = { agesBatiment: AGES_BATIMENT, typesChauffage: TYPES_CHAUFFAGE }

function retour(message) {
  redirect(`/espace${message ? `?m=${encodeURIComponent(message)}` : ''}`)
}

/** L'accès du visiteur en cours, ou null. À appeler dans chaque page et chaque action. */
export async function accesCourant() {
  const jeton = (await cookies()).get(COOKIE_CLIENT)?.value
  return sessionClient(db(), jeton)
}

export async function connexionClient(formData) {
  const identifiant = String(formData.get('identifiant') || '').trim()
  const code = String(formData.get('code') || '').trim()

  // `verifierAcces` calcule l'empreinte même quand l'identifiant est inconnu : sans cela,
  // le temps de réponse trahirait les identifiants qui existent.
  const acces = verifierAcces(db(), identifiant, code)
  if (!acces) {
    // Message unique : dire lequel des deux est faux aiderait surtout celui qui cherche.
    retour('Identifiant ou code incorrect.')
  }

  const { id, expire } = ouvrirSessionClient(db(), acces.id, null)
  const c = await cookies()
  c.set(COOKIE_CLIENT, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/espace',
    expires: new Date(expire),
  })
  redirect('/espace/dossier')
}

export async function deconnexionClient() {
  const c = await cookies()
  fermerSessionClient(db(), c.get(COOKIE_CLIENT)?.value)
  c.delete(COOKIE_CLIENT)
  redirect('/espace')
}

export async function soumettreProposition(formData) {
  const acces = await accesCourant()
  if (!acces) redirect('/espace')

  const valeurs = {}
  for (const def of champsClient(REFERENTIELS)) {
    // Seuls les champs de la liste blanche sont même LUS du formulaire. Un champ ajouté
    // à la main dans le HTML de la page n'atteint donc jamais la couche métier.
    if (!formData.has(def.champ)) {
      // Une liste de cases à cocher entièrement décochée n'envoie AUCUNE clé. Sans ce
      // cas, décocher toutes les activités ne déclarerait rien et l'ancienne réponse
      // survivrait sans que le client comprenne pourquoi.
      if (def.definition?.type === 'choix_multiple') valeurs[def.champ] = []
      continue
    }
    valeurs[def.champ] = def.definition?.type === 'choix_multiple'
      ? formData.getAll(def.champ)
      : formData.get(def.champ)
  }

  const r = soumettre(db(), {
    dossierId: acces.dossier_id,
    accesId: acces.id,
    valeurs,
    message: String(formData.get('message') || '').trim() || null,
    referentiels: REFERENTIELS,
  })

  revalidatePath('/espace/dossier')
  if (!r.ok) {
    redirect(`/espace/dossier?m=${encodeURIComponent(r.motifs.join(' '))}`)
  }
  redirect(`/espace/dossier?m=${encodeURIComponent(
    `Merci. ${r.champs} modification(s) transmises. Elles seront examinées avant d'être appliquées.`)}`)
}
