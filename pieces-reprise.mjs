/**
 * Contrôles du rattachement des pièces jointes.
 *
 * On ne sait pas encore sous quelle forme le logiciel précédent livrera ses archives.
 * Ce test fabrique donc les conventions de nommage plausibles — un dossier par numéro,
 * le numéro dans le nom du fichier, des sous-dossiers par type — et vérifie que chacune
 * retombe sur le bon dossier.
 *
 * Le contrôle qui compte le plus est le dernier : **une pièce dont on ne sait pas à quel
 * dossier elle appartient ne doit jamais être rangée quelque part**. Ranger l'attestation
 * d'un client chez un autre, c'est au mieux un dépôt rejeté, au pire la pièce d'un tiers
 * transmise à un délégataire.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// ── Le test ne doit rien laisser dans le magasin de fichiers réel ──
//
// `lib/fichiers.js` écrit dans `./fichiers` par défaut. Sans cette ligne, chaque passage du
// test déposait ses PDF factices — « attestation_sur_lhonneur.pdf », le fichier piégé —
// dans le magasin de production, où ils restaient en orphelins puisque la base, elle, était
// une copie jetable. Huit fichiers s'y étaient accumulés avant qu'on s'en aperçoive.
// Cette affectation doit précéder l'import de `lib/fichiers.js`, qui lit la variable au
// chargement du module.
process.env.CEE_FICHIERS = fs.mkdtempSync(path.join(os.tmpdir(), 'fichiers-test-'))

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const { appliquerManuelles } = await import('./lib/migrations-manuelles.js')
const { numeroDansChemin, typeDeDocument, importerPieces } = await import('./lib/import-pieces.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
titre('Reconnaissance du numéro de dossier')

for (const [chemin, attendu] of [
  ['EPC-2026-2934/facture.pdf', 'EPC-2026-2934'],
  ['facture_EPC-2026-2934.pdf', 'EPC-2026-2934'],
  ['export/2026/EPC-2026-2934/AH/attestation.pdf', 'EPC-2026-2934'],
  ['EPC-2026-2934 - CHRISTE CHARPENTE/devis.pdf', 'EPC-2026-2934'],
  ['epc-2026-2934/photo.jpg', 'EPC-2026-2934'],
  ['pieces/EPC-2026-2934-2333-1_facture.pdf', 'EPC-2026-2934'],
]) {
  ok(numeroDansChemin(chemin) === attendu, `« ${chemin} » → ${attendu}`)
}

ok(numeroDansChemin('facture_sans_numero.pdf') === null, 'un nom sans numéro ne renvoie rien')
ok(numeroDansChemin('') === null, 'un chemin vide ne renvoie rien')

// Le segment le plus profond gagne : un fichier rangé dans le dossier d'un client mais
// nommé d'après un autre doit suivre son NOM, pas son emplacement.
ok(numeroDansChemin('EPC-2026-1111/EPC-2026-2222_facture.pdf') === 'EPC-2026-2222',
  'le numéro du nom de fichier prime sur celui du répertoire parent')

// ═══════════════════════════════════════════════════════════
titre('Reconnaissance du type de document')

for (const [nom, attendu] of [
  ['attestation_sur_lhonneur.pdf', 'AH'],
  ['AH_signee.pdf', 'AH'],
  ['attestation_fin_de_travaux.pdf', 'AFT'],
  ['AFT_signee.pdf', 'AFT'],
  ['devis_signe.pdf', 'DEVIS'],
  ['facture_2026.pdf', 'FACTURE'],
  ['cadre_de_contribution.pdf', 'CADRE_CONTRIB'],
  ['rapport_cofrac.pdf', 'COFRAC'],
  ['dossier_cee_complet.pdf', 'DOSSIER_CEE'],
  ['photo_chantier_01.jpg', 'PHOTOS'],
  ['certificat_RGE.pdf', 'RGE'],
  ['kbis.pdf', 'KBIS'],
]) {
  ok(typeDeDocument(nom) === attendu, `« ${nom} » → ${attendu}`)
}

// Le piège classique : « attestation de fin de travaux » contient « attestation ».
ok(typeDeDocument('attestation de fin de travaux.pdf') === 'AFT',
  'une attestation de fin de travaux n\'est pas classée en attestation sur l\'honneur')
ok(typeDeDocument('document_quelconque.pdf') === null, 'un nom non reconnu renvoie null')

// ═══════════════════════════════════════════════════════════
titre('Rattachement sur une base réelle')

const SOURCE = process.env.CEE_DB_SOURCE || 'db/cee.db'
if (!fs.existsSync(SOURCE)) {
  console.log(`  (base ${SOURCE} absente — contrôles de rattachement ignorés)`)
} else {
  const CIBLE = '/tmp/pieces-test.db'
  // Effacer le journal d'une copie précédente : un `-wal` orphelin se greffe sur la
// nouvelle copie et fait diverger la table de ses index.
for (const suffixe of ['', '-wal', '-shm']) fs.rmSync(CIBLE + suffixe, { force: true })
fs.copyFileSync(SOURCE, CIBLE)
  const db = new DatabaseSync(CIBLE)
  db.exec('PRAGMA foreign_keys = OFF')
  mettreANiveau(db, cheminSchemaParDefaut())
  appliquerManuelles(db)

  // ── On choisit les numéros les plus hostiles, pas les premiers venus ──
  //
  // Un test qui prend `LIMIT 3` teste la forme régulière et rate tout le reste. Or c'est
  // l'irrégulier qui casse : le numéro très court, celui à souligné, celui dont un AUTRE
  // numéro est le préfixe. On va donc les chercher explicitement.
  const tous = db.prepare('SELECT numero FROM dossier').all().map((d) => String(d.numero))
  const trier = (a, b) => a.length - b.length
  const choisir = (motif) => tous.filter((n) => motif.test(n)).sort(trier)[0] ?? null

  const court = [...tous].sort(trier)[0]
  const souligne = choisir(/_/)
  const ensemble = new Set(tous.map((n) => n.toUpperCase()))
  // Un numéro qui est le préfixe d'un autre : le piège du rattachement.
  const prefixe = tous.find((n) => tous.some((m) => m !== n && m.toUpperCase().startsWith(n.toUpperCase())))
  const banal = tous.find((n) => /^[A-Z]{2,5}-\d{4}-\d{4}$/i.test(n) &&
    !tous.some((m) => m !== n && m.toUpperCase().startsWith(n.toUpperCase())))

  console.log(`  numéros éprouvés : court « ${court} », souligné « ${souligne ?? '—'} », ` +
              `préfixe d'un autre « ${prefixe ?? '—'} », banal « ${banal ?? '—'} »`)

  // Trois numéros distincts : le plus court (souvent le plus piégeux), un banal, un troisième.
  const dossiers = []
  for (const n of [court, banal, souligne, ...tous]) {
    if (n && !dossiers.includes(n)) dossiers.push(n)
    if (dossiers.length === 3) break
  }
  if (dossiers.length < 3) {
    console.log('  (moins de 3 dossiers en base — contrôles ignorés)')
  } else {
    // Une archive fabriquée, mélangeant les trois conventions plausibles.
    const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-'))
    const pdf = (t) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(t)])
    const jpg = (t) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from(t)])

    fs.mkdirSync(path.join(racine, dossiers[0]), { recursive: true })
    fs.writeFileSync(path.join(racine, dossiers[0], 'attestation_sur_lhonneur.pdf'), pdf('ah-1'))
    fs.writeFileSync(path.join(racine, dossiers[0], 'facture.pdf'), pdf('facture-1'))

    fs.writeFileSync(path.join(racine, `devis_${dossiers[1]}.pdf`), pdf('devis-2'))

    fs.mkdirSync(path.join(racine, 'export', dossiers[2], 'photos'), { recursive: true })
    fs.writeFileSync(path.join(racine, 'export', dossiers[2], 'photos', 'photo_chantier.jpg'), jpg('photo-3'))

    // Deux pièges volontaires.
    fs.writeFileSync(path.join(racine, 'EPC-1900-0001_facture.pdf'), pdf('dossier-inconnu'))
    fs.writeFileSync(path.join(racine, 'document_orphelin.pdf'), pdf('sans-numero'))
    // Et un fichier hostile : extension .pdf, contenu HTML.
    fs.writeFileSync(path.join(racine, `${dossiers[0]}_piege.pdf`), Buffer.from('<html><script>alert(1)</script>'))

    // La base réelle contient déjà des pièces reprises : on compte donc en ÉCART, pas en
    // absolu. Un contrôle qui suppose la base vide devient faux dès qu'elle ne l'est plus,
    // et un contrôle faux finit par être ignoré.
    const docsAvant = db.prepare('SELECT COUNT(*) n FROM document_dossier').get().n
    const r = importerPieces(db, racine, {})

    ok(r.fichiers === 7, `${r.fichiers} fichiers examinés`)
    ok(r.rattaches === 4, `4 pièces rattachées (obtenu : ${r.rattaches})`)
    ok(r.sansDossier === 2, `2 fichiers sans dossier identifiable (obtenu : ${r.sansDossier})`)
    ok(r.refuses === 1, `1 fichier refusé pour son contenu (obtenu : ${r.refuses})`)

    const un = (s, p = []) => db.prepare(s).get(...p)
    const d0 = un('SELECT id FROM dossier WHERE numero = ?', [dossiers[0]]).id
    const n0 = un(`SELECT COUNT(*) n FROM document_dossier
                   WHERE dossier_id = ? AND (nom_fichier LIKE '%honneur%' OR nom_fichier LIKE 'facture%')`, [d0]).n
    ok(n0 === 2, `le premier dossier a bien ses 2 pièces de test (obtenu : ${n0})`)

    const type0 = un(`SELECT t.code FROM document_dossier dd JOIN type_document t ON t.id = dd.type_document_id
                      WHERE dd.dossier_id = ? AND dd.nom_fichier LIKE '%honneur%'`, [d0])?.code
    ok(type0 === 'AH', `l'attestation est classée en AH (obtenu : ${type0})`)

    // On vise le fichier fabriqué par le test, pas « une pièce quelconque de ce dossier » :
    // la base réelle en contient déjà, et la requête large renvoyait l'une d'elles.
    const d1 = un('SELECT id FROM dossier WHERE numero = ?', [dossiers[1]]).id
    const type1 = un(`SELECT t.code FROM document_dossier dd JOIN type_document t ON t.id = dd.type_document_id
                      WHERE dd.dossier_id = ? AND dd.nom_fichier LIKE 'devis%'`, [d1])?.code
    ok(type1 === 'DEVIS', `le devis nommé avec le numéro est au bon dossier et bien classé`)

    const d2 = un('SELECT id FROM dossier WHERE numero = ?', [dossiers[2]]).id
    const type2 = un(`SELECT t.code FROM document_dossier dd JOIN type_document t ON t.id = dd.type_document_id
                      WHERE dd.dossier_id = ? AND dd.nom_fichier LIKE 'photo%'`, [d2])?.code
    ok(type2 === 'PHOTOS', 'la photo rangée en sous-dossier est au bon dossier')

    // ── Le contrôle décisif : le numéro voisin ──
    //
    // 84 numéros réels sont préfixes d'un autre numéro réel. Une pièce portant la forme
    // LONGUE ne doit jamais atterrir dans le dossier de la forme COURTE, et inversement.
    if (prefixe) {
      const long = tous.find((m) => m !== prefixe && m.toUpperCase().startsWith(prefixe.toUpperCase()))
      ok(numeroDansChemin(`${long}_facture.pdf`, ensemble) === long.toUpperCase(),
        `« ${long} » est reconnu en entier, pas tronqué en « ${prefixe} »`)
      ok(numeroDansChemin(`${prefixe}.pdf`, ensemble) === prefixe.toUpperCase(),
        `« ${prefixe} » seul reste « ${prefixe} »`)
    }
    // Et une forme longue INCONNUE ne doit rattraper aucun dossier existant.
    ok(numeroDansChemin(`${court}99999_facture.pdf`, ensemble) === null,
      `« ${court}99999 », qui n'existe pas, n'est pas rangé dans « ${court} »`)
    if (souligne) {
      ok(numeroDansChemin(`${souligne}.pdf`, ensemble) === souligne.toUpperCase(),
        `« ${souligne} » garde son souligné`)
    }

    const total = un('SELECT COUNT(*) n FROM document_dossier').n
    ok(total - docsAvant === 4,
      `aucune pièce n'a été rangée ailleurs : ${total - docsAvant} ligne(s) créée(s) pour 4 rattachements`)
    ok(un(`SELECT COUNT(*) n FROM document_dossier dd
           LEFT JOIN dossier d ON d.id = dd.dossier_id WHERE d.id IS NULL`).n === 0,
      'aucune pièce rattachée à un dossier inexistant')

    // ── Rejouabilité ──
    const r2 = importerPieces(db, racine, {})
    ok(r2.rattaches === 0 && r2.dejaPresents === 4,
      `relancer ne duplique rien (0 nouvelle, ${r2.dejaPresents} déjà présentes)`)
    ok(un('SELECT COUNT(*) n FROM document_dossier').n - docsAvant === 4,
      'le total est inchangé après relance')

    fs.rmSync(racine, { recursive: true, force: true })
    fs.rmSync(process.env.CEE_FICHIERS, { recursive: true, force: true })
  }
}

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
