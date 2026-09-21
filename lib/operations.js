/**
 * Opérations d'un dossier : valorisation, et projection sur le dossier.
 *
 * ── Le point d'équilibre de tout ce fichier ──
 *
 * Un dossier porte désormais N opérations. Mais toute la plateforme — les 45 critères de
 * recherche, les exports, le tableau de bord, les lots de dépôt — lit les totaux sur le
 * dossier. Réécrire tout cela d'un coup pour aller chercher les opérations serait un
 * chantier énorme, et chaque oubli deviendrait un écart de marge invisible.
 *
 * Le choix retenu : **le dossier garde ses totaux, comme une projection de ses opérations**,
 * et une seule fonction les maintient — `synchroniserDossier`. Il n'y a donc pas deux
 * sources de vérité qui dérivent, mais une source (les opérations) et une projection tenue
 * en un seul endroit, qu'on peut tester. Toute écriture sur une opération se termine par
 * cet appel, sans exception.
 *
 * ── La règle de gel, énoncée une fois ──
 *
 * **Le total du dossier est la somme de ses opérations FIGÉES, et d'elles seules.**
 *
 * Tout découle de là. Ajouter une opération à un dossier figé ne bouge aucun montant :
 * l'opération neuve n'a pas de `date_calcul`, donc elle ne compte pas encore. Elle est
 * signalée à l'écran, et la valoriser reste un geste explicite. C'est exactement ce qu'on
 * veut : personne ne doit pouvoir modifier une marge déjà facturée en ajoutant une ligne.
 */
import { all, get, run, journaliser } from './db.js'
import { totalOuVide } from './montants.js'
import { calculerCumac, ficheApplicable, conditionsLisibles } from './cumac.js'
import { calculerValorisation, dealApplicable } from './marge.js'

/** Les colonnes de résultat, partagées par l'opération et le dossier. */
export const RESULTATS = [
  'volume_cumac', 'prime_delegataire', 'prime_beneficiaire',
  'commission_installateur', 'commission_apporteur', 'cout_pose', 'marge_nette',
]

const SELECT_OPERATION = `
  SELECT o.*,
         f.code AS fiche_code, f.libelle AS fiche_libelle, f.secteur AS fiche_secteur,
         fv.version AS fv_version, fv.date_effet AS fv_date_effet, fv.date_fin AS fv_date_fin,
         fv.arrete_reference AS fv_arrete, fv.motif_fin AS fv_motif_fin,
         fv.formule_type, fv.unite_variable, fv.coefficients, fv.conditions,
         p.marque AS produit_marque, p.reference AS produit_reference, p.designation AS produit_designation,
         i.raison_sociale AS installateur_nom,
         c.site_id AS chantier_site_id, c.libelle AS chantier_libelle, c.principal AS chantier_principal,
         s.adresse, s.code_postal, s.ville, s.zone_climatique, s.secteur_activite, s.surface
  FROM operation o
  JOIN fiche f ON f.id = o.fiche_id
  JOIN fiche_version fv ON fv.id = o.fiche_version_id
  LEFT JOIN produit p ON p.id = o.produit_id
  LEFT JOIN installateur_rge i ON i.id = o.installateur_id
  LEFT JOIN chantier c ON c.id = o.chantier_id
  LEFT JOIN site s ON s.id = c.site_id
`

export function operationsDuDossier(dossierId) {
  return all(`${SELECT_OPERATION} WHERE o.dossier_id = ? ORDER BY o.ordre, o.created_at`, [dossierId])
}

export function operation(id) {
  return get(`${SELECT_OPERATION} WHERE o.id = ?`, [id])
}

export function chantiersDuDossier(dossierId) {
  return all(`
    SELECT c.*, s.adresse, s.code_postal, s.ville, s.zone_climatique, s.secteur_activite,
           s.surface, s.type_chauffage, s.qpv,
           (SELECT COUNT(*) FROM operation o WHERE o.chantier_id = c.id) AS nb_operations
    FROM chantier c JOIN site s ON s.id = c.site_id
    WHERE c.dossier_id = ? ORDER BY c.principal DESC, c.ordre`, [dossierId])
}

/**
 * Calcule ce que vaudrait une opération **aujourd'hui**, sans rien écrire.
 *
 * Sert deux usages qu'il ne faut pas confondre : l'aperçu à l'écran (« voilà ce que ça
 * donnerait »), et le recalcul, qui seul écrit. Séparer les deux évite qu'un simple
 * affichage fige des montants par inadvertance.
 *
 * Le contexte du coefficient vient du site du CHANTIER de l'opération, pas du dossier :
 * deux chantiers d'un même dossier peuvent être en zones climatiques différentes, et
 * prendre la zone du dossier donnerait un volume faux sur le second.
 */
export function calculerOperation(op, { deal: dl = null, dateEngagement = null, regime = 'CLASSIQUE', avecMpr = false, destinatairePrime = null } = {}) {
  const fv = {
    version: op.fv_version, date_effet: op.fv_date_effet, date_fin: op.fv_date_fin,
    arrete_reference: op.fv_arrete, motif_fin: op.fv_motif_fin,
    formule_type: op.formule_type, unite_variable: op.unite_variable,
    coefficients: op.coefficients, conditions: op.conditions,
  }
  const contexte = {
    secteurActivite: op.secteur_activite,
    zoneClimatique: op.zone_climatique,
    charte: op.charte,
    // Critères propres à l'opération, que certaines fiches font varier. Sur AGRI-EQ-110,
    // « agricole » et « forestier » ne donnent pas le même barème — d'un facteur 2,4.
    typeProduit: op.type_produit,
    typeInstallation: op.type_installation,
  }
  const quantite = op.formule_type === 'FORFAIT_PAR_M2' ? (op.surface ?? op.quantite) : op.quantite
  const cumac = calculerCumac({ ficheVersion: fv, quantite, contexte })

  const aLaDate = dateEngagement || new Date().toISOString()
  const eligibilite = ficheApplicable(fv, aLaDate)

  let valorisation = null
  let dealOk = null
  if (dl) {
    dealOk = dealApplicable(dl, aLaDate)
    valorisation = calculerValorisation({
      cumac: eligibilite.applicable ? cumac.cumac : 0,
      deal: dl,
      // Le régime de revenu et MaPrimeRénov' appartiennent au bénéficiaire et au dossier,
      // pas à l'opération : ils sont donc passés par l'appelant, jamais devinés ici.
      regime: regime === 'PRECAIRE' ? 'PRECAIRE' : 'CLASSIQUE',
      avecMpr: !!avecMpr,
      coutPose: op.cout_pose ?? 0,
      tauxApporteur: op.taux_apporteur ?? 0,
      // Ne sert que sur un contrat en mode « au choix » : c'est ce champ qui désigne
      // laquelle des deux lignes s'applique sur ce dossier-là.
      destinatairePrime: destinatairePrime ?? null,
    })
  }

  return { cumac, eligibilite, deal: dl, dealOk, valorisation, conditions: conditionsLisibles(op.conditions) }
}

/**
 * Fige les montants d'une opération.
 *
 * Chaque champ est journalisé individuellement : sur un écran qui fixe de l'argent, savoir
 * qui a recalculé quoi, quand, et depuis quelle valeur fait partie du dossier.
 */
export function figerOperation(op, calcul, utilisateurId = null) {
  const v = calcul.valorisation
  const valeurs = {
    volume_cumac: calcul.eligibilite.applicable ? calcul.cumac.cumac : 0,
    prime_delegataire: v?.caDelegataire ?? null,
    prime_beneficiaire: v?.primeBeneficiaire ?? null,
    commission_installateur: v?.commissionInstallateur ?? null,
    commission_apporteur: v?.commissionApporteur ?? null,
    cout_pose: v?.coutPose ?? op.cout_pose ?? 0,
    marge_nette: v?.margeNette ?? null,
  }

  const libelles = {
    volume_cumac: 'Volume cumac (kWh)',
    prime_delegataire: 'Versé par le délégataire (€)',
    prime_beneficiaire: 'Prime cédée au bénéficiaire (€)',
    commission_installateur: 'Commission installateur (€)',
    commission_apporteur: 'Commission apporteur (€)',
    cout_pose: 'Coût de pose (€)',
    marge_nette: 'Marge nette (€)',
  }

  for (const [champ, valeur] of Object.entries(valeurs)) {
    if (String(op[champ] ?? '') === String(valeur ?? '')) continue
    run(`UPDATE operation SET ${champ} = ? WHERE id = ?`, [valeur, op.id])
    journaliser({
      entite: 'Operation', entiteId: op.id, dossierId: op.dossier_id,
      champ: `${op.fiche_code} — ${libelles[champ]}`,
      ancienne: op[champ], nouvelle: valeur, utilisateurId,
    })
  }
  run('UPDATE operation SET date_calcul = ? WHERE id = ?', [new Date().toISOString(), op.id])
  return valeurs
}

/**
 * Remet les totaux du dossier en accord avec ses opérations.
 *
 * **Seules les opérations figées sont sommées.** C'est toute la règle de gel : une
 * opération ajoutée mais pas encore valorisée ne déplace aucun montant déjà arrêté.
 *
 * `date_calcul` du dossier prend la date de calcul la plus RÉCENTE de ses opérations : le
 * dossier est figé tant qu'au moins une opération l'est, et la date dit quand ses montants
 * ont bougé pour la dernière fois.
 *
 * L'identité de la fiche, de la charte et de la quantité du dossier suit l'opération
 * principale — c'est ce qui permet à la recherche, aux exports et au tableau de bord de
 * continuer à fonctionner sans être réécrits.
 *
 * @returns {{operations:number, figees:number, enAttente:number, totaux:object}}
 */
export function synchroniserDossier(dossierId, utilisateurId = null) {
  const ops = all('SELECT * FROM operation WHERE dossier_id = ? ORDER BY ordre, created_at', [dossierId])
  const figees = ops.filter((o) => o.date_calcul)

  // Zéro et « on ne sait pas » ne sont pas la même chose : voir `totalOuVide`.
  const totaux = {}
  for (const champ of RESULTATS) totaux[champ] = totalOuVide(figees, champ)

  const avant = get('SELECT * FROM dossier WHERE id = ?', [dossierId])
  if (!avant) return { operations: 0, figees: 0, enAttente: 0, totaux }

  for (const champ of RESULTATS) {
    if (String(avant[champ] ?? '') === String(totaux[champ] ?? '')) continue
    run(`UPDATE dossier SET ${champ} = ? WHERE id = ?`, [totaux[champ], dossierId])
    journaliser({
      entite: 'Dossier', entiteId: dossierId, dossierId,
      champ: `Total dossier — ${champ}`,
      ancienne: avant[champ], nouvelle: totaux[champ], utilisateurId,
    })
  }

  const derniere = figees.length
    ? figees.map((o) => o.date_calcul).sort().at(-1)
    : null
  if (String(avant.date_calcul ?? '') !== String(derniere ?? '')) {
    run('UPDATE dossier SET date_calcul = ? WHERE id = ?', [derniere, dossierId])
  }

  // L'identité du dossier suit son opération principale, pour que tout l'existant tienne.
  const principale = ops[0]
  if (principale) {
    const suivis = {
      fiche_id: principale.fiche_id,
      fiche_version_id: principale.fiche_version_id,
      charte: principale.charte,
      quantite: principale.quantite,
      installateur_id: principale.installateur_id,
    }
    for (const [champ, valeur] of Object.entries(suivis)) {
      if (valeur == null) continue
      if (String(avant[champ] ?? '') === String(valeur ?? '')) continue
      run(`UPDATE dossier SET ${champ} = ? WHERE id = ?`, [valeur, dossierId])
    }
  }

  return {
    operations: ops.length,
    figees: figees.length,
    enAttente: ops.length - figees.length,
    totaux,
  }
}


/**
 * Le chantier principal d'un dossier, créé au besoin.
 *
 * Un dossier repris ou créé avant ce modèle n'a pas de chantier : plutôt que de refuser
 * d'ajouter une opération, on rattrape le retard silencieusement, à partir du site que le
 * dossier porte déjà.
 */
export function chantierPrincipal(dossierId) {
  const existant = get('SELECT * FROM chantier WHERE dossier_id = ? ORDER BY principal DESC, ordre LIMIT 1', [dossierId])
  if (existant) return existant

  const d = get('SELECT site_id FROM dossier WHERE id = ?', [dossierId])
  if (!d?.site_id) return null

  const id = crypto.randomUUID()
  run(`INSERT INTO chantier (id, dossier_id, site_id, principal, libelle, ordre)
       VALUES (?,?,?,1,'Chantier principal',1)`, [id, dossierId, d.site_id])
  return get('SELECT * FROM chantier WHERE id = ?', [id])
}
