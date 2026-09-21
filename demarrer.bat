@echo off
chcp 65001 >nul
title Plateforme CEE
cd /d "%~dp0"

echo.
echo   Plateforme CEE — demarrage
echo   ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js n'est pas installe.
  echo       Installez la version LTS depuis https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

echo   Node detecte :
node -v
echo.

if not exist "node_modules" (
  echo   [1/3] Installation des dependances ^(1 a 2 minutes, une seule fois^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto erreur
) else (
  echo   [1/3] Dependances deja presentes.
)

if not exist "db\cee.db" (
  echo   [2/3] Creation de la base de demonstration...
  call npm run seed
  if errorlevel 1 goto erreur
) else (
  echo   [2/3] Base existante conservee.
  echo         ^(supprimez db\cee.db pour repartir de zero^)
)

echo   [3/3] Construction de l'application...
call npm run build
if errorlevel 1 goto erreur

echo.
echo   ============================================
echo   Pret. Ouvrez http://localhost:3000
echo   Laissez cette fenetre ouverte.
echo   Ctrl+C pour arreter.
echo   ============================================
echo.

start "" http://localhost:3000
call npm start
exit /b 0

:erreur
echo.
echo   [X] Une etape a echoue. Copiez le message ci-dessus.
echo.
pause
exit /b 1
