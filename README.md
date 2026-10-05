# Plateforme CEE

Plateforme de gestion des dossiers CEE. Elle reprend le périmètre de travail de Pixel CRM —
fiche dossier en onglets, rappels, planning, S.A.V, lots de dépôt, appels à paiement,
corbeille, paramétrage — et couvre ce que Pixel CRM et crm-energie.fr ne font ni l'un ni
l'autre :

1. **un référentiel de fiches versionné et daté** — un dossier est rattaché à la version
   en vigueur à sa date d'engagement, jamais à « la » fiche. Une suppression par arrêté
   ne réécrit pas l'historique de marge ;
2. **un moteur de calcul cumac piloté par les données** — les coefficients sont stockés
   sur la version de fiche, pas codés en dur : appliquer un arrêté ne demande pas de livraison ;
3. **la marge nette calculée avant engagement**, en croisant fiche, zone climatique,
   secteur, charte (CDP / hors CDP), régime précaire ou classique, présence de MaPrimeRénov'
   et version du deal ;
4. **un radar de conformité** qui compare le taux d'opérations non satisfaisantes au plafond
   réglementaire (14 % en 2026, 12 % en 2027, 10 % en 2028 — arrêté du 27 juillet 2026),
   par unité d'affaire et par fiche ;
5. **un journal de modification au niveau du champ**, attribué à la personne connectée ;
6. **un cloisonnement par rôle** qui permet d'ouvrir l'outil à une régie ou à un apporteur
   sans leur ouvrir la grille de marge ;
7. **les écarts rendus visibles** — volume validé par le délégataire contre volume déposé,
   virement reçu contre facture émise : une marge perdue sans le savoir se voit avant le bilan.

Le guide d'utilisation (`public/aide.html`, entrée « Guide d'utilisation » du menu) décrit
chaque écran pour l'équipe. Les notes de travail internes — relevé de Pixel, point d'avancement,
ce qui est attendu du client — vivent dans `docs/`, volontairement hors du dépôt (voir
`.gitignore`) : elles contiennent la grille de ratios et des données d'entreprise.

## Démarrer

**Sous Windows** : double-cliquez sur **`demarrer.bat`**. Il vérifie Node, installe ce
qu'il faut, prépare la base, construit l'application et ouvre le navigateur.

**En ligne de commande** :

```bash
npm install
npm run seed      # crée db/cee.db et charge le jeu de démonstration
npm run build
npm start         # http://localhost:3000
```

En développement : `npm run dev` (le code est rechargé à chaque modification).

> `npm start` charge le code une seule fois au lancement. Après toute modification
> des fichiers, il faut **arrêter le serveur (Ctrl+C), relancer `npm run build`, puis
> `npm start`** — sinon l'ancienne version continue d'être servie.

### Mise à niveau du schéma

**Une livraison n'exige jamais de supprimer votre base.** À l'ouverture, l'application compare
le schéma déclaré dans `db/schema.sql` à celui de la base et ajoute ce qui manque : tables
absentes, puis colonnes, puis index — dans cet ordre, parce qu'un index portant sur une colonne
neuve échouerait avant qu'elle existe. Le journal du serveur annonce ce qui a été appliqué.

La mise à niveau est **strictement additive** : elle ne supprime aucune colonne, n'en change
aucun type et ne touche pas aux données. Une transformation destructrice reste une décision
humaine, écrite à la main.

Concrètement : ajouter une colonne à `db/schema.sql` suffit, elle apparaîtra dans les bases
existantes au démarrage suivant. `npm run seed` reste réservé à ce qu'il fait vraiment —
**effacer la base et recharger le jeu de démonstration**.

## Écrans

| Route | Contenu |
|---|---|
| `/` | Tableau de bord : pipeline, radar de conformité, alertes réglementaires, marge prévisionnelle |
| `/dossiers` | **Recherche à 56 critères**, colonnes au choix, tri, export CSV, impression |
| `/dossiers/export` | Export CSV du résultat de recherche, colonnes et portée respectées |
| `/dossiers/nouveau` | Création d'un dossier — bénéficiaire, site, opération, deal |
| `/dossiers/import` | Import de masse depuis un export CRM, en simulation puis pour de bon |
| `/dossiers/import/[id]` | Rapport d'import : suppositions faites, lignes rejetées groupées par cause |
| `/dossiers/[id]` | Fiche dossier en onze onglets (synthèse, bénéficiaire, chantier, opérations, commercial, technique, administratif, contrôle, pièces, suivi, espace client) ; `?onglet=` ouvre l'un d'eux |
| `/dossiers/[id]/devis` · `/facture` | Devis et facture imprimables ; en POST, émission (numéro), acompte (`?acompte`) et avoir (`?avoir=`) |
| `/lots` | Lots de dépôt : constitution, contrôle de blocage, dépôt |
| `/lots/[id]` | Contenu d'un lot, ajout de dossiers prêts, verrouillage au dépôt, état et statuts en masse au retour du délégataire, création de l'appel à paiement |
| `/aap` · `/aap/[id]` | Appels à paiement : AAF, volumes validés, écarts, facture au délégataire, paiement reçu |
| `/aap/[id]/facture` | Facture au délégataire, imprimable |
| `/rappels` | Rappels en retard, du jour, à venir, faits |
| `/planning` | Planning des interventions : sept calendriers, une ligne par intervenant, glisser-déposer |
| `/sav` · `/sav/[id]` · `/sav/export` | S.A.V : liste par statut, fiche, export CSV |
| `/corbeille` | Dossiers supprimés : récupérer, supprimer définitivement |
| `/simulateur` | Simulateur de marge avant engagement |
| `/referentiel` | Fiches, versions, validité, arrêtés, et lecture des coefficients |
| `/referentiel/import` | Import CSV du catalogue des fiches (additif, jamais destructif) |
| `/connexion` | Connexion, et création du premier compte au tout premier démarrage |
| `/activation/[token]` | L'arrivant choisit lui-même son mot de passe |
| `/compte` | Son mot de passe, ses droits, ses sessions ouvertes |
| `/utilisateurs` | Comptes, rôles et droits (réservé au gérant) |
| `/piece/[id]` | Téléchargement ou aperçu d'une pièce, droits et portée revérifiés |
| `/parametrage/delegataires` | Délégataires et leur obligé |
| `/parametrage/deals` | Deals, leurs 18 ratios et leur mode de reversement, avec versionnement |
| `/parametrage/rge` | Installateurs et certifications RGE datées |
| `/parametrage/pieces` | Types de pièces et composition des liasses |
| `/parametrage/workflow` | Étapes, statuts sur cinq axes, unités d'affaire (les régies) |
| `/parametrage/controle` · `/catalogue` | Bureaux de contrôle et leur accréditation ; catalogue produits |
| `/parametrage/societes` | Sociétés émettrices : identité, assurance, séries de numéros, compte bancaire, logo, blocages d'émission |
| `/parametrage/listes` | Quatorze listes (AMO / MAR, mandataires Anah, comptes bancaires…) décrites dans `lib/listes.js` |
| `/parametrage/interventions` · `/sav` | Types d'intervention du planning ; types, statuts et motifs du S.A.V |

### Les pièces jointes

Le fichier est écrit sur le disque, dans `fichiers/`, **hors de l'arborescence servie** —
aucune URL ne mène directement à un fichier. La base ne garde que les métadonnées : un blob
par pièce ferait grossir `cee.db` jusqu'à le rendre impossible à sauvegarder.

Cinq décisions, chacune pour une raison :

- **Le nom sur disque est l'empreinte SHA-256 du contenu.** Le nom d'origine n'entre jamais
  dans un chemin : la traversée de répertoire devient structurellement impossible, plutôt que
  d'être empêchée par un filtrage qu'on peut oublier.
- **La même empreinte n'est écrite qu'une fois.** Vingt dossiers portant la même attestation
  d'installateur occupent un seul fichier. Corollaire : retirer une pièce n'efface le fichier
  que si plus aucune ligne ne s'y réfère.
- **Le type est déterminé par le contenu**, pas par l'extension ni par ce qu'annonce le
  navigateur. Un HTML renommé `.pdf` est refusé. Les SVG le sont aussi : ce sont des documents
  qui peuvent porter du script.
- **Rien n'est servi sans contrôle.** La route `/piece/[id]` revérifie session, droit et
  portée — la pièce d'un dossier d'une autre unité renvoie « introuvable », pas « interdit »,
  pour ne pas révéler son existence. `Content-Disposition: attachment` par défaut, `nosniff`,
  et une politique de sécurité qui interdit tout script.
- **Un fichier altéré n'est pas servi.** L'empreinte est recalculée à chaque lecture ; si elle
  ne correspond plus, la requête échoue au lieu de servir un contenu faux.

`pieces.mjs` éprouve tout cela : dépôt d'un HTML déguisé, d'un SVG à script, d'un nom
`../../../../etc/passwd.pdf`, accès à la pièce d'une autre unité, accès sans session,
et altération du fichier sur le disque.

### Le paramétrage

Tout ce qui se réglait en SQL se règle désormais à l'écran. Deux règles y sont tenues
sans exception.

**On ne supprime jamais ce qui est utilisé.** Un délégataire rattaché à des dossiers est
désactivé, pas effacé : il disparaît des listes de choix et les dossiers passés restent
lisibles. Un type de pièce porté par des documents, un statut porté par des dossiers ne
peuvent pas être supprimés du tout — l'écran dit combien de dossiers s'y opposent.
Les certifications RGE échues sont conservées volontairement : ce qui compte pour un dossier
est que la certification ait été valide **à la date des travaux**, pas aujourd'hui.

**Modifier un tarif ne recalcule aucun dossier figé.** Quand des dossiers ont déjà été figés
sur un deal, changer ses ratios ne les touche pas : une nouvelle version du deal est créée,
l'ancienne est archivée avec ses ratios d'origine, et les dossiers figés gardent les montants
calculés avec la grille de l'époque. Sans cela, une correction de tarif réécrirait toute la
marge historique sans que personne s'en aperçoive. `param.mjs` le vérifie sur des dossiers
réellement figés.

Deux réglages annoncent leurs conséquences au moment où on les change : cocher « perdu » sur
un statut modifie le taux de déperdition du tableau de bord, et l'écran dit sur combien de
dossiers. Composer une liasse décide quels dossiers seront bloqués au dépôt.

### Authentification et rôles

**Aucun mot de passe par défaut n'existe.** Au premier lancement, l'application demande de
créer le compte du gérant : il n'y a jamais d'« admin/admin » à changer plus tard. Les comptes
suivants naissent sans mot de passe et sont inutilisables tant que leur détenteur n'en a pas
choisi un, par un lien d'activation à usage unique valable 48 heures. Personne — pas même le
gérant — ne connaît le mot de passe de quiconque ; « Réinitialiser » produit un nouveau lien,
il ne révèle rien.

Ce qui est stocké est une empreinte **scrypt** avec un sel par compte, jamais le mot de passe.
Le cookie ne porte qu'un jeton opaque : rôle et droits sont relus en base à chaque requête,
donc désactiver un compte le déconnecte immédiatement.

Quatre rôles sont livrés, modifiables depuis `/utilisateurs` sans toucher au code. Deux droits
portent tout l'enjeu :

| Droit | Ce qu'il change |
|---|---|
| **Voir les montants et la marge** | Sans lui, aucun montant n'est envoyé au navigateur. C'est ce qui permet de donner un accès à un apporteur sans qu'il découvre ce que vous gagnez sur ses dossiers. |
| **Voir les dossiers de toutes les unités** | Sans lui, l'utilisateur ne voit que son unité d'affaire. Le cloisonnement est appliqué par le SQL, pas par l'affichage. |
| **Planning de toute l'équipe** (`planning.tous`) | Sans lui, on ne voit et ne déplace que ses propres interventions. |
| **Supprimer un dossier** (`dossier.supprimer`) | La corbeille et la suppression définitive. Un dossier à la corbeille est refusé par `exigerPortee` à toute action, sauf celles de la corbeille. |

Ces deux derniers droits sont arrivés par des étapes de migration nommées
(`lib/migrations-manuelles.js`), données aux rôles qui voient déjà tous les dossiers.

> Masquer un bouton n'est pas une protection. Chaque action serveur refait le contrôle de
> droit et de portée de son côté : le fichier `secu.mjs` le vérifie en rejouant les requêtes
> qu'un utilisateur enverrait depuis la console de son navigateur. `./tester.sh` le lance.

### L'écran de recherche

C'est l'écran où l'ADV passe sa journée, donc celui qui décide si l'outil est adopté ou subi.

- **56 critères**, regroupés par section : identification, bénéficiaire, site et données
  réglementaires, opération, chaîne CEE, statuts et jalons. Plus un champ de recherche libre
  qui balaie n° de dossier, référence externe, bénéficiaire, SIRET, ville et code de fiche.
- **Colonnes au choix** parmi 29, tri sur chacune, 25 à 200 lignes par page.
- **Les filtres actifs s'affichent en pastilles** qu'on retire une par une, sans rouvrir le
  panneau. Après une recherche on veut voir le résultat, pas le formulaire.
- **Les totaux portent sur tout le résultat**, pas sur la page affichée.
- **L'adresse de la page porte toute la vue** : filtres, colonnes, tri. Mettez-la en favori,
  envoyez-la à un collègue — il verra exactement la même chose, dans la limite de ses droits.
- **Clavier** : `/` place le curseur dans la recherche, `Échap` l'efface.
- **Impression** : une feuille de style dédiée retire la navigation et les boutons.

Les critères sont déclarés en données dans `lib/recherche.js`. En ajouter un le fait
apparaître dans le formulaire, dans les pastilles de filtres et dans l'export, sans toucher
à l'écran. Aucune valeur saisie n'est concaténée dans le SQL ; les seuls fragments interpolés
— colonne de tri, sens, limite — sont validés contre une liste fermée.

### Import de masse

`/dossiers/import` charge un export de votre CRM actuel. Le fichier n'a pas besoin d'être
mis au format : les noms de colonnes sont reconnus sans accents ni casse, avec les synonymes
courants (`cp`, `client`, `qté`, `date devis`…), et le séparateur est détecté.

Quatre garanties :

1. **Simulation d'abord.** Le bouton « Simuler » ne touche pas la base et produit le rapport complet.
2. **Transactionnel.** Tout le fichier passe dans une seule transaction : une coupure en cours
   d'import ne laisse rien derrière elle. 2 500 lignes prennent environ 300 ms.
3. **Rejouable.** La référence externe sert de clé : réimporter le même fichier après correction
   ne duplique aucun dossier déjà créé.
4. **Aucune supposition silencieuse.** Zone climatique déduite, deal par défaut appliqué, statut
   d'entrée attribué, fiche hors validité : tout est compté et affiché dans le rapport.

Une ligne est entièrement valide ou entièrement rejetée. Les rejets sont regroupés par cause,
avec les numéros de ligne et trois exemples — on corrige la cause, pas les lignes une par une.

> `db/zones-climatiques.json` sert à déduire la zone quand la colonne est absente.
> **Le zonage réglementaire est défini à la commune et dépend de l'altitude** : cette table
> départementale est une approximation de dépannage, à vérifier contre l'annexe de l'arrêté.
> Les départements les plus hétérogènes sont listés dans le fichier et nommés dans le rapport.

### Cycle de vie d'un dossier

1. **Création** — la version de fiche applicable est choisie automatiquement d'après la date
   d'engagement. Si la fiche n'est plus en vigueur à cette date, le dossier est créé mais signalé
   comme non éligible.
2. **Modification** — statuts sur les cinq axes, quantité, dates, deal, charte, MPR.
   Chaque changement est enregistré dans le journal, champ par champ, avec l'ancienne et la
   nouvelle valeur, l'auteur et l'horodatage. Changer la date d'engagement peut basculer
   le dossier sur une autre version de fiche : le journal le note aussi.
3. **Calcul et figeage** — le bouton « Calculer et figer » arrête les montants sur le dossier.
   Tant qu'on ne recalcule pas, ce sont ces montants qui font foi. Si le calcul courant s'en
   écarte (deal modifié, quantité changée), un bandeau signale l'écart sans rien écraser.
4. **Pièces** — la liasse exigée dépend du couple (délégataire, fiche). L'écran affiche
   le taux de complétude, ce qui manque, et ce qui attend la validation du délégataire.
   Une liasse propre à un délégataire l'emporte sur la liasse standard de la fiche.
5. **Lot de dépôt** — on ne peut déposer un lot que si aucun de ses dossiers n'est hors
   validité de fiche ni incomplet. Le dépôt verrouille tous les dossiers du lot.
   Le jeu de démonstration contient deux lots : un déjà déposé (dossiers verrouillés) et un
   en constitution dont le dépôt est bloqué — une fiche hors validité et une pièce manquante.
6. **Export** — le lot se télécharge en CSV (point-virgule, BOM UTF-8 : Excel l'ouvre
   sans manipulation). Une ligne par dossier, avec bénéficiaire, site, fiche et version,
   volume cumac, montants figés et taux de complétude.
7. **Verrouillage** — fige le dossier en lecture seule ; le déverrouillage est journalisé.
8. **Retour du délégataire** — sur la fiche du lot : état (instruit, validé, rejeté),
   référence EMMY, et statut de tous ses dossiers en un geste, journalisé dossier par dossier
   (`lib/statuts-masse.js`).
9. **Appel à paiement** — volumes et primes réellement validés, saisis contre le déposé ;
   facture au délégataire numérotée dans la série de la société ; virement contrôlé au centime.

À tout moment : **rappels** et **interventions** au planning depuis l'onglet Suivi ;
**S.A.V** quand un incident rouvre le dossier ; **corbeille** pour un doublon ou un essai.

## Architecture

```
app/          écrans (Next.js App Router, composants serveur sauf le simulateur)
lib/db.js     accès SQLite + journalisation au niveau du champ
lib/migrations.js  mise à niveau additive du schéma à l'ouverture de la base
lib/fichiers.js    stockage des pièces par empreinte, déduplication, contrôle du type
lib/nom-fichier.js nettoyage du nom affiché
fichiers/          les pièces déposées, hors de l'arborescence servie
lib/cumac.js  moteur de calcul du volume cumac + contrôle de validité de fiche
lib/marge.js  moteur de valorisation (grille de 12 ratios) + contrôle de validité du deal
lib/queries.js requêtes métier (pipeline, radar, alertes, calcul dossier)
lib/auth.js   empreintes scrypt, sessions, garde des actions serveur
lib/permissions.js  catalogue des droits et rôles par défaut
lib/garde.js  garde d'écran + portée de lecture par unité d'affaire
middleware.js premier filtre : renvoie vers /connexion sans cookie de session
lib/recherche.js  catalogue des critères et colonnes, construction de la requête
lib/import-dossiers.js  moteur d'import de masse (parsing, validation, rapport)
lib/export.js  export CSV d'un lot de dépôt
lib/facture.js     factures, acomptes, avoirs : numérotation sans trou, lignes recopiées
lib/rappels.js · planning.js · sav.js · aap.js · corbeille.js · listes.js · societes.js
                   un module par fonction, qui reçoit la base en paramètre : chacun se
                   teste sur une base jetable ; les actions serveur (lib/actions-*.js)
                   y ajoutent le contrôle de droit et de portée
lib/portee.js      exigerPortee : unité d'affaire et corbeille, une seule copie
db/zones-climatiques.json  correspondance département → zone, à vérifier
db/schema.sql DDL de référence : c'est lui qui fait foi
db/seed.mjs   jeu de données de démonstration
jeu-demo.mjs  dossier de démonstration à planter / retirer sur une base réelle
prisma/schema.prisma  ancien modèle, qui a divergé du schéma réel
```

### Base de données

La plateforme tourne sur **SQLite** via le module `node:sqlite` intégré à Node 22 :
aucune installation, aucun conteneur, la base est un fichier.

La cible de production est **PostgreSQL**. `prisma/schema.prisma` devait en être le modèle,
mais il a divergé : il ignore une grande partie des tables réelles. La référence est
`db/schema.sql` ; le modèle Prisma est à régénérer depuis lui, ou à supprimer, avant toute
bascule.

## Le modèle de marge

Chaque deal porte **18 ratios en €/MWh cumac** : trois régimes (grande précarité, précaire,
classique) × trois parties (délégataire, prime cédée au bénéficiaire, commission installateur)
× avec ou sans MaPrimeRénov'.

Chaque deal dit aussi son **mode de reversement** : prime cédée et commission installateur
sont-elles **cumulées**, ou **au choix** selon qui touche la prime ? Tant qu'un deal ne le dit
pas, aucune marge n'est calculée sur ses dossiers — la plateforme affiche un tiret, pas un zéro.

```
Versé par le délégataire   = ratio_délégataire      × MWh cumac
− prime cédée              = ratio_cédée            × MWh cumac
− commission installateur  = ratio_gardée           × MWh cumac
− commission apporteur     = % du versé délégataire
− coût de pose
= marge nette
```

**Règle non négociable** : les montants d'un dossier sont figés à la date de calcul.
Modifier un deal ne recalcule jamais les dossiers existants — le recalcul est une action
explicite. Sans cela, tout l'historique de marge se corrompt au premier changement de tarif.

## Données réglementaires du jeu `npm run seed`

Ce jeu sert aux essais sur une base jetable : il efface la base. Les paramètres
réglementaires sont réels et sourcés ; les dossiers, sociétés et régies sont synthétiques.

| Fiche | État | Référence |
|---|---|---|
| BAT-EQ-127, BAR-EQ-110, IND-BA-116 | supprimées au 25/02/2026 | arrêté du 23 février 2026 (JO 24/02/2026) |
| BAR-SE-109 | supprimée au 09/02/2026 | arrêté du 5 février 2026 (JO 08/02/2026) |
| BAR-TH-160 | suppression annoncée, date d'effet à confirmer | — |
| BAT-TH-122, AGRI-EQ-110, TRA-SE-104 | en vigueur | — |

Coefficients BAT-EQ-127 (kWh cumac par watt installé) : hôtellerie-restauration 31,
commerce 36, bureaux 35, santé 38, enseignement 24, autres 24.

## Contrôles automatiques

`./tester.sh` lance les suites autonomes sur une copie de la base, dont le dossier de
démonstration est retiré. Chacune monte sa propre base jetable quand elle en a besoin.

| Suite | Ce qu'elle vérifie |
|---|---|
| `fiches`, `dimensionnement`, `site-listes`, `typage`, `veille-fiches` | Calcul cumac, référentiel, listes fermées du site, typage des pièces |
| `deals`, `devis`, `facture`, `emmy`, `controles-depot` | Grille de ratios, mentions légales, numérotation sans trou, tableau de dépôt |
| `espace-client`, `qualification`, `pieces-reprise` | Espace client et propositions, fiche de qualification, reprise des pièces |
| `acompte` | Factures d'acompte : ventilation de TVA, déduction, avoir |
| `planning` | Jours sans fuseau, déplacement, date de pose, portée, migrations |
| `aap` | Appels à paiement : écarts, gel, série de factures, statuts en masse |
| `sav-corbeille` | S.A.V ; dossier à la corbeille absent de chaque écran ; suppression définitive |
| `listes-societes` | IBAN, SIRET/SIREN/TVA, préfixes de série, logo, IBAN figé sur facture |
| `schema-crlf` | La mise à niveau du schéma ne dépend ni des fins de ligne ni des commentaires |

Sous Windows, `operations.mjs` et `commercial.mjs` écrivent dans `/tmp` et ne se lancent
pas, et plusieurs suites échouent au nettoyage final (fichier encore ouvert) après avoir
tout vérifié : comptez les lignes `OK` / `ÉCHEC` plutôt que le code de sortie.

## Ce qui reste à faire

Le détail est dans les notes internes de `docs/` (hors dépôt). En bref : renseigner les
sociétés émettrices (SIRET, assurance décennale) et le mode de reversement des deals, puis
la mise en ligne ; côté code, l'attestation sur l'honneur, les e-mails, la vue carte du
planning, la validation d'un fichier Emmy, et régénérer ou retirer `prisma/schema.prisma`.
