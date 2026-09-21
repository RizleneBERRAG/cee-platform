/**
 * Import de masse des dossiers.
 *
 * Trois principes, dans cet ordre :
 *
 * 1. **Rien de partiel.** Une ligne est entièrement valide ou entièrement rejetée.
 *    Un dossier à moitié créé, sans site ou sans version de fiche, est pire que pas de dossier :
 *    il pollue le radar de conformité et fausse la marge prévisionnelle.
 * 2. **Aucune supposition silencieuse.** Chaque valeur devinée (zone climatique déduite du
 *    département, deal repris par défaut, version de fiche choisie par la date) est comptée
 *    et remontée dans le rapport. Vous devez pouvoir dire d'où vient chaque chiffre.
 * 3. **Rejouable.** Un dossier déjà importé, reconnu à sa référence externe, est ignoré et
 *    non dupliqué. Relancer le même fichier deux fois ne crée rien de plus.
 */
import fs from 'node:fs'
import path from 'node:path'
import { all, get, run, db } from './db.js'
import { calculerCumac, ficheApplicable } from './cumac.js'
import { calculerValorisation } from './marge.js'

// ── Zones climatiques ────────────────────────────────────────
let _zones = null
function zones() {
  if (_zones) return _zones
  try {
    const brut = fs.readFileSync(path.join(process.cwd(), 'db', 'zones-climatiques.json'), 'utf8')
    const j = JSON.parse(brut)
    _zones = { table: j.zones || {}, incertains: new Set(j._incertains || []) }
  } catch {
    _zones = { table: {}, incertains: new Set() }
  }
  return _zones
}

// ── Découpage CSV ────────────────────────────────────────────

/** Détecte le séparateur sur la ligne d'en-tête : point-virgule, virgule ou tabulation. */
export function detecterSeparateur(entete) {
  const candidats = [';', '\t', ',']
  let meilleur = ';'
  let max = 0
  for (const c of candidats) {
    const n = decouper(entete, c).length
    if (n > max) { max = n; meilleur = c }
  }
  return meilleur
}

/** Découpe une ligne CSV en respectant les guillemets doublés. */
export function decouper(ligne, sep = ';') {
  const out = []
  let courant = ''
  let entreGuillemets = false
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i]
    if (c === '"') {
      if (entreGuillemets && ligne[i + 1] === '"') { courant += '"'; i++ }
      else entreGuillemets = !entreGuillemets
    } else if (c === sep && !entreGuillemets) {
      out.push(courant); courant = ''
    } else courant += c
  }
  out.push(courant)
  return out
}

/** Normalise un nom de colonne : minuscules, sans accents, espaces et tirets en underscore. */
function normaliserColonne(nom) {
  return nom
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

/** Noms alternatifs acceptés pour chaque colonne — les exports des autres outils ne s'alignent jamais. */
const SYNONYMES = {
  ref_externe: ['reference', 'reference_externe', 'ref', 'numero_externe', 'id_externe', 'dossier'],
  raison_sociale: ['beneficiaire', 'client', 'societe', 'nom_client', 'raison_sociale_beneficiaire'],
  siret: ['siret_beneficiaire', 'n_siret'],
  regime_revenu: ['regime', 'revenus', 'menage'],
  adresse: ['adresse_site', 'adresse_travaux', 'rue'],
  code_postal: ['cp', 'code_postal_site', 'postal'],
  ville: ['commune', 'ville_site'],
  zone_climatique: ['zone', 'zone_clim'],
  secteur_activite: ['secteur', 'activite', 'usage'],
  fiche: ['fiche_code', 'code_fiche', 'operation', 'code_operation'],
  quantite: ['qte', 'volume', 'nombre', 'quantite_posee'],
  date_engagement: ['date_devis', 'date_signature', 'engagement'],
  date_pose: ['date_travaux', 'date_fin_travaux', 'pose'],
  charte: ['coup_de_pouce', 'cdp'],
  avec_mpr: ['mpr', 'maprimerenov', 'ma_prime_renov'],
  deal: ['deal_code', 'contrat', 'grille'],
  delegataire: ['delegataire_nom', 'obligé', 'oblige'],
  installateur: ['installateur_nom', 'poseur', 'entreprise_travaux'],
  unite_affaire: ['regie', 'unite', 'apporteur', 'origine'],
  statut: ['statut_dossier', 'etat'],
  source: ['canal', 'provenance'],
  type_beneficiaire: ['type_client'],
  surface: ['surface_m2'],
  cout_pose: ['cout_travaux', 'prix_pose'],
}

/** Construit l'index nom logique → position de colonne. */
function indexerColonnes(entete) {
  const brut = entete.map(normaliserColonne)
  const index = {}
  brut.forEach((c, i) => { if (!(c in index)) index[c] = i })
  for (const [canonique, autres] of Object.entries(SYNONYMES)) {
    if (canonique in index) continue
    for (const a of autres) {
      const n = normaliserColonne(a)
      if (n in index) { index[canonique] = index[n]; break }
    }
  }
  return index
}

// ── Normalisation des valeurs ────────────────────────────────

/**
 * Accepte AAAA-MM-JJ, JJ/MM/AAAA et JJ-MM-AAAA. Renvoie null si illisible.
 *
 * La forme ne suffit pas : « 32/13/2026 » a la bonne tête et n'existe pas. On vérifie que
 * le triplet correspond à une vraie date du calendrier, sinon la date d'engagement choisirait
 * une version de fiche au hasard et la marge serait fausse sans que rien ne le signale.
 */
export function normaliserDate(v) {
  const s = String(v || '').trim()
  if (!s) return null
  let a, mo, j
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (m) { [, a, mo, j] = m } else {
    m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/)
    if (!m) return null
    ;[, j, mo, a] = m
  }
  const an = Number(a), mois = Number(mo), jour = Number(j)
  if (mois < 1 || mois > 12 || jour < 1 || jour > 31) return null
  const d = new Date(Date.UTC(an, mois - 1, jour))
  // Le constructeur reporte silencieusement : le 31 février devient le 3 mars. On le refuse.
  if (d.getUTCFullYear() !== an || d.getUTCMonth() !== mois - 1 || d.getUTCDate() !== jour) return null
  return `${an}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`
}

/** Accepte « 1 234,56 », « 1234.56 », « 1.234,56 ». Renvoie null si ce n'est pas un nombre. */
export function normaliserNombre(v) {
  let s = String(v ?? '').trim().replace(/\s| /g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const VRAI = new Set(['1', 'oui', 'o', 'yes', 'y', 'true', 'vrai', 'x'])
const booleen = (v) => VRAI.has(String(v ?? '').trim().toLowerCase())

function normaliserCharte(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (!s) return 'HORS_CDP'
  if (VRAI.has(s) || s.includes('coup') || s === 'cdp') return 'CDP'
  return 'HORS_CDP'
}

function normaliserRegime(v) {
  const s = String(v ?? '').trim().toLowerCase()
  if (s.startsWith('prec') || s.startsWith('préc') || s.includes('modeste') || s.includes('tres_modeste')) return 'PRECAIRE'
  return 'CLASSIQUE'
}

const SIRET_PROPRE = (v) => String(v ?? '').replace(/\D/g, '') || null

// ── Import ───────────────────────────────────────────────────

const uid = () => crypto.randomUUID()

/**
 * Analyse et importe un CSV de dossiers.
 * @param {string} texte        contenu du fichier
 * @param {object} opts
 * @param {boolean} opts.simulation  n'écrit rien, renvoie seulement le rapport
 * @param {number}  opts.tauxApporteur
 * @returns {{colonnes:string[], lignes:number, crees:number, ignores:number, rejets:Array, avertissements:object, apercu:Array}}
 */
export function importerDossiersCsv(texte, { simulation = false, tauxApporteur = 8 } = {}) {
  const brutes = String(texte || '').split(/\r?\n/).filter((l) => l.trim() !== '')
  if (brutes.length < 2) {
    return vide('Le fichier ne contient pas d\'en-tête suivie d\'au moins une ligne.')
  }

  const sep = detecterSeparateur(brutes[0])
  const entete = decouper(brutes.shift(), sep)
  const col = indexerColonnes(entete)

  const manquantes = ['fiche', 'quantite', 'date_engagement'].filter((c) => !(c in col))
  if (manquantes.length) {
    return vide(`Colonnes obligatoires absentes : ${manquantes.join(', ')}.`)
  }

  // Référentiels chargés une seule fois — 2 600 lignes × 6 requêtes, c'est 15 000 allers-retours évitables.
  const fiches = new Map(all('SELECT id, code FROM fiche').map((f) => [f.code.toUpperCase(), f.id]))
  const versionsParFiche = new Map()
  for (const v of all('SELECT * FROM fiche_version ORDER BY date_effet DESC')) {
    if (!versionsParFiche.has(v.fiche_id)) versionsParFiche.set(v.fiche_id, [])
    versionsParFiche.get(v.fiche_id).push(v)
  }
  const deals = all('SELECT * FROM deal WHERE actif = 1')
  const dealsParNom = new Map(deals.map((d) => [String(d.libelle || '').trim().toLowerCase(), d]))
  const dealParDefaut = deals.find((d) => d.par_defaut) || deals[0] || null
  const parNom = (rows, champ) => new Map(rows.map((r) => [String(r[champ]).trim().toLowerCase(), r.id]))
  const delegataires = parNom(all('SELECT id, nom FROM delegataire'), 'nom')
  const installateurs = parNom(all('SELECT id, raison_sociale FROM installateur_rge'), 'raison_sociale')
  const unites = parNom(all('SELECT id, nom FROM unite_affaire'), 'nom')
  const statuts = parNom(all('SELECT id, libelle FROM statut WHERE axe = \'DOSSIER\''), 'libelle')
  // Un dossier sans statut est invisible partout : le pipeline, le radar et les totaux du
  // tableau de bord comptent par statut. On rattache donc les imports à l'entrée du pipeline
  // plutôt que de les laisser flotter hors de toute vue.
  const statutParDefaut = get(
    `SELECT st.id FROM statut st LEFT JOIN etape e ON e.id = st.etape_id
      WHERE st.axe = 'DOSSIER' AND st.perdu = 0 ORDER BY e.ordre, st.ordre LIMIT 1`
  )?.id || null
  const beneficiairesParSiret = new Map(
    all('SELECT id, siret FROM beneficiaire WHERE siret IS NOT NULL AND siret <> \'\'').map((b) => [b.siret, b.id])
  )
  const refsConnues = new Set(
    all('SELECT ref_externe FROM dossier WHERE ref_externe IS NOT NULL AND ref_externe <> \'\'').map((d) => d.ref_externe)
  )
  const { table: tableZones, incertains } = zones()

  // Numérotation : on lit le dernier une seule fois puis on incrémente en mémoire.
  const annee = new Date().getFullYear()
  const dernier = get('SELECT numero FROM dossier WHERE numero LIKE ? ORDER BY numero DESC LIMIT 1', [`D-${annee}-%`])
  let compteur = dernier ? Number(dernier.numero.split('-')[2]) : 0

  const rejets = []
  const apercu = []
  const avert = { zoneDeduite: 0, zoneIncertaine: new Set(), dealParDefaut: 0, ficheHorsValidite: 0, sansDeal: 0, statutParDefaut: 0 }
  let crees = 0
  let ignores = 0

  // Tout le fichier dans une seule transaction, pour deux raisons.
  // D'abord la sûreté : une coupure à la ligne 2 000 ne doit pas laisser un import à moitié fait,
  // impossible à distinguer d'un import complet. Ensuite la vitesse : sans transaction, SQLite
  // synchronise le disque à chaque insertion — 2 500 lignes passent de ~7 s à moins d'une seconde.
  // Le grain de validité reste la ligne : les lignes fautives sont écartées avant d'écrire quoi que ce soit.
  if (!simulation) db().exec('BEGIN')
  try {

  for (let i = 0; i < brutes.length; i++) {
    const noLigne = i + 2 // +1 pour l'en-tête, +1 pour compter à partir de 1
    const cells = decouper(brutes[i], sep)
    const v = (nom) => {
      const j = col[nom]
      return j != null && cells[j] != null ? String(cells[j]).trim() : ''
    }
    const rejeter = (motif) => rejets.push({ ligne: noLigne, motif, extrait: brutes[i].slice(0, 110) })

    // — Référence externe : la clé de rejouabilité
    const ref = v('ref_externe') || null
    if (ref && refsConnues.has(ref)) { ignores++; continue }

    // — Fiche
    const codeFiche = v('fiche').toUpperCase().replace(/\s/g, '')
    const ficheId = fiches.get(codeFiche)
    if (!ficheId) {
      rejeter(`Fiche inconnue au référentiel : « ${codeFiche || '(vide)'} ». Importez-la d'abord dans /referentiel/import.`)
      continue
    }

    // — Date d'engagement : elle commande la version de fiche, donc la valorisation
    const dateEngagement = normaliserDate(v('date_engagement'))
    if (!dateEngagement) {
      rejeter(`Date d'engagement illisible : « ${v('date_engagement') || '(vide)'} ». Formats acceptés : AAAA-MM-JJ ou JJ/MM/AAAA.`)
      continue
    }

    const candidates = versionsParFiche.get(ficheId) || []
    const version =
      candidates.find((x) => x.date_effet <= dateEngagement && (!x.date_fin || x.date_fin > dateEngagement)) ||
      candidates[0]
    if (!version) {
      rejeter(`Aucune version de fiche pour ${codeFiche} : la fiche existe mais n'a aucune version datée.`)
      continue
    }

    // — Quantité
    const quantite = normaliserNombre(v('quantite'))
    if (quantite == null || quantite <= 0) {
      rejeter(`Quantité invalide : « ${v('quantite') || '(vide)'} ». Elle doit être un nombre strictement positif.`)
      continue
    }

    // — Site
    const cp = v('code_postal').replace(/\s/g, '')
    const departement = cp.startsWith('20') ? (Number(cp) < 20200 ? '2A' : '2B') : cp.slice(0, 2)
    let zone = v('zone_climatique').toUpperCase().replace(/\s/g, '')
    if (!/^H[123]$/.test(zone)) {
      zone = tableZones[departement] || null
      if (zone) {
        avert.zoneDeduite++
        if (incertains.has(departement)) avert.zoneIncertaine.add(departement)
      }
    }

    // — Deal : nommé dans le CSV, sinon celui marqué par défaut. Sans deal, aucune marge n'est calculable.
    const nomDeal = v('deal').trim().toLowerCase()
    let deal = nomDeal ? dealsParNom.get(nomDeal) : null
    if (!deal) {
      deal = dealParDefaut
      if (deal) avert.dealParDefaut++
    }
    if (!deal) avert.sansDeal++

    // — Éligibilité : on n'interdit pas, on signale. Un dossier ancien hors validité est un fait, pas une erreur.
    const elig = ficheApplicable(version, dateEngagement)
    if (!elig.applicable) avert.ficheHorsValidite++

    if (simulation) {
      if (apercu.length < 10) {
        apercu.push({ ligne: noLigne, ref, fiche: codeFiche, version: version.version, quantite, dateEngagement, zone })
      }
      crees++
      if (ref) refsConnues.add(ref)
      continue
    }

    // ── Écriture ───────────────────────────────────────────
    const siret = SIRET_PROPRE(v('siret'))
    let beneficiaireId = siret ? beneficiairesParSiret.get(siret) : null
    if (!beneficiaireId) {
      beneficiaireId = uid()
      run(
        `INSERT INTO beneficiaire (id, type, raison_sociale, siret, nom, prenom, email, telephone, regime_revenu)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [beneficiaireId, v('type_beneficiaire') || 'SOCIETE', v('raison_sociale') || null, siret,
         v('nom') || null, v('prenom') || null, v('email') || null, v('telephone') || null,
         normaliserRegime(v('regime_revenu'))]
      )
      if (siret) beneficiairesParSiret.set(siret, beneficiaireId)
    }

    const statutLigne = statuts.get(v('statut').toLowerCase()) || statutParDefaut
    if (!statuts.get(v('statut').toLowerCase())) avert.statutParDefaut++

    const siteId = uid()
    run(
      `INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique, secteur_activite, surface, qpv)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [siteId, v('adresse') || '—', cp, v('ville') || '', departement || null, zone,
       v('secteur_activite').toUpperCase() || null, normaliserNombre(v('surface')), booleen(v('qpv')) ? 1 : 0]
    )

    compteur++
    const numero = `D-${annee}-${String(compteur).padStart(5, '0')}`
    const dossierId = uid()
    run(
      `INSERT INTO dossier (id, numero, ref_externe, unite_affaire_id, beneficiaire_id, site_id,
         fiche_id, fiche_version_id, deal_id, delegataire_id, installateur_id, charte, avec_mpr,
         quantite, source, statut_dossier_id, date_engagement, date_pose, cout_pose)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [dossierId, numero, ref, unites.get(v('unite_affaire').toLowerCase()) || null,
       beneficiaireId, siteId, ficheId, version.id, deal?.id || null,
       delegataires.get(v('delegataire').toLowerCase()) || null,
       installateurs.get(v('installateur').toLowerCase()) || null,
       normaliserCharte(v('charte')), booleen(v('avec_mpr')) ? 1 : 0,
       quantite, v('source') || 'Import', statutLigne,
       dateEngagement, normaliserDate(v('date_pose')), normaliserNombre(v('cout_pose'))]
    )

    // — Figeage immédiat : un dossier importé arrive avec son historique, pas comme un brouillon.
    if (deal) {
      const cu = calculerCumac({
        ficheVersion: version, quantite,
        contexte: { secteurActivite: v('secteur_activite').toUpperCase() || null, zoneClimatique: zone, charte: normaliserCharte(v('charte')) },
      })
      const val = calculerValorisation({
        cumac: elig.applicable ? cu.cumac : 0,
        deal,
        regime: normaliserRegime(v('regime_revenu')),
        avecMpr: booleen(v('avec_mpr')),
        coutPose: normaliserNombre(v('cout_pose')) || 0,
        tauxApporteur,
      })
      run(
        `UPDATE dossier SET volume_cumac=?, prime_delegataire=?, prime_beneficiaire=?,
           commission_installateur=?, commission_apporteur=?, marge_nette=?, date_calcul=?
         WHERE id=?`,
        [elig.applicable ? cu.cumac : 0, val.caDelegataire, val.primeBeneficiaire,
         val.commissionInstallateur, val.commissionApporteur, val.margeNette,
         new Date().toISOString(), dossierId]
      )
    }

    if (ref) refsConnues.add(ref)
    crees++
  }

  if (!simulation) db().exec('COMMIT')
  } catch (e) {
    if (!simulation) { try { db().exec('ROLLBACK') } catch { /* transaction déjà refermée */ } }
    return {
      ...vide(`L'import a été annulé et la base laissée intacte : ${e.message}`),
      colonnes: entete.map(normaliserColonne),
      lignes: brutes.length,
      rejets,
    }
  }

  return {
    colonnes: entete.map(normaliserColonne),
    lignes: brutes.length,
    crees,
    ignores,
    rejets,
    avertissements: { ...avert, zoneIncertaine: [...avert.zoneIncertaine] },
    apercu,
    erreur: null,
  }
}

function vide(erreur) {
  return {
    colonnes: [], lignes: 0, crees: 0, ignores: 0, rejets: [],
    avertissements: { zoneDeduite: 0, zoneIncertaine: [], dealParDefaut: 0, ficheHorsValidite: 0, sansDeal: 0 },
    apercu: [], erreur,
  }
}
