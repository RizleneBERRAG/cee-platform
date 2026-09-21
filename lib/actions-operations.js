'use server'

/**
 * Écriture des chantiers et des opérations.
 *
 * Une règle tient tout le fichier : **toute écriture se termine par `synchroniserDossier`.**
 * C'est elle qui garantit que les totaux du dossier restent la somme de ses opérations
 * figées — donc que la recherche, les exports et le tableau de bord, qui lisent le dossier,
 * disent la vérité. Un chemin d'écriture qui l'oublierait créerait un écart de marge
 * invisible : c'est le seul vrai danger de ce modèle, et il se traite en un seul endroit.
 */
import { revalidatePath } from 'next/cache'
import { all, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { exigerPortee } from './garde.js'
import { deal as lireDeal } from './queries.js'
import {
  operation as lireOperation, operationsDuDossier, chantierPrincipal,
  calculerOperation, figerOperation, synchroniserDossier,
} from './operations.js'

const uid = () => crypto.randomUUID()
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const num = (v) => {
  const s = String(v ?? '').trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Droit, portée, verrou — dans cet ordre, à chaque entrée. */
async function ouvrir(dossierId, permission = 'dossier.modifier') {
  const u = await exiger(permission)
  exigerPortee(u, dossierId)
  const d = get('SELECT id, verrouille FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant de le modifier.')
  return u
}

/** La version de fiche en vigueur à une date, sinon la plus récente. */
function versionApplicable(ficheId, date) {
  const jour = String(date || new Date().toISOString()).slice(0, 10)
  return get(`SELECT * FROM fiche_version
              WHERE fiche_id = ? AND date_effet <= ?
                AND (date_fin IS NULL OR date_fin >= ?)
              ORDER BY date_effet DESC LIMIT 1`, [ficheId, jour, jour])
    || get('SELECT * FROM fiche_version WHERE fiche_id = ? ORDER BY date_effet DESC LIMIT 1', [ficheId])
}

// ══ Opérations ═════════════════════════════════════════════════

export async function ajouterOperation(formData) {
  const dossierId = String(formData.get('dossier_id') || '')
  const u = await ouvrir(dossierId)

  const ficheId = txt(formData.get('fiche_id'))
  if (!ficheId) throw new Error('Une opération doit porter une fiche.')

  const d = get('SELECT date_engagement FROM dossier WHERE id = ?', [dossierId])
  const fv = versionApplicable(ficheId, d?.date_engagement)
  if (!fv) throw new Error("Cette fiche n'a aucune version publiée.")

  const chantierId = txt(formData.get('chantier_id')) || chantierPrincipal(dossierId)?.id || null
  const ordre = (get('SELECT COALESCE(MAX(ordre), 0) AS n FROM operation WHERE dossier_id = ?', [dossierId]).n) + 1

  const id = uid()
  run(`INSERT INTO operation (
         id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id, charte,
         produit_id, installateur_id, quantite, unite, puv, cout_pose, taux_apporteur,
         type_produit, type_installation
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, dossierId, chantierId, ordre, ficheId, fv.id,
     txt(formData.get('charte')) === 'CDP' ? 'CDP' : 'HORS_CDP',
     txt(formData.get('produit_id')), txt(formData.get('installateur_id')),
     num(formData.get('quantite')) ?? 0, txt(formData.get('unite')) || fv.unite_variable,
     num(formData.get('puv')), num(formData.get('cout_pose')) ?? 0, num(formData.get('taux_apporteur')) ?? 0,
     ['AGRICOLE', 'FORESTIER'].includes(String(formData.get('type_produit'))) ? String(formData.get('type_produit')) : null,
     ['SYSTEME_COMPLET', 'TOITURE_COUPLEE'].includes(String(formData.get('type_installation'))) ? String(formData.get('type_installation')) : null])

  const f = get('SELECT code FROM fiche WHERE id = ?', [ficheId])
  journaliser({
    entite: 'Operation', entiteId: id, dossierId, champ: 'Opération ajoutée',
    ancienne: null, nouvelle: `${f?.code} (${fv.version})`, utilisateurId: u.id,
  })

  // L'opération neuve n'est pas figée : les totaux du dossier ne bougent pas. C'est voulu.
  synchroniserDossier(dossierId, u.id)
  revalidatePath(`/dossiers/${dossierId}`)
}

const CHAMPS_OPERATION = [
  ['charte', 'Charte', (v) => (String(v) === 'CDP' ? 'CDP' : 'HORS_CDP')],
  ['chantier_id', 'Chantier', txt],
  ['produit_id', 'Produit', txt],
  ['installateur_id', 'Installateur', txt],
  ['quantite', 'Quantité', (v) => num(v) ?? 0],
  ['unite', 'Unité', txt],
  ['puv', 'Prix unitaire de vente (€)', num],
  ['cout_pose', 'Coût de pose (€)', (v) => num(v) ?? 0],
  ['taux_apporteur', "Taux d'apporteur (%)", (v) => num(v) ?? 0],
  // Critères de barème. `txt` renvoie null sur une chaîne vide : « sans objet » reste
  // vide, et le calcul refusera de conclure plutôt que de retenir un barème au hasard.
  ['type_produit', 'Produit séché', (v) => (['AGRICOLE', 'FORESTIER'].includes(String(v)) ? String(v) : null)],
  ['type_installation', "Type d'installation",
    (v) => (['SYSTEME_COMPLET', 'TOITURE_COUPLEE'].includes(String(v)) ? String(v) : null)],
]

export async function majOperation(formData) {
  const id = String(formData.get('id') || '')
  const op = lireOperation(id)
  if (!op) throw new Error('Opération introuvable.')
  const u = await ouvrir(op.dossier_id)

  for (const [champ, label, conv] of CHAMPS_OPERATION) {
    if (!formData.has(champ)) continue
    const valeur = conv(formData.get(champ))
    if (String(op[champ] ?? '') === String(valeur ?? '')) continue
    run(`UPDATE operation SET ${champ} = ? WHERE id = ?`, [valeur, id])
    journaliser({
      entite: 'Operation', entiteId: id, dossierId: op.dossier_id,
      champ: `${op.fiche_code} — ${label}`, ancienne: op[champ], nouvelle: valeur, utilisateurId: u.id,
    })
  }

  // Modifier la quantité ne refige RIEN : les montants restent ceux du dernier calcul,
  // et l'écran signale que l'opération est à recalculer. Sans cela, corriger une faute de
  // frappe réécrirait des montants déjà facturés sans que personne l'ait demandé.
  synchroniserDossier(op.dossier_id, u.id)
  revalidatePath(`/dossiers/${op.dossier_id}`)
}

/**
 * Supprime une opération.
 *
 * Une opération FIGÉE n'est pas supprimée en silence : ses montants sont entrés dans les
 * totaux du dossier, et peut-être dans un lot déposé. La suppression est journalisée avec
 * les montants qu'elle emporte, et les totaux sont recalculés dans la foulée.
 */
export async function supprimerOperation(formData) {
  const id = String(formData.get('id') || '')
  const op = lireOperation(id)
  if (!op) throw new Error('Opération introuvable.')
  const u = await ouvrir(op.dossier_id)

  const restantes = get('SELECT COUNT(*) AS n FROM operation WHERE dossier_id = ?', [op.dossier_id]).n
  if (restantes <= 1) throw new Error("Un dossier garde au moins une opération. Modifiez celle-ci plutôt que de la supprimer.")

  run('DELETE FROM operation WHERE id = ?', [id])
  journaliser({
    entite: 'Operation', entiteId: id, dossierId: op.dossier_id, champ: 'Opération supprimée',
    ancienne: `${op.fiche_code} — ${op.volume_cumac ?? 0} kWh cumac, marge ${op.marge_nette ?? 0} €`,
    nouvelle: null, utilisateurId: u.id,
  })

  synchroniserDossier(op.dossier_id, u.id)
  revalidatePath(`/dossiers/${op.dossier_id}`)
}

/**
 * Valorise une opération, ou toutes celles du dossier.
 *
 * C'est le seul chemin par lequel des montants se figent. Le geste reste explicite :
 * rien ne se recalcule à l'enregistrement d'un champ.
 */
export async function valoriser(formData) {
  const dossierId = String(formData.get('dossier_id') || '')
  const u = await exiger('marge.voir')
  exigerPortee(u, dossierId)
  const d = get('SELECT * FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé.')

  const b = get('SELECT regime_revenu FROM beneficiaire WHERE id = ?', [d.beneficiaire_id])
  const dl = d.deal_id ? lireDeal(d.deal_id) : null

  const cible = txt(formData.get('operation_id'))
  const ops = cible
    ? [lireOperation(cible)].filter((o) => o && o.dossier_id === dossierId)
    : operationsDuDossier(dossierId)

  for (const op of ops) {
    const calcul = calculerOperation(op, {
      deal: dl,
      dateEngagement: d.date_engagement,
      regime: b?.regime_revenu,
      avecMpr: d.avec_mpr,
      destinatairePrime: d.destinataire_prime,
    })
    // ── Ne pas figer ce qui n'est pas calculé ──
    //
    // Si le contrat n'a pas de mode de reversement, la valorisation est indéterminée.
    // La figer écrirait des montants vides par-dessus d'éventuels montants existants, et
    // ferait passer « on ne sait pas » pour « recalculé ». On saute l'opération.
    if (calcul.valorisation?.indetermine) continue
    figerOperation(op, calcul, u.id)
  }

  synchroniserDossier(dossierId, u.id)
  revalidatePath(`/dossiers/${dossierId}`)
  revalidatePath('/')
}

// ══ Chantiers ══════════════════════════════════════════════════

export async function ajouterChantier(formData) {
  const dossierId = String(formData.get('dossier_id') || '')
  const u = await ouvrir(dossierId)

  const adresse = txt(formData.get('adresse'))
  const cp = txt(formData.get('code_postal'))
  const ville = txt(formData.get('ville'))
  if (!adresse || !cp || !ville) throw new Error('Adresse, code postal et ville sont obligatoires.')

  const dept = cp.startsWith('20') ? (Number(cp) < 20200 ? '2A' : '2B') : cp.slice(0, 2)
  const siteId = uid()
  run(`INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique,
                         secteur_activite, surface, type_chauffage, qpv)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [siteId, adresse, cp, ville, dept,
     txt(formData.get('zone_climatique')), txt(formData.get('secteur_activite')),
     num(formData.get('surface')), txt(formData.get('type_chauffage')),
     formData.get('qpv') ? 1 : 0])

  const ordre = (get('SELECT COALESCE(MAX(ordre), 0) AS n FROM chantier WHERE dossier_id = ?', [dossierId]).n) + 1
  const id = uid()
  run(`INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
       VALUES (?,?,?,0,?,?)`,
    [id, dossierId, siteId, txt(formData.get('libelle')) || `Chantier ${ordre}`, ordre])

  journaliser({
    entite: 'Chantier', entiteId: id, dossierId, champ: 'Chantier ajouté',
    ancienne: null, nouvelle: `${adresse}, ${cp} ${ville}`, utilisateurId: u.id,
  })
  revalidatePath(`/dossiers/${dossierId}`)
}

/**
 * Retire un chantier supplémentaire.
 *
 * Le chantier principal n'est jamais retiré : c'est l'adresse du dossier. Un chantier
 * portant des opérations non plus — il faut d'abord les déplacer, faute de quoi elles se
 * retrouveraient sans zone climatique et leur volume deviendrait faux.
 */
export async function supprimerChantier(formData) {
  const id = String(formData.get('id') || '')
  const c = get('SELECT * FROM chantier WHERE id = ?', [id])
  if (!c) throw new Error('Chantier introuvable.')
  const u = await ouvrir(c.dossier_id)

  if (c.principal) throw new Error("Le chantier principal ne peut pas être retiré : c'est l'adresse du dossier.")
  const n = get('SELECT COUNT(*) AS n FROM operation WHERE chantier_id = ?', [id]).n
  if (n > 0) throw new Error(`${n} opération(s) sont posées sur ce chantier. Déplacez-les d'abord.`)

  run('DELETE FROM chantier WHERE id = ?', [id])
  journaliser({
    entite: 'Chantier', entiteId: id, dossierId: c.dossier_id, champ: 'Chantier retiré',
    ancienne: c.libelle, nouvelle: null, utilisateurId: u.id,
  })
  revalidatePath(`/dossiers/${c.dossier_id}`)
}

// ══ Catalogue produits ═════════════════════════════════════════

export async function enregistrerProduit(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const designation = txt(formData.get('designation'))
  if (!designation) return

  const champs = [
    txt(formData.get('marque')), txt(formData.get('reference')), designation,
    txt(formData.get('description')), txt(formData.get('unite')),
    txt(formData.get('fiche_id')), formData.get('actif') ? 1 : 0,
  ]

  if (id) {
    run(`UPDATE produit SET marque=?, reference=?, designation=?, description=?, unite=?, fiche_id=?, actif=?
         WHERE id = ?`, [...champs, id])
    journaliser({ entite: 'Produit', entiteId: id, champ: 'Modification', ancienne: null, nouvelle: designation, utilisateurId: u.id })
  } else {
    const nid = uid()
    run(`INSERT INTO produit (id, marque, reference, designation, description, unite, fiche_id, actif)
         VALUES (?,?,?,?,?,?,?,?)`, [nid, ...champs])
    journaliser({ entite: 'Produit', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: designation, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/catalogue')
}

/** Un produit posé sur des dossiers est désactivé, jamais supprimé. */
export async function supprimerProduit(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const p = get('SELECT * FROM produit WHERE id = ?', [id])
  if (!p) return

  const n = get('SELECT COUNT(*) AS n FROM operation WHERE produit_id = ?', [id]).n
  if (n > 0) {
    run('UPDATE produit SET actif = 0 WHERE id = ?', [id])
    journaliser({ entite: 'Produit', entiteId: id, champ: 'Désactivé', ancienne: 'actif', nouvelle: `${n} opération(s)`, utilisateurId: u.id })
  } else {
    run('DELETE FROM produit WHERE id = ?', [id])
    journaliser({ entite: 'Produit', entiteId: id, champ: 'Suppression', ancienne: p.designation, nouvelle: null, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/catalogue')
}
