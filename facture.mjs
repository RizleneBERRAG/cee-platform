/**
 * Contrôles du générateur de factures.
 *
 * Une facture n'est pas un devis mieux habillé. Une fois émise elle est entrée dans deux
 * comptabilités, elle ne se modifie plus, et son numéro appartient à une suite que
 * l'administration peut demander à voir. Ce qui est vérifié ici découle entièrement de là :
 *
 * 1. **La série ne tolère ni trou ni doublon.** Les avoirs y prennent leur numéro aussi.
 *    Et un échec en cours d'écriture ne doit consommer aucun numéro.
 * 2. **Les lignes sont figées à l'émission.** Corriger une opération six mois plus tard ne
 *    doit pas réécrire un document déjà payé. C'est le test le plus important du fichier.
 * 3. **Rien ne se corrige, tout se contre-passe.** Une facture fausse s'annule par un avoir,
 *    négatif, qui la désigne. Les deux pièces restent lisibles.
 * 4. **Une facture irrégulière ne sort pas.** Mentions du code de commerce absentes,
 *    opération non valorisée, société incomplète : l'émission est refusée en le disant.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { DatabaseSync } = await import('node:sqlite')
const { mettreANiveau, cheminSchemaParDefaut } = await import('./lib/migrations.js')
const {
  DELAI_MAX_JOURS, controlerFacture, attribuerNumeroFacture, lignesFacturables,
  preparerFacture, apercuFacture, emettreFacture, emettreAvoir, lireFacture,
} = await import('./lib/facture.js')
const { factureHtml } = await import('./lib/facture-html.js')

let echecs = 0
const ok = (c, m) => { if (!c) echecs++; console.log(`${c ? '  OK  ' : ' ÉCHEC'} ${m}`) }
const titre = (t) => console.log(`\n── ${t} ──`)

// ═══════════════════════════════════════════════════════════
// La base d'essai : jetable, montée depuis le schéma réel.
const CIBLE = path.join(os.tmpdir(), 'facture-test.db')
fs.rmSync(CIBLE, { force: true })
const db = new DatabaseSync(CIBLE)
db.exec('PRAGMA foreign_keys = OFF')
mettreANiveau(db, cheminSchemaParDefaut())

const uid = () => crypto.randomUUID()

function poserEntite(code, prefixe, extra = {}) {
  const id = uid()
  const base = {
    raison_sociale: `${code} SAS`, siret: '95178810800029', siren: '951788108',
    tva: 'FR71951788108', adresse: '3 rue de Genève', code_postal: '69006', ville: 'Lyon',
    capital: 1000, assurance_nom: 'AXA', assurance_police: 'P-1', taux_tva_defaut: 20,
    facture_prefixe: prefixe, taux_penalites: 10.85, indemnite_recouvrement: 40,
    delai_paiement_jours: 30, conditions_reglement: 'Virement à réception',
    ...extra,
  }
  const cols = ['id', 'code', ...Object.keys(base)]
  db.prepare(`INSERT INTO entite_emettrice (${cols.join(',')})
              VALUES (${cols.map(() => '?').join(',')})`)
    .run(id, code, ...Object.values(base))
  return id
}

const ficheId = uid()
const versionId = uid()
db.prepare('INSERT INTO fiche (id, code, secteur, domaine, libelle) VALUES (?,?,?,?,?)')
  .run(ficheId, 'RES-EC-104', 'RES', 'EC', "Rénovation d'éclairage extérieur")
db.prepare('INSERT INTO fiche_version (id, fiche_id, version, date_effet) VALUES (?,?,?,?)')
  .run(versionId, ficheId, 1, '2024-01-01')

function poserDossier(numero, { entiteId = null, ops = [], achevement = '2026-05-12' } = {}) {
  const benef = uid()
  const site = uid()
  const dossier = uid()
  db.prepare('INSERT INTO beneficiaire (id, type, raison_sociale, siret) VALUES (?,?,?,?)')
    .run(benef, 'PRO', 'EARL DE CHEVASNE', '12345678900011')
  db.prepare('INSERT INTO site (id, adresse, code_postal, ville) VALUES (?,?,?,?)')
    .run(site, '66 Chevasné', '44440', 'RIAILLE')
  db.prepare(`INSERT INTO dossier (id, numero, beneficiaire_id, site_id, fiche_id,
              fiche_version_id, entite_id, date_achevement, facture_deduire_prime)
              VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(dossier, numero, benef, site, ficheId, versionId, entiteId, achevement, 0)

  const ids = []
  ops.forEach((o, i) => {
    const opId = uid()
    ids.push(opId)
    db.prepare(`INSERT INTO operation (id, dossier_id, ordre, fiche_id, fiche_version_id,
                quantite, unite, puv, taux_tva, volume_cumac, prime_beneficiaire, date_calcul)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(opId, dossier, i + 1, ficheId, versionId,
        o.quantite ?? 1, o.unite ?? 'u', o.puv ?? null, o.taux_tva ?? 20,
        o.cumac ?? null, o.prime ?? null, o.fige === false ? null : '2026-06-01')
  })
  return { dossier, operations: ids }
}

// ═══════════════════════════════════════════════════════════
titre('Les mentions que la loi impose entre professionnels')

const complete = {
  raison_sociale: 'TEST SAS', siret: '95178810800029', siren: '951788108',
  tva: 'FR71951788108', adresse: '3 rue de Genève', code_postal: '69006', ville: 'Lyon',
  capital: 1000, telephone: '0600000000', assurance_nom: 'AXA', assurance_police: 'P-123',
  taux_tva_defaut: 20, taux_penalites: 10.85, indemnite_recouvrement: 40,
  delai_paiement_jours: 30,
}
const rge = [{ libelle: 'Qualibat' }]

ok(controlerFacture(complete, rge, { dossier: { date_achevement: '2026-05-12' } }).length === 0,
  'une société complète, sur un dossier daté, ne déclenche rien')

ok(controlerFacture({ ...complete, taux_penalites: null }, rge)
  .some((a) => a.niveau === 'BLOQUANT' && a.champ === 'taux_penalites'),
  'sans taux de pénalités de retard : bloquant (art. L.441-10 du code de commerce)')
ok(controlerFacture({ ...complete, indemnite_recouvrement: 0 }, rge)
  .some((a) => a.niveau === 'BLOQUANT' && a.champ === 'indemnite_recouvrement'),
  "sans l'indemnité forfaitaire de recouvrement : bloquant (art. D.441-5)")
ok(controlerFacture({ ...complete, delai_paiement_jours: null }, rge)
  .some((a) => a.niveau === 'BLOQUANT' && a.champ === 'delai_paiement_jours'),
  'sans délai de paiement : bloquant')

// Un délai trop long est irrégulier mais la facture, elle, reste émissible : c'est le
// paramétrage qu'il faut corriger, pas le document qu'il faut retenir.
const tropLong = controlerFacture({ ...complete, delai_paiement_jours: 90 }, rge,
  { dossier: { date_achevement: '2026-05-12' } })
ok(tropLong.length === 1 && tropLong[0].niveau === 'AVERTISSEMENT',
  `un délai de 90 jours dépasse le plafond légal de ${DELAI_MAX_JOURS} jours : averti, non bloqué`)

// Les contrôles du devis sont hérités, ils ne sont pas réécrits — donc pas oubliés.
ok(controlerFacture({ ...complete, assurance_police: null }, rge)
  .some((a) => a.niveau === 'BLOQUANT' && a.champ === 'assurance'),
  "les contrôles du devis sont hérités : sans assurance décennale, toujours bloquant")
ok(controlerFacture({ ...complete, tva: 'FR1951788108' }, rge)
  .some((a) => a.niveau === 'BLOQUANT' && a.champ === 'tva'),
  'un numéro de TVA dont la clé est fausse bloque la facture comme il bloque le devis')

ok(controlerFacture(complete, rge, { dossier: { date_achevement: null, date_pose: null } })
  .some((a) => a.niveau === 'AVERTISSEMENT' && a.champ === 'date_prestation'),
  "sans date de travaux, la facture porte sa date d'émission — et le dit")

// ═══════════════════════════════════════════════════════════
titre('La série de numéros : ni trou, ni doublon, ni série partagée')

const bpg = poserEntite('BPG', 'BPG-F')
const spl = poserEntite('SPL', 'SPL-F')

const f1 = attribuerNumeroFacture(db, bpg, new Date('2026-03-04'))
const f2 = attribuerNumeroFacture(db, bpg, new Date('2026-07-19'))
const f3 = attribuerNumeroFacture(db, bpg, new Date('2026-09-18'))
ok(f1 === 'BPG-F-2026-0001', `la série démarre à BPG-F-2026-0001 (obtenu : ${f1})`)
ok(f2 === 'BPG-F-2026-0002' && f3 === 'BPG-F-2026-0003', 'et se poursuit sans trou')
ok(new Set([f1, f2, f3]).size === 3, 'sans doublon')
ok(attribuerNumeroFacture(db, spl, new Date('2026-09-18')) === 'SPL-F-2026-0001',
  'chaque société a SA série : celle de SPLIT ne suit pas celle de BPG')
ok(attribuerNumeroFacture(db, bpg, new Date('2027-01-02')) === 'BPG-F-2027-0001',
  "au changement d'année le compteur repart à 1")

// Sans préfixe propre, la série suit celle des devis : le client lit SPL-2026-0031 et
// SPL-F-2026-0001, pas un code technique qu'il n'a jamais vu.
const sansPrefixe = poserEntite('SPLIT', null, { devis_prefixe: 'SPL' })
ok(attribuerNumeroFacture(db, sansPrefixe, new Date('2026-09-18')) === 'SPL-F-2026-0001',
  'à défaut de préfixe de facture, celui des devis est repris, pas le code interne')

// La série des factures ne doit pas être celle des devis : un devis émis ne doit pas
// décaler un numéro de facture, et réciproquement.
const avantDevis = db.prepare('SELECT devis_compteur FROM entite_emettrice WHERE id = ?').get(bpg)
ok(Number(avantDevis.devis_compteur) === 0,
  'après cinq factures, le compteur de devis est resté à zéro : les deux séries sont distinctes')

let leve = false
try { attribuerNumeroFacture(db, 'inexistant') } catch { leve = true }
ok(leve, "numéroter sur une société inconnue échoue franchement plutôt que d'inventer un préfixe")

// ═══════════════════════════════════════════════════════════
titre("Ce qui empêche d'émettre")

const emet = poserEntite('EMET', 'EM-F')

const vide = poserDossier('D-VIDE', { entiteId: emet })
const rVide = emettreFacture(db, vide.dossier)
ok(!rVide.ok && rVide.motifs.some((m) => /aucune opération/i.test(m)),
  'un dossier sans opération ne produit pas une facture à zéro : il est refusé')

const nonFige = poserDossier('D-NONFIGE', { entiteId: emet, ops: [{ puv: 1200, fige: false }] })
const rNonFige = emettreFacture(db, nonFige.dossier)
ok(!rNonFige.ok && rNonFige.motifs.some((m) => /pas valorisée|non valorisée|valorisées/i.test(m)),
  "une opération non valorisée n'est pas facturée pour zéro : l'émission est refusée")

const sansPrix = poserDossier('D-SANSPRIX', { entiteId: emet, ops: [{ puv: null }] })
const rSansPrix = emettreFacture(db, sansPrix.dossier)
ok(!rSansPrix.ok, 'une ligne sans prix unitaire empêche la facture — le total serait incomplet')

// Le compteur ne doit pas avoir bougé pour ces trois refus.
const compteurApresRefus = db.prepare('SELECT facture_compteur FROM entite_emettrice WHERE id = ?').get(emet)
ok(Number(compteurApresRefus.facture_compteur || 0) === 0,
  'trois émissions refusées, aucun numéro consommé : un refus ne troue pas la série')

const rInconnu = emettreFacture(db, 'dossier-qui-nexiste-pas')
ok(!rInconnu.ok && /introuvable/i.test(rInconnu.motifs[0]), 'un dossier inconnu est refusé, pas inventé')

// ═══════════════════════════════════════════════════════════
titre("L'aperçu ne consomme rien")

const bon = poserDossier('D-BON', {
  entiteId: emet,
  ops: [{ quantite: 50, puv: 22.32, taux_tva: 20, cumac: 2325000, prime: 5580 }],
})

const avant = Number(db.prepare('SELECT facture_compteur FROM entite_emettrice WHERE id = ?')
  .get(emet).facture_compteur || 0)
const apercu = apercuFacture(db, bon.dossier)
const apres = Number(db.prepare('SELECT facture_compteur FROM entite_emettrice WHERE id = ?')
  .get(emet).facture_compteur || 0)

ok(avant === apres, "prévisualiser n'avance pas le compteur — on peut rafraîchir cent fois")
ok(db.prepare('SELECT COUNT(*) AS n FROM facture').get().n === 0, "et n'écrit aucune facture")
ok(apercu.emettable === true, 'le dossier complet est déclaré émissible')
ok(apercu.facture.numero === null, "l'aperçu n'a pas de numéro : il n'en existe pas encore")

const htmlApercu = factureHtml(apercu.facture)
ok(htmlApercu.includes('NON ÉMISE'),
  "l'aperçu porte un filigrane en clair : il ne peut pas être pris pour une facture réelle")
ok(htmlApercu.includes('PROJET NON ÉMIS'), 'et son titre le dit aussi')
ok(/1\s*116,00/u.test(htmlApercu.replace(/ | /g, ' ')),
  "l'aperçu chiffre déjà la ligne : 50 × 22,32 = 1 116,00 €")

// ═══════════════════════════════════════════════════════════
titre("L'émission")

const emis = emettreFacture(db, bon.dossier, { aujourdhui: new Date('2026-09-18') })
ok(emis.ok, `la facture est émise (${emis.numero || emis.motifs?.join(' ; ')})`)
ok(emis.numero === 'EM-F-2026-0001', `et prend le premier numéro de la série (obtenu : ${emis.numero})`)

const facture = lireFacture(db, emis.id)
ok(facture.total_ttc === 1116, `total TTC de 1 116,00 € (obtenu : ${facture.total_ttc})`)
ok(facture.total_ht === 930, `total HT de 930,00 € (obtenu : ${facture.total_ht})`)
ok(facture.total_tva === 186, `TVA de 186,00 € (obtenu : ${facture.total_tva})`)
ok(facture.prime_deduite === null && facture.reste_a_payer === 1116,
  'la prime n\'étant pas déduite sur ce dossier, le net à payer reste le TTC entier')
ok(facture.date_prestation === '2026-05-12',
  "la date de prestation est celle des travaux, pas celle de l'impression")
ok(facture.date_echeance === '2026-10-18',
  `l'échéance suit le délai de la société : 30 jours (obtenu : ${facture.date_echeance})`)
ok(facture.taux_penalites === 10.85 && facture.indemnite_recouvrement === 40,
  'le taux de pénalités et l\'indemnité sont RECOPIÉS sur la facture, pas relus plus tard')
ok(facture.client_nom === 'EARL DE CHEVASNE', 'le client est recopié lui aussi')
ok(facture.lignes.length === 1 && facture.lignes[0].total_ttc === 1116,
  'la ligne est recopiée avec son total')
ok(/RES-EC-104/.test(facture.lignes[0].detail),
  "le détail de la ligne cite la fiche d'opération — le contrôle la cherchera")

// Un deuxième appel ne doit pas produire une deuxième facture.
const doublon = emettreFacture(db, bon.dossier)
ok(!doublon.ok && /porte déjà/i.test(doublon.motifs[0]),
  "un deuxième clic n'émet pas une deuxième facture : il renvoie au document existant")
ok(db.prepare('SELECT COUNT(*) AS n FROM facture WHERE dossier_id = ?').get(bon.dossier).n === 1,
  'il n\'y a toujours qu\'une facture en base pour ce dossier')

// ═══════════════════════════════════════════════════════════
titre('Les lignes sont FIGÉES — le test qui justifie tout le reste')

// Six mois plus tard, quelqu'un corrige le prix de l'opération. La facture déjà payée ne
// doit pas bouger d'un centime.
db.prepare('UPDATE operation SET puv = 99.99, quantite = 3 WHERE id = ?').run(bon.operations[0])

const relue = lireFacture(db, emis.id)
ok(relue.total_ttc === 1116,
  `l'opération a été corrigée à 3 × 99,99 € ; la facture affiche toujours 1 116,00 € (obtenu : ${relue.total_ttc})`)
ok(relue.lignes[0].prix_unitaire_ttc === 22.32 && relue.lignes[0].quantite === 50,
  'la ligne garde le prix et la quantité du jour de la facturation')
ok(lignesFacturables(db, bon.dossier)[0].puv === 99.99,
  "l'opération, elle, porte bien la correction : c'est la facture qui ne la suit pas")

const htmlRelu = factureHtml(relue)
ok(!htmlRelu.includes('99,99'), "et le document réimprimé n'en porte aucune trace")

// ═══════════════════════════════════════════════════════════
titre("L'avoir : on ne corrige pas, on contre-passe")

const avoir = emettreAvoir(db, emis.id, { motif: 'Erreur de quantité', aujourdhui: new Date('2026-09-18') })
ok(avoir.ok, `l'avoir est émis (${avoir.numero || avoir.motifs?.join(' ; ')})`)
ok(avoir.numero === 'EM-F-2026-0002',
  `il prend son numéro dans LA MÊME série que les factures (obtenu : ${avoir.numero})`)

const a = lireFacture(db, avoir.id)
ok(a.type === 'AVOIR' && a.annule_facture_id === emis.id, "l'avoir désigne la facture qu'il annule")
ok(a.total_ttc === -1116 && a.reste_a_payer === -1116,
  `les montants sont négatifs (obtenu : ${a.total_ttc})`)
ok(a.lignes.length === 1 && a.lignes[0].total_ttc === -1116, 'les lignes aussi')
ok(a.annulee?.numero === 'EM-F-2026-0001', "et il sait nommer la facture d'origine")

ok(db.prepare('SELECT COUNT(*) AS n FROM facture WHERE id = ?').get(emis.id).n === 1,
  "la facture annulée reste en base : rien n'est effacé")
const originale = lireFacture(db, emis.id)
ok(originale.total_ttc === 1116, 'et elle garde ses montants positifs')
ok(originale.avoir?.numero === 'EM-F-2026-0002', "elle sait qu'un avoir l'annule")

const htmlAvoir = factureHtml(a)
ok(htmlAvoir.includes('AVOIR EM-F-2026-0002'), "le document s'annonce comme un AVOIR, pas par un signe moins")
ok(htmlAvoir.includes('EM-F-2026-0001') && /annule la facture/i.test(htmlAvoir),
  "et renvoie en clair vers la facture qu'il annule")
ok(!/Échéance de règlement/.test(htmlAvoir), "un avoir ne réclame pas de règlement : pas d'échéance")
ok(/Motif :<\/b> Erreur de quantité/.test(htmlAvoir) && !/Règlement :/.test(htmlAvoir),
  "le champ porte ici le MOTIF de l'annulation : l'étiqueter « Règlement » le ferait lire de travers")

const htmlOriginale = factureHtml(originale)
ok(/annulée par l'avoir/i.test(htmlOriginale),
  'réimprimée, la facture annulée le dit — sinon elle circulerait comme si elle valait encore')

// Les refus attendus autour de l'avoir.
const deuxFois = emettreAvoir(db, emis.id)
ok(!deuxFois.ok && /déjà annulée/i.test(deuxFois.motifs[0]), 'une facture ne s\'annule pas deux fois')
const avoirDAvoir = emettreAvoir(db, avoir.id)
ok(!avoirDAvoir.ok, "un avoir ne s'annule pas par un autre avoir")
ok(!emettreAvoir(db, 'inconnu').ok, 'un avoir sur une facture inconnue est refusé')

// Et, la facture d'origine annulée, le dossier redevient facturable.
const rejoue = emettreFacture(db, bon.dossier, { aujourdhui: new Date('2026-09-18') })
ok(rejoue.ok && rejoue.numero === 'EM-F-2026-0003',
  `une fois l'avoir passé, une facture corrigée peut être émise (obtenu : ${rejoue.numero || rejoue.motifs})`)
const corrigee = lireFacture(db, rejoue.id)
ok(corrigee.total_ttc === 299.97,
  `et elle porte, elle, les montants corrigés : 3 × 99,99 = 299,97 € (obtenu : ${corrigee.total_ttc})`)

// ═══════════════════════════════════════════════════════════
titre('Le document')

const doc = factureHtml(corrigee)
ok(doc.includes('EM-F-2026-0003'), 'le numéro figure sur le document')
ok(doc.includes('EARL DE CHEVASNE'), 'le client aussi')
ok(doc.includes('L.441-10') && doc.includes('D.441-5'),
  'les deux articles du code de commerce sont cités — leur absence est sanctionnable')
ok(/10,85\s*%/u.test(doc.replace(/ | /g, ' ')), 'le taux des pénalités de retard est imprimé')
ok(/indemnité forfaitaire de 40,00/u.test(doc.replace(/ | /g, ' ')),
  "l'indemnité de recouvrement est imprimée en toutes lettres")
ok(doc.includes('FR71951788108'), 'le pied de page porte le numéro de TVA')
ok(doc.includes('Siret'), 'et le Siret')
ok(!doc.includes('NON ÉMISE'), 'une facture numérotée ne porte pas le filigrane')
ok(!doc.includes('{/*') && !doc.includes('*/}'),
  "aucun commentaire de code n'a fui dans le document imprimé")

// Une injection dans un nom de client ne doit pas devenir du HTML.
const piege = factureHtml({ ...corrigee, client_nom: '<script>alert(1)</script>' })
ok(!piege.includes('<script>alert(1)</script>') && piege.includes('&lt;script&gt;'),
  'un nom de client contenant du HTML est échappé, pas exécuté')

// ═══════════════════════════════════════════════════════════
titre('La prime déduite, quand elle est demandée')

const avecPrime = poserDossier('D-PRIME', {
  entiteId: emet,
  ops: [{ quantite: 1, puv: 3776.41, taux_tva: 20, prime: 3984.12 }],
})
db.prepare('UPDATE dossier SET facture_deduire_prime = 1 WHERE id = ?').run(avecPrime.dossier)
const rPrime = emettreFacture(db, avecPrime.dossier, { aujourdhui: new Date('2026-09-18') })
ok(rPrime.ok, 'la facture avec prime déduite est émise')
const fPrime = lireFacture(db, rPrime.id)
// Le cas réel du dossier EPC-2026-1788 : la prime dépasse le coût des travaux.
ok(fPrime.reste_a_payer === 0,
  `une prime supérieure aux travaux ne donne pas un net à payer négatif (obtenu : ${fPrime.reste_a_payer})`)
ok(fPrime.prime_deduite === 3776.41, 'la déduction est plafonnée au montant des travaux')

// ═══════════════════════════════════════════════════════════
titre("La société d'émission incomplète bloque, même sur un dossier parfait")

// La colonne est NOT NULL avec une valeur par défaut : le paramétrage bancal qu'on peut
// réellement rencontrer, c'est un taux remis à zéro, pas un taux absent.
const bancale = poserEntite('BANC', 'BC-F', { taux_penalites: 0, indemnite_recouvrement: 0 })
const dBancal = poserDossier('D-BANCAL', { entiteId: bancale, ops: [{ puv: 1000 }] })
const rBancal = emettreFacture(db, dBancal.dossier)
ok(!rBancal.ok && rBancal.motifs.length >= 2,
  'les mentions légales manquantes sont énumérées, pas résumées en « erreur »')
ok(Number(db.prepare('SELECT facture_compteur FROM entite_emettrice WHERE id = ?')
  .get(bancale).facture_compteur || 0) === 0,
  'et là encore, aucun numéro consommé')

// ═══════════════════════════════════════════════════════════
titre('La plateforme telle qu\'elle est paramétrée aujourd\'hui')

const reel = new DatabaseSync(process.env.CEE_DB_SOURCE || 'db/cee.db')
const entites = reel.prepare('SELECT * FROM entite_emettrice WHERE actif = 1 ORDER BY code').all()
ok(entites.length >= 1, `au moins une société émettrice active (obtenu : ${entites.length})`)
ok(entites.every((x) => Number(x.taux_penalites) > 0 && Number(x.indemnite_recouvrement) > 0),
  'chacune porte un taux de pénalités et une indemnité de recouvrement')
ok(entites.every((x) => Number(x.delai_paiement_jours) > 0 && Number(x.delai_paiement_jours) <= DELAI_MAX_JOURS),
  `et un délai de paiement dans les clous des ${DELAI_MAX_JOURS} jours légaux`)
ok(new Set(entites.map((x) => x.facture_prefixe || x.code)).size === entites.length,
  'deux sociétés ne partagent jamais le même préfixe de facture')
ok(entites.every((x) => Number(x.facture_compteur || 0) === 0),
  'aucune n\'a encore émis de facture : les compteurs sont à zéro')
// Le blocage attendu tant que les pièces manquent, dit explicitement plutôt que découvert
// le jour où quelqu'un essaiera d'émettre.
for (const x of entites) {
  const bl = controlerFacture(x, []).filter((y) => y.niveau === 'BLOQUANT')
  ok(bl.some((y) => y.champ === 'assurance'),
    `${x.raison_sociale} : facturation bloquée faute d'assurance décennale — attendu`)
}

fs.rmSync(CIBLE, { force: true })

console.log(`\n${echecs === 0 ? '✔ Tous les contrôles passent.' : `✘ ${echecs} contrôle(s) en échec.`}`)
process.exit(echecs ? 1 : 0)
