import { NextResponse } from 'next/server'

/**
 * Premier filtre : renvoie vers la connexion toute requête sans cookie de session.
 *
 * Ce n'est **pas** le contrôle d'accès. Le middleware tourne en périphérie, sans accès
 * à la base : il ne peut ni vérifier que la session existe vraiment, ni lire les
 * permissions. Il évite seulement d'afficher une coquille vide à un visiteur non connecté.
 *
 * Le vrai contrôle est fait par `exiger()` dans chaque page et chaque action serveur,
 * où la session est relue en base. Un cookie forgé passe ici et est rejeté juste après.
 */
// `/espace` est l'espace client : il a son propre cookie, sa propre session et aucun
// rapport avec les comptes du personnel. Le laisser passer ici ne l'ouvre pas — chacune de
// ses pages relit sa session en base et redirige vers son formulaire d'accès.
// `/aide.html` est le guide d'utilisation : un fichier statique, sans aucune donnée. Son
// premier chapitre explique comment se connecter — le renvoyer vers la connexion serait
// refuser la notice à qui n'arrive pas à entrer.
const PUBLIC = [/^\/connexion/, /^\/activation\//, /^\/espace(\/|$)/, /^\/aide\.html$/]

export function middleware(request) {
  const { pathname } = request.nextUrl
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next()
  if (request.cookies.get('cee_session')) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/connexion'
  url.search = ''
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
