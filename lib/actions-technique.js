'use server'

/**
 * Blocs réglementaires du dossier : documents commerciaux, réseau de chaleur,
 * audit énergétique, contrôles COFRAC.
 *
 * Deux règles communes à tout ce fichier.
 *
 * 1. **Ces blocs ne participent pas au calcul.** Ils ne touchent ni au volume, ni aux
 *    montants, ni à la date de calcul. Un dossier figé peut donc être complété — c'est
 *    même le cas normal : le contrôle a lieu après la pose, longtemps après le calcul.
 *    Le verrou reste respecté, parce qu'il exprime une décision humaine, pas un état.
 * 2. **Chaque écriture est journalisée au niveau du champ.** Ce sont les blocs qu'un
 *    contrôleur viendra relire ; savoir qui a saisi quoi, et quand, fait partie du dossier.
 */
import { revalidatePath } from 'next/cache'
import { all, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import {
  RESEAU_STATUTS, TYPES_AUDIT, ETATS_RAPPORT, MOTEURS_CALCUL,
  MODALITES_CONTROLE, RESULTATS_CONTROLE, valeurDe,
} from './referentiels-technique.js'

const uid = () => crypto.randomUUID()
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const num = (v) => {
  const s = String(v ?? '').trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const bool = (v) => (v ? 1 : 0)
const date = (v) => {
  const s = String(v ?? '').trim().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/** Contrôles communs : droit, portée, verrou. Renvoie l'utilisateur et le dossier. */
async function ouvrir(formData, permission = 'dossier.modifier') {
  const u = await exiger(permission)
  const dossierId = String(formData.get('dossier_id') || '')
  exigerPortee(u, dossierId)
  const d = get('SELECT id, verrouille FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant de le modifier.')
  return { u, dossierId }
}

/** Écrit un champ et le journalise — seulement s'il change réellement. */
function ecrire(table, id, dossierId, champ, label, valeur, avant, utilisateurId) {
  if (String(avant?.[champ] ?? '') === String(valeur ?? '')) return false
  run(`UPDATE ${table} SET ${champ} = ? WHERE id = ?`, [valeur, id])
  journaliser({ entite: table, entiteId: id, dossierId, champ: label, ancienne: avant?.[champ], nouvelle: valeur, utilisateurId })
  return true
}

// ══ Documents commerciaux : devis et facture, séparément ═══════

/**
 * Les deux documents ont leur propre réglage.
 *
 * Un devis « prime déduite » suivi d'une facture « prime non déduite » — ou l'inverse —
 * est une erreur comptable courante. Tant que les deux documents partagent un réglage
 * unique, elle n'est pas seulement impossible à détecter : elle est impossible à
 * représenter, donc invisible. Deux réglages la rendent au moins constatable.
 */
const CHAMPS_DOCS = [
  ['devis_conditions', 'Devis — mentionner les conditions'],
  ['devis_deduire_prime', 'Devis — déduire la prime CEE'],
  ['facture_conditions', 'Facture — mentionner les conditions'],
  ['facture_deduire_prime', 'Facture — déduire la prime CEE'],
]

export async function majDocumentsCommerciaux(formData) {
  const { u, dossierId } = await ouvrir(formData)
  const avant = get('SELECT * FROM dossier WHERE id = ?', [dossierId])
  for (const [champ, label] of CHAMPS_DOCS) {
    ecrire('dossier', dossierId, dossierId, champ, label, bool(formData.get(champ)), avant, u.id)
  }
  revalidatePath(`/dossiers/${dossierId}`)
}

// ══ Réseau public de chaleur ═══════════════════════════════════

const CHAMPS_RESEAU = [
  ['reseau_gestionnaire', 'Réseau — gestionnaire'],
  ['reseau_nom', 'Réseau — nom'],
  ['reseau_exploitant', "Réseau — société d'exploitation"],
]

export async function majReseau(formData) {
  const { u, dossierId } = await ouvrir(formData)
  const avant = get('SELECT * FROM dossier WHERE id = ?', [dossierId])

  ecrire('dossier', dossierId, dossierId, 'reseau_statut', 'Réseau — statut',
    valeurDe(RESEAU_STATUTS, formData.get('reseau_statut')), avant, u.id)
  for (const [champ, label] of CHAMPS_RESEAU) {
    ecrire('dossier', dossierId, dossierId, champ, label, txt(formData.get(champ)), avant, u.id)
  }
  revalidatePath(`/dossiers/${dossierId}`)
}

// ══ Audit énergétique ══════════════════════════════════════════

const CHAMPS_AUDIT = [
  ['bureau_etude', "Audit — bureau d'étude", txt],
  ['auditeur', 'Audit — auditeur', txt],
  ['qualification', 'Audit — qualification', txt],
  ['date_demande', 'Audit — demandé le', date],
  ['date_realisation', 'Audit — réalisé le', date],
  ['numero_audit', "Audit — numéro", txt],
  ['reference_rapport', 'Audit — référence du rapport', txt],
  ['logiciel', 'Audit — logiciel', txt],
  ['editeur_logiciel', 'Audit — éditeur du logiciel', txt],
  ['version_logiciel', 'Audit — version du logiciel', txt],
  ['date_version_logiciel', 'Audit — date de version', date],
  ['cout', "Audit — coût", num],
  ['date_facturation', 'Audit — facturé le', date],
  ['scenario', 'Audit — scénario retenu', txt],
  ['numero_diagnostiqueur', 'Audit — numéro de diagnostiqueur', txt],
]

/**
 * L'audit est créé à la première saisie.
 *
 * On ne crée pas une ligne vide pour chaque dossier : la plupart n'en ont pas besoin, et
 * une ligne vide dans `audit_energetique` se lirait, à tort, comme « audit commencé ».
 */
export async function majAudit(formData) {
  const { u, dossierId } = await ouvrir(formData)

  let a = get('SELECT * FROM audit_energetique WHERE dossier_id = ?', [dossierId])
  if (!a) {
    const nid = uid()
    run('INSERT INTO audit_energetique (id, dossier_id) VALUES (?,?)', [nid, dossierId])
    journaliser({ entite: 'audit_energetique', entiteId: nid, dossierId, champ: 'Audit ouvert', ancienne: null, nouvelle: 'créé', utilisateurId: u.id })
    a = get('SELECT * FROM audit_energetique WHERE id = ?', [nid])
  }

  ecrire('audit_energetique', a.id, dossierId, 'type_audit', "Audit — type",
    valeurDe(TYPES_AUDIT, formData.get('type_audit')), a, u.id)
  ecrire('audit_energetique', a.id, dossierId, 'etat_rapport', 'Audit — état du rapport',
    valeurDe(ETATS_RAPPORT, formData.get('etat_rapport')), a, u.id)
  ecrire('audit_energetique', a.id, dossierId, 'moteur_calcul', 'Audit — moteur de calcul',
    valeurDe(MOTEURS_CALCUL, formData.get('moteur_calcul')), a, u.id)
  for (const [champ, label, conv] of CHAMPS_AUDIT) {
    ecrire('audit_energetique', a.id, dossierId, champ, label, conv(formData.get(champ)), a, u.id)
  }
  revalidatePath(`/dossiers/${dossierId}`)
}

// ══ Contrôles ══════════════════════════════════════════════════

/**
 * Enregistre un passage de contrôle.
 *
 * Le premier passage et le contre-contrôle coexistent : le second **n'écrase pas** le
 * premier. Sinon on perd la trace de la non-conformité initiale et de ce qui a été corrigé
 * — c'est-à-dire précisément ce qu'un contrôleur vient vérifier.
 *
 * La validité de l'accréditation du bureau n'est pas bloquante ici : la saisie doit pouvoir
 * refléter ce qui s'est réellement passé, même si c'est une erreur. L'alerte est affichée
 * sur le dossier, en permanence, tant que l'anomalie n'est pas corrigée.
 */
export async function enregistrerControle(formData) {
  const { u, dossierId } = await ouvrir(formData)

  const passage = Number(formData.get('passage')) === 2 ? 2 : 1
  const valeurs = {
    bureau_controle_id: txt(formData.get('bureau_controle_id')),
    modalite: valeurDe(MODALITES_CONTROLE, formData.get('modalite')) || 'SUR_SITE',
    date: date(formData.get('date')),
    resultat: valeurDe(RESULTATS_CONTROLE, formData.get('resultat')),
    motif: txt(formData.get('motif')),
    montant: num(formData.get('montant')),
    solde_effectue: bool(formData.get('solde_effectue')),
    date_solde: date(formData.get('date_solde')),
  }

  const existant = get('SELECT * FROM controle WHERE dossier_id = ? AND passage = ?', [dossierId, passage])

  if (existant) {
    for (const [champ, v] of Object.entries(valeurs)) {
      ecrire('controle', existant.id, dossierId, champ, `Contrôle ${passage} — ${champ}`, v, existant, u.id)
    }
  } else {
    const nid = uid()
    const cols = ['id', 'dossier_id', 'passage', ...Object.keys(valeurs)]
    run(
      `INSERT INTO controle (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(',')})`,
      [nid, dossierId, passage, ...Object.values(valeurs)]
    )
    journaliser({
      entite: 'controle', entiteId: nid, dossierId,
      champ: passage === 1 ? 'Contrôle — premier passage' : 'Contrôle — contre-contrôle',
      ancienne: null, nouvelle: valeurs.resultat || 'enregistré', utilisateurId: u.id,
    })
  }

  revalidatePath(`/dossiers/${dossierId}`)
}

// ══ Référentiel des bureaux de contrôle ════════════════════════

export async function enregistrerBureau(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const nom = txt(formData.get('nom'))
  const fin = date(formData.get('date_fin_accreditation'))
  const actif = bool(formData.get('actif'))
  if (!nom) return

  if (id) {
    const avant = get('SELECT * FROM bureau_controle WHERE id = ?', [id])
    if (!avant) return
    for (const [champ, label, v] of [
      ['nom', 'Nom', nom],
      ['date_fin_accreditation', "Fin d'accréditation", fin],
      ['actif', 'Actif', actif],
    ]) {
      ecrire('bureau_controle', id, null, champ, label, v, avant, u.id)
    }
  } else {
    const nid = uid()
    run('INSERT INTO bureau_controle (id, nom, date_fin_accreditation, actif) VALUES (?,?,?,?)',
      [nid, nom, fin, actif])
    journaliser({ entite: 'bureau_controle', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: nom, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/controle')
}

/**
 * Désactive un bureau plutôt que de le supprimer dès qu'il a servi.
 *
 * Un bureau supprimé effacerait la référence des contrôles déjà réalisés — donc la preuve
 * qu'ils ont eu lieu, et par qui.
 */
export async function supprimerBureau(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const b = get('SELECT * FROM bureau_controle WHERE id = ?', [id])
  if (!b) return

  const usages = get('SELECT COUNT(*) AS n FROM controle WHERE bureau_controle_id = ?', [id]).n
  if (usages > 0) {
    run('UPDATE bureau_controle SET actif = 0 WHERE id = ?', [id])
    journaliser({ entite: 'bureau_controle', entiteId: id, champ: 'Désactivé', ancienne: 'actif', nouvelle: `${usages} contrôle(s) rattachés`, utilisateurId: u.id })
  } else {
    run('DELETE FROM bureau_controle WHERE id = ?', [id])
    journaliser({ entite: 'bureau_controle', entiteId: id, champ: 'Suppression', ancienne: b.nom, nouvelle: null, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/controle')
}

/** Les bureaux proposés à la saisie : actifs d'abord, accréditation la plus lointaine en tête. */
export async function bureauxActifs() {
  return all('SELECT * FROM bureau_controle ORDER BY actif DESC, nom')
}
