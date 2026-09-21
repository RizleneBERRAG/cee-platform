-- Plateforme CEE — DDL SQLite.
--
-- ── CE FICHIER EST LE MODÈLE DE RÉFÉRENCE ──
--
-- Il l'est parce qu'il est le seul que la plateforme exécute réellement : la base est créée
-- et mise à niveau à partir d'ici, et nulle part ailleurs.
--
-- L'en-tête précédent désignait `prisma/schema.prisma` comme référence. Ce n'était plus
-- vrai : ce fichier-là ignorait `operation`, `chantier`, `produit`, `dossier_intervenant`
-- et `audit_energetique`, et portait au contraire des modèles jamais construits. Aucune
-- ligne de code ne l'importe. Un commentaire qui ment est plus coûteux qu'un commentaire
-- absent : il fait chercher la vérité au mauvais endroit. Voir prisma/LISEZ-MOI.md.
--
-- Cible de production : PostgreSQL. La migration se fera par introspection de cette base,
-- pas en repartant d'un schéma écrit à la main.

PRAGMA foreign_keys = ON;

-- ── Accès ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS unite_affaire (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'REGIE',
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS role (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  -- Liste JSON de permissions. En données et non en code : ouvrir un droit à un rôle
  -- ne doit pas demander une livraison.
  permissions TEXT NOT NULL DEFAULT '[]',
  parent_id TEXT REFERENCES role(id)
);

CREATE TABLE IF NOT EXISTS utilisateur (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nom TEXT NOT NULL,
  prenom TEXT NOT NULL,
  role_id TEXT REFERENCES role(id),
  unite_affaire_id TEXT REFERENCES unite_affaire(id),
  actif INTEGER NOT NULL DEFAULT 1,
  -- Empreinte scrypt « scrypt$N$r$p$sel$empreinte ». Jamais le mot de passe.
  -- NULL = compte qui n'a pas encore été activé : il ne peut pas se connecter.
  mot_de_passe TEXT,
  doit_changer_mdp INTEGER NOT NULL DEFAULT 0,
  derniere_connexion TEXT,
  -- Compteur d'échecs consécutifs, pour ralentir les tentatives en force brute.
  echecs INTEGER NOT NULL DEFAULT 0,
  bloque_jusqua TEXT
);

-- Sessions : le cookie ne porte qu'un jeton opaque. Tout l'état est ici, donc
-- révoquer une session est une suppression de ligne, pas une attente d'expiration.
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  utilisateur_id TEXT NOT NULL REFERENCES utilisateur(id),
  expire_le TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_user ON session(utilisateur_id);

-- ── Référentiel réglementaire (versionné et daté) ────────────
CREATE TABLE IF NOT EXISTS fiche (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  secteur TEXT NOT NULL,
  domaine TEXT NOT NULL,
  libelle TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fiche_version (
  id TEXT PRIMARY KEY,
  fiche_id TEXT NOT NULL REFERENCES fiche(id),
  version TEXT NOT NULL,
  date_effet TEXT NOT NULL,
  date_fin TEXT,
  arrete_reference TEXT,
  motif_fin TEXT,
  formule_type TEXT NOT NULL DEFAULT 'FORFAIT_PAR_UNITE',
  unite_variable TEXT,
  coefficients TEXT NOT NULL DEFAULT '[]',
  conditions TEXT NOT NULL DEFAULT '[]',
  UNIQUE (fiche_id, version)
);

-- ── Chaîne CEE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delegataire (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL,
  oblige TEXT,
  actif INTEGER NOT NULL DEFAULT 1,

  -- ── Le gabarit d'export de CE délégataire ──
  --
  -- L'annexe 6 fixe les INFORMATIONS à transmettre ; elle ne fixe pas la feuille de calcul.
  -- Chaque délégataire fournit la sienne, avec ses propres intitulés et son propre ordre de
  -- colonnes. Les y faire entrer en modifiant le code reviendrait à livrer une version par
  -- délégataire. On stocke donc la correspondance : un JSON [{colonne, champ}] où `colonne`
  -- est l'intitulé attendu par eux et `champ` le code d'un champ de lib/emmy.js.
  -- Vide : l'export sort avec les intitulés de l'annexe 6.
  gabarit_export TEXT,
  siren TEXT
);

CREATE TABLE IF NOT EXISTS installateur_rge (
  id TEXT PRIMARY KEY,
  raison_sociale TEXT NOT NULL,
  siret TEXT,
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS certification_rge (
  id TEXT PRIMARY KEY,
  installateur_id TEXT NOT NULL REFERENCES installateur_rge(id),
  libelle TEXT NOT NULL,
  numero TEXT,
  date_debut TEXT NOT NULL,
  date_fin TEXT NOT NULL
);

-- ── Entité émettrice : qui signe le devis ────────────────────
--
-- Le groupe émet ses devis sous PLUSIEURS sociétés. Le choix de l'entité n'est donc pas
-- un réglage global : il se fait dossier par dossier, et il engage — ce sont ses mentions
-- légales, son SIRET, son assurance et sa qualification RGE qui figurent au bas du devis.
--
-- Pourquoi ces champs et pas un bloc de texte libre : un pied de page saisi une fois puis
-- recopié se périme sans bruit. Les devis relevés dans les pièces jointes en portent la
-- preuve — ils affichent encore l'ancien établissement et un numéro de TVA amputé d'un
-- chiffre. Champ par champ, une donnée fausse se corrige à un seul endroit.
CREATE TABLE IF NOT EXISTS entite_emettrice (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,          -- court, stable : sert au préfixe de numérotation
  raison_sociale TEXT NOT NULL,
  forme_juridique TEXT,               -- SAS, SARL…
  capital REAL,                       -- en euros ; NULL = non renseigné, pas « zéro »
  siren TEXT,
  siret TEXT,                         -- l'établissement qui émet, pas forcément le siège
  naf TEXT,
  rcs_ville TEXT,
  rcs_numero TEXT,
  tva TEXT,
  adresse TEXT,
  code_postal TEXT,
  ville TEXT,
  telephone TEXT,
  email TEXT,
  site_web TEXT,
  representant_nom TEXT,
  representant_qualite TEXT,
  logo TEXT,                          -- chemin sous public/, ou NULL

  -- La qualification RGE n'est pas recopiée ici : elle vit dans `installateur_rge` /
  -- `certification_rge`, où sa validité est contrôlée à la date des travaux. Le devis va
  -- la chercher là. Deux copies d'une date de validité, c'est une copie périmée.
  installateur_id TEXT REFERENCES installateur_rge(id),

  -- Assurance décennale : obligation d'affichage sur le devis (art. L.243-2 du code des
  -- assurances). Sans elle le devis est irrégulier, d'où le contrôle avant émission.
  assurance_nom TEXT,
  assurance_police TEXT,
  assurance_couverture TEXT,          -- zone géographique couverte

  -- Le bas de page et les conditions, propres à chaque société.
  mentions_pied TEXT,
  conditions_reglement TEXT,
  validite_jours INTEGER NOT NULL DEFAULT 30,

  -- Le taux de TVA appliqué par défaut. NULL tant qu'il n'est pas décidé : la rénovation
  -- énergétique connaît 5,5 %, 10 % et 20 % selon les cas, et imprimer un taux deviné sur
  -- un devis signé est une erreur qui se rattrape en comptabilité, pas auprès du client.
  taux_tva_defaut REAL,

  -- Numérotation : préfixe et compteur PAR ENTITÉ. Deux sociétés ne partagent pas une
  -- série de numéros — chacune doit pouvoir justifier une suite continue devant son
  -- propre contrôle fiscal.
  devis_prefixe TEXT,
  devis_compteur INTEGER NOT NULL DEFAULT 0,
  -- L'année du compteur : sans elle, impossible de savoir s'il faut repartir à 1.
  devis_annee INTEGER,

  -- La série des FACTURES est distincte de celle des devis, et bien plus exigeante : elle
  -- doit être continue, sans trou et sans doublon, et un contrôle fiscal peut la demander.
  -- Les avoirs y prennent leur numéro aussi — un avoir est une facture.
  facture_prefixe TEXT,
  facture_compteur INTEGER NOT NULL DEFAULT 0,
  facture_annee INTEGER,

  -- Mentions obligatoires sur toute facture entre professionnels (art. L.441-10 et
  -- D.441-5 du code de commerce). Les valeurs par défaut sont celles de la loi : le taux
  -- légal de pénalités et les 40 € d'indemnité forfaitaire de recouvrement.
  taux_penalites REAL NOT NULL DEFAULT 10.85,
  indemnite_recouvrement REAL NOT NULL DEFAULT 40,
  delai_paiement_jours INTEGER NOT NULL DEFAULT 30,

  par_defaut INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1
);

-- ── Factures ─────────────────────────────────────────────────
--
-- ── Pourquoi une table, et pas un simple bouton « imprimer » ──
--
-- Un devis se rejoue : il décrit une proposition, et si les chiffres changent, on en
-- réimprime un. Une facture, non. Une fois émise, elle est entrée dans la comptabilité du
-- client et dans la sienne : elle ne se modifie plus, ne se supprime pas, et son numéro
-- appartient à une suite continue qu'un contrôle fiscal peut demander à voir. Elle doit
-- donc être STOCKÉE, pas régénérée — sinon une correction d'opération faite six mois plus
-- tard réécrirait un document déjà payé.
--
-- D'où la conception : à l'émission, les lignes sont RECOPIÉES dans `facture_ligne`. La
-- facture ne dépend plus de l'opération une fois éditée. Corriger une facture se fait par
-- un AVOIR, qui est lui-même une facture — négative, numérotée dans la même suite, et qui
-- pointe vers celle qu'elle annule.
CREATE TABLE IF NOT EXISTS facture (
  id TEXT PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  entite_id TEXT NOT NULL REFERENCES entite_emettrice(id),

  -- FACTURE | AVOIR. Un avoir porte les mêmes montants, en négatif.
  type TEXT NOT NULL DEFAULT 'FACTURE',
  -- L'avoir désigne la facture qu'il annule ; une facture annulée n'est jamais effacée.
  annule_facture_id TEXT REFERENCES facture(id),

  date_emission TEXT NOT NULL,
  -- Date de la vente ou de la fin des travaux : c'est elle qui fait foi fiscalement,
  -- pas la date d'impression.
  date_prestation TEXT,
  date_echeance TEXT NOT NULL,

  -- ── Le client, RECOPIÉ ──
  -- Un client qui change de raison sociale ou d'adresse ne doit pas modifier
  -- rétroactivement les factures déjà émises à son ancien nom.
  client_nom TEXT NOT NULL,
  client_adresse TEXT,
  client_code_postal TEXT,
  client_ville TEXT,
  client_siret TEXT,
  client_tva TEXT,

  -- Les totaux, figés.
  total_ht REAL,
  total_tva REAL,
  total_ttc REAL,
  prime_deduite REAL,
  reste_a_payer REAL,

  -- Conditions au jour de l'émission, recopiées pour la même raison que le client.
  conditions_reglement TEXT,
  taux_penalites REAL,
  indemnite_recouvrement REAL,

  emise_par TEXT REFERENCES utilisateur(id),
  cree_le TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_facture_dossier ON facture(dossier_id);

-- Les lignes, recopiées à l'émission. Elles ne pointent PAS vers l'opération : elles en
-- gardent une photographie. L'opération peut ensuite être corrigée sans que la facture
-- déjà remise au client ne bouge d'un centime.
CREATE TABLE IF NOT EXISTS facture_ligne (
  id TEXT PRIMARY KEY,
  facture_id TEXT NOT NULL REFERENCES facture(id) ON DELETE CASCADE,
  ordre INTEGER NOT NULL DEFAULT 1,
  designation TEXT NOT NULL,
  detail TEXT,
  quantite REAL,
  unite TEXT,
  prix_unitaire_ttc REAL,
  total_ttc REAL,
  taux_tva REAL,
  -- La trace de l'opération d'origine, pour pouvoir remonter — sans en dépendre.
  operation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_facture_ligne ON facture_ligne(facture_id);

-- ── Deal : le contrat de rachat, versionné ───────────────────
CREATE TABLE IF NOT EXISTS deal (
  id TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT 'V1',
  delegataire_id TEXT NOT NULL REFERENCES delegataire(id),
  type_beneficiaire TEXT NOT NULL DEFAULT 'B2B_B2C',
  volume_cumac REAL,
  date_debut TEXT NOT NULL,
  date_fin TEXT,
  num_contrat_standard TEXT,
  num_contrat_cdp TEXT,
  num_contrat_mpr TEXT,
  -- Distincte de date_fin : le contrat s'arrête, mais les dossiers déjà engagés restent
  -- facturables au-delà. Confondre les deux dates fait perdre le droit de facturer.
  date_fin_facturation TEXT,
  par_defaut INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,

  -- ── Comment les trois lignes de la grille se combinent ──
  --
  -- La question n'a pas de réponse universelle, et les contrats repris de l'ancien
  -- logiciel le prouvent : sur onze sur douze, « prime cédée » + « commission
  -- installateur » dépasse ce que verse le délégataire. Deux lectures cohabitent donc
  -- dans les vraies données, et il faut pouvoir les dire toutes les deux :
  --
  --   CUMULE      les deux sont versés. La marge est le reste : délégataire − cédé − commission.
  --   ALTERNATIF  un seul s'applique, selon qui touche la prime. La marge est délégataire
  --               moins cette seule ligne.
  --   NULL        pas encore tranché — et c'est le défaut.
  --
  -- NULL n'est pas un oubli : tant que le mode n'est pas choisi, **aucune marge n'est
  -- calculée** sur ce contrat. Deviner ici produirait des marges fausses sur tout un
  -- portefeuille, sans que rien ne le signale. Mieux vaut une marge absente qu'une marge
  -- inventée.
  mode_reversement TEXT,

  -- ── Grille de ratios, en € par MWh cumac ──
  --
  -- Trois régimes de revenus × avec ou sans MaPrimeRénov' × trois parties : ce que verse
  -- le délégataire, ce qui est cédé au bénéficiaire, ce qui revient à l'installateur.
  -- Dix-huit cases, relevées sur l'ancien logiciel — qui en portait autant.
  --
  -- **NULL, pas 0.** Une case vide veut dire « ce tarif n'est pas renseigné » ; un zéro
  -- voudrait dire « ce tarif est nul », c'est-à-dire gratuit. Les confondre ferait
  -- calculer des marges sur des conditions qu'on ne connaît pas. Le cas se présente
  -- réellement : l'ancien logiciel n'a aucun champ pour le tarif délégataire en précaire
  -- hors MaPrimeRénov', et cette case revient donc vide sur les douze contrats repris.
  r_deleg_grande_precarite_sans_mpr REAL,
  r_deleg_grande_precarite_avec_mpr REAL,
  r_cede_grande_precarite_sans_mpr REAL,
  r_cede_grande_precarite_avec_mpr REAL,
  r_garde_grande_precarite_sans_mpr REAL,
  r_garde_grande_precarite_avec_mpr REAL,
  r_deleg_precaire_sans_mpr REAL,
  r_deleg_precaire_avec_mpr REAL,
  r_cede_precaire_sans_mpr REAL,
  r_cede_precaire_avec_mpr REAL,
  r_garde_precaire_sans_mpr REAL,
  r_garde_precaire_avec_mpr REAL,
  r_deleg_classique_sans_mpr REAL,
  r_deleg_classique_avec_mpr REAL,
  r_cede_classique_sans_mpr REAL,
  r_cede_classique_avec_mpr REAL,
  r_garde_classique_sans_mpr REAL,
  r_garde_classique_avec_mpr REAL,

  -- La provenance de la ligne : saisie ici, ou relevée sur l'ancien logiciel. Utile le
  -- jour où un chiffre surprend — on saura s'il a été tapé ou recopié.
  source TEXT,
  source_ref TEXT
);

-- La charte fait partie de la clé : relevé sur Pixel, la même fiche peut être portée deux
-- fois par un même deal — une fois hors coup de pouce, une fois en coup de pouce, avec des
-- conditions différentes. BAR-EN-103 est dans ce cas. Avec UNIQUE (deal_id, fiche_id), la
-- deuxième déclaration était rejetée et la moitié de l'offre devenait impossible à saisir.
CREATE TABLE IF NOT EXISTS deal_fiche (
  id TEXT PRIMARY KEY,
  deal_id TEXT NOT NULL REFERENCES deal(id),
  fiche_id TEXT NOT NULL REFERENCES fiche(id),
  charte TEXT NOT NULL DEFAULT 'HORS_CDP',
  actif INTEGER NOT NULL DEFAULT 1,
  UNIQUE (deal_id, fiche_id, charte)
);

-- ── Workflow paramétrable : Étape › Catégorie › Statut ───────
CREATE TABLE IF NOT EXISTS etape (
  id TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  ordre INTEGER NOT NULL,
  couleur TEXT NOT NULL DEFAULT '#64748b'
);

CREATE TABLE IF NOT EXISTS statut (
  id TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  couleur TEXT NOT NULL DEFAULT '#64748b',
  axe TEXT NOT NULL DEFAULT 'DOSSIER',
  perdu INTEGER NOT NULL DEFAULT 0,
  etape_id TEXT REFERENCES etape(id)
);

-- ── Bénéficiaire & site ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS beneficiaire (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'SOCIETE',
  raison_sociale TEXT,
  siret TEXT,
  code_ape TEXT,
  nom TEXT,
  prenom TEXT,
  email TEXT,
  telephone TEXT,
  regime_revenu TEXT NOT NULL DEFAULT 'CLASSIQUE'
);

CREATE TABLE IF NOT EXISTS site (
  id TEXT PRIMARY KEY,
  adresse TEXT NOT NULL,
  code_postal TEXT NOT NULL,
  ville TEXT NOT NULL,
  departement TEXT,
  -- Zone climatique : H1, H1_IDF, H2, H3 (voir lib/referentiels-site.js).
  -- H1_IDF est distinguée de H1 parce que les fiches la distinguent : même climat,
  -- forfaits différents.
  zone_climatique TEXT,
  secteur_activite TEXT,
  -- Âge du bâtiment en années : conservé en lecture pour l'historique, remplacé par la
  -- tranche ci-dessous. Les fiches raisonnent par tranches, pas en années.
  age_batiment INTEGER,
  -- NEUF, MOINS_2_ANS, DE_2_A_15_ANS, PLUS_15_ANS.
  age_batiment_tranche TEXT,
  surface REAL,
  -- COMBUSTIBLE, ELECTRIQUE, HYBRIDE — les trois seules valeurs du dispositif.
  type_chauffage TEXT,
  qpv INTEGER NOT NULL DEFAULT 0,

  -- La référence cadastrale du terrain. Elle figure sur les devis déjà émis par le groupe
  -- (« Parcelle cadastrale : 000 / YI / 0037 ») et sert à identifier le bien sans
  -- ambiguïté quand l'adresse ne suffit pas — un hangar agricole au lieu-dit, typiquement.
  parcelle_cadastrale TEXT
);

-- ── Lots de dépôt ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lot (
  id TEXT PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  organisme TEXT,
  statut TEXT NOT NULL DEFAULT 'EN_CONSTITUTION',
  date_depot TEXT,
  volume_cumac REAL,
  chiffre_affaire REAL,
  -- La référence que le registre attribue à la demande. Elle n'existe qu'une fois le dépôt
  -- ouvert côté EMMY : elle est donc saisie, jamais calculée.
  reference_emmy TEXT,
  delegataire_id TEXT REFERENCES delegataire(id)
);

-- ── Dossier ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dossier (
  id TEXT PRIMARY KEY,
  numero TEXT NOT NULL UNIQUE,
  ref_externe TEXT,
  unite_affaire_id TEXT REFERENCES unite_affaire(id),
  beneficiaire_id TEXT NOT NULL REFERENCES beneficiaire(id),
  site_id TEXT NOT NULL REFERENCES site(id),
  fiche_id TEXT NOT NULL REFERENCES fiche(id),
  fiche_version_id TEXT NOT NULL REFERENCES fiche_version(id),
  deal_id TEXT REFERENCES deal(id),
  delegataire_id TEXT REFERENCES delegataire(id),
  installateur_id TEXT REFERENCES installateur_rge(id),
  charte TEXT NOT NULL DEFAULT 'HORS_CDP',
  avec_mpr INTEGER NOT NULL DEFAULT 0,
  quantite REAL NOT NULL DEFAULT 0,
  source TEXT,
  -- résultats FIGÉS
  volume_cumac REAL,
  prime_delegataire REAL,
  prime_beneficiaire REAL,
  commission_installateur REAL,
  cout_pose REAL,
  commission_apporteur REAL,
  marge_nette REAL,
  date_calcul TEXT,
  -- statuts multi-axes
  etape_id TEXT REFERENCES etape(id),
  statut_dossier_id TEXT REFERENCES statut(id),
  statut_admin_id TEXT REFERENCES statut(id),
  statut_facturation_id TEXT REFERENCES statut(id),
  statut_installation_id TEXT REFERENCES statut(id),
  statut_cofrac_id TEXT REFERENCES statut(id),
  -- jalons
  date_engagement TEXT,
  date_confirmation TEXT,
  date_pose TEXT,
  date_controle TEXT,
  date_achevement TEXT,
  date_depot TEXT,
  verrouille INTEGER NOT NULL DEFAULT 0,
  lot_id TEXT REFERENCES lot(id),

  -- ── Ce que l'annexe 6 demande et que rien d'autre ne porte ──
  --
  -- Ces champs ne servent qu'au dépôt. Ils sont nuls tant que personne ne les a saisis, et
  -- l'export le dit ligne par ligne plutôt que d'envoyer une colonne vide : une demande
  -- incomplète revient, et elle revient des semaines plus tard.
  sous_traitant_siren TEXT,
  sous_traitant_raison_sociale TEXT,
  aides_hors_cee REAL,        -- autres aides perçues, en euros (MaPrimeRénov' comprise)
  nb_logements INTEGER,       -- pour les fiches qui s'expriment par logement
  cout_operation REAL,        -- à défaut, celui de la facture émise

  -- ── Devis et facture se configurent SÉPARÉMENT ──
  -- Un réglage unique paraissait suffisant. Il ne l'est pas : un devis « prime déduite »
  -- suivi d'une facture « prime non déduite » est une erreur comptable courante, et tant
  -- que les deux documents partagent un seul réglage, elle est indétectable — il n'existe
  -- aucun endroit où la constater. Deux réglages la rendent au moins visible.
  devis_conditions INTEGER NOT NULL DEFAULT 1,
  devis_deduire_prime INTEGER NOT NULL DEFAULT 1,
  facture_conditions INTEGER NOT NULL DEFAULT 1,
  facture_deduire_prime INTEGER NOT NULL DEFAULT 1,

  -- Le statut d'origine, tel que le logiciel précédent le portait. Conservé brut plutôt
  -- que traduit : leur liste mélange statuts, deals et listes de travail, et la traduire
  -- de force importerait leur dette de conception dans la nôtre. On garde la trace pour
  -- pouvoir y revenir, et notre propre statut vit à part.
  statut_origine TEXT,

  -- ── Parcours commercial ──
  -- Un dossier ne disait pas d'où il venait ni comment il avait été vendu. « Source » était
  -- un champ libre : trois orthographes du même canal, et aucune statistique possible.
  -- Ces champs-là sont ceux qui permettent de répondre à « quel canal rapporte le plus de
  -- marge », question qu'aucun écran ne savait poser jusqu'ici.
  type_lead TEXT,              -- FORM | APPEL_ENTRANT | PARRAINAGE | CALL_CENTER | …
  source_lead TEXT,
  campagne TEXT,
  rdv_confirme INTEGER NOT NULL DEFAULT 0,
  -- `date_confirmation` existe déjà plus bas, parmi les jalons : c'est la même date.
  -- La redéclarer ici faisait échouer tout le CREATE TABLE — et l'échec était avalé.
  date_rdv_planifie TEXT,
  date_rdv_visite TEXT,
  num_devis TEXT,
  date_proposition TEXT,
  date_signature TEXT,
  etat_devis TEXT,             -- A_EDITER | A_SIGNER | SIGNE | ANNULE | ORIGINAL_RECU | …

  -- Sous quelle société ce dossier est facturé. NULL tant que ce n'est pas tranché : le
  -- groupe émet sous plusieurs entités, et deviner laquelle mettrait de fausses mentions
  -- légales au bas d'un document signé par le client.
  entite_id TEXT REFERENCES entite_emettrice(id),

  -- Qui touche la prime sur CE dossier. Ne sert que sur un contrat en mode ALTERNATIF,
  -- où c'est ce champ qui désigne laquelle des deux lignes s'applique.
  -- BENEFICIAIRE (le cas courant) | INSTALLATEUR.
  destinataire_prime TEXT,

  -- ── Réseau public de chaleur — obligation réglementaire ──
  -- Sur les opérations de chauffage, l'absence de raccordement à un réseau existant doit
  -- être JUSTIFIÉE. Sans justification, le dossier est rejetable au contrôle. Ce n'est
  -- donc pas un champ de confort : c'est une pièce du dossier.
  reseau_statut TEXT,          -- RACCORDE | RACCORDEMENT_POSSIBLE | INEXISTANT | IMPOSSIBLE | PAS_ENR
  reseau_gestionnaire TEXT,
  reseau_nom TEXT,
  reseau_exploitant TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Conformité documentaire ──────────────────────────────────
CREATE TABLE IF NOT EXISTS type_document (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  libelle TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS liasse (
  id TEXT PRIMARY KEY,
  libelle TEXT NOT NULL,
  delegataire_id TEXT REFERENCES delegataire(id),
  fiche_code TEXT,
  actif INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS liasse_item (
  id TEXT PRIMARY KEY,
  liasse_id TEXT NOT NULL REFERENCES liasse(id),
  type_document_id TEXT NOT NULL REFERENCES type_document(id),
  obligatoire INTEGER NOT NULL DEFAULT 1,
  ordre INTEGER NOT NULL DEFAULT 0,
  UNIQUE (liasse_id, type_document_id)
);

CREATE TABLE IF NOT EXISTS document_dossier (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  type_document_id TEXT NOT NULL REFERENCES type_document(id),
  nom_fichier TEXT NOT NULL,
  valide_par_delegataire INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Le fichier lui-même vit sur le disque, pas en base : un blob par pièce ferait
  -- grossir la base jusqu'à la rendre impossible à sauvegarder ou à copier.
  -- L'empreinte SHA-256 sert de nom de fichier ET de clé de déduplication : deux dossiers
  -- qui portent la même attestation ne l'écrivent qu'une fois sur le disque.
  empreinte TEXT,
  taille INTEGER,
  type_mime TEXT,
  extension TEXT,
  depose_par TEXT REFERENCES utilisateur(id)
);
CREATE INDEX IF NOT EXISTS idx_document_empreinte ON document_dossier(empreinte);
CREATE INDEX IF NOT EXISTS idx_document_dossier ON document_dossier(dossier_id);

-- ── Communication, contrôle, traçabilité ─────────────────────
CREATE TABLE IF NOT EXISTS note (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  canal TEXT NOT NULL DEFAULT 'NOTE',
  contenu TEXT NOT NULL,
  utilisateur_id TEXT REFERENCES utilisateur(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Intervenants d'un dossier ────────────────────────────────
-- Sept personnes touchent un dossier avant qu'il soit signé : celui qui a généré le lead,
-- celui qui a confirmé le rendez-vous, celui qui l'a visité, celui qui a signé, son manager.
-- Le modèle n'en portait qu'une — l'apporteur — si bien qu'après coup personne ne savait
-- qui avait vendu quoi, et qu'aucune performance commerciale n'était calculable.
--
-- Table plutôt que sept colonnes : les rôles varient d'une société à l'autre, et un même
-- dossier peut en avoir deux du même type (deux commerciaux sur une grosse affaire).
-- Sept colonnes auraient figé la liste dans le schéma et interdit ce cas.
--
-- `utilisateur_id` OU `nom` : un télé-opérateur de plateau ou un apporteur externe n'a pas
-- de compte sur la plateforme. Refuser de l'enregistrer parce qu'il n'a pas de compte
-- reviendrait à perdre l'information ; on accepte donc un nom libre, en le disant.
CREATE TABLE IF NOT EXISTS dossier_intervenant (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  role TEXT NOT NULL,
  utilisateur_id TEXT REFERENCES utilisateur(id),
  nom TEXT,
  unite_affaire_id TEXT REFERENCES unite_affaire(id),
  -- Taux indicatif : la commission réellement calculée reste celle de l'opération.
  -- Deux endroits qui calculent de l'argent, c'est un de trop — voir lib/operations.js.
  taux_commission REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intervenant_dossier ON dossier_intervenant(dossier_id, role);
CREATE INDEX IF NOT EXISTS idx_intervenant_utilisateur ON dossier_intervenant(utilisateur_id);

-- ── Chantiers ────────────────────────────────────────────────
-- Un dossier porte plusieurs chantiers. Relevé sur le terrain : une exploitation agricole
-- fait isoler trois bâtiments d'un coup, un bailleur traite quatre adresses dans la même
-- opération. Avec un seul site par dossier, il fallait créer trois dossiers artificiels —
-- qui repartaient ensuite chacun dans un lot différent, avec trois fois le même bénéficiaire.
--
-- `dossier.site_id` reste le site du chantier principal : tous les écrans, la recherche et
-- les exports continuent de fonctionner sans être réécrits.
CREATE TABLE IF NOT EXISTS chantier (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  site_id TEXT NOT NULL REFERENCES site(id),
  principal INTEGER NOT NULL DEFAULT 0,
  libelle TEXT,
  ordre INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_chantier_dossier ON chantier(dossier_id, ordre);

-- ── Catalogue produits ───────────────────────────────────────
-- Le produit réellement posé, avec sa désignation commerciale et sa fiche technique.
-- C'est ce que le délégataire contrôle : « panneau X, puissance Y » doit correspondre à la
-- fiche d'opération déclarée. Un champ libre sur le devis ne suffit pas — il faut un
-- référentiel, sinon la même référence s'écrit de six façons et rien n'est vérifiable.
CREATE TABLE IF NOT EXISTS produit (
  id TEXT PRIMARY KEY,
  marque TEXT,
  reference TEXT,
  designation TEXT NOT NULL,
  description TEXT,
  unite TEXT,
  fiche_id TEXT REFERENCES fiche(id),
  actif INTEGER NOT NULL DEFAULT 1,
  UNIQUE (marque, reference)
);

-- ── Opérations d'un dossier ──────────────────────────────────
-- Le cœur du changement. Un dossier n'est plus « une fiche et une quantité » : c'est une
-- liste d'opérations, chacune posée sur un chantier, avec son produit, son installateur,
-- sa quantité, son prix unitaire de vente — et sa PROPRE valorisation figée.
--
-- Pourquoi figer au niveau de l'opération et non du dossier. Les opérations d'un même
-- dossier ne sont pas calculées le même jour : la première est chiffrée à la signature,
-- la quatrième est ajoutée trois mois plus tard, après un avenant, sous une grille qui a
-- pu changer entre-temps. Figer au niveau du dossier obligerait à tout recalculer pour
-- ajouter une ligne — donc à réécrire des montants déjà facturés.
--
-- Le total du dossier est la somme de ses opérations FIGÉES, et d'elles seules : une
-- opération ajoutée mais pas encore valorisée ne bouge aucun montant existant. Elle est
-- signalée à l'écran, et le recalcul reste une décision explicite.
CREATE TABLE IF NOT EXISTS operation (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  chantier_id TEXT REFERENCES chantier(id),
  ordre INTEGER NOT NULL DEFAULT 1,

  fiche_id TEXT NOT NULL REFERENCES fiche(id),
  fiche_version_id TEXT NOT NULL REFERENCES fiche_version(id),
  charte TEXT NOT NULL DEFAULT 'HORS_CDP',
  produit_id TEXT REFERENCES produit(id),
  installateur_id TEXT REFERENCES installateur_rge(id),

  quantite REAL NOT NULL DEFAULT 0,
  unite TEXT,
  puv REAL,                       -- prix unitaire de vente, en euros

  -- Les paramètres de valorisation sont CONSERVÉS, pas seulement saisis.
  -- Ils ne l'étaient pas : un recalcul sans ressaisir le taux d'apporteur remettait
  -- silencieusement la commission à zéro. Les stocker rend le recalcul reproductible.
  cout_pose REAL NOT NULL DEFAULT 0,
  taux_apporteur REAL NOT NULL DEFAULT 0,

  -- Taux de TVA de CETTE ligne. NULL = on prend celui de l'entité émettrice. Une ligne
  -- peut y déroger : sur un même chantier, la pose relève d'un taux et la fourniture d'un
  -- autre. Un taux unique par devis obligerait à scinder le devis.
  taux_tva REAL,

  -- ── Ce que la fiche a besoin de savoir, en plus du chantier ──
  --
  -- Certaines fiches font varier leur barème sur des critères qui n'appartiennent ni au
  -- site ni au produit : la nature de ce qu'on sèche, le type d'installation posée.
  -- Sur AGRI-EQ-110 — la fiche du séchage solaire — l'écart est considérable : le barème
  -- forestier vaut environ 2,4 fois l'agricole (102 600 contre 42 700 kWh cumac/kW en
  -- zone H1). Se tromper de case, c'est se tromper du simple au double sur la prime.
  --
  -- NULL tant que ce n'est pas saisi : le calcul refuse alors de conclure plutôt que de
  -- retenir un barème au hasard.
  type_produit TEXT,        -- AGRICOLE | FORESTIER
  type_installation TEXT,   -- SYSTEME_COMPLET | TOITURE_COUPLEE

  -- Résultats FIGÉS de cette opération
  volume_cumac REAL,
  prime_delegataire REAL,
  prime_beneficiaire REAL,
  commission_installateur REAL,
  commission_apporteur REAL,
  marge_nette REAL,
  date_calcul TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_operation_dossier ON operation(dossier_id, ordre);
CREATE INDEX IF NOT EXISTS idx_operation_fiche ON operation(fiche_id);

-- ── Bureaux de contrôle accrédités ───────────────────────────
-- La date de fin d'accréditation n'est pas décorative. L'accréditation COFRAC est datée ;
-- un contrôle réalisé après son échéance ne vaut rien, et le dossier est rejeté au dépôt —
-- des mois plus tard, quand plus personne ne fait le lien. La date est donc portée par le
-- référentiel, et la vérification se fait à la saisie du contrôle, pas au dépôt.
CREATE TABLE IF NOT EXISTS bureau_controle (
  id TEXT PRIMARY KEY,
  nom TEXT NOT NULL UNIQUE,
  date_fin_accreditation TEXT,
  actif INTEGER NOT NULL DEFAULT 1
);

-- ── Contrôles ────────────────────────────────────────────────
-- `passage` : un dossier non conforme au premier contrôle est contre-contrôlé. Les deux
-- passages coexistent — le premier n'est pas écrasé, sinon on perd la trace de la
-- non-conformité et de ce qui a été corrigé.
CREATE TABLE IF NOT EXISTS controle (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id),
  passage INTEGER NOT NULL DEFAULT 1,
  bureau_controle_id TEXT REFERENCES bureau_controle(id),
  modalite TEXT NOT NULL,
  date TEXT,
  resultat TEXT,
  motif TEXT,
  montant REAL,
  solde_effectue INTEGER NOT NULL DEFAULT 0,
  date_solde TEXT
);
CREATE INDEX IF NOT EXISTS idx_controle_dossier ON controle(dossier_id, passage);

-- ── Audit énergétique et bureau d'étude ──────────────────────
-- Bloc distinct, et non une poignée de colonnes de plus sur `dossier` : la rénovation
-- d'ampleur et la rénovation globale EXIGENT un audit réalisé avec un moteur de calcul
-- identifié et versionné. Sans ce bloc, ces opérations sont tout simplement insaisissables
-- chez nous — ce n'est pas un manque de confort, c'est une famille d'opérations perdue.
CREATE TABLE IF NOT EXISTS audit_energetique (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id) UNIQUE,
  type_audit TEXT,             -- INCITATIF | REGLEMENTAIRE
  bureau_etude TEXT,
  auditeur TEXT,
  qualification TEXT,
  date_demande TEXT,
  date_realisation TEXT,
  numero_audit TEXT,
  reference_rapport TEXT,
  etat_rapport TEXT,           -- A_REALISER | INCOMPLET | VALIDE
  logiciel TEXT,
  editeur_logiciel TEXT,
  version_logiciel TEXT,
  date_version_logiciel TEXT,
  moteur_calcul TEXT,
  cout REAL,
  date_facturation TEXT,
  scenario TEXT,
  numero_diagnostiqueur TEXT
);

-- Journal AU NIVEAU DU CHAMP
CREATE TABLE IF NOT EXISTS journal_champ (
  id TEXT PRIMARY KEY,
  entite TEXT NOT NULL,
  entite_id TEXT NOT NULL,
  dossier_id TEXT REFERENCES dossier(id),
  champ TEXT NOT NULL,
  ancienne TEXT,
  nouvelle TEXT,
  utilisateur_id TEXT REFERENCES utilisateur(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_journal_entite ON journal_champ(entite, entite_id);
CREATE INDEX IF NOT EXISTS idx_dossier_statut ON dossier(statut_dossier_id);
CREATE INDEX IF NOT EXISTS idx_dossier_fiche ON dossier(fiche_id);

-- ── Rapports d'import de dossiers ────────────────────────────
-- Le rapport survit à l'import : on doit pouvoir revenir dessus une semaine plus tard
-- pour savoir pourquoi 40 lignes sur 2 600 ne sont jamais arrivées.
CREATE TABLE IF NOT EXISTS import_lot (
  id TEXT PRIMARY KEY,
  nom_fichier TEXT,
  lignes INTEGER NOT NULL DEFAULT 0,
  crees INTEGER NOT NULL DEFAULT 0,
  ignores INTEGER NOT NULL DEFAULT 0,
  rejetes INTEGER NOT NULL DEFAULT 0,
  simulation INTEGER NOT NULL DEFAULT 0,
  rapport TEXT,
  utilisateur_id TEXT REFERENCES utilisateur(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_dossier_ref ON dossier(ref_externe);

-- ── Espace client ────────────────────────────────────────────
--
-- Un accès par dossier, jamais par personne : le client n'a pas de compte sur la
-- plateforme, il a un lien vers SON dossier. Pas de compte, donc pas de mot de passe à
-- gérer, pas de réinitialisation, et rien à révoquer d'autre que l'accès lui-même.
--
-- L'identifiant est public (il voyage dans l'URL) ; le secret ne l'est pas et n'est stocké
-- que sous forme d'empreinte. Un accès volé se révoque en une ligne sans toucher au dossier.
CREATE TABLE IF NOT EXISTS acces_client (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  -- Ce qui apparaît dans l'URL. Assez long pour ne pas se deviner, assez court pour se dicter.
  identifiant TEXT NOT NULL UNIQUE,
  -- Empreinte scrypt du code d'accès. Le code en clair n'est affiché qu'une fois, à la création.
  secret_empreinte TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  cree_par TEXT REFERENCES utilisateur(id),
  derniere_visite TEXT,
  visites INTEGER NOT NULL DEFAULT 0,
  revoque_le TEXT,
  revoque_par TEXT REFERENCES utilisateur(id)
);
CREATE INDEX IF NOT EXISTS idx_acces_dossier ON acces_client(dossier_id);

-- Une soumission du client. Elle ne touche à rien : c'est une COPIE en attente.
CREATE TABLE IF NOT EXISTS proposition (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  acces_client_id TEXT REFERENCES acces_client(id),
  -- EN_ATTENTE, TRAITEE
  statut TEXT NOT NULL DEFAULT 'EN_ATTENTE',
  message TEXT,
  soumise_le TEXT NOT NULL DEFAULT (datetime('now')),
  traitee_le TEXT,
  traitee_par TEXT REFERENCES utilisateur(id)
);
CREATE INDEX IF NOT EXISTS idx_proposition_dossier ON proposition(dossier_id, statut);

-- Le détail, champ par champ. Le gérant tranche ligne à ligne : accepter, amender, refuser.
CREATE TABLE IF NOT EXISTS proposition_champ (
  id TEXT PRIMARY KEY,
  proposition_id TEXT NOT NULL REFERENCES proposition(id) ON DELETE CASCADE,
  -- « beneficiaire.telephone », « site.adresse » : la cible, entité comprise.
  champ TEXT NOT NULL,
  -- La valeur au moment de la soumission, pour que le gérant voie ce qui change ET
  -- qu'on détecte si elle a bougé entre-temps.
  valeur_avant TEXT,
  valeur_proposee TEXT,
  -- EN_ATTENTE, ACCEPTE, AMENDE, REFUSE
  decision TEXT NOT NULL DEFAULT 'EN_ATTENTE',
  valeur_retenue TEXT,
  motif TEXT
);
CREATE INDEX IF NOT EXISTS idx_proposition_champ ON proposition_champ(proposition_id);

-- La session d'un client dans son espace. Distincte de `session`, qui est celle du
-- personnel : mélanger les deux ferait qu'un défaut sur l'une ouvrirait l'autre, et un
-- client n'a rien à voir avec un utilisateur de la plateforme. Le cookie ne porte qu'un
-- jeton opaque ; tout l'état est ici, donc révoquer un accès coupe la session en cours.
CREATE TABLE IF NOT EXISTS session_client (
  id TEXT PRIMARY KEY,
  acces_client_id TEXT NOT NULL REFERENCES acces_client(id) ON DELETE CASCADE,
  expire_le TEXT NOT NULL,
  cree_le TEXT NOT NULL DEFAULT (datetime('now')),
  agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_client ON session_client(acces_client_id);

-- ── Fiche de qualification ───────────────────────────────────
--
-- Le relevé fait à la première visite : activité, produit à sécher, bâtiment, énergie
-- disponible, contraintes. Une centaine de champs, et d'autres fiches viendront avec
-- d'autres produits — d'où un stockage en (clé, valeur) plutôt qu'une table à cent
-- colonnes qu'il faudrait migrer à chaque nouveau questionnaire.
--
-- Les valeurs sont en TEXTE, y compris les nombres. C'est un relevé déclaratif, pas une
-- base de calcul : « environ 200 tonnes » et « 12 à 15 » sont des réponses légitimes ici,
-- et les forcer en réels les perdrait. Le dimensionnement, lui, se fait sur des valeurs
-- vérifiées par le bureau d'études.
CREATE TABLE IF NOT EXISTS reponse_qualification (
  id TEXT PRIMARY KEY,
  dossier_id TEXT NOT NULL REFERENCES dossier(id) ON DELETE CASCADE,
  -- Le code de la fiche : une même affaire peut en porter plusieurs si le catalogue
  -- s'élargit. « HYDRO_CONTROL » pour le séchage hybride.
  fiche_code TEXT NOT NULL DEFAULT 'HYDRO_CONTROL',
  cle TEXT NOT NULL,
  valeur TEXT,
  saisi_par TEXT REFERENCES utilisateur(id),
  saisi_le TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (dossier_id, fiche_code, cle)
);
CREATE INDEX IF NOT EXISTS idx_reponse_qualif ON reponse_qualification(dossier_id);
