/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Sans cela, le cache routeur du client garde jusqu'à 30 s l'ancienne version
    // d'une page dynamique : après un changement de statut, l'écran affiche encore
    // l'ancienne valeur. On force la relecture à chaque navigation.
    staleTimes: { dynamic: 0, static: 0 },
    // Un export de CRM de plusieurs milliers de dossiers dépasse largement la limite
    // par défaut de 1 Mo des actions serveur.
    serverActions: { bodySizeLimit: '25mb' },
  },
}

export default nextConfig
