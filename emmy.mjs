/**
 * Contrôles de l'export de dépôt.
 *
 * Ce que ce fichier vérifie, et pourquoi :
 *
 * 1. **Les formats qui font rejeter une demande.** Dates en jj/mm/aaaa, SIREN à 9 chiffres,
 *    SIRET à 14, et surtout : un SIRET qui commence par un zéro ne doit pas sortir sous une
 *    forme qu'Excel relira comme un nombre. C'est la cause de rejet la plus bête et la plus
 *    fréquente.
 * 2. **Un champ absent ne devient jamais une case vide.** Il est énuméré. Un export qui
 *    comble les trous produit une demande qui revient après instruction.
 * 3. **Le gabarit d'un délégataire remplace les intitulés, pas les données.** Et un gabarit
 *    abîmé fait retomber sur l'annexe 6 en le disant, plutôt que de vider des colonnes.
 * 4. **Le coût déclaré est celui de la facture émise.** Deux chiffres saisis deux fois
 *    finissent par diverger ; ici il n'y en a qu'un.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const {
  CHAMPS, dateFr, siretValide, sirenValide, sirenDeSiret,
  ligneDepot, valeursLigne, gabarit, tableauDepot, csvDepot,
} = await import('./lib/emmy.js')
const { emettreFacture } = await import('./lib/facture.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('Les formats que le registre impose')

ok(dateFr('2026-05-12') === '12/05/2026', `une date ISO devient jj/mm/aaaa (obtenu : ${dateFr('2026-05-12')})`)
ok(dateFr('2026-05-12T09:30:00Z') === '12/05/2026', 'un horodatage est ramené au jour')
ok(dateFr(null) === null && dateFr('') === null, 'une date absente reste absente, elle ne devient pas 01/01/1970')
ok(dateFr('pas une date') === null, "une valeur qui n'est pas une date ne sort pas déguisée en date")

ok(siretValide('82408078200035') && !siretValide('824080782'), 'un SIRET fait 14 chiffres, pas 9')
ok(sirenValide('824080782') && !sirenValide('82408078200035'), 'et un SIREN en fait 9')
ok(siretValide('824 080 782 00035'), 'les espaces de présentation ne font pas échouer le contrôle')
ok(sirenDeSiret('82408078200035') === '824080782', 'le SIREN se déduit du SIRET quand lui seul est connu')
ok(sirenDeSiret('824080782') === null, "mais pas d'un SIRET incomplet — on préfère rien à un faux")

// ═══════════════════════════════════════════════════════════
// La base d'essai.
const CIBLE = path.join(os.tmpdir(), 'emmy-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())
const uid = () => crypto.randomUUID()

const ent = uid()
db.prepare(`INSERT INTO entite_emettrice (id, code, raison_sociale, siren, siret, tva, adresse,
  code_postal, ville, capital, assurance_nom, assurance_police, taux_tva_defaut, devis_prefixe,
  taux_penalites, indemnite_recouvrement, delai_paiement_jours, par_defaut, conditions_reglement)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .run(ent, 'SPL', 'SPLIT DISTRIBUTION', '824080782', '82408078200035', 'FR60824080782',
    '15 rue de la Villette', '69003', 'Lyon', 130000, 'AXA', 'P-1', 20, 'SPL', 10.85, 40, 30, 1,
    'Virement à réception')

// Un installateur dont le SIRET commence par un zéro : le piège classique du tableur.
const inst = uid()
db.prepare('INSERT INTO installateur_rge (id, raison_sociale, siret) VALUES (?,?,?)')
  .run(inst, 'HYDRO CONTROL', '01234567800019')

const fi = uid(), fv = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)')
  .run(fi, 'AGRI-EQ-110', 'AGRI', 'EQ', 'Récupération de chaleur sur séchoir')
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)')
  .run(fv, fi, 1, '2024-01-01')

const deleg = uid()
db.prepare('INSERT INTO delegataire (id, nom, oblige) VALUES (?,?,?)')
  .run(deleg, 'LSF ENERGIE', 'SCA PETROLE et DERIVES')

const lot = uid()
db.prepare('INSERT INTO lot (id, numero, statut, delegataire_id, reference_emmy) VALUES (?,?,?,?,?)')
  .run(lot, 'LOT-2026-01', 'EN_CONSTITUTION', deleg, 'EMMY-2026-000123')

function poserDossier(numero, o = {}) {
  const b = uid(), s = uid(), d = uid()
  db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale, siret, email, telephone) VALUES (?,?,?,?,?,?)')
    .run(b, 'PRO', o.client ?? 'EARL DE CHEVASNE', o.clientSiret ?? '39284710500018',
      'contact@chevasne.fr', '0240000000')
  db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)')
    .run(s, '66 Chevasné', '44440', 'RIAILLE')
  db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id, fiche_version_id,
    entite_id, installateur_id, delegataire_id, lot_id, charte, destinataire_prime,
    date_engagement, date_pose, date_achevement, volume_cumac, prime_beneficiaire,
    facture_deduire_prime, cout_operation, aides_hors_cee, nb_logements)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(d, numero, b, s, fi, fv, ent, o.installateur === null ? null : inst, deleg, lot,
      o.charte ?? 'CDP', o.destinataire ?? 'BENEFICIAIRE',
      o.engagement === undefined ? '2026-02-10' : o.engagement,
      '2026-05-01',
      o.achevement === undefined ? '2026-05-12' : o.achevement,
      o.cumac === undefined ? 7387200 : o.cumac,
      o.prime === undefined ? 1650.2 : o.prime,
      0, o.cout ?? null, o.aides ?? null, o.logements ?? null)
  db.prepare(`INSERT INTO operation (id, dossier_id, ordre, fiche_id, fiche_version_id,
    quantite, unite, puv, taux_tva, volume_cumac, prime_beneficiaire, date_calcul)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(uid(), d, 1, fi, fv, 72, 'kW', 96.4, 20, o.cumac === undefined ? 7387200 : o.cumac,
      o.prime === undefined ? 1650.2 : o.prime, '2026-06-01')
  return d
}

// ═══════════════════════════════════════════════════════════
titre('Une ligne complète sort telle quelle')

const d1 = poserDossier('SPL-2026-0042')
const src1 = ligneDepot(db, d1)
ok(src1 !== null, 'la ligne se rassemble')
const r1 = valeursLigne(src1)

ok(r1.valeurs.reference_emmy === 'EMMY-2026-000123', 'la référence EMMY vient du lot')
ok(r1.valeurs.reference_interne === 'SPL-2026-0042', "la référence interne est le numéro du dossier")
ok(r1.valeurs.fiche === 'AGRI-EQ-110', "la fiche d'opération standardisée est citée")
ok(r1.valeurs.date_engagement === '10/02/2026', `date d'engagement au format registre (obtenu : ${r1.valeurs.date_engagement})`)
ok(r1.valeurs.date_achevement === '12/05/2026', "date d'achèvement au format registre")
ok(r1.valeurs.volume_cumac === 7387200, 'le volume sort en kWh cumac entier')
ok(r1.valeurs.professionnel_siret === '01234567800019',
  "le SIRET de l'installateur sort avec son zéro de tête")
ok(r1.valeurs.professionnel_siren === '012345678',
  'et le SIREN en est déduit, zéro compris')
ok(r1.valeurs.role_actif_nature === 'Prime versée au bénéficiaire',
  'la nature du rôle actif est écrite en clair, pas codée')
ok(r1.valeurs.role_actif_montant === '1650.20', `le montant du rôle actif est chiffré (obtenu : ${r1.valeurs.role_actif_montant})`)
ok(r1.valeurs.bonification === 'Coup de pouce', 'la bonification coup de pouce est déclarée')
ok(r1.valeurs.mandataire === 'LSF ENERGIE', 'le délégataire figure comme mandataire du rôle actif')

// ═══════════════════════════════════════════════════════════
titre("Ce qui manque est énuméré, jamais comblé")

ok(r1.manquants.some((m) => m.champ === 'date_facture'),
  "sans facture émise, la date de facture manque — et c'est dit")
ok(r1.manquants.some((m) => m.champ === 'cout_operation'),
  "le coût de l'opération aussi : il n'est pas remplacé par zéro")
ok(r1.valeurs.cout_operation === null,
  "et la valeur reste vide plutôt que de sortir à 0,00 € — zéro n'est pas inconnu")
ok(r1.valeurs.aides_hors_cee === null && !r1.manquants.some((m) => m.champ === 'aides_hors_cee'),
  "les aides hors CEE ne sont pas obligatoires : absentes, elles ne bloquent pas")

const dSansDate = poserDossier('SPL-2026-0043', { engagement: null, achevement: null })
const rSansDate = valeursLigne(ligneDepot(db, dSansDate))
ok(rSansDate.manquants.some((m) => m.champ === 'date_engagement'),
  "une date d'engagement absente est un manque, pas la date du jour")
ok(rSansDate.valeurs.date_achevement === '01/05/2026',
  "à défaut de date d'achèvement, la date de pose fait foi — c'est prévu, pas deviné")

const dSansInstall = poserDossier('SPL-2026-0044', { installateur: null })
const rSansInstall = valeursLigne(ligneDepot(db, dSansInstall))
ok(rSansInstall.valeurs.professionnel_siret === '82408078200035',
  "sans installateur rattaché, c'est la société émettrice qui a réalisé les travaux")

const dCumacNul = poserDossier('SPL-2026-0045', { cumac: 0 })
const rCumacNul = valeursLigne(ligneDepot(db, dCumacNul))
ok(rCumacNul.anomalies.some((a) => a.champ === 'volume_cumac'),
  'un volume nul est signalé : une demande à 0 kWh cumac est un dépôt perdu')

const dMauvaisSiret = poserDossier('SPL-2026-0046', { clientSiret: '392847105' })
const rMauvaisSiret = valeursLigne(ligneDepot(db, dMauvaisSiret))
ok(rMauvaisSiret.anomalies.some((a) => a.champ === 'beneficiaire_siret' && /14/.test(a.motif)),
  'un SIRET de bénéficiaire à 9 chiffres est signalé avant le dépôt, pas après')

// ═══════════════════════════════════════════════════════════
titre('Le coût déclaré est celui de la facture émise')

const emis = emettreFacture(db, d1, { aujourdhui: new Date('2026-09-18') })
ok(emis.ok, `la facture du dossier est émise (${emis.numero || emis.motifs?.join(' ; ')})`)

const r1bis = valeursLigne(ligneDepot(db, d1))
ok(r1bis.valeurs.date_facture === '18/09/2026',
  `la date de facture vient de la facture, pas d'une saisie (obtenu : ${r1bis.valeurs.date_facture})`)
ok(r1bis.valeurs.cout_operation === '6940.80',
  `le coût déclaré est le TTC facturé : 72 × 96,40 = 6 940,80 € (obtenu : ${r1bis.valeurs.cout_operation})`)
ok(!r1bis.manquants.some((m) => m.champ === 'cout_operation' || m.champ === 'date_facture'),
  'les deux manques précédents sont comblés par la facture — sans ressaisie')

// Une saisie explicite sur le dossier l'emporte : le cas où la facture ne couvre pas tout.
db.prepare('UPDATE dossier SET cout_operation = ? WHERE id = ?').run(8200, d1)
ok(valeursLigne(ligneDepot(db, d1)).valeurs.cout_operation === '8200.00',
  "un coût saisi sur le dossier prend le pas sur celui de la facture")

// ═══════════════════════════════════════════════════════════
titre("Le gabarit du délégataire : ses intitulés, nos données")

const parDefaut = gabarit(null)
ok(parDefaut.source === 'ANNEXE_6' && parDefaut.colonnes.length === CHAMPS.length,
  "sans gabarit, toutes les colonnes de l'annexe 6 sortent")

const g = gabarit({ nom: 'LSF', gabarit_export: JSON.stringify([
  { colonne: 'REF_OP', champ: 'reference_interne' },
  { colonne: 'FICHE', champ: 'fiche' },
  { colonne: 'KWHC', champ: 'volume_cumac' },
]) })
ok(g.source === 'GABARIT' && g.colonnes.length === 3,
  'un gabarit fourni réduit et renomme les colonnes, sans toucher aux données')
ok(g.colonnes[0].colonne === 'REF_OP', "et c'est bien leur intitulé qui sort")

const abime = gabarit({ nom: 'LSF', gabarit_export: '{ ceci n\'est pas du JSON' })
ok(abime.source === 'ANNEXE_6' && abime.avertissement,
  "un gabarit illisible fait retomber sur l'annexe 6 — en le disant")
const inconnu = gabarit({ nom: 'LSF', gabarit_export: JSON.stringify([{ colonne: 'X', champ: 'champ_qui_nexiste_pas' }]) })
ok(inconnu.source === 'ANNEXE_6' && /champ_qui_nexiste_pas/.test(inconnu.avertissement),
  'un gabarit qui désigne un champ inconnu est refusé en entier plutôt qu\'appliqué à moitié')
const vide = gabarit({ nom: 'LSF', gabarit_export: '[]' })
ok(vide.source === 'ANNEXE_6', 'un gabarit vide ne produit pas un fichier sans colonne')

// ═══════════════════════════════════════════════════════════
titre("Le fichier ne part pas incomplet")

const refus = csvDepot(db, lot)
ok(!refus.ok, "le lot porte des dossiers incomplets : l'export est refusé")
ok(refus.motifs.some((m) => /SPL-2026-0043/.test(m)),
  'et le refus nomme les dossiers en cause, pas seulement leur nombre')

const force = csvDepot(db, lot, { incompletAutorise: true })
ok(force.ok && force.incomplet === true,
  "on peut forcer la sortie pour travailler dessus, et le résultat se déclare incomplet")

// Un lot dont toutes les lignes sont complètes doit, lui, passer.
const lotBon = uid()
db.prepare('INSERT INTO lot (id, numero, statut, delegataire_id, reference_emmy) VALUES (?,?,?,?,?)')
  .run(lotBon, 'LOT-2026-02', 'EN_CONSTITUTION', deleg, 'EMMY-2026-000124')
db.prepare('UPDATE dossier SET lot_id = ? WHERE id = ?').run(lotBon, d1)

const bon = csvDepot(db, lotBon)
ok(bon.ok && bon.incomplet === false,
  `un lot dont les lignes sont complètes sort sans forçage (${bon.ok ? 'ok' : bon.motifs?.join(' ; ')})`)
ok(bon.nbLignes === 1, 'une ligne par dossier')

const [entetes, ligne] = bon.contenu.replace(/^﻿/, '').trim().split('\r\n')
ok(entetes.startsWith('Référence EMMY de la demande;'),
  "les intitulés de l'annexe 6 ouvrent le fichier")
ok(entetes.split(';').length === ligne.split(';').length,
  'autant de colonnes dans la ligne que dans les en-têtes')
ok(bon.contenu.startsWith('﻿'), 'le BOM est présent : Excel français ouvre le fichier sans manipulation')
ok(bon.contenu.includes('\r\n'), 'les fins de ligne sont celles attendues par les tableurs')

// Un montant à point décimal, ouvert dans un tableur français, n'est plus un nombre : c'est
// du texte, ou une date. Le destinataire est une société française.
ok(/1650,20/.test(bon.contenu),
  'les montants sortent à la virgule décimale, comme les attend un tableur français')
ok(!/1650\.20/.test(bon.contenu), "et jamais au point, qui en ferait du texte ou une date")
const pointu = csvDepot(db, lotBon, { decimaleFr: false })
ok(/1650\.20/.test(pointu.contenu),
  "le point reste disponible pour un délégataire dont l'outil l'attend")

// LE point : le SIRET à zéro de tête.
ok(ligne.includes('="01234567800019"'),
  'le SIRET sort protégé contre le tableur — sans quoi Excel perdrait le zéro de tête')
const nu = csvDepot(db, lotBon, { protegerIdentifiants: false })
ok(nu.contenu.includes(';01234567800019;'),
  'la protection se désactive quand le délégataire attend un fichier brut')

// Une cellule qui commence par « = » est une formule. La protection ne doit donc jamais
// s'appliquer à autre chose qu'une suite de chiffres, sous peine de faire exécuter à
// l'ouverture du fichier un texte saisi ailleurs dans la plateforme.
ok(!/;="[^0-9"]/.test(bon.contenu),
  "aucune cellule non numérique ne sort sous forme de formule")

// Le gabarit change les en-têtes du fichier réel.
db.prepare('UPDATE delegataire SET gabarit_export = ? WHERE id = ?').run(JSON.stringify([
  { colonne: 'REF_OP', champ: 'reference_interne' },
  { colonne: 'KWHC', champ: 'volume_cumac' },
]), deleg)
const avecGabarit = csvDepot(db, lotBon)
ok(avecGabarit.ok && avecGabarit.contenu.replace(/^﻿/, '').startsWith('REF_OP;KWHC'),
  "avec un gabarit, le fichier sort aux intitulés du délégataire")
ok(/SPL-2026-0042;7387200/.test(avecGabarit.contenu),
  'et les données sont les mêmes, simplement rangées autrement')
ok(avecGabarit.nomFichier.includes('gabarit'),
  'le nom du fichier dit de quel gabarit il sort — deux fichiers différents ne doivent pas porter le même nom')

// ═══════════════════════════════════════════════════════════
titre('Les refus attendus')

ok(!csvDepot(db, 'lot-inconnu').ok, 'un lot inconnu est refusé, pas inventé')
const lotVide = uid()
db.prepare('INSERT INTO lot (id, numero, statut) VALUES (?,?,?)').run(lotVide, 'LOT-VIDE', 'EN_CONSTITUTION')
const rVide = csvDepot(db, lotVide)
ok(!rVide.ok && /aucun dossier/i.test(rVide.motifs[0]), 'un lot sans dossier ne produit pas un fichier vide')

const t = tableauDepot(db, lotVide)
ok(t && t.lignes.length === 0 && t.deposable === true,
  'le tableau d\'un lot vide existe et ne prétend pas être incomplet — il est vide, c\'est différent')

// ═══════════════════════════════════════════════════════════
titre("Aucune injection ne passe dans le fichier")

const dPiege = poserDossier('SPL-2026-0047', { client: 'EARL "GUILLEMET"; RM -RF' })
const src = ligneDepot(db, dPiege)
const rp = valeursLigne(src)
ok(rp.valeurs.beneficiaire_nom === 'EARL "GUILLEMET"; RM -RF', 'la valeur est conservée telle quelle en mémoire')
db.prepare('UPDATE dossier SET lot_id = ? WHERE id = ?').run(lotBon, dPiege)
db.prepare('UPDATE delegataire SET gabarit_export = NULL WHERE id = ?').run(deleg)
const cp = csvDepot(db, lotBon, { incompletAutorise: true })
ok(cp.contenu.includes('"EARL ""GUILLEMET""; RM -RF"'),
  'et elle est échappée dans le CSV : ni colonne décalée, ni guillemet perdu')
ok(cp.contenu.trim().split('\r\n').length === 3,
  'deux dossiers, deux lignes, plus les en-têtes — le point-virgule du nom n\'a pas créé de colonne')

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
