#!/bin/bash
# Repart d'une base NEUVE avec un serveur neuf — pour tester le premier démarrage.
#
# ⚠ Ce script EFFACE la base. Depuis la reprise des données réelles, ce n'est plus anodin :
# un lancement par réflexe détruirait 1 677 dossiers. Il refuse donc de s'exécuter sur une
# base qui contient de vraies données, sauf à le forcer explicitement.
#
#   ./relancer.sh          → refuse si la base contient des données réelles
#   ./relancer.sh --forcer → efface quand même (à n'utiliser qu'en connaissance de cause)
cd "$(dirname "$0")"

SEUIL=300   # au-delà de ce nombre de dossiers, ce n'est plus un jeu de test

if [ -f db/cee.db ] && [ "$1" != "--forcer" ]; then
  N=$(node -e "
    const {DatabaseSync}=require('node:sqlite');
    try { console.log(new DatabaseSync('db/cee.db').prepare('SELECT COUNT(*) n FROM dossier').get().n) }
    catch { console.log(0) }
  " 2>/dev/null)
  if [ "${N:-0}" -gt "$SEUIL" ]; then
    echo "REFUS : db/cee.db contient $N dossiers — ce sont vos données réelles."
    echo "        Ce script les effacerait. Si c'est vraiment ce que vous voulez :"
    echo "          ./relancer.sh --forcer"
    echo "        Pour repartir des données de test sans rien perdre, copiez d'abord"
    echo "        db/cee.db ailleurs."
    exit 1
  fi
fi

for pid in $(ps ax | grep -E "next-server|next start" | grep -v grep | awk '{print $1}'); do kill "$pid" 2>/dev/null; done
sleep 2
rm -f db/cee.db
npm run seed >/dev/null 2>&1
# Le référentiel des bureaux de contrôle et leurs dates d'accréditation.
node db/seed-bureaux.mjs >/dev/null 2>&1
(npm start >/tmp/srv.log 2>&1 &)
for i in $(seq 1 25); do
  if [ "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/connexion)" = "200" ]; then echo "serveur prêt"; exit 0; fi
  sleep 1
done
echo "le serveur n'a pas démarré"; tail -20 /tmp/srv.log; exit 1
