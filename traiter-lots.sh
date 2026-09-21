#!/usr/bin/env bash
# Traite les lots de pièces déposés dans le répertoire de transit : rattachement puis
# lecture du contenu pour le typage. Rejouable — les lots déjà traités sont ignorés par
# la déduplication, et le typage reprend là où il s'est arrêté.
set -u
cd "$(dirname "$0")"

TRANSIT="${1:-/mnt/user-data/uploads/Downloads}"
MARQUE="db/lots-traites.txt"
touch "$MARQUE"

nouveaux=()
for z in "$TRANSIT"/PJ-lot-*.zip "$TRANSIT"/PJ-essai.zip; do
  [ -e "$z" ] || continue
  if ! grep -Fxq "$(basename "$z")" "$MARQUE"; then nouveaux+=("$z"); fi
done

if [ ${#nouveaux[@]} -eq 0 ]; then
  echo "Aucun nouveau lot."
else
  echo "── ${#nouveaux[@]} nouveau(x) lot(s) ──"
  if node reprise-pieces.mjs "${nouveaux[@]}"; then
    for z in "${nouveaux[@]}"; do basename "$z" >> "$MARQUE"; done
  else
    echo "Rattachement en échec — les lots ne sont PAS marqués comme traités."
    exit 1
  fi
fi

echo
node typer-pieces.mjs "${2:-400}"
