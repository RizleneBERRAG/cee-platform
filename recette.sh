#!/bin/bash
# Recette complète : l'application entière, par l'écran, sur une base jetable.
#
# ── Pourquoi ce fichier existe à côté de tester.sh ──
#
# `tester.sh` vérifie les RÈGLES : un barème, un arrondi, une numérotation. Il les vérifie
# en appelant les fonctions directement, et il a raison — c'est rapide et précis.
#
# Mais une règle juste ne fait pas une application qui marche. Le défaut
# « NOT NULL constraint failed: site.adresse » est passé au travers de 759 contrôles au
# vert : aucune règle n'était fausse, c'est la requête et le formulaire qui ne parlaient
# pas de la même liste de champs. Il a fallu ouvrir la page pour le voir.
#
# Cette recette-ci ouvre donc les pages. Elle démarre un vrai serveur sur une COPIE de la
# base, pilote un vrai navigateur, et vérifie quatre choses :
#
#   1. chaque écran répond, sans exception serveur ni erreur de console ;
#   2. chaque formulaire réenregistré sans modification ne change RIEN en base ;
#   3. chaque champ modifié s'enregistre — et lui seul ;
#   4. le cycle commercial tient du devis au dépôt.
#
# Chaque étape repart d'une base neuve : l'ordre des étapes ne doit jamais changer le
# résultat, sans quoi un échec ne dit plus si le défaut est dans l'application ou dans la
# recette.
#
# Usage :
#   ./recette.sh                  → sur une copie de db/cee.db
#   ./recette.sh chemin/vers.db   → sur une copie de la base indiquée
cd "$(dirname "$0")"

SOURCE="${1:-db/cee.db}"
COPIE=/tmp/recette-$$.db
PORT=3199

if [ ! -f "$SOURCE" ]; then echo "Base introuvable : $SOURCE"; exit 1; fi

arreter() {
  for pid in $(ps ax | grep -E "next-server|next start" | grep -v grep | awk '{print $1}'); do kill "$pid" 2>/dev/null; done
  sleep 2
}
# Quoi qu'il arrive — échec, interruption — le serveur s'arrête et la copie disparaît.
nettoyer() { arreter; rm -f "$COPIE" "$COPIE"-wal "$COPIE"-shm /tmp/ids-$$.json; }
trap nettoyer EXIT

preparer() {
  arreter
  rm -f "$COPIE" "$COPIE"-wal "$COPIE"-shm
  cp "$SOURCE" "$COPIE"
  CEE_DB_PATH="$COPIE" node jeu-demo.mjs >/dev/null 2>&1
  CEE_DB_PATH="$COPIE" node -e "
    const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.CEE_DB_PATH);
    const u=db.prepare('SELECT id FROM utilisateur LIMIT 1').get();
    if(!u){console.error('Aucun compte dans la base : la recette a besoin d un utilisateur.');process.exit(1)}
    db.prepare('INSERT INTO session (id,utilisateur_id,expire_le,agent) VALUES (?,?,?,?)')
      .run('recette',u.id,new Date(Date.now()+864e5).toISOString(),'recette');
    require('fs').writeFileSync(process.env.IDS,JSON.stringify({
      dossier: db.prepare(\"SELECT id FROM dossier WHERE numero='DEMO-2026-0001'\").get().id,
      lot: db.prepare(\"SELECT id FROM lot WHERE numero='DEMO-LOT-2026-01'\").get().id}));
  " 2>/dev/null || return 1
  nohup env CEE_DB_PATH="$COPIE" npx next start -p $PORT > /tmp/recette-serveur-$$.log 2>&1 &
  for _ in $(seq 1 30); do
    sleep 1
    curl -s -o /dev/null "http://localhost:$PORT/" && return 0
  done
  echo "  Le serveur n'a pas démarré."; return 1
}

export IDS=/tmp/ids-$$.json
export RECETTE_URL="http://localhost:$PORT"
export CEE_DB_PATH="$COPIE"
export RECETTE_IDS="$IDS"

echecs=0
etape() {
  printf "\n═══ %s ═══\n" "$1"
  preparer || { echo "  Préparation impossible."; echecs=$((echecs+1)); return; }
  node "$2" || echecs=$((echecs+1))
  # Une exception serveur ne remonte pas toujours jusqu'au navigateur : on relit le journal.
  n=$(grep -c "⨯" /tmp/recette-serveur-$$.log 2>/dev/null || echo 0)
  [ "$n" -gt 0 ] && { echo "  ⚠ $n erreur(s) dans le journal du serveur :"; grep -A2 "⨯" /tmp/recette-serveur-$$.log | head -8; echecs=$((echecs+1)); }
}

echo "Recette de la plateforme — base : $SOURCE (copie jetable)"

etape "Les écrans"       recette-ecrans.mjs
etape "Les formulaires"  recette-formulaires.mjs
etape "Les champs"       recette-champs.mjs
etape "Le cycle"         recette-cycle.mjs
etape "L'espace client" recette-client.mjs

echo ""
if [ "$echecs" -eq 0 ]; then echo "✔ Recette complète : rien à signaler."; else echo "✘ $echecs étape(s) en défaut."; fi
exit $([ "$echecs" -eq 0 ] && echo 0 || echo 1)
