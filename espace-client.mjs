/**
 * Contrôles de l'espace client.
 *
 * L'espace client est la seule partie de la plateforme ouverte à quelqu'un qui n'a ni
 * compte, ni rôle, ni permission. Ce qui est vérifié ici découle entièrement de ça :
 *
 * 1. **Le client ne modifie jamais son dossier.** Il dépose une proposition à côté. Tant
 *    que le gérant n'a pas tranché, le dossier est inchangé — c'est le contrôle central.
 * 2. **La liste blanche tient.** Un champ hors liste est refusé à la soumission, et
 *    revérifié au moment d'écrire. Deux verrous, parce qu'un seul finit par céder.
 * 3. **Un accès révoqué est révoqué tout de suite**, session ouverte comprise.
 * 4. **L'arbitrage est ligne par ligne**, et une valeur modifiée entre-temps n'est pas
 *    écrasée en silence.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const {
  genererIdentifiant, genererCode, ouvrirAcces, revoquerAcces, verifierAcces,
  ouvrirSessionClient, sessionClient, fermerSessionClient, purgerSessionsClient,
} = await import('./lib/acces-client.js')
const {
  CHAMPS_CLIENT, champsClient, definitionChamp, normaliser, soumettre, arbitrer,
  enAttente, valeurActuelle, suiviClient, cible,
} = await import('./lib/propositions.js')
const { AGES_BATIMENT, TYPES_CHAUFFAGE } = await import('./lib/referentiels-site.js')

const REF = { agesBatiment: AGES_BATIMENT, typesChauffage: TYPES_CHAUFFAGE }

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ── Une base de travail avec un dossier complet ──
const CIBLE = path.join(os.tmpdir(), 'espace-client-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

const uid = () => crypto.randomUUID()
const run = (s, p = []) => db.prepare(s).run(...p)

const benefId = uid(); const siteId = uid(); const dossierId = uid()
const ficheId = uid(); const versionId = uid()

run(`INSERT INTO beneficiaire (id, type, raison_sociale, nom, prenom, telephone, email, regime_revenu)
     VALUES (?,?,?,?,?,?,?,?)`,
  [benefId, 'SOCIETE', 'EARL DE CHEVASNE', 'CHOTARD', 'Anthony', '0607050349', 'ancien@example.fr', 'CLASSIQUE'])
run(`INSERT INTO site (id, adresse, code_postal, ville, departement, surface, type_chauffage)
     VALUES (?,?,?,?,?,?,?)`,
  [siteId, '66 Chevasné', '44440', 'RIAILLE', '44', 120, 'COMBUSTIBLE'])
run('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)',
  [ficheId, 'RES-EC-104', 'RES', 'EC', "Rénovation d'éclairage extérieur"])
run(`INSERT INTO fiche_version (id, fiche_id, version, date_effet, formule_type, unite_variable, coefficients, conditions)
     VALUES (?,?,?,?,?,?,?,?)`, [versionId, ficheId, 'A62-2', '2025-01-01', 'FORFAIT_PAR_UNITE', 'U', '{}', '{}'])
run(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id,
     date_proposition, date_signature) VALUES (?,?,?,?,?,?,?,?)`,
  [dossierId, 'EPC-2026-0001', benefId, siteId, ficheId, versionId, '2026-02-01', '2026-02-10'])

// ═══════════════════════════════════════════════════════════
titre("Les identifiants se dictent au téléphone")

const ident = genererIdentifiant()
const code = genererCode()
ok(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(ident), `l'identifiant est lisible : ${ident}`)
ok(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code), 'le code aussi')
// Le 0 et le O, le 1 et le I : c'est l'appel au support pour un problème qui n'existe pas.
const cent = Array.from({ length: 100 }, () => genererIdentifiant() + genererCode()).join('')
ok(!/[IOL01]/.test(cent),
  'sur 100 tirages, aucun caractère qui se confonde (I, O, L, 0, 1) — ils sont exclus de l\'alphabet')
ok(new Set(Array.from({ length: 500 }, genererIdentifiant)).size === 500,
  'et 500 identifiants tirés de suite sont tous différents')

// ═══════════════════════════════════════════════════════════
titre("L'accès : délivré, vérifié, révocable")

const acces = ouvrirAcces(db, dossierId, null)
ok(!!acces.identifiant && !!acces.code, 'un accès porte un identifiant et un code')
const enBase = db.prepare('SELECT * FROM acces_client WHERE id = ?').get(acces.id)
ok(!enBase.secret_empreinte.includes(acces.code),
  "le code n'est pas stocké en clair — seule son empreinte l'est")

ok(!!verifierAcces(db, acces.identifiant, acces.code), 'le bon couple identifiant/code ouvre')
ok(!verifierAcces(db, acces.identifiant, 'MAUVAIS-CODE1'), 'un mauvais code n\'ouvre pas')
ok(!verifierAcces(db, 'XXXX-XXXX-XXXX', acces.code), 'un identifiant inconnu n\'ouvre pas')
ok(!!verifierAcces(db, ` ${acces.identifiant.toLowerCase()} `, acces.code),
  'la casse et les espaces autour ne font pas échouer une saisie correcte')

const apresVisite = db.prepare('SELECT visites FROM acces_client WHERE id = ?').get(acces.id)
ok(apresVisite.visites >= 2, `les visites sont comptées (${apresVisite.visites})`)

// ═══════════════════════════════════════════════════════════
titre('La session client, séparée de celle du personnel')

const { id: jeton } = ouvrirSessionClient(db, acces.id)
ok(!!sessionClient(db, jeton), 'une session ouverte est reconnue')
ok(sessionClient(db, jeton).dossier_id === dossierId, 'et elle désigne le bon dossier')
ok(!sessionClient(db, 'jeton-inventé'), 'un jeton inventé ne l\'est pas')
ok(!sessionClient(db, null), 'ni un jeton absent')

// Le point qui compte : révoquer doit couper la session EN COURS.
const { id: jeton2 } = ouvrirSessionClient(db, acces.id)
revoquerAcces(db, acces.id, null)
ok(!sessionClient(db, jeton2),
  "révoquer un accès coupe immédiatement la session ouverte — pas à l'expiration du jeton")
ok(!verifierAcces(db, acces.identifiant, acces.code), 'et le couple identifiant/code ne rouvre plus')

// Une session expirée n'ouvre plus, et se purge.
const acces2 = ouvrirAcces(db, dossierId, null)
const { id: jetonVieux } = ouvrirSessionClient(db, acces2.id)
db.prepare("UPDATE session_client SET expire_le = datetime('now','-1 hour') WHERE id = ?").run(jetonVieux)
ok(!sessionClient(db, jetonVieux), 'une session expirée est refusée')
ok(db.prepare('SELECT COUNT(*) n FROM session_client WHERE id = ?').get(jetonVieux).n === 0,
  'et elle est supprimée au passage, pas laissée à traîner')

// ═══════════════════════════════════════════════════════════
titre('La liste blanche : ce qui est modifiable, et rien d\'autre')

const tous = champsClient(REF).map((c) => c.champ)
ok(tous.includes('beneficiaire.telephone') && tous.includes('site.adresse'),
  'les coordonnées et l\'adresse du chantier sont modifiables')
ok(tous.includes('site.age_batiment_tranche') && tous.includes('site.type_chauffage'),
  'l\'âge du bâtiment et le chauffage aussi, en liste fermée')

// Ce qui ne doit JAMAIS y figurer. La liste est écrite en dur ici exprès : si quelqu'un
// ajoute un de ces champs à `CHAMPS_CLIENT`, ce contrôle tombe.
for (const interdit of ['dossier.prime_beneficiaire', 'dossier.volume_cumac', 'dossier.fiche_id',
  'dossier.delegataire_id', 'dossier.deal_id', 'dossier.statut_dossier_id', 'dossier.marge_nette',
  'operation.puv', 'dossier.verrouille', 'dossier.num_devis']) {
  ok(!tous.includes(interdit), `${interdit} n'est pas modifiable par le client`)
}

ok(definitionChamp('dossier.marge_nette', REF) === null, 'un champ hors liste n\'a pas de définition')
ok(cible('site.adresse')?.table === 'site', 'la cible se découpe correctement')
ok(cible('site; DROP TABLE dossier') === null, 'une cible qui ne ressemble pas à table.colonne est rejetée')
ok(cible('../../etc/passwd') === null, 'et une tentative de traversée aussi')

// La normalisation
ok(normaliser({ type: 'nombre', libelle: 'S' }, '-3').ok === false, 'une surface négative est refusée')
ok(normaliser({ type: 'nombre', libelle: 'S' }, '12,5').valeur === 12.5, 'la virgule décimale est acceptée')
ok(normaliser({ type: 'email', libelle: 'E' }, 'pas-un-email').ok === false, 'un e-mail malformé est refusé')
ok(normaliser({ type: 'texte', libelle: 'T', max: 5 }, 'beaucoup trop long').ok === false,
  'un texte trop long est refusé')
ok(normaliser({ type: 'liste', libelle: 'C', valeurs: [{ code: 'A' }] }, 'B').ok === false,
  'une valeur hors liste fermée est refusée')
ok(normaliser({ type: 'texte', libelle: 'T' }, '').valeur === null,
  'un champ laissé vide vaut « vide », pas une chaîne vide')

// ═══════════════════════════════════════════════════════════
titre('Soumettre ne touche PAS au dossier — le contrôle central')

const avantTel = valeurActuelle(db, dossierId, 'beneficiaire.telephone')
const r = soumettre(db, {
  dossierId, accesId: acces2.id, referentiels: REF,
  valeurs: {
    'beneficiaire.telephone': '06 11 22 33 44',
    'beneficiaire.email': 'nouveau@example.fr',
    'site.adresse': '66 bis Chevasné',
  },
  message: 'Bonjour, j\'ai changé de numéro.',
})
ok(r.ok && r.champs === 3, `trois modifications enregistrées (obtenu : ${r.champs})`)
ok(valeurActuelle(db, dossierId, 'beneficiaire.telephone') === avantTel,
  'le téléphone du dossier n\'a PAS bougé — la proposition est une copie à côté')
ok(db.prepare('SELECT COUNT(*) n FROM proposition WHERE statut = ?').get('EN_ATTENTE').n === 1,
  'et une proposition est en attente')

// Une valeur identique n'est pas une modification.
const rIdem = soumettre(db, {
  dossierId, accesId: acces2.id, referentiels: REF,
  valeurs: { 'beneficiaire.email': 'ancien@example.fr' },
})
ok(!rIdem.ok && /Aucune modification/.test(rIdem.motifs[0]),
  'renvoyer le formulaire sans rien changer ne crée pas de proposition vide')

// Un champ interdit fait ÉCHOUER la soumission, il n'est pas ignoré en silence.
const rInterdit = soumettre(db, {
  dossierId, accesId: acces2.id, referentiels: REF,
  valeurs: { 'beneficiaire.telephone': '0600000000', 'dossier.prime_beneficiaire': '999999' },
})
ok(!rInterdit.ok, 'une soumission contenant un champ interdit est refusée en entier')
ok(/n'est pas modifiable/.test(rInterdit.motifs.join(' ')), 'et le motif nomme le champ')
ok(db.prepare("SELECT COUNT(*) n FROM proposition_champ WHERE champ = 'dossier.prime_beneficiaire'").get().n === 0,
  "le champ interdit n'existe nulle part en base — pas même comme ligne en attente")

// ═══════════════════════════════════════════════════════════
titre("L'arbitrage du gérant, ligne par ligne")

const [prop] = enAttente(db, dossierId)
ok(prop.champs.length === 3, 'la proposition présente ses trois lignes au gérant')
ok(prop.message === "Bonjour, j'ai changé de numéro.", 'et le mot du client')

const parChamp = Object.fromEntries(prop.champs.map((c) => [c.champ, c.id]))
const res = arbitrer(db, prop.id, {
  [parChamp['beneficiaire.telephone']]: { decision: 'ACCEPTE' },
  [parChamp['beneficiaire.email']]: { decision: 'AMENDE', valeur: 'contact@chevasne.fr', motif: 'adresse pro' },
  [parChamp['site.adresse']]: { decision: 'REFUSE', motif: 'adresse vérifiée au cadastre' },
}, null)

ok(res.ok, 'l\'arbitrage passe')
ok(valeurActuelle(db, dossierId, 'beneficiaire.telephone') === '06 11 22 33 44',
  'le champ accepté est appliqué')
ok(valeurActuelle(db, dossierId, 'beneficiaire.email') === 'contact@chevasne.fr',
  'le champ amendé prend la valeur du GÉRANT, pas celle du client')
ok(valeurActuelle(db, dossierId, 'site.adresse') === '66 Chevasné',
  'le champ refusé laisse le dossier intact')
ok(res.appliques.length === 2, `deux champs appliqués sur trois (obtenu : ${res.appliques.length})`)

ok(db.prepare('SELECT statut FROM proposition WHERE id = ?').get(prop.id).statut === 'TRAITEE',
  'la proposition passe en traitée')
ok(!arbitrer(db, prop.id, {}, null).ok, 'et ne peut pas être arbitrée une seconde fois')

// La trace de la décision est conservée : qui a refusé quoi, et pourquoi.
const refuse = db.prepare('SELECT * FROM proposition_champ WHERE id = ?').get(parChamp['site.adresse'])
ok(refuse.decision === 'REFUSE' && refuse.motif === 'adresse vérifiée au cadastre',
  'le refus garde son motif — on saura pourquoi dans six mois')

// ═══════════════════════════════════════════════════════════
titre('Les deux garde-fous de l\'arbitrage')

// (a) La valeur a bougé entre-temps : on ne l'écrase pas en silence.
const r2 = soumettre(db, {
  dossierId, accesId: acces2.id, referentiels: REF,
  valeurs: { 'beneficiaire.telephone': '06 99 99 99 99' },
})
ok(r2.ok, 'une deuxième proposition est déposée')
// Entre-temps, l'ADV corrige le numéro en interne.
run('UPDATE beneficiaire SET telephone = ? WHERE id = ?', ['06 55 55 55 55', benefId])

const [prop2] = enAttente(db, dossierId)
const res2 = arbitrer(db, prop2.id, {
  [prop2.champs[0].id]: { decision: 'ACCEPTE' },
}, null)
ok(res2.ok && res2.appliques.length === 0,
  'un champ modifié en interne depuis la soumission n\'est PAS écrasé')
ok(res2.conflits.length === 1 && /a changé depuis la soumission/.test(res2.conflits[0]),
  'et le conflit est signalé au gérant, avec les deux valeurs')
ok(valeurActuelle(db, dossierId, 'beneficiaire.telephone') === '06 55 55 55 55',
  'la correction interne survit — c\'est elle la plus récente')

// (b) Un dossier verrouillé ne se modifie pas, même par une proposition acceptée.
const r3 = soumettre(db, {
  dossierId, accesId: acces2.id, referentiels: REF,
  valeurs: { 'site.ville': 'RIAILLÉ' },
})
run('UPDATE dossier SET verrouille = 1 WHERE id = ?', [dossierId])
const [prop3] = enAttente(db, dossierId)
const res3 = arbitrer(db, prop3.id, { [prop3.champs[0].id]: { decision: 'ACCEPTE' } }, null)
ok(!res3.ok && /verrouillé/.test(res3.motifs[0]),
  'sur un dossier verrouillé, l\'arbitrage est refusé en entier')
ok(valeurActuelle(db, dossierId, 'site.ville') === 'RIAILLE', 'et rien n\'est appliqué')
ok(db.prepare('SELECT statut FROM proposition WHERE id = ?').get(prop3.id).statut === 'EN_ATTENTE',
  'la proposition reste en attente — elle sera arbitrée au déverrouillage')
run('UPDATE dossier SET verrouille = 0 WHERE id = ?', [dossierId])

// ═══════════════════════════════════════════════════════════
titre('Le suivi montré au client')

const suivi = suiviClient({ date_proposition: '2026-02-01', date_signature: '2026-02-10' })
ok(suivi.etapes.length === 6, 'six étapes')
ok(suivi.etapes[0].faite && suivi.etapes[1].faite, 'les deux premières sont franchies')
ok(suivi.enCours === 'POSE', `l'étape en cours est celle qui suit (obtenu : ${suivi.enCours})`)
ok(!suivi.termine, 'le parcours n\'est pas terminé')

const vide = suiviClient({})
ok(vide.etapes.every((e) => !e.faite) && vide.enCours === 'DEVIS',
  'sans aucune date, rien n\'est inventé : le parcours commence au début')

const fini = suiviClient({
  date_proposition: '2026-01-01', date_signature: '2026-01-02', date_pose: '2026-01-03',
  date_controle: '2026-01-04', date_achevement: '2026-01-05', date_depot: '2026-01-06',
})
ok(fini.termine && fini.enCours === null, 'un dossier déposé est marqué terminé')

// Les étapes montrées au client ne portent AUCUN statut interne.
const libelles = suivi.etapes.map((e) => e.libelle).join(' ')
ok(!/COFRAC|AGRI|ILORAL|LISTE/i.test(libelles),
  'aucun statut interne (« LISTE AGRI TH 117 », « PAS COFRAC ») n\'apparaît côté client')

// ═══════════════════════════════════════════════════════════
titre('Ce que la page client ne va pas chercher')

// Le contrôle porte sur le CODE de la page : les montants interdits ne doivent pas être
// lus du tout. Un masquage à l'affichage se contournerait en lisant le HTML.
const pageClient = fs.readFileSync('app/espace/dossier/page.jsx', 'utf8')
for (const interdit of ['marge_nette', 'commission_apporteur', 'prime_delegataire', 'commission_installateur']) {
  ok(!new RegExp(`\\b${interdit}\\b`).test(pageClient),
    `la page client ne lit jamais ${interdit} — ce n'est pas masqué, c'est absent`)
}
ok(/prime_beneficiaire/.test(pageClient), 'elle lit bien la prime qui revient au client')
ok(/@media print/.test(pageClient) && /filigrane/.test(pageClient),
  'elle bloque l\'impression et porte un filigrane')
ok(/identifiant/.test(pageClient), 'dont l\'identifiant du visiteur, pour tracer une capture')

// Et les actions de l'espace client n'écrivent que dans `proposition`.
const actions = fs.readFileSync('app/espace/actions.js', 'utf8')
ok(!/UPDATE\s+(dossier|beneficiaire|site|operation)\b/i.test(actions),
  'aucune action de l\'espace client n\'écrit dans le dossier, le bénéficiaire, le site ou les opérations')

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
