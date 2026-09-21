'use server'

/**
 * Parcours commercial : qui a vendu, quand, par quel canal.
 *
 * Rien ici n'entre dans le calcul de la marge. C'est délibéré : un taux de commission saisi
 * sur un intervenant reste **indicatif**, et la commission qui compte demeure celle portée
 * par l'opération. Deux endroits qui calculent de l'argent finissent toujours par diverger,
 * et c'est celui qu'on a oublié qui fausse les comptes.
 */
import { revalidatePath } from 'next/cache'
import { all, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import {
  ROLES_INTERVENANT, TYPES_LEAD, ETATS_DEVIS, valeurDe, libelleRole,
} from './referentiels-commercial.js'

const uid = () => crypto.randomUUID()
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const num = (v) => {
  const s = String(v ?? '').trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const date = (v) => {
  const s = String(v ?? '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

async function ouvrir(dossierId) {
  const u = await exiger('dossier.modifier')
  exigerPortee(u, dossierId)
  const d = get('SELECT id, verrouille FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant de le modifier.')
  return u
}

// ══ Parcours et devis ══════════════════════════════════════════

const CHAMPS = [
  ['source_lead', 'Source du lead', txt],
  ['campagne', 'Campagne', txt],
  ['date_confirmation', 'Date de confirmation', date],
  ['date_rdv_planifie', 'RDV planifié le', date],
  ['date_rdv_visite', 'RDV visité le', date],
  ['num_devis', 'N° de devis', txt],
  ['date_proposition', 'Date de proposition', date],
  ['date_signature', 'Date de signature', date],
]

export async function majCommercial(formData) {
  const dossierId = String(formData.get('dossier_id') || '')
  const u = await ouvrir(dossierId)
  const avant = get('SELECT * FROM dossier WHERE id = ?', [dossierId])

  const ecrire = (champ, label, valeur) => {
    if (String(avant[champ] ?? '') === String(valeur ?? '')) return
    run(`UPDATE dossier SET ${champ} = ? WHERE id = ?`, [valeur, dossierId])
    journaliser({
      entite: 'Dossier', entiteId: dossierId, dossierId, champ: label,
      ancienne: avant[champ], nouvelle: valeur, utilisateurId: u.id,
    })
  }

  ecrire('type_lead', 'Type de lead', valeurDe(TYPES_LEAD, formData.get('type_lead')))
  ecrire('etat_devis', 'État du devis', valeurDe(ETATS_DEVIS, formData.get('etat_devis')))
  ecrire('rdv_confirme', 'RDV confirmé', formData.get('rdv_confirme') ? 1 : 0)
  for (const [champ, label, conv] of CHAMPS) {
    if (!formData.has(champ)) continue
    ecrire(champ, label, conv(formData.get(champ)))
  }

  revalidatePath(`/dossiers/${dossierId}`)
}

// ══ Intervenants ═══════════════════════════════════════════════

/**
 * Rattache une personne à un dossier, dans un rôle.
 *
 * Interne ou externe : un télé-opérateur de plateau n'a pas de compte sur la plateforme.
 * Exiger un compte reviendrait à perdre l'information — on accepte donc un nom libre, et
 * l'écran distingue les deux pour qu'on ne confonde pas « collaborateur » et « saisie ».
 */
export async function ajouterIntervenant(formData) {
  const dossierId = String(formData.get('dossier_id') || '')
  const u = await ouvrir(dossierId)

  const role = valeurDe(ROLES_INTERVENANT, formData.get('role'))
  if (!role) throw new Error('Rôle inconnu.')

  const utilisateurId = txt(formData.get('utilisateur_id'))
  const nomLibre = txt(formData.get('nom'))
  if (!utilisateurId && !nomLibre) {
    throw new Error('Choisissez un collaborateur, ou saisissez un nom si la personne n\'a pas de compte.')
  }

  // Un compte a toujours raison sur un nom tapé à la main : on ne garde pas les deux,
  // sinon le même intervenant existe sous deux formes et les statistiques se dédoublent.
  const utilisateur = utilisateurId ? get('SELECT id, nom, prenom, unite_affaire_id FROM utilisateur WHERE id = ?', [utilisateurId]) : null

  const id = uid()
  run(`INSERT INTO dossier_intervenant (id, dossier_id, role, utilisateur_id, nom, unite_affaire_id, taux_commission)
       VALUES (?,?,?,?,?,?,?)`,
    [id, dossierId, role, utilisateur?.id ?? null,
     utilisateur ? null : nomLibre,
     utilisateur?.unite_affaire_id ?? txt(formData.get('unite_affaire_id')),
     num(formData.get('taux_commission'))])

  journaliser({
    entite: 'Intervenant', entiteId: id, dossierId,
    champ: `${libelleRole(role)} rattaché`,
    ancienne: null,
    nouvelle: utilisateur ? `${utilisateur.prenom} ${utilisateur.nom}` : nomLibre,
    utilisateurId: u.id,
  })
  revalidatePath(`/dossiers/${dossierId}`)
}

export async function retirerIntervenant(formData) {
  const id = String(formData.get('id') || '')
  const i = get('SELECT * FROM dossier_intervenant WHERE id = ?', [id])
  if (!i) throw new Error('Intervenant introuvable.')
  const u = await ouvrir(i.dossier_id)

  const nom = i.utilisateur_id
    ? get('SELECT prenom || \' \' || nom AS n FROM utilisateur WHERE id = ?', [i.utilisateur_id])?.n
    : i.nom

  run('DELETE FROM dossier_intervenant WHERE id = ?', [id])
  journaliser({
    entite: 'Intervenant', entiteId: id, dossierId: i.dossier_id,
    champ: `${libelleRole(i.role)} retiré`, ancienne: nom, nouvelle: null, utilisateurId: u.id,
  })
  revalidatePath(`/dossiers/${i.dossier_id}`)
}
