/**
 * Contrôles du planning.
 *
 * 1. **Les jours se comptent sur les chaînes**, sans fuseau : un changement d'heure ne décale
 *    jamais une pose d'un jour, et le mois de février a bien 28 colonnes.
 * 2. **Déplacer garde l'heure et la durée** ; un rendez-vous confirmé déplacé redevient
 *    « planifié » — le client a dit oui à une autre date.
 * 3. **Une intervention réalisée ou annulée ne bouge plus.**
 * 4. **La date du dossier suit la pose réalisée, sans jamais écraser une date saisie.**
 * 5. **La portée s'applique** : une intervention d'un dossier d'une autre unité n'apparaît pas.
 * 6. **Les étapes de migration** posent les sept types une seule fois, et donnent le droit
 *    « planning.tous » aux rôles qui voient déjà tous les dossiers.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const { appliquerManuelles } = await import('./lib/migrations-manuelles.js')
const P = await import('./lib/planning.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)
const leve = (f) => { try { f(); return null } catch (e) { return e.message } }

const CIBLE = path.join(os.tmpdir(), `planning-test-${process.pid}.db`)
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())
const uid = () => crypto.randomUUID()

// Deux rôles avant migration : l'un voit tout, l'autre non.
const roleGerant = uid(), roleRegie = uid()
db.prepare('INSERT INTO role (id, nom, code, permissions) VALUES (?,?,?,?)').run(roleGerant, 'Gérant', 'GERANT', JSON.stringify(['dossier.voir', 'dossier.tous']))
db.prepare('INSERT INTO role (id, nom, code, permissions) VALUES (?,?,?,?)').run(roleRegie, 'Régie', 'REGIE', JSON.stringify(['dossier.voir']))

// ═══════════════════════════════════════════════════════════
titre('Étapes de migration')
const r1 = appliquerManuelles(db)
ok(r1.erreurs.length === 0, r1.erreurs.length ? r1.erreurs.join(' | ') : 'appliquées sans erreur')
const types = P.typesIntervention(db)
ok(types.length === 7 && types[0].code === 'RDV_COMMERCIAL', `sept types posés, dans l'ordre : ${types.map((t) => t.libelle).join(', ')}`)
const perm = (id) => JSON.parse(db.prepare('SELECT permissions FROM role WHERE id = ?').get(id).permissions)
ok(perm(roleGerant).includes('planning.tous') && !perm(roleRegie).includes('planning.tous'),
  '« planning.tous » donné au rôle qui voit tous les dossiers, pas à la régie')
db.prepare("UPDATE type_intervention SET actif = 0 WHERE code = 'SAV'").run()
db.prepare("DELETE FROM migration_manuelle WHERE nom = '2026-09-30-types-intervention'").run()
appliquerManuelles(db)
ok(db.prepare('SELECT COUNT(*) AS n FROM type_intervention').get().n === 7, 'rejouée sur une table non vide, elle ne rajoute rien')
ok(P.typesIntervention(db).length === 6, 'un type désactivé disparaît des listes')
db.prepare("UPDATE type_intervention SET actif = 1 WHERE code = 'SAV'").run()
const T = Object.fromEntries(P.typesIntervention(db).map((t) => [t.code, t.id]))

// ═══════════════════════════════════════════════════════════
titre('Les jours')
const semaine = P.periode('semaine', '2026-10-01')
ok(semaine[0] === '2026-09-28' && semaine[6] === '2026-10-04', `la semaine du jeudi 1er octobre va du lundi 28/09 au dimanche 04/10`)
ok(P.periode('mois', '2027-02-14').length === 28, 'février 2027 : 28 jours')
ok(P.periode('mois', '2028-02-03').length === 29, 'février 2028 : 29 jours')
const oct = P.periode('mois', '2026-10-20')
ok(oct.length === 31 && oct.includes('2026-10-25') && oct.includes('2026-10-26'), "octobre 2026 : 31 jours, le passage à l'heure d'hiver (25/10) ne fait ni sauter ni doubler un jour")
ok(P.ajouterJours('2026-03-28', 2) === '2026-03-30', "passage à l'heure d'été : samedi + 2 jours = lundi")

// ═══════════════════════════════════════════════════════════
titre('Dossiers et interventions')
const unite1 = uid(), unite2 = uid()
db.prepare('INSERT INTO unite_affaire (id, nom) VALUES (?,?), (?,?)').run(unite1, 'Régie Nord', unite2, 'Régie Sud')
const poseur = uid(), commercial = uid()
db.prepare('INSERT INTO utilisateur (id, email, nom, prenom, role_id) VALUES (?,?,?,?,?)').run(poseur, 'p@x.fr', 'Martin', 'Paul', roleRegie)
db.prepare('INSERT INTO utilisateur (id, email, nom, prenom, role_id) VALUES (?,?,?,?,?)').run(commercial, 'c@x.fr', 'Durand', 'Léa', roleGerant)
const fiche = uid(), version = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)').run(fiche, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Séchage solaire')
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)').run(version, fiche, 1, '2024-01-01')
function dossier(numero, unite, datePose = null) {
  const b = uid(), s = uid(), d = uid()
  db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale) VALUES (?,?,?)').run(b, 'SOCIETE', `EARL ${numero}`)
  db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)').run(s, '1 route', '01000', 'Bourg')
  db.prepare(`INSERT INTO dossier (id, numero, unite_affaire_id, beneficiaire_id, site_id, fiche_id, fiche_version_id, date_pose)
              VALUES (?,?,?,?,?,?,?,?)`).run(d, numero, unite, b, s, fiche, version, datePose)
  return d
}
const d1 = dossier('D1', unite1), d2 = dossier('D2', unite2, '2026-09-01')

const aPlanifier = P.creerIntervention(db, { dossierId: d1, typeId: T.PREVISITE })
ok(db.prepare('SELECT statut FROM intervention WHERE id = ?').get(aPlanifier).statut === 'A_PLANIFIER', 'sans date : à planifier')
ok(P.interventionsAPlanifier(db).length === 1, 'elle attend dans la liste « à planifier »')

const pose = P.creerIntervention(db, { dossierId: d1, typeId: T.POSE, debut: '2026-09-30T08:00', fin: '2026-10-02T17:00', attribueeA: poseur })
ok(P.interventionsPeriode(db, '2026-10-01', '2026-10-01').some((i) => i.id === pose), 'une pose sur trois jours apparaît le jour du milieu')
ok(P.interventionsPeriode(db, '2026-10-03', '2026-10-09').length === 0, 'et plus après sa fin')
ok(leve(() => P.creerIntervention(db, { dossierId: d1, typeId: T.POSE, debut: '2026-10-05T10:00', fin: '2026-10-05T09:00' })) === 'La fin est avant le début.', 'fin avant début : refusé')
ok(/Date invalide/.test(leve(() => P.creerIntervention(db, { dossierId: d1, typeId: T.POSE, debut: '05/10/2026' }))), 'une date mal formée est refusée, pas devinée')

// ═══════════════════════════════════════════════════════════
titre('Déplacer')
P.confirmerIntervention(db, pose, { par: commercial })
let r = P.deplacerIntervention(db, pose, { jour: '2026-10-05', attribueeA: commercial })
let i = db.prepare('SELECT * FROM intervention WHERE id = ?').get(pose)
ok(i.debut === '2026-10-05T08:00' && i.fin === '2026-10-07T17:00', `heure et durée conservées : ${i.debut} → ${i.fin}`)
ok(i.attribuee_a === commercial, 'réattribuée à la personne de la ligne')
ok(i.statut === 'PLANIFIEE' && i.confirmee_par === null, 'un rendez-vous confirmé puis déplacé redevient « planifié »')
P.deplacerIntervention(db, aPlanifier, { jour: '2026-10-06', attribueeA: null })
ok(db.prepare('SELECT debut, statut FROM intervention WHERE id = ?').get(aPlanifier).debut === '2026-10-06T08:00', 'une intervention à planifier glissée sur un jour arrive à 8 h')
ok(db.prepare('SELECT statut FROM intervention WHERE id = ?').get(aPlanifier).statut === 'PLANIFIEE', 'et passe « planifiée »')
P.confirmerIntervention(db, aPlanifier)
P.deplacerIntervention(db, aPlanifier, { jour: '2026-10-06', attribueeA: poseur })
ok(db.prepare('SELECT statut FROM intervention WHERE id = ?').get(aPlanifier).statut === 'CONFIRMEE', 'changer seulement de personne garde la confirmation')

// ═══════════════════════════════════════════════════════════
titre('Réaliser')
const date = P.realiserIntervention(db, pose, { compteRendu: 'RAS' })
ok(date?.champ === 'Date de pose' && db.prepare('SELECT date_pose AS v FROM dossier WHERE id = ?').get(d1).v === '2026-10-07',
  'la pose réalisée renseigne la date de pose du dossier (jour de fin)')
ok(/ne se modifie plus/.test(leve(() => P.deplacerIntervention(db, pose, { jour: '2026-10-10' }))), 'une intervention réalisée ne se déplace plus')
const pose2 = P.creerIntervention(db, { dossierId: d2, typeId: T.POSE, debut: '2026-10-08T08:00' })
ok(P.realiserIntervention(db, pose2) === null && db.prepare('SELECT date_pose AS v FROM dossier WHERE id = ?').get(d2).v === '2026-09-01',
  "une date de pose déjà saisie n'est jamais écrasée")
ok(/sans date/.test(leve(() => P.realiserIntervention(db, P.creerIntervention(db, { dossierId: d1, typeId: T.SAV })))), 'une intervention sans date ne peut pas être réalisée')
P.rouvrirIntervention(db, pose)
ok(db.prepare('SELECT statut FROM intervention WHERE id = ?').get(pose).statut === 'PLANIFIEE', 'une réalisation saisie par erreur se rouvre')

// ═══════════════════════════════════════════════════════════
titre('Portée et filtres')
const semaine2 = P.periode('semaine', '2026-10-05')
ok(P.interventionsPeriode(db, semaine2[0], semaine2[6], { uniteId: unite1 }).every((x) => x.unite_affaire_id === unite1), "l'unité 1 ne voit que ses dossiers")
ok(P.interventionsPeriode(db, semaine2[0], semaine2[6], { uniteId: unite2 }).length === 1, "l'unité 2 voit sa seule pose")
ok(P.interventionsPeriode(db, semaine2[0], semaine2[6], { attribueeA: poseur }).every((x) => x.attribuee_a === poseur), 'le planning personnel ne montre que ses interventions')
ok(P.interventionsPeriode(db, semaine2[0], semaine2[6], { typeId: T.PREVISITE }).every((x) => x.type_id === T.PREVISITE), 'un calendrier ne montre que son type')
const annulee = P.creerIntervention(db, { dossierId: d1, typeId: T.PREVISITE, debut: '2026-10-09T09:00' })
P.annulerIntervention(db, annulee, { motif: 'client absent' })
ok(!P.interventionsPeriode(db, semaine2[0], semaine2[6]).some((x) => x.id === annulee), 'une intervention annulée sort du planning')
ok(P.interventionsDossier(db, d1).some((x) => x.id === annulee), 'mais reste dans l\'historique du dossier')
db.prepare('UPDATE utilisateur SET actif = 0 WHERE id = ?').run(poseur)
const lignes = P.ressources(db, P.interventionsPeriode(db, semaine2[0], semaine2[6]))
ok(lignes.some((l) => l.id === poseur && l.role === 'Comptes désactivés'), "un compte désactivé qui porte des interventions garde sa ligne, pour qu'on les réattribue")

db.close()
fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
