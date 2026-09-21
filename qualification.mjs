/**
 * Contrôles de la fiche de qualification Hydro Control.
 *
 * Trois choses comptent ici :
 *
 * 1. **La fiche du client n'a pas de fuite.** Le dimensionnement et la conclusion
 *    commerciale — dont la probabilité de signature — ne doivent apparaître nulle part
 *    côté client. Ni masqués : absents.
 * 2. **Une réponse de qualification suit le même chemin que le reste.** Le client propose,
 *    le gérant arbitre. Rien n'est écrit sans décision.
 * 3. **Les réponses ne sont pas déformées.** Un choix multiple vidé reste vide, un
 *    pourcentage hors bornes est refusé, et « environ 200 » n'est pas transformé en zéro.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const {
  FICHE_QUALIFICATION, tousLesChamps, champsClientQualification, sectionsClient,
  definitionQualification, normaliserReponse, lireReponse, enregistrerReponses,
  reponsesDuDossier, completudeQualification, INDISPENSABLES,
} = await import('./lib/fiche-qualification.js')
const { champsClient, soumettre, arbitrer, enAttente, valeurActuelle } = await import('./lib/propositions.js')
const { ouvrirAcces } = await import('./lib/acces-client.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('La fiche est complète et fidèle au document papier')

ok(FICHE_QUALIFICATION.sections.length === 16, `seize sections (obtenu : ${FICHE_QUALIFICATION.sections.length})`)
const numeros = FICHE_QUALIFICATION.sections.map((s) => s.numero)
ok(numeros.join(',') === Array.from({ length: 16 }, (_, i) => i + 1).join(','),
  'numérotées de 1 à 16, sans trou ni doublon')

const champs = tousLesChamps()
ok(new Set(champs.map((c) => c.cle)).size === champs.length,
  `aucune clé en double (${champs.length} champs)`)
ok(champs.every((c) => c.cle.startsWith('q.')), 'toutes les clés sont préfixées `q.`')
ok(champs.every((c) => ['texte', 'texte_long', 'nombre', 'date', 'tel', 'email', 'oui_non', 'choix', 'choix_multiple'].includes(c.type)),
  'aucun type de champ inconnu')
ok(champs.filter((c) => c.type === 'choix' || c.type === 'choix_multiple').every((c) => Array.isArray(c.valeurs) && c.valeurs.length),
  'chaque liste de choix porte ses valeurs')

// Quelques champs du document papier, vérifiés nommément.
for (const [cle, attendu] of [
  ['q.humidite_initiale', 'Humidité initiale (%)'],
  ['q.bat_volume', 'Volume (m³)'],
  ['q.energie_kva', 'Puissance électrique souscrite (kVA)'],
  ['q.dim_nb_kits', 'Nombre de kits'],
]) {
  ok(definitionQualification(cle)?.libelle === attendu, `${cle} — « ${attendu} »`)
}
ok(definitionQualification('q.activite').valeurs.includes('Scierie')
  && definitionQualification('q.activite').valeurs.includes('CBD'),
  'la liste des activités reprend celle du document (scierie, CBD…)')

// ═══════════════════════════════════════════════════════════
titre('Ce que le client ne doit pas voir')

const cotesClient = champsClientQualification().map((c) => c.cle)
const sectionsVues = sectionsClient().map((s) => s.numero)

ok(!sectionsVues.includes(14), 'la section 14 (dimensionnement) n\'est pas montrée au client')
ok(!sectionsVues.includes(16), 'la section 16 (conclusion commerciale) non plus')
ok(sectionsVues.includes(15), 'la check-list des pièces, elle, lui est ouverte : c\'est lui qui les détient')
ok(sectionsVues.length === 14, `quatorze sections visibles (obtenu : ${sectionsVues.length})`)

for (const interdit of ['q.probabilite', 'q.projet_temperature', 'q.commentaires',
  'q.dim_capacite', 'q.dim_nb_kits', 'q.dim_puissance', 'q.dim_observations']) {
  ok(!cotesClient.includes(interdit), `${interdit} est hors de portée du client`)
}

// Le contrôle qui compte : ces champs ne doivent pas non plus atterrir dans la liste
// blanche des propositions — sinon un client pourrait les proposer, et un gérant pressé
// les accepter.
const proposables = champsClient({}).map((c) => c.champ)
ok(!proposables.includes('qualification.q.probabilite'),
  'la probabilité de signature n\'est même pas proposable')
ok(!proposables.includes('qualification.q.dim_nb_kits'),
  'le dimensionnement non plus')
ok(proposables.includes('qualification.q.produit_nature'),
  'alors que la nature du produit l\'est')
ok(proposables.filter((c) => c.startsWith('qualification.')).length === cotesClient.length,
  'la liste blanche des propositions colle exactement aux champs client')

// Et le rendu : le composant ne doit pas construire les sections réservées.
const rendu = fs.readFileSync('app/espace/dossier/Qualification.jsx', 'utf8')
ok(/sectionsClient\(\)/.test(rendu) && !/FICHE_QUALIFICATION\.sections/.test(rendu),
  'le formulaire client parcourt `sectionsClient()`, pas la fiche entière')
for (const mot of ['probabilite', 'dim_nb_kits', 'Abandonné']) {
  ok(!rendu.includes(mot), `« ${mot} » n'apparaît pas dans le formulaire client`)
}

// ═══════════════════════════════════════════════════════════
titre('Les réponses ne sont pas déformées')

const nb = (cle, v) => normaliserReponse(definitionQualification(cle), v)
ok(nb('q.humidite_initiale', '45').valeur === '45', 'un pourcentage valide passe')
ok(nb('q.humidite_initiale', '145').ok === false, 'un pourcentage au-dessus de 100 est refusé')
ok(nb('q.humidite_initiale', '-5').ok === false, 'un pourcentage négatif aussi')
ok(nb('q.bat_surface', '1 250,5').valeur === '1250.5', 'un nombre avec espace et virgule est compris')
ok(nb('q.bat_surface', 'environ 200').ok === false, 'un nombre illisible est refusé — pas converti en zéro')
ok(nb('q.bat_surface', '').valeur === null, 'un champ vide reste vide')

const cm = definitionQualification('q.activite')
ok(normaliserReponse(cm, ['Scierie', 'Céréales']).valeur === '["Scierie","Céréales"]',
  'un choix multiple est stocké en liste')
ok(normaliserReponse(cm, []).valeur === null, 'un choix multiple vidé redevient vide')
ok(normaliserReponse(cm, ['Scierie', 'Licorne']).ok === false, 'une valeur hors liste est refusée')
ok(lireReponse(cm, '["Scierie"]').join() === 'Scierie', 'et se relit en liste')
ok(lireReponse(cm, null).length === 0, 'une réponse absente se relit en liste vide')
ok(lireReponse(cm, 'pas du json').length === 0, 'une valeur corrompue ne fait pas planter la page')

ok(normaliserReponse(definitionQualification('q.production_continue'), 'Oui').valeur === 'Oui',
  'un Oui/Non passe')
ok(normaliserReponse(definitionQualification('q.production_continue'), 'Peut-être').ok === false,
  'et rien d\'autre')
ok(normaliserReponse(definitionQualification('q.date_decision'), '2026-10-01').valeur === '2026-10-01',
  'une date au bon format passe')
ok(normaliserReponse(definitionQualification('q.date_decision'), '01/10/2026').ok === false,
  'une date mal formée est refusée')

// ═══════════════════════════════════════════════════════════
titre('Du client au dossier : le même chemin que le reste')

const CIBLE = path.join(os.tmpdir(), 'qualif-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

const uid = () => crypto.randomUUID()
const benefId = uid(); const siteId = uid(); const dossierId = uid()
const ficheId = uid(); const versionId = uid()
db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale) VALUES (?,?,?)').run(benefId, 'SOCIETE', 'SCIERIE DU PUY')
db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)').run(siteId, 'ZA', '63780', 'Saint-Georges-de-Mons')
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)')
  .run(ficheId, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Séchage solaire')
db.prepare(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, formule_type, unite_variable, coefficients, conditions)
            VALUES (?,?,?,?,?,?,?,?)`).run(versionId, ficheId, 'A38-1', '2021-07-31', 'FORFAIT_PAR_UNITE', 'U', '{}', '{}')
db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id)
            VALUES (?,?,?,?,?,?)`).run(dossierId, 'SPL-2026-0001', benefId, siteId, ficheId, versionId)

const acces = ouvrirAcces(db, dossierId, null)

const r = soumettre(db, {
  dossierId, accesId: acces.id,
  valeurs: {
    'qualification.q.produit_nature': 'Plaquettes de hêtre',
    'qualification.q.humidite_initiale': '45',
    'qualification.q.humidite_cible': '20',
    'qualification.q.activite': ['Scierie', 'Exploitant forestier'],
    'qualification.q.production_continue': 'Non',
  },
  message: 'Voici les infos pour le séchoir.',
})
ok(r.ok && r.champs === 5, `cinq réponses transmises (obtenu : ${r.champs})`)
ok(Object.keys(reponsesDuDossier(db, dossierId)).length === 0,
  'AUCUNE réponse n\'est encore posée sur le dossier — la proposition est une copie à côté')

// Un champ réservé glissé dans la soumission doit faire échouer l'ensemble.
const rTriche = soumettre(db, {
  dossierId, accesId: acces.id,
  valeurs: { 'qualification.q.produit_nature': 'Chêne', 'qualification.q.probabilite': '90 %' },
})
ok(!rTriche.ok && /n'est pas modifiable/.test(rTriche.motifs.join(' ')),
  'un champ réservé glissé dans la soumission la fait échouer en entier')
ok(db.prepare("SELECT COUNT(*) n FROM proposition_champ WHERE champ LIKE '%probabilite'").get().n === 0,
  'et il n\'existe nulle part en base')

// L'arbitrage écrit dans la table des réponses.
const [prop] = enAttente(db, dossierId)
const parChamp = Object.fromEntries(prop.champs.map((c) => [c.champ, c.id]))
const res = arbitrer(db, prop.id, {
  [parChamp['qualification.q.produit_nature']]: { decision: 'ACCEPTE' },
  [parChamp['qualification.q.humidite_initiale']]: { decision: 'AMENDE', valeur: '48', motif: 'mesuré sur place' },
  [parChamp['qualification.q.humidite_cible']]: { decision: 'ACCEPTE' },
  [parChamp['qualification.q.activite']]: { decision: 'ACCEPTE' },
  [parChamp['qualification.q.production_continue']]: { decision: 'REFUSE', motif: 'à revoir en visite' },
}, null)

ok(res.ok, 'l\'arbitrage passe')
const rep = reponsesDuDossier(db, dossierId)
ok(rep['q.produit_nature'] === 'Plaquettes de hêtre', 'la réponse acceptée est posée sur le dossier')
ok(rep['q.humidite_initiale'] === '48', 'la réponse amendée prend la valeur du gérant, pas celle du client')
ok(rep['q.production_continue'] === undefined, 'la réponse refusée n\'est pas posée')
ok(lireReponse(cm, rep['q.activite']).join() === 'Scierie,Exploitant forestier',
  'un choix multiple accepté se relit correctement')

// Rejouer une réponse ne doit pas créer de doublon.
const r2 = enregistrerReponses(db, dossierId, { 'q.produit_nature': 'Plaquettes de chêne' }, null)
ok(r2.ok, 'une saisie interne passe')
ok(db.prepare('SELECT COUNT(*) n FROM reponse_qualification WHERE dossier_id = ? AND cle = ?')
  .get(dossierId, 'q.produit_nature').n === 1, 'une réponse réécrite ne se duplique pas')
ok(reponsesDuDossier(db, dossierId)['q.produit_nature'] === 'Plaquettes de chêne',
  'et c\'est la nouvelle valeur qui reste')

ok(!enregistrerReponses(db, dossierId, { 'q.inexistant': 'x' }).ok,
  'une clé inconnue est refusée à la saisie interne aussi')
ok(!enregistrerReponses(db, dossierId, { 'q.humidite_cible': '300' }).ok,
  'et une valeur hors bornes')

// ═══════════════════════════════════════════════════════════
titre('Ce qui manque pour dimensionner')

const c1 = completudeQualification(reponsesDuDossier(db, dossierId))
ok(!c1.dimensionnable, 'la fiche n\'est pas encore dimensionnable')
ok(c1.manquants.some((m) => m.cle === 'q.bat_surface'),
  'et il est dit lesquels manquent (la surface du bâtiment, ici)')
ok(c1.taux > 0 && c1.taux < 100, `le taux de remplissage est indicatif (${c1.taux} %)`)

enregistrerReponses(db, dossierId, {
  'q.bat_surface': '800', 'q.bat_hauteur': '7', 'q.energie': ['Électricité', 'Biomasse'],
})
const c2 = completudeQualification(reponsesDuDossier(db, dossierId))
ok(c2.dimensionnable, 'une fois les indispensables remplis, elle le devient')
ok(c2.manquants.length === 0, 'et plus rien n\'est signalé comme manquant')
ok(INDISPENSABLES.every((c) => definitionQualification(c)),
  'chaque champ déclaré indispensable existe bien dans la fiche')

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
