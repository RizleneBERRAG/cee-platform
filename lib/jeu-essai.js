/**
 * Un petit jeu de dossiers, planté à la demande dans une base de test.
 *
 * ── Pourquoi ce fichier existe ──
 *
 * Plusieurs suites de contrôle travaillaient sur une copie de la base réelle : elles
 * cherchaient « un dossier figé », « un dossier à plusieurs chantiers », et vérifiaient
 * leurs règles dessus. Tant que la base portait 1 677 dossiers repris, ça marchait.
 * Le jour où elle a été vidée — activité archivée, plateforme repartie à neuf — les mêmes
 * contrôles se sont mis à échouer sans qu'aucune règle n'ait bougé.
 *
 * Un contrôle qui ne passe que si la base contient un certain import n'est pas un
 * contrôle : c'est une observation. Ce module donne aux suites de quoi se tenir debout
 * toutes seules, sur des données qu'elles fabriquent et dont elles connaissent les
 * réponses à l'avance.
 *
 * ── Ce qu'il plante, et pourquoi ainsi ──
 *
 * Trois dossiers, **sans opération ni chantier** — exactement dans l'état où l'ancien
 * logiciel les livrait. C'est la reprise (`reprendreDossiersEnOperations`) qui leur crée
 * leur chantier principal et leur première opération, et c'est justement elle que les
 * contrôles vérifient. Planter les opérations à sa place reviendrait à tester le jeu
 * d'essai au lieu de tester la reprise.
 *
 * Les trois cas :
 *
 * - **un dossier figé** : celui qui vérifie que la règle de gel tient — ajouter une
 *   opération ne doit pas réécrire ses montants ;
 * - **un deuxième dossier figé, en régime précaire** : de quoi vérifier que la projection
 *   ne mélange pas deux dossiers ;
 * - **un dossier NON figé**, sans date de calcul ni montants : celui qui vérifie qu'un
 *   dossier non valorisé n'est pas compté pour zéro.
 *
 * Les montants sont ronds et invraisemblables (1 000, 2 500) : c'est voulu. Un chiffre
 * rond dans un message d'erreur se reconnaît immédiatement comme venant du jeu d'essai, et
 * non d'une donnée réelle.
 */

const uid = () => crypto.randomUUID()

/** La marque que `jeu-demo.mjs` appose sur tout ce qu'il pose. */
export const MARQUE_DEMO = 'Jeu de démonstration'

/**
 * La base contient-elle de VRAIES données ?
 *
 * ── Pourquoi ce n'est pas « la base est-elle vide » ──
 *
 * Le jeu d'essai n'est planté que sur une base sans données réelles : sur une base
 * peuplée, ce sont les vraies données qu'on veut éprouver, pas des fixtures.
 *
 * Mais « peuplée » ne voulait dire que « au moins un dossier ». Le jour où un dossier de
 * DÉMONSTRATION a été posé pour essayer les écrans, trois suites ont cru travailler sur du
 * réel, n'ont plus trouvé les cas qu'elles cherchaient, et ont échoué — alors que rien dans
 * l'application n'avait bougé. Un contrôle qui rougit à cause d'une donnée d'essai apprend
 * surtout à ignorer les contrôles.
 *
 * On ne compte donc que les dossiers qui ne portent pas la marque de la démonstration.
 */
export function baseVide(db) {
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM dossier WHERE source IS NULL OR source <> ?')
      .get(MARQUE_DEMO).n === 0
  } catch {
    return true
  }
}

/**
 * Plante le jeu d'essai. Sans effet si la base porte déjà des dossiers.
 *
 * @returns {{plante:boolean, dossiers:object}} les identifiants, pour que l'appelant
 *          puisse viser un cas précis sans le chercher.
 */
export function planterJeuEssai(db) {
  if (!baseVide(db)) return { plante: false, dossiers: {} }

  const run = (s, p = []) => db.prepare(s).run(...p)

  // ── Le référentiel minimal ──
  const ficheId = uid()
  const versionId = uid()
  run('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
    [ficheId, 'ESSAI-XX-001', 'BAT', 'EQ', "Fiche d'essai"])
  run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, formule_type,
       unite_variable, coefficients, conditions) VALUES (?,?,?,?,?,?,?,?)`,
    [versionId, ficheId, 'A1-1', '2020-01-01', 'FORFAIT_PAR_UNITE', 'U',
     JSON.stringify({ forfait: 1000 }), '[]'])

  const delegataireId = uid()
  run('INSERT INTO delegataire (id, nom, oblige) VALUES (?,?,?)',
    [delegataireId, 'DÉLÉGATAIRE ESSAI', 'OBLIGÉ ESSAI'])

  const installateurId = uid()
  run('INSERT INTO installateur_rge (id, raison_sociale, siret) VALUES (?,?,?)',
    [installateurId, 'INSTALLATEUR ESSAI', '00000000000000'])

  // Un contrat, avec un mode de reversement CHOISI : sans lui, aucune marge ne se
  // calculerait et les contrôles qui vérifient qu'un tarif modifié ne recalcule pas les
  // dossiers figés n'auraient rien à observer.
  const dealId = uid()
  run(`INSERT INTO deal (id, libelle, version, delegataire_id, date_debut, actif, par_defaut,
       mode_reversement, r_deleg_classique_sans_mpr, r_cede_classique_sans_mpr,
       r_garde_classique_sans_mpr, r_deleg_precaire_sans_mpr, r_cede_precaire_sans_mpr,
       r_garde_precaire_sans_mpr)
       VALUES (?,?,?,?,?,1,0,?,?,?,?,?,?,?)`,
    [dealId, 'DEAL ESSAI', 'V1', delegataireId, '2020-01-01', 'CUMULE',
     10, 5, 2, 12, 7, 2])

  /** Fabrique un dossier avec son bénéficiaire et son site. */
  function dossier({ numero, zone, regime = 'CLASSIQUE' }) {
    const benefId = uid(); const siteId = uid(); const dId = uid()
    run(`INSERT INTO beneficiaire (id, type, raison_sociale, siret, regime_revenu)
         VALUES (?,?,?,?,?)`, [benefId, 'SOCIETE', `ESSAI ${numero}`, '00000000000000', regime])
    run(`INSERT INTO site (id, adresse, code_postal, ville, departement, zone_climatique, secteur_activite)
         VALUES (?,?,?,?,?,?,?)`,
      [siteId, "1 rue de l'Essai", '69000', 'Lyon', '69', zone, 'INDUSTRIE'])
    run(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id,
         delegataire_id, deal_id, date_engagement) VALUES (?,?,?,?,?,?,?,?,?)`,
      [dId, numero, benefId, siteId, ficheId, versionId, delegataireId, dealId, '2026-01-15'])
    return { id: dId, siteId, benefId }
  }

  /**
   * Pose les montants FIGÉS d'un dossier, comme le faisait l'ancien logiciel : sur le
   * dossier lui-même, avant qu'il n'ait la moindre opération.
   */
  function figer(dossierId, montant) {
    run(`UPDATE dossier SET quantite = ?, charte = 'HORS_CDP', installateur_id = ?,
         cout_pose = 0, volume_cumac = ?, prime_delegataire = ?, prime_beneficiaire = ?,
         commission_installateur = ?, commission_apporteur = ?, marge_nette = ?,
         date_calcul = ? WHERE id = ?`,
      [1, installateurId, montant * 100, montant, montant * 0.6, montant * 0.2,
       montant * 0.08, montant * 0.12, '2026-02-01T10:00:00.000Z', dossierId])
  }

  const fige = dossier({ numero: 'ESSAI-2026-0001', zone: 'H1' })
  figer(fige.id, 1000)

  // Celui-ci porte volontairement un montant au DIXIÈME DE CENTIME (1 605,5585 €), comme
  // l'export de l'ancien logiciel en produisait. Il garde vivant le contrôle qui interdit
  // d'« arrondir pour faire propre » les montants venus de la source : les arrondir
  // éloignerait la plateforme de ce qui a été facturé.
  const precaire = dossier({ numero: 'ESSAI-2026-0002', zone: 'H3', regime: 'PRECAIRE' })
  run(`UPDATE dossier SET quantite = 1, charte = 'HORS_CDP', installateur_id = ?,
       cout_pose = 0, volume_cumac = ?, prime_delegataire = ?, prime_beneficiaire = ?,
       commission_installateur = ?, commission_apporteur = ?, marge_nette = ?,
       date_calcul = ? WHERE id = ?`,
    // La prime est au dixième de centime, la MARGE est au centime : c'est exactement le
    // motif observé dans l'export de l'ancien logiciel. Rendre la marge elle aussi fine
    // ferait diverger le total du dossier (arrondi) de son opération (non arrondie), et
    // le contrôle de cohérence le signalerait — à juste titre.
    [installateurId, 250000, 2500, 1605.5585, 500, 200, 194.44,
     '2026-02-01T10:00:00.000Z', precaire.id])

  // Non figé : ni date de calcul, ni montants. Il doit rester distinct d'un dossier à zéro.
  const nonFige = dossier({ numero: 'ESSAI-2026-0003', zone: 'H2' })
  run('UPDATE dossier SET quantite = 1, charte = ?, installateur_id = ? WHERE id = ?',
    ['HORS_CDP', installateurId, nonFige.id])

  // ── Remettre la reprise à faire ──
  //
  // La base de travail porte la trace que l'étape « reprise en opérations » a déjà été
  // passée : elle ne se rejouera donc pas, et nos trois dossiers resteraient sans
  // opération. On efface cette trace SUR LA COPIE DE TEST, pour que la reprise s'exécute
  // sur eux — c'est elle que la suite contrôle.
  //
  // Sans danger : cette fonction ne fait rien sur une base qui contient des dossiers, et
  // les suites travaillent toujours sur une copie.
  // L'arrondi au centime des TOTAUX est effacé pour la même raison, et dans le même ordre
  // que la base réelle l'a vécu : reprise, puis arrondi. Sans lui, le total du dossier
  // resterait au dixième de centime (1 605,5585) alors que la projection, elle, arrondit —
  // et la première resynchronisation ferait bouger le chiffre. Ce n'est pas une dérive :
  // c'est l'étape d'arrondi qui n'a pas eu lieu.
  for (const etape of ['2026-09-16-reprise-operations', '2026-09-17-arrondi-centime']) {
    try {
      db.prepare('DELETE FROM migration_manuelle WHERE nom = ?').run(etape)
    } catch { /* la table n'existe pas encore : les étapes se joueront de toute façon */ }
  }

  return {
    plante: true,
    dossiers: { fige: fige.id, precaire: precaire.id, nonFige: nonFige.id },
    ficheId, versionId, delegataireId, installateurId, dealId,
  }
}

/**
 * Retire le jeu d'essai d'une base.
 *
 * Réservé aux suites qui doivent travailler sur la base RÉELLE parce qu'elles passent par
 * le serveur — lequel lit ce fichier-là et pas une copie. Elles plantent, contrôlent, puis
 * nettoient. Sans ce nettoyage, une plateforme neuve se retrouverait avec trois dossiers
 * « ESSAI » que le gérant découvrirait sans comprendre d'où ils viennent.
 *
 * Ne supprime QUE ce que `planterJeuEssai` a créé, reconnu à ses libellés. Un dossier réel
 * ne s'appelle pas « ESSAI-2026-000x » et une fiche réelle n'a pas le code « ESSAI-XX-001 ».
 */
export function retirerJeuEssai(db) {
  const run = (s, p = []) => { try { return db.prepare(s).run(...p) } catch { return { changes: 0 } } }
  const ids = db.prepare("SELECT id, beneficiaire_id, site_id FROM dossier WHERE numero LIKE 'ESSAI-%'").all()

  for (const d of ids) {
    for (const t of ['proposition_champ', 'proposition', 'session_client', 'acces_client',
      'reponse_qualification', 'document_dossier', 'note', 'journal_champ',
      'dossier_intervenant', 'controle', 'audit_energetique', 'operation']) {
      run(`DELETE FROM ${t} WHERE dossier_id = ?`, [d.id])
    }
    // Les chantiers portent leur propre site : on les retire avant de perdre leur trace.
    for (const c of db.prepare('SELECT site_id FROM chantier WHERE dossier_id = ?').all(d.id)) {
      run('DELETE FROM site WHERE id = ?', [c.site_id])
    }
    run('DELETE FROM chantier WHERE dossier_id = ?', [d.id])
    run('DELETE FROM dossier WHERE id = ?', [d.id])
    run('DELETE FROM beneficiaire WHERE id = ?', [d.beneficiaire_id])
    run('DELETE FROM site WHERE id = ?', [d.site_id])
  }

  run("DELETE FROM deal WHERE libelle = 'DEAL ESSAI'")
  run("DELETE FROM delegataire WHERE nom = 'DÉLÉGATAIRE ESSAI'")
  run("DELETE FROM installateur_rge WHERE raison_sociale = 'INSTALLATEUR ESSAI'")
  run("DELETE FROM fiche_version WHERE fiche_id IN (SELECT id FROM fiche WHERE code = 'ESSAI-XX-001')")
  run("DELETE FROM fiche WHERE code = 'ESSAI-XX-001'")
  return { retires: ids.length }
}
