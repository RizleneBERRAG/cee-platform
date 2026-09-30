'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { db, journaliser } from './db.js'
import { exiger } from './auth.js'
import {
  creerAppel, ajouterDossiers, retirerDossier, majLigne, majEntete, validerAppel, rouvrirAppel,
  emettreFactureAppel, enregistrerPaiement, supprimerAppel, STATUTS_AAP,
} from './aap.js'
import { statuerDossiers } from './statuts-masse.js'

/**
 * Un appel à paiement n'est fait que de montants : il demande le droit de gérer les lots ET
 * celui de voir la marge. Sans le second, un gestionnaire de lots verrait par cet écran les
 * primes que le reste de l'application lui cache.
 */
async function autorise() {
  const u = await exiger('lot.gerer')
  if (!u.permissions.includes('marge.voir')) throw new Error("Action refusée : il vous manque le droit « marge.voir ».")
  return u
}

const txt = (v) => (v === '' || v == null ? null : String(v).trim() || null)
const ici = (id, message) => redirect(`/aap/${id}${message ? `?m=${encodeURIComponent(message)}` : ''}`)
const tracer = (id, champ, ancienne, nouvelle, u) =>
  journaliser({ entite: 'AppelPaiement', entiteId: id, champ, ancienne, nouvelle, utilisateurId: u.id })

export async function creerAppelAction(formData) {
  const u = await autorise()
  const lotId = txt(formData.get('lot_id'))
  const id = creerAppel(db(), { delegataireId: txt(formData.get('delegataire_id')), lotId, par: u.id })
  tracer(id, 'Création', null, lotId ? 'depuis un lot' : 'vide', u)
  revalidatePath('/aap')
  redirect(`/aap/${id}`)
}

export async function ajouterDossiersAction(formData) {
  await autorise()
  const id = String(formData.get('appel_id'))
  const r = ajouterDossiers(db(), id, formData.getAll('dossier_id').map(String))
  revalidatePath(`/aap/${id}`)
  ici(id, [r.ajoutes.length ? `${r.ajoutes.length} dossier(s) ajouté(s).` : null,
    ...r.refuses.map((x) => `${x.numero} refusé : ${x.motif}.`)].filter(Boolean).join(' '))
}

export async function retirerDossierAction(formData) {
  await autorise()
  const id = String(formData.get('appel_id'))
  retirerDossier(db(), id, String(formData.get('dossier_id')))
  revalidatePath(`/aap/${id}`)
}

export async function majLigneAction(formData) {
  await autorise()
  majLigne(db(), String(formData.get('ligne_id')), {
    cumacValide: txt(formData.get('cumac_valide')),
    primeHt: txt(formData.get('prime_ht')),
  })
  revalidatePath(`/aap/${formData.get('appel_id')}`)
}

export async function majEnteteAction(formData) {
  const u = await autorise()
  const id = String(formData.get('id'))
  majEntete(db(), id, {
    numAaf: txt(formData.get('num_aaf')), dateAaf: txt(formData.get('date_aaf')),
    tauxTva: txt(formData.get('taux_tva')), commentaire: txt(formData.get('commentaire')),
    entiteId: txt(formData.get('entite_id')),
  })
  tracer(id, 'En-tête', null, `AAF ${txt(formData.get('num_aaf')) || '—'}`, u)
  revalidatePath(`/aap/${id}`)
  ici(id, 'Enregistré.')
}

export async function changerEtapeAction(formData) {
  const u = await autorise()
  const id = String(formData.get('id'))
  const geste = String(formData.get('geste'))
  const base = db()
  let message = null
  if (geste === 'valider') { validerAppel(base, id); message = 'Appel validé : les montants ne bougent plus.' }
  else if (geste === 'rouvrir') { rouvrirAppel(base, id); message = 'Appel rouvert.' }
  else if (geste === 'emettre') {
    const r = emettreFactureAppel(base, id, { numeroExterne: txt(formData.get('numero_externe')) })
    if (!r.ok) ici(id, `Facture non émise — ${r.motifs.join(' ')}`)
    message = `Facture ${r.numero} émise : paiement en attente.`
  } else if (geste === 'paiement') {
    const ecart = enregistrerPaiement(base, id, { date: txt(formData.get('date_paiement')), montant: txt(formData.get('montant_recu')) })
    message = ecart === 0 ? 'Paiement enregistré : le compte est bon.'
      : `Paiement enregistré, avec un écart de ${ecart.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} € par rapport à la facture.`
  } else if (geste === 'supprimer') {
    supprimerAppel(base, id)
    tracer(id, 'Suppression', null, null, u)
    revalidatePath('/aap')
    redirect('/aap')
  } else throw new Error('Geste inconnu.')
  const statut = base.prepare('SELECT statut FROM appel_paiement WHERE id = ?').get(id)?.statut
  tracer(id, 'Statut', null, STATUTS_AAP[statut]?.libelle || statut, u)
  revalidatePath('/aap')
  revalidatePath(`/aap/${id}`)
  ici(id, message)
}

/** Statuer d'un coup tous les dossiers d'un appel. */
export async function statuerDossiersAppelAction(formData) {
  const u = await autorise()
  const id = String(formData.get('id'))
  const ids = db().prepare('SELECT dossier_id FROM appel_paiement_ligne WHERE appel_id = ?').all(id).map((r) => r.dossier_id)
  const n = statuerDossiers(db(), ids, {
    statut_dossier_id: txt(formData.get('statut_dossier_id')),
    statut_admin_id: txt(formData.get('statut_admin_id')),
    statut_facturation_id: txt(formData.get('statut_facturation_id')),
  }, { utilisateurId: u.id })
  for (const d of ids) revalidatePath(`/dossiers/${d}`)
  ici(id, n ? `${n} changement(s) de statut appliqué(s) sur ${ids.length} dossier(s).`
    : "Aucun changement : aucun statut choisi, ou les dossiers l'avaient déjà.")
}
