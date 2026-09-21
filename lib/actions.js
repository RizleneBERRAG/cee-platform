'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { all, get, run, journaliser } from './db.js'
import { dossier as lireDossier, calculDossier } from './queries.js'
import { importerDossiersCsv } from './import-dossiers.js'
import { exiger, utilisateurConnecte } from './auth.js'
import { exigerPortee } from './garde.js'
import { chantierPrincipal } from './operations.js'
import { valoriser } from './actions-operations.js'
import { reprendreDossiersEnOperations } from './migrations-manuelles.js'
import { db as dbBrute } from './db.js'
import { enregistrer, effacerSiOrphelin, poids } from './fichiers.js'

/**
 * Chaque action refait le contrôle de droit côté serveur.
 *
 * Masquer un bouton n'est pas une protection : une action serveur est une adresse HTTP
 * qu'on peut appeler directement. Le contrôle d'affichage sert le confort, celui-ci sert
 * la sécurité — et c'est celui-ci qui fait foi.
 */
/** Le contrôle de portée vit dans lib/garde.js : une seule copie, partagée par tous les fichiers d'actions. */

const uid = () => crypto.randomUUID()
const num = (v) => (v === '' || v == null ? null : Number(v))
const txt = (v) => (v === '' || v == null ? null : String(v))

/** Version de fiche en vigueur à une date donnée, sinon la plus récente. */
function versionPourDate(ficheId, date) {
  const v = get(
    `SELECT * FROM fiche_version
      WHERE fiche_id = ? AND date_effet <= ? AND (date_fin IS NULL OR date_fin > ?)
      ORDER BY date_effet DESC LIMIT 1`,
    [ficheId, date, date]
  )
  return v || get('SELECT * FROM fiche_version WHERE fiche_id = ? ORDER BY date_effet DESC LIMIT 1', [ficheId])
}

export async function creerDossier(formData) {
  const u = await exiger('dossier.creer')
  const f = Object.fromEntries(formData)

  const dateEngagement = txt(f.date_engagement) || new Date().toISOString().slice(0, 10)
  const version = versionPourDate(f.fiche_id, dateEngagement)
  if (!version) throw new Error('Aucune version de fiche disponible pour cette opération.')

  const beneficiaireId = uid()
  run(
    `INSERT INTO beneficiaire (id, type, raison_sociale, siret, code_ape, nom, prenom, email, telephone, regime_revenu)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [beneficiaireId, txt(f.type_beneficiaire) || 'SOCIETE', txt(f.raison_sociale), txt(f.siret), txt(f.code_ape),
     txt(f.nom), txt(f.prenom), txt(f.email), txt(f.telephone), txt(f.regime_revenu) || 'CLASSIQUE']
  )

  const siteId = uid()
  run(
    `INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique, secteur_activite, age_batiment, surface, type_chauffage, qpv)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [siteId, txt(f.adresse) || '—', txt(f.code_postal) || '', txt(f.ville) || '',
     (txt(f.code_postal) || '').slice(0, 2), txt(f.zone_climatique), txt(f.secteur_activite),
     num(f.age_batiment), num(f.surface), txt(f.type_chauffage), f.qpv ? 1 : 0]
  )

  // Numérotation séquentielle par année
  const annee = new Date().getFullYear()
  const dernier = get(
    `SELECT numero FROM dossier WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1`,
    [`D-${annee}-%`]
  )
  const suivant = dernier ? Number(dernier.numero.split('-')[2]) + 1 : 1
  const numero = `D-${annee}-${String(suivant).padStart(5, '0')}`

  const dossierId = uid()
  run(
    `INSERT INTO dossier (id, numero, ref_externe, unite_affaire_id, beneficiaire_id, site_id,
       fiche_id, fiche_version_id, deal_id, delegataire_id, charte, avec_mpr, quantite, source,
       statut_dossier_id, date_engagement)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [dossierId, numero, txt(f.ref_externe), txt(f.unite_affaire_id), beneficiaireId, siteId,
     f.fiche_id, version.id, txt(f.deal_id), txt(f.delegataire_id),
     txt(f.charte) || 'HORS_CDP', f.avec_mpr ? 1 : 0, num(f.quantite) || 0, txt(f.source),
     txt(f.statut_dossier_id), dateEngagement]
  )

  journaliser({
    entite: 'Dossier', entiteId: dossierId, dossierId, champ: 'création',
    ancienne: null, nouvelle: numero, utilisateurId: u?.id,
  })

  revalidatePath('/dossiers')
  revalidatePath('/')
  redirect(`/dossiers/${dossierId}`)
}

/** Champs du dossier modifiables depuis la fiche, avec journalisation champ par champ. */
const CHAMPS_MODIFIABLES = {
  quantite: 'Quantité',
  charte: 'Charte',
  avec_mpr: 'MaPrimeRénov\'',
  source: 'Source',
  ref_externe: 'Référence externe',
  date_engagement: "Date d'engagement",
  date_confirmation: 'Date de confirmation',
  date_pose: 'Date de pose',
  date_controle: 'Date de contrôle',
  date_depot: 'Date de dépôt',
  deal_id: 'Deal',
  statut_dossier_id: 'Statut dossier',
  statut_admin_id: 'Statut administratif',
  statut_facturation_id: 'Statut facturation',
  statut_installation_id: 'Statut installation',
  statut_cofrac_id: 'Contrôle COFRAC',
}

export async function majDossier(formData) {
  const u = await exiger('dossier.modifier')
  const f = Object.fromEntries(formData)
  const id = f.id
  exigerPortee(u, id)
  const avant = get('SELECT * FROM dossier WHERE id = ?', [id])
  if (!avant) throw new Error('Dossier introuvable.')
  if (avant.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant de le modifier.')

  const libelles = libellesStatuts()

  for (const [champ, label] of Object.entries(CHAMPS_MODIFIABLES)) {
    if (!(champ in f)) continue
    let valeur = f[champ]
    if (champ === 'avec_mpr') valeur = f[champ] ? 1 : 0
    else if (champ === 'quantite') valeur = num(valeur) ?? 0
    else valeur = txt(valeur)

    if (String(avant[champ] ?? '') === String(valeur ?? '')) continue

    run(`UPDATE dossier SET ${champ} = ? WHERE id = ?`, [valeur, id])
    journaliser({
      entite: 'Dossier', entiteId: id, dossierId: id, champ: label,
      ancienne: lisible(champ, avant[champ], libelles),
      nouvelle: lisible(champ, valeur, libelles),
      utilisateurId: u?.id,
    })
  }

  // Un changement de date d'engagement peut changer la version de fiche applicable.
  const apres = get('SELECT * FROM dossier WHERE id = ?', [id])
  if (apres.date_engagement !== avant.date_engagement) {
    const v = versionPourDate(apres.fiche_id, apres.date_engagement)
    if (v && v.id !== apres.fiche_version_id) {
      const ancienne = get('SELECT version FROM fiche_version WHERE id = ?', [apres.fiche_version_id])
      run('UPDATE dossier SET fiche_version_id = ? WHERE id = ?', [v.id, id])
      journaliser({
        entite: 'Dossier', entiteId: id, dossierId: id, champ: 'Version de fiche',
        ancienne: ancienne?.version, nouvelle: v.version, utilisateurId: u?.id,
      })
    }
  }

  revalidatePath(`/dossiers/${id}`)
  revalidatePath('/dossiers')
  revalidatePath('/')
}

/**
 * Fige les montants sur le dossier. C'est une action explicite : modifier un deal
 * ou un barème ne recalcule JAMAIS les dossiers existants.
 */
/**
 * Recalcule un dossier.
 *
 * Ne fige plus rien lui-même : il délègue aux opérations, qui sont désormais la source des
 * montants. Deux chemins pour figer de l'argent, c'est un de trop — celui qu'on oublie de
 * corriger devient l'écart de marge que personne ne s'explique.
 *
 * Les paramètres du formulaire (coût de pose, taux d'apporteur) sont portés par l'opération
 * principale, puis TOUTES les opérations du dossier sont valorisées et les totaux remis en
 * accord. Le taux d'apporteur est enfin conservé : jusqu'ici il n'était stocké nulle part,
 * si bien qu'un second recalcul, sans ressaisie, remettait la commission à zéro sans le dire.
 */
export async function recalculer(formData) {
  const u = await exiger('marge.voir')
  const id = String(formData.get('id') || '')
  exigerPortee(u, id)
  const d = get('SELECT id, verrouille FROM dossier WHERE id = ?', [id])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé.')

  // Un dossier antérieur au modèle par opérations n'en a pas encore : on le rattrape.
  chantierPrincipal(id)
  let principale = get('SELECT id FROM operation WHERE dossier_id = ? ORDER BY ordre LIMIT 1', [id])
  if (!principale) {
    reprendreDossiersEnOperations(dbBrute())
    principale = get('SELECT id FROM operation WHERE dossier_id = ? ORDER BY ordre LIMIT 1', [id])
  }

  if (principale) {
    const n = (v) => { const x = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(x) ? x : 0 }
    run('UPDATE operation SET cout_pose = ?, taux_apporteur = ? WHERE id = ?',
      [n(formData.get('cout_pose')), n(formData.get('taux_apporteur')), principale.id])
  }

  const fd = new FormData()
  fd.append('dossier_id', id)
  await valoriser(fd)
}

export async function basculerVerrou(formData) {
  const u = await exiger('dossier.verrouiller')
  const id = formData.get('id')
  exigerPortee(u, id)
  const d = get('SELECT verrouille FROM dossier WHERE id = ?', [id])
  const nouveau = d.verrouille ? 0 : 1
  run('UPDATE dossier SET verrouille = ? WHERE id = ?', [nouveau, id])
  journaliser({
    entite: 'Dossier', entiteId: id, dossierId: id, champ: 'Verrouillage',
    ancienne: d.verrouille ? 'verrouillé' : 'déverrouillé',
    nouvelle: nouveau ? 'verrouillé' : 'déverrouillé', utilisateurId: u?.id,
  })
  revalidatePath(`/dossiers/${id}`)
}

export async function ajouterNote(formData) {
  const u = await exiger('dossier.voir')
  const id = formData.get('dossier_id')
  exigerPortee(u, id)
  const contenu = txt(formData.get('contenu'))
  if (!contenu) return
  run('INSERT INTO note (id, dossier_id, canal, contenu, utilisateur_id) VALUES (?,?,?,?,?)',
    [uid(), id, txt(formData.get('canal')) || 'NOTE', contenu, u?.id])
  revalidatePath(`/dossiers/${id}`)
}

// ── utilitaires ──────────────────────────────────────────────
function libellesStatuts() {
  const map = {}
  for (const s of all('SELECT id, libelle FROM statut')) map[s.id] = s.libelle
  for (const d of all('SELECT id, libelle, version FROM deal')) map[d.id] = `${d.libelle} (${d.version})`
  return map
}

function lisible(champ, valeur, libelles) {
  if (valeur == null || valeur === '') return null
  if (champ.startsWith('statut_') || champ === 'deal_id') return libelles[valeur] || valeur
  if (champ === 'avec_mpr') return valeur ? 'oui' : 'non'
  return String(valeur)
}

// ── Pièces du dossier ────────────────────────────────────────

/**
 * Dépôt d'une pièce, fichier compris.
 *
 * Le contenu est écrit sur le disque sous son empreinte ; la base ne garde que les
 * métadonnées. Un fichier déjà présent à l'identique n'est pas réécrit : c'est courant,
 * la même attestation d'installateur se retrouve sur des dizaines de dossiers.
 */
export async function ajouterDocument(formData) {
  const u = await exiger('piece.deposer')
  const dossierId = String(formData.get('dossier_id') || '')
  const typeId = String(formData.get('type_document_id') || '')
  if (!dossierId || !typeId) return
  exigerPortee(u, dossierId)

  const verrou = get('SELECT verrouille FROM dossier WHERE id = ?', [dossierId])
  if (verrou?.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant d\'ajouter une pièce.')

  const fichier = formData.get('fichier')
  const aUnFichier = fichier && typeof fichier.arrayBuffer === 'function' && fichier.size > 0

  let meta = null
  if (aUnFichier) {
    meta = enregistrer(Buffer.from(await fichier.arrayBuffer()), fichier.name)
    if (meta.erreur) redirect(`/dossiers/${dossierId}?piece=${encodeURIComponent(meta.erreur)}`)
  }

  const nom = meta?.nom || txt(formData.get('nom_fichier')) || 'document.pdf'
  const td = get('SELECT libelle FROM type_document WHERE id = ?', [typeId])

  run(
    `INSERT INTO document_dossier
       (id, dossier_id, type_document_id, nom_fichier, empreinte, taille, type_mime, extension, depose_par)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [uid(), dossierId, typeId, nom, meta?.empreinte || null, meta?.taille || null,
     meta?.mime || null, meta?.extension || null, u.id]
  )
  journaliser({
    entite: 'Dossier', entiteId: dossierId, dossierId, champ: 'Pièce ajoutée',
    ancienne: null,
    nouvelle: meta ? `${td?.libelle} — ${nom} (${poids(meta.taille)})` : `${td?.libelle} — ${nom} (sans fichier)`,
    utilisateurId: u.id,
  })
  revalidatePath(`/dossiers/${dossierId}`)
}

export async function validerDocument(formData) {
  const u = await exiger('piece.valider')
  const id = formData.get('document_id')
  const doc = get('SELECT dd.*, td.libelle FROM document_dossier dd JOIN type_document td ON td.id = dd.type_document_id WHERE dd.id = ?', [id])
  if (!doc) return
  exigerPortee(u, doc.dossier_id)
  const nouveau = doc.valide_par_delegataire ? 0 : 1
  run('UPDATE document_dossier SET valide_par_delegataire = ? WHERE id = ?', [nouveau, id])
  journaliser({
    entite: 'Dossier', entiteId: doc.dossier_id, dossierId: doc.dossier_id,
    champ: 'Validation délégataire',
    ancienne: `${doc.libelle} : ${doc.valide_par_delegataire ? 'validée' : 'en attente'}`,
    nouvelle: `${doc.libelle} : ${nouveau ? 'validée' : 'en attente'}`,
    utilisateurId: u?.id,
  })
  revalidatePath(`/dossiers/${doc.dossier_id}`)
}

export async function supprimerDocument(formData) {
  const u = await exiger('piece.deposer')
  const id = formData.get('document_id')
  const doc = get('SELECT dd.*, td.libelle FROM document_dossier dd JOIN type_document td ON td.id = dd.type_document_id WHERE dd.id = ?', [id])
  if (!doc) return
  exigerPortee(u, doc.dossier_id)
  run('DELETE FROM document_dossier WHERE id = ?', [id])

  // Le fichier est partagé entre toutes les pièces de même empreinte : on ne l'efface
  // du disque que lorsque plus aucune ligne ne s'y réfère.
  if (doc.empreinte) {
    const restantes = get('SELECT COUNT(*) AS n FROM document_dossier WHERE empreinte = ?', [doc.empreinte]).n
    effacerSiOrphelin(doc.empreinte, doc.extension, restantes > 0)
  }

  journaliser({
    entite: 'Dossier', entiteId: doc.dossier_id, dossierId: doc.dossier_id, champ: 'Pièce retirée',
    ancienne: `${doc.libelle} — ${doc.nom_fichier}`, nouvelle: null, utilisateurId: u?.id,
  })
  revalidatePath(`/dossiers/${doc.dossier_id}`)
}

// ── Lots de dépôt ────────────────────────────────────────────

export async function creerLot(formData) {
  const u = await exiger('lot.gerer')
  const organisme = txt(formData.get('organisme'))
  const annee = new Date().getFullYear()
  const dernier = get(`SELECT numero FROM lot WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1`, [`LOT-${annee}-%`])
  const suivant = dernier ? Number(dernier.numero.split('-')[2]) + 1 : 1
  const numero = `LOT-${annee}-${String(suivant).padStart(3, '0')}`
  const lotId = uid()
  run('INSERT INTO lot (id, numero, organisme, statut) VALUES (?,?,?,?)', [lotId, numero, organisme, 'EN_CONSTITUTION'])
  journaliser({ entite: 'Lot', entiteId: lotId, champ: 'création', ancienne: null, nouvelle: numero, utilisateurId: u?.id })
  revalidatePath('/lots')
  redirect(`/lots/${lotId}`)
}

export async function affecterAuLot(formData) {
  const u = await exiger('lot.gerer')
  const lotId = formData.get('lot_id')
  const ids = formData.getAll('dossier_id')
  const l = get('SELECT numero, statut FROM lot WHERE id = ?', [lotId])
  if (!l || l.statut !== 'EN_CONSTITUTION') throw new Error('Lot déjà déposé : il ne peut plus être modifié.')
  for (const id of ids) {
    run('UPDATE dossier SET lot_id = ? WHERE id = ? AND lot_id IS NULL', [lotId, id])
    journaliser({ entite: 'Dossier', entiteId: id, dossierId: id, champ: 'Lot de dépôt', ancienne: null, nouvelle: l.numero, utilisateurId: u?.id })
  }
  majTotauxLot(lotId)
  revalidatePath(`/lots/${lotId}`)
  revalidatePath('/lots')
}

export async function retirerDuLot(formData) {
  const u = await exiger('lot.gerer')
  const id = formData.get('dossier_id')
  const d = get('SELECT lot_id FROM dossier WHERE id = ?', [id])
  const l = d?.lot_id ? get('SELECT numero, statut FROM lot WHERE id = ?', [d.lot_id]) : null
  if (!l || l.statut !== 'EN_CONSTITUTION') throw new Error('Lot déjà déposé.')
  run('UPDATE dossier SET lot_id = NULL WHERE id = ?', [id])
  journaliser({ entite: 'Dossier', entiteId: id, dossierId: id, champ: 'Lot de dépôt', ancienne: l.numero, nouvelle: null, utilisateurId: u?.id })
  majTotauxLot(d.lot_id)
  revalidatePath(`/lots/${d.lot_id}`)
}

export async function deposerLot(formData) {
  const u = await exiger('lot.deposer')
  const lotId = formData.get('lot_id')
  majTotauxLot(lotId)
  const aujourdhui = new Date().toISOString().slice(0, 10)
  run('UPDATE lot SET statut = ?, date_depot = ? WHERE id = ?', ['DEPOSE', aujourdhui, lotId])
  // Un dépôt verrouille les dossiers : plus aucune modification après transmission.
  for (const d of all('SELECT id FROM dossier WHERE lot_id = ?', [lotId])) {
    run('UPDATE dossier SET verrouille = 1, date_depot = ? WHERE id = ?', [aujourdhui, d.id])
    journaliser({ entite: 'Dossier', entiteId: d.id, dossierId: d.id, champ: 'Dépôt', ancienne: null, nouvelle: 'lot déposé, dossier verrouillé', utilisateurId: u?.id })
  }
  revalidatePath(`/lots/${lotId}`)
  revalidatePath('/lots')
}

function majTotauxLot(lotId) {
  const t = get(
    'SELECT COALESCE(SUM(volume_cumac),0) AS cumac, COALESCE(SUM(prime_delegataire),0) AS ca FROM dossier WHERE lot_id = ?',
    [lotId]
  )
  run('UPDATE lot SET volume_cumac = ?, chiffre_affaire = ? WHERE id = ?', [t.cumac, t.ca, lotId])
}

// ── Import du référentiel de fiches ──────────────────────────

/**
 * Import CSV du catalogue des fiches. Séparateur `;`, une ligne d'en-tête.
 * Colonnes reconnues : code, secteur, domaine, libelle, version, date_effet,
 * date_fin, arrete, motif_fin, formule_type, unite, coefficients (JSON), conditions (JSON).
 * Seules code, secteur, domaine et libelle sont obligatoires : une fiche importée
 * sans coefficient existe au référentiel mais ne calcule rien, et le dit.
 */
export async function importerFiches(formData) {
  const u = await exiger('referentiel.gerer')
  const texte = String(formData.get('csv') || '').trim()
  if (!texte) return

  const lignes = texte.split(/\r?\n/).filter((l) => l.trim())
  const entete = lignes.shift().split(';').map((c) => c.trim().toLowerCase().replace(/^﻿/, ''))
  const idx = (nom) => entete.indexOf(nom)

  let crees = 0
  let versions = 0
  let ignores = 0

  for (const ligne of lignes) {
    const cols = decouper(ligne)
    const val = (nom) => {
      const i = idx(nom)
      return i >= 0 && cols[i] != null ? cols[i].trim() : ''
    }
    const code = val('code').toUpperCase()
    if (!/^[A-Z]{3,4}-[A-Z]{2}-\d{3}$/.test(code)) { ignores++; continue }

    const secteur = val('secteur') || code.split('-')[0]
    const domaine = val('domaine') || code.split('-')[1]
    const libelle = val('libelle') || code

    let fiche = get('SELECT * FROM fiche WHERE code = ?', [code])
    if (!fiche) {
      const fid = uid()
      run('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
        [fid, code, secteur, domaine, libelle])
      fiche = { id: fid, code }
      crees++
    } else if (libelle && libelle !== code) {
      run('UPDATE fiche SET libelle = ? WHERE id = ?', [libelle, fiche.id])
    }

    const version = val('version') || 'v1'
    const dejaLa = get('SELECT id FROM fiche_version WHERE fiche_id = ? AND version = ?', [fiche.id, version])
    if (dejaLa) continue

    run(
      `INSERT INTO fiche_version (id, fiche_id, version, date_effet, date_fin, arrete_reference, motif_fin,
         formule_type, unite_variable, coefficients, conditions)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [uid(), fiche.id, version,
       val('date_effet') || new Date().toISOString().slice(0, 10),
       val('date_fin') || null,
       val('arrete') || null,
       val('motif_fin') || null,
       val('formule_type') || 'FORFAIT_PAR_UNITE',
       val('unite') || null,
       jsonOu(val('coefficients'), '[]'),
       jsonOu(val('conditions'), '[]')]
    )
    versions++
  }

  journaliser({
    entite: 'Referentiel', entiteId: 'import', champ: 'Import de fiches',
    ancienne: null, nouvelle: `${crees} fiche(s) créée(s), ${versions} version(s), ${ignores} ligne(s) ignorée(s)`,
    utilisateurId: u?.id,
  })

  revalidatePath('/referentiel')
  redirect(`/referentiel?import=${crees}-${versions}-${ignores}`)
}

/** Découpe une ligne CSV en respectant les guillemets. */
function decouper(ligne) {
  const out = []
  let courant = ''
  let entreGuillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') { courant += '"'; i++ }
      else entreGuillemets = !entreGuillemets
    } else if (c === ';' && !entreGuillemets) {
      out.push(courant); courant = ''
    } else courant += c
  }
  out.push(courant)
  return out
}

function jsonOu(texte, defaut) {
  if (!texte) return defaut
  try { JSON.parse(texte); return texte } catch { return defaut }
}

/**
 * Import de masse des dossiers depuis un CSV — fichier déposé ou texte collé.
 *
 * Deux modes : « simulation » n'écrit rien et sert à valider le fichier avant de s'engager,
 * « import » écrit. Dans les deux cas le rapport est stocké et consultable ensuite.
 */
export async function importerDossiers(formData) {
  const u = await exiger('dossier.importer')
  const fichier = formData.get('fichier')
  const colle = String(formData.get('csv') || '')
  const simulation = String(formData.get('mode') || '') === 'simulation'

  let texte = colle.trim()
  let nomFichier = 'collage'
  if (fichier && typeof fichier.arrayBuffer === 'function' && fichier.size > 0) {
    texte = new TextDecoder('utf-8').decode(await fichier.arrayBuffer())
    nomFichier = fichier.name || 'fichier.csv'
  }
  if (!texte.trim()) return

  const rapport = importerDossiersCsv(texte, { simulation })

  const lotId = uid()
  run(
    `INSERT INTO import_lot (id, nom_fichier, lignes, crees, ignores, rejetes, simulation, rapport, utilisateur_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [lotId, nomFichier, rapport.lignes, rapport.crees, rapport.ignores, rapport.rejets.length,
     simulation ? 1 : 0, JSON.stringify(rapport), u?.id || null]
  )

  if (!simulation && rapport.crees > 0) {
    journaliser({
      entite: 'Dossier', entiteId: 'import', champ: 'Import de masse',
      ancienne: null,
      nouvelle: `${rapport.crees} dossier(s) créé(s) depuis ${nomFichier}`,
      utilisateurId: u?.id,
    })
    revalidatePath('/dossiers')
    revalidatePath('/')
  }

  redirect(`/dossiers/import/${lotId}`)
}

/** Champs du site modifiables depuis la fiche dossier. */
const CHAMPS_SITE = {
  adresse: 'Adresse',
  code_postal: 'Code postal',
  ville: 'Ville',
  zone_climatique: 'Zone climatique',
  secteur_activite: "Secteur d'activité",
  age_batiment: 'Âge du bâtiment',
  surface: 'Surface',
  type_chauffage: 'Type de chauffage',
  qpv: 'QPV',
}

/**
 * Correction des données du site.
 *
 * Ce n'est pas de l'état civil : **la zone climatique et le secteur d'activité sont des
 * entrées du calcul cumac**. Les corriger change le volume et donc la marge. C'est pour ça
 * qu'ils sont journalisés comme le reste, et que l'écran rappelle de recalculer ensuite.
 */
export async function majSite(formData) {
  const u = await exiger('dossier.modifier')
  const dossierId = String(formData.get('dossier_id') || '')
  exigerPortee(u, dossierId)

  const d = get('SELECT site_id, verrouille FROM dossier WHERE id = ?', [dossierId])
  if (!d) throw new Error('Dossier introuvable.')
  if (d.verrouille) throw new Error('Dossier verrouillé : déverrouillez-le avant de le modifier.')

  const avant = get('SELECT * FROM site WHERE id = ?', [d.site_id])

  // ── Ce qu'un site ne peut pas perdre ──
  //
  // L'adresse, le code postal et la ville sont obligatoires en base. Les vider ne produit
  // pas un site incomplet : ça produit une erreur SQL, donc une page blanche et une
  // modification perdue sans que personne sache laquelle. On refuse d'abord, en nommant le
  // champ, et on n'écrit rien du tout — plutôt que d'enregistrer la moitié du formulaire
  // avant de buter sur le reste.
  const INDISPENSABLES = { adresse: "L'adresse du chantier", code_postal: 'Le code postal', ville: 'La ville' }
  for (const [champ, label] of Object.entries(INDISPENSABLES)) {
    if (!formData.has(champ)) continue
    if (txt(formData.get(champ)) === null) {
      redirect(`/dossiers/${dossierId}?site=${encodeURIComponent(`${label} ne peut pas rester vide : rien n'a été enregistré.`)}`)
    }
  }

  for (const [champ, label] of Object.entries(CHAMPS_SITE)) {
    if (!formData.has(champ) && champ !== 'qpv') continue
    let valeur
    if (champ === 'qpv') valeur = formData.get('qpv') ? 1 : 0
    else if (champ === 'age_batiment' || champ === 'surface') valeur = num(formData.get(champ))
    else valeur = txt(formData.get(champ))

    if (String(avant[champ] ?? '') === String(valeur ?? '')) continue
    run(`UPDATE site SET ${champ} = ? WHERE id = ?`, [valeur, d.site_id])
    journaliser({
      entite: 'Site', entiteId: d.site_id, dossierId, champ: label,
      ancienne: avant[champ], nouvelle: valeur, utilisateurId: u.id,
    })
  }

  // Le département suit le code postal : le laisser diverger fausserait les recherches.
  const cp = txt(formData.get('code_postal')) || ''
  const dept = cp.startsWith('20') ? (Number(cp) < 20200 ? '2A' : '2B') : cp.slice(0, 2)
  if (dept && dept !== avant.departement) {
    run('UPDATE site SET departement = ? WHERE id = ?', [dept, d.site_id])
    journaliser({
      entite: 'Site', entiteId: d.site_id, dossierId, champ: 'Département',
      ancienne: avant.departement, nouvelle: dept, utilisateurId: u.id,
    })
  }

  revalidatePath(`/dossiers/${dossierId}`)
}
