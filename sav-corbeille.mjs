/**
 * Contrôles du S.A.V et de la corbeille.
 *
 * S.A.V : listes posées une fois, numérotation, clôture tenue avec le statut dans les deux
 * sens, intervention rattachée au planning.
 *
 * Corbeille : ce qui l'empêche ; un dossier à la corbeille disparaît PARTOUT (tableau de
 * bord, recherche, rappels, planning, S.A.V, appels à paiement, espace client) et refuse
 * toute écriture ; il revient tel quel ; la suppression définitive efface ce qui
 * n'appartient qu'à lui, garde ce qui est partagé, laisse une trace et refuse un devis
 * numéroté.
 *
 * La suite pointe l'application entière sur une base jetable (CEE_DB_PATH), pour contrôler
 * aussi les requêtes des écrans existants — c'est là qu'un oubli ferait réapparaître un
 * dossier supprimé.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CIBLE = path.join(os.tmpdir(), `sav-corbeille-${process.pid}.db`)
fs.rmSync(CIBLE, { force: true })
process.env.CEE_DB_PATH = CIBLE

const { db: ouvrir } = await import('./lib/db.js')
const db = ouvrir() // schéma + étapes de migration, comme au démarrage
const S = await import('./lib/sav.js')
const C = await import('./lib/corbeille.js')
const Q = await import('./lib/queries.js')
const R = await import('./lib/recherche.js')
const { listerRappels, compteurs } = await import('./lib/rappels.js')
const P = await import('./lib/planning.js')
const { dossiersAppelables } = await import('./lib/aap.js')
const { ouvrirAcces, verifierAcces } = await import('./lib/acces-client.js')
const { exigerPortee } = await import('./lib/portee.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const leve = (f) => { try { f(); return null } catch (e) { return e.message } }
const uid = () => crypto.randomUUID()
db.exec('PRAGMA foreign_keys = ON')

const moi = uid()
db.prepare('INSERT INTO utilisateur (id, email, nom, prenom) VALUES (?,?,?,?)').run(moi, 'adv@x.fr', 'Adv', 'Anne')
const deleg = uid()
db.prepare('INSERT INTO delegataire (id, nom) VALUES (?,?)').run(deleg, 'DRAPO')
const fiche = uid(), version = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)').run(fiche, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Séchage')
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)').run(version, fiche, 1, '2024-01-01')
const stDossier = uid()
db.prepare("INSERT INTO statut (id, libelle, axe) VALUES (?, 'En cours', 'DOSSIER')").run(stDossier)

function dossier(numero, { benef = null } = {}) {
  const b = benef || uid(), s = uid(), d = uid(), ch = uid()
  if (!benef) db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale, siret) VALUES (?,?,?,?)').run(b, 'SOCIETE', `EARL ${numero}`, '12345678900011')
  db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)').run(s, '1 route', '01000', 'Bourg')
  db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id, statut_dossier_id, delegataire_id, date_calcul, volume_cumac, prime_delegataire)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(d, numero, b, s, fiche, version, stDossier, deleg, '2026-09-01', 1000, 7)
  db.prepare('INSERT INTO chantier (id, dossier_id, site_id, principal) VALUES (?,?,?,1)').run(ch, d, s)
  db.prepare('INSERT INTO operation (id, dossier_id, ordre, fiche_id, fiche_version_id, chantier_id, quantite) VALUES (?,?,?,?,?,?,?)').run(uid(), d, 1, fiche, version, ch, 10)
  return { d, b, s }
}

// ═══════════════════════════════════════════════════════════
titre('Listes du S.A.V')
ok(S.referentielSav(db, 'TYPE').length === 5 && S.referentielSav(db, 'STATUT').length === 9 && S.referentielSav(db, 'MOTIF').length === 14,
  'posées au premier démarrage : 5 types, 9 statuts, 14 motifs')
const regle = S.referentielSav(db, 'STATUT').find((s) => s.libelle === 'Réglé')
const enCours = S.referentielSav(db, 'STATUT').find((s) => s.libelle === 'En cours')
const refus = S.referentielSav(db, 'MOTIF').find((s) => s.libelle === 'Refus organisme')
ok(regle?.cloture === 1 && S.referentielSav(db, 'STATUT').filter((s) => s.cloture).length === 1, '« Réglé » est le seul statut qui clôt')

// ═══════════════════════════════════════════════════════════
titre('Un S.A.V')
const A = dossier('A')
const v1 = S.creerSav(db, { dossierId: A.d, motifId: refus.id, probleme: 'Refus DRAPO : photo illisible', par: moi })
let v = S.lireSav(db, v1)
ok(/^SAV-\d{4}-0001$/.test(v.numero) && v.statut_libelle === 'À traiter' && v.cloture === 0, `${v.numero}, ouvert « À traiter » par défaut`)
ok(/Valeur inconnue/.test(leve(() => S.creerSav(db, { dossierId: A.d, motifId: regle.id })) || ''), "un statut donné comme motif est refusé")
S.modifierSav(db, v1, { motifId: refus.id, statutId: regle.id })
v = S.lireSav(db, v1)
ok(v.cloture === 1 && v.regle_le === new Date().toISOString().slice(0, 10), 'choisir « Réglé » clôt, daté du jour')
S.modifierSav(db, v1, { motifId: refus.id, statutId: regle.id, cloture: false })
v = S.lireSav(db, v1)
ok(v.cloture === 0 && v.statut_libelle === 'À traiter' && v.regle_le === null, 'décocher « Clôturé » rouvre, et quitte « Réglé »')
S.modifierSav(db, v1, { motifId: refus.id, statutId: enCours.id, cloture: true })
v = S.lireSav(db, v1)
ok(v.cloture === 1 && v.statut_libelle === 'Réglé', 'cocher « Clôturé » sur « En cours » passe en « Réglé »')
S.modifierSav(db, v1, { motifId: refus.id, statutId: enCours.id, cloture: false })
const i1 = S.planifierInterventionSav(db, v1, { debut: '2026-10-12T09:00', par: moi })
ok(db.prepare("SELECT t.code FROM intervention i JOIN type_intervention t ON t.id = i.type_id WHERE i.id = ?").get(i1).code === 'SAV',
  "l'intervention S.A.V est créée au planning et rattachée")
ok(/déjà rattachée/.test(leve(() => S.planifierInterventionSav(db, v1)) || ''), 'une seule intervention par S.A.V')
ok(S.comptesSav(db).ouverts === 1 && S.listerSav(db, { etat: 'ouverts', statutId: enCours.id }).length === 1, 'compteurs et filtres')

// ═══════════════════════════════════════════════════════════
titre('Ce qui empêche la corbeille')
const B = dossier('B')
db.prepare('UPDATE dossier SET verrouille = 1 WHERE id = ?').run(B.d)
ok(C.obstaclesCorbeille(db, B.d).some((o) => /verrouillé/.test(o)), 'un dossier déposé (verrouillé)')
db.prepare('UPDATE dossier SET verrouille = 0 WHERE id = ?').run(B.d)
const ent = uid()
db.prepare("INSERT INTO entite_emettrice (id, code, raison_sociale) VALUES (?, 'X', 'X')").run(ent)
db.prepare("INSERT INTO facture (id, numero, dossier_id, entite_id, type, date_emission, date_echeance, client_nom) VALUES (?, 'F-1', ?, ?, 'ACOMPTE', '2026-09-01', '2026-10-01', 'X')").run(uid(), B.d, ent)
ok(C.obstaclesCorbeille(db, B.d).some((o) => /facture/.test(o)), 'un dossier facturé, même d\'un simple acompte')
ok(/motif|pourquoi/i.test(leve(() => C.mettreALaCorbeille(db, A.d, { motif: '  ' })) || ''), 'sans motif : refusé')

// ═══════════════════════════════════════════════════════════
titre('À la corbeille, il disparaît partout')
db.prepare("INSERT INTO rappel (id, dossier_id, date_rappel, motif, attribue_a) VALUES (?, ?, date('now'), 'Relance devis', ?)").run(uid(), A.d, moi)
const acces = ouvrirAcces(db, A.d, moi)
const avant = { vivants: Q.dossiersVivants().length, recherche: R.compter({}, {}), rappels: compteurs({}).jour }
C.mettreALaCorbeille(db, A.d, { motif: 'Doublon de B', par: moi })
ok(Q.dossiersVivants().length === avant.vivants - 1, 'tableau de bord : dossiers vivants')
ok(Q.pipeline().reduce((s, l) => s + l.n, 0) === avant.vivants - 1, 'tableau de bord : pipeline')
ok(R.compter({}, {}) === avant.recherche - 1 && !R.rechercher({ q: 'EARL A' }, {}).length, 'recherche et export')
ok(compteurs({}).jour === avant.rappels - 1 && !listerRappels({ panier: 'jour' }).length, 'rappels')
ok(!P.interventionsPeriode(db, '2026-10-01', '2026-10-31').some((i) => i.dossier_id === A.d), 'planning')
ok(!S.listerSav(db, { etat: 'tous' }).length && S.comptesSav(db).ouverts === 0, 'S.A.V')
ok(!dossiersAppelables(db, deleg).some((x) => x.id === A.d), 'appels à paiement')
ok(verifierAcces(db, acces.identifiant, acces.code) === null, "l'espace client refuse la connexion")
ok(/corbeille/.test(leve(() => exigerPortee({ permissions: ['dossier.tous'] }, A.d)) || ''), 'et toute action serveur sur le dossier est refusée')
ok(!leve(() => exigerPortee({ permissions: ['dossier.tous'] }, A.d, { corbeille: true })), 'sauf celles de la corbeille')
ok(C.listerCorbeille(db).map((x) => x.numero).join() === 'A', 'la corbeille le liste, avec son motif')

// ═══════════════════════════════════════════════════════════
titre('Récupérer')
C.recuperer(db, A.d, { par: moi })
ok(Q.dossiersVivants().length === avant.vivants && verifierAcces(db, acces.identifiant, acces.code) !== null, 'il revient partout, accès client compris')
ok(db.prepare("SELECT COUNT(*) AS n FROM journal_champ WHERE dossier_id = ? AND champ = 'Corbeille'").get(A.d).n === 2, 'les deux gestes sont au journal')

// ═══════════════════════════════════════════════════════════
titre('Supprimer définitivement')
ok(/pas dans la corbeille/.test(leve(() => C.supprimerDefinitivement(db, A.d)) || ''), "hors de la corbeille : refusé")
const D = dossier('D')
db.prepare("UPDATE dossier SET num_devis = 'SPL-2026-0042' WHERE id = ?").run(D.d)
C.mettreALaCorbeille(db, D.d, { motif: 'test' })
ok(/numéroté/.test(leve(() => C.supprimerDefinitivement(db, D.d)) || ''), 'un devis numéroté bloque l\'effacement : la série doit rester continue')
const E = dossier('E', { benef: A.b }) // même bénéficiaire que A
const tE = S.creerSav(db, { dossierId: E.d })
S.planifierInterventionSav(db, tE)
db.prepare("INSERT INTO note (id, dossier_id, contenu) VALUES (?, ?, 'note')").run(uid(), E.d)
const td = uid()
db.prepare("INSERT INTO type_document (id, code, libelle) VALUES (?, 'AH', 'Attestation sur l''honneur')").run(td)
db.prepare("INSERT INTO document_dossier (id, dossier_id, type_document_id, nom_fichier, empreinte, extension) VALUES (?, ?, ?, 'a.pdf', 'e-unique', 'pdf'), (?, ?, ?, 'b.pdf', 'e-partagee', 'pdf')").run(uid(), E.d, td, uid(), E.d, td)
db.prepare("INSERT INTO document_dossier (id, dossier_id, type_document_id, nom_fichier, empreinte, extension) VALUES (?, ?, ?, 'b.pdf', 'e-partagee', 'pdf')").run(uid(), A.d, td)
C.mettreALaCorbeille(db, E.d, { motif: 'Dossier de test', par: moi })
const r = C.supprimerDefinitivement(db, E.d, { par: moi })
const reste = (t) => db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE dossier_id = ?`).get(E.d).n
ok(!db.prepare('SELECT 1 AS x FROM dossier WHERE id = ?').get(E.d), 'le dossier est effacé')
ok(['operation', 'chantier', 'note', 'sav', 'intervention', 'document_dossier', 'journal_champ'].every((t) => reste(t) === 0), 'avec ses opérations, chantiers, notes, S.A.V, interventions, pièces et journal')
ok(!db.prepare('SELECT 1 AS x FROM site WHERE id = ?').get(E.s), 'son site, qui ne servait qu\'à lui')
ok(!!db.prepare('SELECT 1 AS x FROM beneficiaire WHERE id = ?').get(A.b), 'mais pas le bénéficiaire, partagé avec A')
ok(r.orphelins.map((f) => f.empreinte).join() === 'e-unique', 'seul le fichier qui ne sert plus ailleurs est à effacer du disque')
const trace = db.prepare("SELECT * FROM journal_champ WHERE champ = 'Suppression définitive' AND entite_id = ?").get(E.d)
ok(trace?.ancienne === 'E' && trace?.nouvelle === 'Dossier de test' && trace?.dossier_id === null, 'la trace reste : quel dossier, pourquoi, par qui — sans les données')
ok(db.prepare('PRAGMA foreign_key_check').all().length === 0, 'aucune référence orpheline dans la base')

db.close()
fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
