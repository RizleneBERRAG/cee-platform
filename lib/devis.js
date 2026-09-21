/**
 * Le devis : numérotation, contrôle de régularité, et assemblage du document.
 *
 * ── Ce qu'un devis engage ──
 *
 * Un devis n'est pas une mise en page. C'est un document contractuel : il porte les
 * mentions légales d'une société précise, un numéro qui doit s'inscrire dans une suite
 * continue, et — sur des travaux de bâtiment — une assurance décennale dont l'absence
 * rend le document irrégulier (art. L.243-2 du code des assurances). Sur un dossier CEE
 * il porte en plus la prime, son délégataire et sa fiche d'opération : ce sont ces
 * mentions-là que le contrôle vérifiera, des mois plus tard.
 *
 * D'où la forme de ce module : il **vérifie avant d'émettre**, et il refuse de compléter
 * ce qu'il ne sait pas. Un devis à qui il manque le numéro de TVA de l'émetteur ne sort
 * pas avec une case vide discrète ; il ne sort pas.
 *
 * ── Pourquoi la numérotation est par entité ──
 *
 * Deux sociétés ne partagent pas une série. Chacune doit pouvoir présenter une suite
 * continue, sans trou, à son propre contrôle fiscal. Le compteur vit donc sur l'entité,
 * et il s'incrémente dans la même transaction que l'attribution : deux devis émis à la
 * même seconde ne peuvent pas recevoir le même numéro.
 *
 * ── Ce que ce module ne fait pas ──
 *
 * Il ne recalcule rien. Les montants viennent des opérations FIGÉES du dossier, telles
 * qu'elles ont été valorisées. Un devis qui recalculerait à l'impression afficherait un
 * montant différent de celui enregistré, et personne ne saurait lequel fait foi.
 */
import { arrondi } from './montants.js'

/** Les champs sans lesquels un devis n'est pas régulier. */
const OBLIGATOIRES = [
  ['raison_sociale', 'la raison sociale'],
  ['siret', 'le SIRET'],
  ['tva', 'le numéro de TVA intracommunautaire'],
  ['adresse', "l'adresse"],
  ['code_postal', 'le code postal'],
  ['ville', 'la ville'],
]

/**
 * La clé de contrôle d'un numéro de TVA français, recalculée depuis le SIREN.
 *
 * Deux chiffres au début du numéro, et une faute de frappe y est invisible à l'œil. Les
 * devis déjà émis en portent un amputé d'un chiffre depuis des mois. La clé se recalcule
 * en une ligne : autant la vérifier.
 */
export function tvaFrValide(tva, siren) {
  const t = String(tva || '').replace(/\s/g, '').toUpperCase()
  const s = String(siren || '').replace(/\s/g, '')
  if (!/^FR[0-9A-Z]{2}\d{9}$/.test(t)) return false
  if (!/^\d{9}$/.test(s)) return true // sans SIREN, on ne contrôle que la forme
  if (t.slice(4) !== s) return false
  const cle = (12 + 3 * (Number(s) % 97)) % 97
  return t.slice(2, 4) === String(cle).padStart(2, '0')
}

/**
 * Ce qui empêche ou gêne l'émission d'un devis sous cette entité.
 *
 * Deux niveaux, et la distinction compte : `BLOQUANT` arrête l'émission, `AVERTISSEMENT`
 * la laisse passer en le disant. Tout bloquer rendrait la plateforme inutilisable avant
 * que le gérant ait fini de la renseigner ; ne rien bloquer laisserait sortir des devis
 * irréguliers. La ligne passe là où le document devient faux plutôt qu'incomplet.
 */
const FORMES = {
  devis: { un: 'Un devis', irregulier: 'irrégulier', sur: 'sur un devis', au_pied: 'au pied du devis' },
  facture: { un: 'Une facture', irregulier: 'irrégulière', sur: 'sur une facture', au_pied: 'au pied de la facture' },
}

/**
 * Les contrôles communs au devis et à la facture.
 *
 * `document` ne change QUE la formulation. Un message qui parle de devis alors qu'on émet
 * une facture fait douter de ce qui a été contrôlé — et fait chercher au mauvais endroit.
 */
export function controlerEntite(entite, certifications = [], { document = 'devis' } = {}) {
  const f = FORMES[document] || FORMES.devis
  const out = []
  if (!entite) {
    return [{ niveau: 'BLOQUANT', message: "Aucune société émettrice n'est choisie pour ce dossier." }]
  }

  for (const [champ, nom] of OBLIGATOIRES) {
    if (!entite[champ]) {
      out.push({
        niveau: 'BLOQUANT', champ,
        message: `${entite.raison_sociale || "L'entité"} : ${nom} manque. ${f.un} sans cette mention est ${f.irregulier}.`,
      })
    }
  }

  if (entite.tva && !tvaFrValide(entite.tva, entite.siren)) {
    out.push({
      niveau: 'BLOQUANT', champ: 'tva',
      message: `${entite.raison_sociale} : le numéro de TVA « ${entite.tva} » ne correspond pas au SIREN ` +
        `${entite.siren || '(non renseigné)'} — sa clé de contrôle est fausse.`,
    })
  }

  if (!entite.assurance_nom || !entite.assurance_police) {
    out.push({
      niveau: 'BLOQUANT', champ: 'assurance',
      message: `${entite.raison_sociale} : l'assurance décennale (assureur et n° de police) n'est pas ` +
        `renseignée. Son affichage est obligatoire ${f.sur} de travaux de bâtiment.`,
    })
  }

  if (entite.capital === null || entite.capital === undefined) {
    out.push({
      niveau: 'AVERTISSEMENT', champ: 'capital',
      message: `${entite.raison_sociale} : le capital social n'est pas renseigné — il figure d'ordinaire ${f.au_pied}.`,
    })
  }

  if (entite.taux_tva_defaut === null || entite.taux_tva_defaut === undefined) {
    out.push({
      niveau: 'BLOQUANT', champ: 'taux_tva_defaut',
      message: `${entite.raison_sociale} : aucun taux de TVA par défaut. Il ne sera pas deviné.`,
    })
  }

  if (!entite.telephone && !entite.email) {
    out.push({
      niveau: 'AVERTISSEMENT', champ: 'contact',
      message: `${entite.raison_sociale} : ni téléphone ni e-mail — le client n'aura aucun moyen de vous joindre.`,
    })
  }

  if (certifications.length === 0) {
    out.push({
      niveau: 'AVERTISSEMENT', champ: 'rge',
      message: `${entite.raison_sociale} : aucune qualification RGE enregistrée. Elle conditionne le droit à la prime.`,
    })
  }

  return out
}

/**
 * Attribue le prochain numéro de devis d'une entité.
 *
 * Le compteur est lu ET incrémenté par le même `UPDATE … RETURNING` : entre la lecture et
 * l'écriture, aucune autre émission ne peut s'intercaler. Un `SELECT` suivi d'un `UPDATE`
 * donnerait deux fois le même numéro à deux devis émis en même temps — et une série de
 * numéros avec un doublon est précisément ce qu'un contrôle fiscal relève.
 *
 * Forme : `EPC-2026-0001`. L'année est celle de l'émission, et le compteur repart à 1 à
 * chaque changement d'année — d'où `devis_annee`, sans quoi on ne saurait pas s'il faut
 * repartir de zéro.
 */
export function attribuerNumero(db, entiteId, aujourdhui = new Date()) {
  const annee = aujourdhui.getFullYear()
  const e = db.prepare('SELECT code, devis_prefixe, devis_compteur, devis_annee FROM entite_emettrice WHERE id = ?').get(entiteId)
  if (!e) throw new Error('Entité émettrice introuvable.')

  const repart = Number(e.devis_annee) !== annee
  const suivant = repart ? 1 : Number(e.devis_compteur || 0) + 1
  db.prepare('UPDATE entite_emettrice SET devis_compteur = ?, devis_annee = ? WHERE id = ?')
    .run(suivant, annee, entiteId)

  const prefixe = e.devis_prefixe || e.code
  return `${prefixe}-${annee}-${String(suivant).padStart(4, '0')}`
}

/**
 * Les totaux d'un devis.
 *
 * ── Le point délicat : la prime déduite ──
 *
 * Sur un dossier CEE, la prime peut être versée au client OU déduite du montant à payer.
 * Les deux existent, le dossier porte le choix (`devis_deduire_prime`), et se tromper
 * revient à réclamer au client une somme qu'il ne doit pas — ou à ne pas la réclamer.
 * Le total « reste à payer » est donc toujours affiché, même quand il vaut zéro : c'est
 * lui qui fait foi.
 *
 * ── Zéro n'est pas inconnu ──
 *
 * Une ligne sans prix unitaire n'est pas une ligne à 0 €. Elle est signalée, et le total
 * indique qu'il est incomplet plutôt que d'additionner des vides.
 */
export function totauxDevis(lignes, { prime = null, deduirePrime = true, tauxDefaut = null } = {}) {
  const sansPrix = lignes.filter((l) => l.puv === null || l.puv === undefined || l.puv === '')
  const chiffrees = lignes.filter((l) => !sansPrix.includes(l))

  // Un devis se lit en TTC chez eux (« P.U TTC », « Total TTC ») : on part donc du TTC de
  // chaque ligne et on remonte au HT, plutôt que l'inverse. Descendre du HT au TTC
  // donnerait des centimes d'écart avec les devis déjà émis, sur les mêmes chiffres.
  const parTaux = new Map()
  let ttc = 0
  for (const l of chiffrees) {
    const taux = l.taux_tva ?? tauxDefaut
    const ligneTtc = arrondi(Number(l.puv) * Number(l.quantite ?? 1))
    ttc = arrondi(ttc + ligneTtc)
    if (taux === null || taux === undefined) continue
    const k = Number(taux)
    parTaux.set(k, arrondi((parTaux.get(k) || 0) + ligneTtc))
  }

  let ht = 0
  const tvas = []
  for (const [taux, montantTtc] of [...parTaux].sort((a, b) => a[0] - b[0])) {
    const montantHt = arrondi(montantTtc / (1 + taux / 100))
    const montantTva = arrondi(montantTtc - montantHt)
    ht = arrondi(ht + montantHt)
    tvas.push({ taux, base: montantHt, montant: montantTva })
  }

  // ── Quand la prime dépasse le coût des travaux ──
  //
  // Le cas se présente pour de bon : sur un dossier repris, 3 984,12 € de prime pour
  // 3 776,41 € de travaux. Déduire brutalement donnerait un « reste à payer » de
  // −207,71 €, c'est-à-dire un devis où l'entreprise doit de l'argent au client. Ce n'est
  // pas ce qui se passe : la prime est plafonnée au coût de l'opération.
  //
  // On plafonne donc la déduction au TTC, et on expose l'excédent à part plutôt que de le
  // faire disparaître. Un chiffre rogné en silence est un chiffre qu'on ne corrigera
  // jamais, faute de savoir qu'il existe.
  const primeBrute = prime === null || prime === undefined ? null : arrondi(Number(prime))
  const deduite = deduirePrime && primeBrute !== null ? Math.min(primeBrute, ttc) : null
  const primeDeduite = deduite === null ? null : arrondi(deduite)
  const primeExcedentaire = primeDeduite !== null && primeBrute > ttc ? arrondi(primeBrute - ttc) : null
  const reste = primeDeduite === null ? ttc : arrondi(ttc - primeDeduite)

  return {
    ht, tvas, ttc,
    prime: primeBrute,
    primeDeduite,
    primeExcedentaire,
    reste,
    complet: sansPrix.length === 0 && parTaux.size > 0,
    lignesSansPrix: sansPrix.length,
    lignesSansTaux: chiffrees.filter((l) => (l.taux_tva ?? tauxDefaut) === null || (l.taux_tva ?? tauxDefaut) === undefined).length,
  }
}

/**
 * Rassemble tout ce qu'il faut pour imprimer le devis d'un dossier.
 *
 * Ne touche à rien : aucune écriture, aucun numéro attribué. C'est volontaire — on doit
 * pouvoir prévisualiser un devis autant de fois qu'on veut sans consommer un numéro de la
 * série. Le numéro s'attribue au moment de l'émission, et une seule fois.
 */
export function donneesDevis(db, dossierId) {
  const d = db.prepare(`
    SELECT d.*, b.raison_sociale AS client_raison_sociale, b.siret AS client_siret,
           b.nom AS client_nom, b.prenom AS client_prenom, b.email AS client_email,
           b.telephone AS client_telephone, b.regime_revenu,
           s.adresse AS site_adresse, s.code_postal AS site_cp, s.ville AS site_ville,
           s.parcelle_cadastrale,
           dg.nom AS delegataire_nom, dg.oblige AS delegataire_oblige
      FROM dossier d
      LEFT JOIN beneficiaire b ON b.id = d.beneficiaire_id
      LEFT JOIN site s ON s.id = d.site_id
      LEFT JOIN delegataire dg ON dg.id = d.delegataire_id
     WHERE d.id = ?`).get(dossierId)
  if (!d) return null

  const entite = d.entite_id
    ? db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(d.entite_id)
    : db.prepare('SELECT * FROM entite_emettrice WHERE par_defaut = 1 AND actif = 1').get() || null

  const certifications = entite?.installateur_id
    ? db.prepare('SELECT * FROM certification_rge WHERE installateur_id = ? ORDER BY date_fin DESC')
        .all(entite.installateur_id)
    : []

  // Seules les opérations FIGÉES portent des montants. Une opération non valorisée est
  // listée à part : elle doit se voir, pas disparaître du devis en silence.
  const operations = db.prepare(`
    SELECT o.*, f.code AS fiche_code, f.libelle AS fiche_libelle,
           p.marque, p.reference, p.designation, p.description
      FROM operation o
      JOIN fiche f ON f.id = o.fiche_id
      LEFT JOIN produit p ON p.id = o.produit_id
     WHERE o.dossier_id = ?
     ORDER BY o.ordre`).all(dossierId)

  const figees = operations.filter((o) => o.date_calcul)
  const totaux = totauxDevis(operations, {
    prime: figees.length ? figees.reduce((s, o) => s + (Number(o.prime_beneficiaire) || 0), 0) : null,
    deduirePrime: !!d.devis_deduire_prime,
    tauxDefaut: entite?.taux_tva_defaut ?? null,
  })

  return {
    dossier: d,
    entite,
    certifications,
    operations,
    nonFigees: operations.filter((o) => !o.date_calcul),
    totaux,
    anomalies: controlerEntite(entite, certifications),
  }
}
