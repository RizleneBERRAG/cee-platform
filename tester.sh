#!/bin/bash
# Lance tous les contrôles, dans le bon ordre et sur la bonne base.
#
# ── Deux familles, et elles ne travaillent pas sur la même base ──
#
# 1. Les suites AUTONOMES tournent sur la base de production (ou une copie). Elles
#    fabriquent elles-mêmes ce dont elles ont besoin : une plateforme vide ne les gêne pas.
#
# 2. Les suites d'INTÉGRATION passent par le serveur HTTP et rejouent des scénarios
#    complets — plusieurs unités d'affaire, des pièces déposées, des deals portant des
#    dossiers figés. Elles exigent la base de démonstration que fabrique ./relancer.sh.
#    Sur la base de production elles s'IGNORENT en le disant, plutôt que d'échouer : un
#    test rouge qui veut seulement dire « pas de données » finit par être ignoré pour de bon.
#
# Usage :
#   ./tester.sh              → les suites autonomes seulement (sans risque)
#   ./tester.sh --tout       → + les suites d'intégration, sur une base de démonstration
#                              JETABLE ; la base de production est sauvegardée et restaurée.
cd "$(dirname "$0")"

AUTONOMES="fiches.mjs dimensionnement.mjs operations.mjs commercial.mjs pieces-reprise.mjs site-listes.mjs \
controles-depot.mjs typage.mjs veille-fiches.mjs deals.mjs devis.mjs facture.mjs emmy.mjs espace-client.mjs qualification.mjs \
schema-crlf.mjs acompte.mjs planning.mjs aap.mjs sav-corbeille.mjs listes-societes.mjs"
INTEGRATION="param.mjs technique.mjs pieces.mjs"

# ── Les données de démonstration ne doivent pas fausser les contrôles ──
#
# `jeu-demo.mjs` plante un dossier, une société et un deal d'essai pour pouvoir manipuler
# les écrans. Ces lignes-là ne sont pas des données réelles : les compter comme telles
# faisait échouer trois suites — non pas parce que l'application allait mal, mais parce
# qu'elles croyaient travailler sur du vrai. Un contrôle qui rougit à cause d'une donnée
# d'essai apprend surtout à ignorer les contrôles.
#
# On fabrique donc une base de référence SANS la démonstration, et on la donne aux suites
# autonomes. La base de production n'est ni lue en écriture ni modifiée.
REFERENCE="/tmp/tester-reference-$$.db"
preparer_reference() {
  [ -f db/cee.db ] || return 1
  rm -f "$REFERENCE" "$REFERENCE"-wal "$REFERENCE"-shm
  cp db/cee.db "$REFERENCE" 2>/dev/null || return 1
  CEE_DB_PATH="$REFERENCE" node jeu-demo.mjs --retirer >/dev/null 2>&1
  export CEE_DB_SOURCE="$REFERENCE"
}
oublier_reference() { unset CEE_DB_SOURCE; rm -f "$REFERENCE" "$REFERENCE"-wal "$REFERENCE"-shm; }

echecs=0
lancer() {
  printf "  %-24s " "$1"
  sortie=$(node "$1" 2>&1 | grep -v ExperimentalWarning | grep -v trace-warnings)
  code=$?
  derniere=$(echo "$sortie" | tail -1)
  premiere=$(echo "$sortie" | head -1)
  case "$premiere" in
    IGNORÉ*) echo "$premiere" ;;
    *) echo "$derniere"; echo "$derniere" | grep -q '✔' || echecs=$((echecs+1)) ;;
  esac
}

echo "── Suites autonomes ──"
preparer_reference || echo "  (pas de base de référence : les suites travailleront sur db/cee.db)"
for f in $AUTONOMES; do lancer "$f"; done
oublier_reference

if [ "$1" = "--tout" ]; then
  echo ""
  echo "── Suites d'intégration (base de démonstration jetable) ──"
  SAUVE="/tmp/cee-production-$$.db"
  cp db/cee.db "$SAUVE" || { echo "  Sauvegarde impossible — on s'arrête."; exit 1; }
  # Le piège à éviter : oublier de restaurer. On le fait quoi qu'il arrive.
  restaurer() {
    for pid in $(ps ax | grep -E "next-server|next start" | grep -v grep | awk '{print $1}'); do kill "$pid" 2>/dev/null; done
    sleep 1
    rm -f db/cee.db && cp "$SAUVE" db/cee.db && rm -f "$SAUVE"
    echo "  (base de production restaurée)"
  }
  trap restaurer EXIT

  ./relancer.sh --forcer >/dev/null 2>&1 || { echo "  Le serveur n'a pas démarré."; exit 1; }
  for f in $INTEGRATION; do lancer "$f"; done
  ./relancer.sh --forcer >/dev/null 2>&1 && lancer secu.mjs
fi

echo ""
if [ "$echecs" -eq 0 ]; then echo "✔ Tout passe."; else echo "✘ $echecs suite(s) en échec."; fi
exit $([ "$echecs" -eq 0 ] && echo 0 || echo 1)
