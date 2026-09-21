/**
 * Un dossier de démonstration, complet, pour essayer la chaîne du bout à l'autre.
 *
 * ── Pourquoi une société « DÉMONSTRATION » et pas SPLIT DISTRIBUTION ──
 *
 * Pour émettre un devis ou une facture, la plateforme exige les mentions légales de la
 * société émettrice : SIRET, numéro de TVA cohérent avec le SIREN, assurance décennale.
 * BPG, DISTRI PAC et SPLIT DISTRIBUTION ne les ont pas encore — c'est voulu, elles
 * attendent vos documents. Les inventer pour faire tourner un essai serait la pire idée
 * possible : un devis de démonstration portant un faux SIRET au nom d'une société réelle
 * finit tôt ou tard devant un client.
 *
 * On plante donc une société d'essai dont les identifiants sont manifestement faux
 * (SIREN 000 000 000), sous un nom qui ne laisse aucun doute. Tout fonctionne, rien ne
 * peut être confondu avec un document réel.
 *
 * ── Ce qui est planté ──
 *
 * Une société d'essai, un bénéficiaire, un site, un deal, un dossier avec une opération
 * VALORISÉE, un lot de dépôt, et un accès client. De quoi essayer, dans l'ordre :
 * l'aperçu du devis → son émission → l'aperçu de la facture → son émission → un avoir →
 * le contrôle du tableau de dépôt → l'espace client.
 *
 * Les chiffres sont ceux de la fiche AGRI-EQ-110 telle qu'elle est chargée : 72 kW en
 * séchage forestier zone H1, soit 7 387 200 kWh cumac. Ils sont donc justes, pas ronds :
 * un essai sur des chiffres faux ne prouve rien sur les arrondis.
 *
 * Usage :
 *   node jeu-demo.mjs              → plante (ou remet à neuf) le dossier de démonstration
 *   node jeu-demo.mjs --retirer    → efface tout ce que ce script a planté, et rien d'autre
 */
import path from 'node:path'
const { DatabaseSync } = await import('node:sqlite')

const CIBLE = process.env.CEE_DB_PATH || path.join(process.cwd(), 'db', 'cee.db')
const RETIRER = process.argv.includes('--retirer')

const db = new DatabaseSync(CIBLE)
const uid = () => crypto.randomUUID()
const un = (s, p = []) => db.prepare(s).get(...p)
const tous = (s, p = []) => db.prepare(s).all(...p)
const run = (s, p = []) => db.prepare(s).run(...p)

// Tout ce que ce script crée porte une marque reconnaissable. Le retrait s'appuie dessus :
// il n'efface jamais par déduction, seulement ce qu'il sait avoir posé lui-même.
const CODE_ENTITE = 'DEMO'
const NUM_DOSSIER = 'DEMO-2026-0001'
const NUM_LOT = 'DEMO-LOT-2026-01'
const NOM_DEAL = 'DEAL DE DÉMONSTRATION'
const NOM_DELEG = 'DÉLÉGATAIRE DE DÉMONSTRATION'
const NOM_CLIENT = 'EARL DE LA DÉMONSTRATION'

function retirer() {
  const d = un('SELECT id FROM dossier WHERE numero = ?', [NUM_DOSSIER])
  if (d) {
    for (const f of tous('SELECT id FROM facture WHERE dossier_id = ?', [d.id])) {
      run('DELETE FROM facture_ligne WHERE facture_id = ?', [f.id])
    }
    // Les avoirs pointent vers les factures : on casse le lien avant d'effacer, sinon
    // l'ordre de suppression décide du succès, ce qui est exactement ce qu'on ne veut pas.
    run('UPDATE facture SET annule_facture_id = NULL WHERE dossier_id = ?', [d.id])
    run('DELETE FROM facture WHERE dossier_id = ?', [d.id])
    for (const a of tous('SELECT id FROM acces_client WHERE dossier_id = ?', [d.id])) {
      run('DELETE FROM session_client WHERE acces_client_id = ?', [a.id])
      run('DELETE FROM proposition_champ WHERE proposition_id IN (SELECT id FROM proposition WHERE dossier_id = ?)', [d.id])
      run('DELETE FROM proposition WHERE dossier_id = ?', [d.id])
      run('DELETE FROM acces_client WHERE id = ?', [a.id])
    }
    run('DELETE FROM reponse_qualification WHERE dossier_id = ?', [d.id])
    run('DELETE FROM operation WHERE dossier_id = ?', [d.id])
    run('DELETE FROM chantier WHERE dossier_id = ?', [d.id])
    run('DELETE FROM note WHERE dossier_id = ?', [d.id])
    run('DELETE FROM journal_champ WHERE entite_id = ?', [d.id])
    const ref = un('SELECT beneficiaire_id, site_id FROM dossier WHERE id = ?', [d.id])
    run('DELETE FROM dossier WHERE id = ?', [d.id])
    if (ref?.beneficiaire_id) run('DELETE FROM beneficiaire WHERE id = ?', [ref.beneficiaire_id])
    if (ref?.site_id) run('DELETE FROM site WHERE id = ?', [ref.site_id])
  }
  run('DELETE FROM lot WHERE numero = ?', [NUM_LOT])
  const deal = un('SELECT id FROM deal WHERE libelle = ?', [NOM_DEAL])
  if (deal) { run('DELETE FROM deal_fiche WHERE deal_id = ?', [deal.id]); run('DELETE FROM deal WHERE id = ?', [deal.id]) }
  run('DELETE FROM delegataire WHERE nom = ?', [NOM_DELEG])
  run('DELETE FROM entite_emettrice WHERE code = ?', [CODE_ENTITE])
  console.log('Jeu de démonstration retiré. Rien d\'autre n\'a été touché.')
}

if (RETIRER) { retirer(); process.exit(0) }

// Remettre à neuf plutôt qu'empiler : relancer le script deux fois ne doit pas laisser
// deux dossiers de démonstration, ni une facture émise lors du passage précédent.
retirer()

// ── La société d'essai ──
//
// TVA : la clé française vaut (12 + 3 × (SIREN mod 97)) mod 97. Pour un SIREN à zéro,
// elle vaut 12. Le numéro est donc formellement valide et manifestement faux, ce qui est
// exactement ce qu'on veut d'un jeu d'essai.
const entite = uid()
run(`INSERT INTO entite_emettrice (id, code, raison_sociale, forme_juridique, capital,
     siren, siret, naf, rcs_ville, rcs_numero, tva, adresse, code_postal, ville,
     telephone, email, representant_nom, representant_qualite,
     assurance_nom, assurance_police, assurance_couverture,
     conditions_reglement, validite_jours, taux_tva_defaut,
     devis_prefixe, facture_prefixe, taux_penalites, indemnite_recouvrement,
     delai_paiement_jours, par_defaut, actif)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,1)`,
  [entite, CODE_ENTITE, 'SOCIÉTÉ DE DÉMONSTRATION — jeu d\'essai', 'SAS', 10000,
    '000000000', '00000000000000', '4322B', 'Lyon', '000 000 000', 'FR12000000000',
    '1 rue de la Démonstration', '69000', 'Lyon', '00 00 00 00 00', 'demo@example.invalid',
    'Prénom NOM', 'Gérant',
    'ASSUREUR DE DÉMONSTRATION', 'DEMO-0000', 'France métropolitaine — jeu d\'essai',
    'Virement à réception de facture', 30, 20,
    'DEMO', 'DEMO-F', 10.85, 40, 30])

// ── Le délégataire et le deal ──
const deleg = uid()
run('INSERT INTO delegataire (id, nom, oblige, actif) VALUES (?,?,?,1)',
  [deleg, NOM_DELEG, 'OBLIGÉ DE DÉMONSTRATION'])

// Le mode de reversement est renseigné : sans lui la valorisation reste « indéterminée »,
// et l'essai ne montrerait aucun montant — ce qui ferait croire à une panne.
const deal = uid()
run(`INSERT INTO deal (id, libelle, version, delegataire_id, type_beneficiaire, date_debut,
     par_defaut, actif, mode_reversement,
     r_deleg_classique_sans_mpr, r_cede_classique_sans_mpr, r_garde_classique_sans_mpr,
     r_deleg_precaire_sans_mpr, r_cede_precaire_sans_mpr, r_garde_precaire_sans_mpr,
     source, source_ref)
     VALUES (?,?,?,?,?,?,0,1,?,?,?,?,?,?,?,?,?)`,
  [deal, NOM_DEAL, 'V1', deleg, 'B2B_B2C', '2026-01-01', 'CUMULE',
    6.5, 4.55, 1.95, 7.0, 5.0, 2.0,
    'Jeu de démonstration', 'node jeu-demo.mjs'])

// La fiche du séchage : c'est celle de la nouvelle activité.
const fiche = un("SELECT f.id, f.code, fv.id AS version_id FROM fiche f JOIN fiche_version fv ON fv.fiche_id = f.id WHERE f.code = 'AGRI-EQ-110' LIMIT 1")
  || un('SELECT f.id, f.code, fv.id AS version_id FROM fiche f JOIN fiche_version fv ON fv.fiche_id = f.id LIMIT 1')
if (!fiche) { console.log('Aucune fiche en base : chargez le référentiel avant.'); process.exit(1) }
run('INSERT INTO deal_fiche (id, deal_id, fiche_id, charte, actif) VALUES (?,?,?,?,1)',
  [uid(), deal, fiche.id, 'HORS_CDP'])

// ── Le client, le site, le dossier ──
const benef = uid()
run(`INSERT INTO beneficiaire (id, type, raison_sociale, siret, code_ape, nom, prenom,
     email, telephone, regime_revenu) VALUES (?,?,?,?,?,?,?,?,?,?)`,
  [benef, 'PRO', NOM_CLIENT, '00000000000000', '0161Z', 'DÉMONSTRATION', 'Jean',
    'client.demo@example.invalid', '00 00 00 00 00', 'CLASSIQUE'])

const site = uid()
run(`INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique,
     secteur_activite) VALUES (?,?,?,?,?,?,?)`,
  [site, '12 chemin de la Scierie', '01000', 'Bourg-en-Bresse', '01', 'H1', 'AGRICOLE'])

// L'utilisateur connecté peut être rattaché à une unité d'affaire : le dossier prend la
// même, sinon le cloisonnement le rendrait invisible à celui-là même qui veut l'essayer.
const moi = un('SELECT id, unite_affaire_id FROM utilisateur LIMIT 1')

// Les chiffres : 72 kW, séchage forestier zone H1 → 7 387 200 kWh cumac (barème officiel
// de 102 600 kWh cumac par kW installé, système complet). Prime au taux « cédé » du deal.
const CUMAC = 7387200
const PRIME = Math.round((CUMAC / 1000) * 4.55 * 100) / 100
// Le prix des travaux est ILLUSTRATIF — je n'ai pas votre grille tarifaire. Il est
// simplement mis à un ordre de grandeur crédible pour une installation de 72 kW, et avec
// des centimes, pour que l'essai exerce réellement les arrondis.
const PUV = 1236.45
const QUANTITE = 72

const dossier = uid()
run(`INSERT INTO dossier (id, numero, unite_affaire_id, beneficiaire_id, site_id, fiche_id,
     fiche_version_id, deal_id, delegataire_id, entite_id, charte, avec_mpr, quantite,
     source, volume_cumac, prime_beneficiaire, date_engagement, date_pose, date_achevement,
     destinataire_prime, devis_deduire_prime, facture_deduire_prime, verrouille, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,1,1,0,datetime('now'))`,
  [dossier, NUM_DOSSIER, moi?.unite_affaire_id ?? null, benef, site, fiche.id,
    fiche.version_id, deal, deleg, entite, 'HORS_CDP', QUANTITE,
    'Jeu de démonstration', CUMAC, PRIME, '2026-02-10', '2026-05-01', '2026-05-12',
    'BENEFICIAIRE'])

// ── Le chantier, posé ici et pas laissé à l'application ──
//
// Une opération sans chantier n'est pas invalide : l'application la rattache d'elle-même au
// premier enregistrement du dossier. Mais une donnée d'essai qui se répare toute seule au
// premier clic fait bouger la base sans qu'on l'ait demandé, et brouille la lecture de
// toute vérification qui compare l'avant et l'après. Le jeu d'essai part donc propre.
const chantier = uid()
run(`INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
     VALUES (?,?,?,1,'Chantier principal',1)`, [chantier, dossier, site])

// L'opération est VALORISÉE (date_calcul renseignée) : sans cela la facture refuserait
// d'être émise, et l'essai s'arrêterait avant d'avoir montré quoi que ce soit.
run(`INSERT INTO operation (id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id, charte,
     quantite, unite, puv, taux_tva, volume_cumac, prime_beneficiaire, date_calcul,
     type_produit, type_installation, created_at)
     VALUES (?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'))`,
  [uid(), dossier, chantier, fiche.id, fiche.version_id, 'HORS_CDP',
    QUANTITE, 'kW', PUV, 20, CUMAC, PRIME, '2026-06-01',
    'FORESTIER', 'SYSTEME_COMPLET'])

// ── Le lot de dépôt ──
const lot = uid()
run(`INSERT INTO lot (id, numero, organisme, statut, delegataire_id, reference_emmy)
     VALUES (?,?,?,?,?,?)`,
  [lot, NUM_LOT, NOM_DELEG, 'EN_CONSTITUTION', deleg, 'EMMY-DEMO-000001'])
run('UPDATE dossier SET lot_id = ? WHERE id = ?', [lot, dossier])

// ── L'accès client ──
//
// Les identifiants sont générés par le module habituel : c'est le vrai mécanisme qui est
// essayé, pas une imitation. Le code n'est stocké que haché — il est affiché ici une fois,
// et ne sera plus jamais lisible ensuite.
let acces = null
try {
  const { ouvrirAcces } = await import('./lib/acces-client.js')
  acces = ouvrirAcces(db, dossier, moi?.id ?? null)
} catch (e) {
  console.log('(accès client non créé :', e.message, ')')
}

const ttc = Math.round(PUV * QUANTITE * 100) / 100
const euros = (n) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

console.log(`
── Dossier de démonstration planté ──

  Dossier    : ${NUM_DOSSIER} — ${NOM_CLIENT}
  Société    : SOCIÉTÉ DE DÉMONSTRATION (identifiants volontairement faux)
  Fiche      : ${fiche.code}, ${QUANTITE} kW, forestier zone H1
  Volume     : ${CUMAC.toLocaleString('fr-FR')} kWh cumac
  Travaux    : ${euros(ttc)} TTC  (${QUANTITE} × ${euros(PUV)}) — prix illustratif
  Prime CEE  : ${euros(PRIME)}  — déduite sur le devis et la facture
  Net à payer: ${euros(Math.round((ttc - PRIME) * 100) / 100)}
  Lot         : ${NUM_LOT} (référence EMMY-DEMO-000001)

  À ouvrir :
    Le dossier         http://localhost:3000/dossiers/${dossier}
    Aperçu du devis    http://localhost:3000/dossiers/${dossier}/devis
    Aperçu facture     http://localhost:3000/dossiers/${dossier}/facture
    Le lot             http://localhost:3000/lots/${lot}
    Contrôle du dépôt  http://localhost:3000/lots/${lot}/depot?controle=1
${acces ? `
  Espace client        http://localhost:3000/espace
    identifiant : ${acces.identifiant}
    code        : ${acces.code}
    (le code n'est pas conservé en clair : notez-le maintenant)` : ''}

  Pour tout effacer :  node jeu-demo.mjs --retirer
`)
