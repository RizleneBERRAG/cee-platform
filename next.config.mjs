/** @type {import('next').NextConfig} */
const nextConfig = {
  // Permet de compiler à côté (NEXT_DIST_DIR=.next-essai) sans écraser la version que sert `next start`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  experimental: {
    // Sans cela, le cache routeur du client garde jusqu'à 30 s l'ancienne version
    // d'une page dynamique : après un changement de statut, l'écran affiche encore
    // l'ancienne valeur. On force la relecture à chaque navigation.
    staleTimes: { dynamic: 0, static: 0 },
    // Un export de CRM de plusieurs milliers de dossiers dépasse largement la limite
    // par défaut de 1 Mo des actions serveur.
    serverActions: {
      bodySizeLimit: '25mb',
      // ── Pourquoi cette liste ──
      //
      // Derrière un proxy (Codespaces, tunnel Cloudflare), le navigateur voit une
      // adresse en https://…app.github.dev tandis que le serveur, lui, s'entend
      // appeler « localhost ». Next compare les deux et, par défaut, rejette
      // l'écart : les actions serveur échouent — donc TOUS les boutons qui
      // enregistrent, sans message clair à l'écran.
      //
      // Déclarer ces domaines ne relâche rien en production : la liste ne
      // concerne que des hôtes de démonstration, jamais le domaine final.
      allowedOrigins: [
        'localhost:3000',
        '*.app.github.dev',      // Codespaces
        '*.trycloudflare.com',   // tunnel Cloudflare
        '*.ngrok-free.app',      // tunnel ngrok
      ],
    },
  },
}

export default nextConfig
