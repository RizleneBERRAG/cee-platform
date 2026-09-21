# Prisma — état réel et marche à suivre

## En un mot

**`schema.prisma` n'est plus le modèle de référence.** Il a été renommé en
`schema.prisma.obsolete` pour qu'aucune commande Prisma ne tourne dessus par accident.

Le modèle de référence est **`db/schema.sql`** : c'est le seul fichier que la plateforme
exécute réellement, et donc le seul qui décrive la base telle qu'elle est.

## Pourquoi

L'en-tête de `db/schema.sql` annonçait le contraire. Ce n'était plus vrai depuis longtemps :

- `schema.prisma` **ignorait** `operation`, `chantier`, `produit`, `dossier_intervenant`,
  `audit_energetique` — c'est-à-dire tout le modèle par opérations, le cœur de la plateforme ;
- il **portait** en revanche des modèles jamais construits : `Organisation`, `Permission`,
  `Intervention`, `Commission` ;
- il comptait 31 modèles là où la base en a 33, et les deux ensembles ne se recouvrent qu'en
  partie ;
- **aucune ligne de code ne l'importe.** `@prisma/client` figure dans les dépendances, il
  n'est appelé nulle part.

Laisser ce fichier en place avec un commentaire le désignant comme référence, c'était
garantir qu'un jour quelqu'un lancerait `prisma generate` et obtiendrait un client en
désaccord avec la base — sans erreur, juste des champs manquants au moment d'écrire.

## Ce qui a été fait, et ce qui ne l'a pas été

**Fait :** l'en-tête mensonger de `db/schema.sql` est corrigé, et le fichier Prisma est
renommé pour que les commandes échouent bruyamment au lieu de produire un client faux.

**Pas fait :** régénérer le schéma. L'introspection (`prisma db pull`) demande de
télécharger les moteurs Prisma, ce que le réseau de l'environnement de travail refuse.

**Volontairement pas fait :** réécrire les 33 tables à la main. Ç'aurait été refabriquer le
problème d'origine — un fichier d'apparence officielle qui n'est en réalité la transcription
de personne, et qui diverge à la première migration oubliée.

## Comment régénérer, le jour où c'est utile

Sur un poste avec accès réseau, depuis la racine du projet :

```bash
# 1. Repartir d'un fichier minimal qui ne décrit que la connexion
cat > prisma/schema.prisma <<'EOF'
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
EOF

# 2. Introspecter la base réelle : Prisma écrit les modèles d'après elle
DATABASE_URL="file:./db/cee.db" npx prisma db pull
```

Le schéma obtenu décrit alors la base **telle qu'elle est**, et non telle qu'on croyait
qu'elle était.

## Pour passer à PostgreSQL

La migration part de la base réelle, pas d'un schéma écrit à la main :

1. introspecter la base SQLite comme ci-dessus ;
2. changer `provider = "postgresql"` et pointer `DATABASE_URL` sur le serveur ;
3. `npx prisma migrate dev` pour créer la structure ;
4. transférer les données, puis **vérifier les totaux** — nombre de dossiers, d'opérations,
   de pièces, somme des volumes cumac — avant de basculer quoi que ce soit.

Ce dernier point n'est pas une formalité. La reprise depuis l'ancien logiciel a montré deux
défauts qu'aucun message d'erreur n'aurait révélés : un en-tête décalé d'une colonne et des
montants multipliés par la quantité. Une migration qui « passe sans erreur » ne prouve rien
sur les chiffres.
