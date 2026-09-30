/**
 * La facture : émission, numérotation, avoir.
 *
 * ── Ce qui distingue une facture d'un devis, et qui commande tout le reste ──
 *
 * Un devis se réimprime autant qu'on veut : il décrit une proposition. Une facture, une
 * fois émise, est entrée dans deux comptabilités. Elle ne se modifie plus, ne se supprime
 * pas, et son numéro appartient à une suite continue qu'un contrôle fiscal peut demander à
 * voir. Trois conséquences, toutes visibles dans ce fichier :
 *
 * 1. **Les lignes sont recopiées à l'émission.** La facture ne lit plus les opérations
 *    ensuite. Corriger une opération six mois après ne doit pas réécrire un document déjà
 *    payé — et c'est exactement ce qui arriverait si la facture se régénérait à l'affichage.
 * 2. **Rien ne se corrige, tout se contre-passe.** Une facture fausse s'annule par un
 *    AVOIR : une autre facture, négative, numérotée dans la même suite, qui pointe vers
 *    celle qu'elle annule. Les deux restent en base. C'est la seule façon d'avoir une
 *    comptabilité qui se relit.
 * 3. **La numérotation ne tolère ni trou ni doublon.** Le compteur est lu et incrémenté
 *    dans la même opération, et le numéro n'est attribué qu'au moment où la facture est
 *    réellement écrite — jamais pour une prévisualisation.
 *
 * ── Les mentions obligatoires ──
 *
 * Entre professionnels, une facture doit porter le taux des pénalités de retard et
 * l'indemnité forfaitaire de 40 € pour frais de recouvrement (art. L.441-10 et D.441-5 du
 * code de commerce). Leur absence est sanctionnable. Elles sont donc contrôlées avant
 * émission, au même titre que le SIRET.
 */
import { arrondi } from './montants.js'
import { controlerEntite, totauxDevis } from './devis.js'
import { coordonneesBancaires } from './listes.js'

/** Les jours de délai de paiement, plafonnés par la loi entre professionnels. */
export const DELAI_MAX_JOURS = 60

/**
 * Ce qui empêche d'émettre une facture.
 *
 * Reprend les contrôles du devis — mêmes mentions légales, même société — et y ajoute ce
 * qui n'est exigible que sur une facture.
 */
export function controlerFacture(entite, certifications = [], { dossier = null } = {}) {
  const out = controlerEntite(entite, certifications, { document: 'facture' })
  if (!entite) return out

  if (!(entite.taux_penalites > 0)) {
    out.push({
      niveau: 'BLOQUANT', champ: 'taux_penalites',
      message: `${entite.raison_sociale} : le taux des pénalités de retard n'est pas renseigné. `
        + `Sa mention est obligatoire entre professionnels (art. L.441-10 du code de commerce).`,
    })
  }
  if (!(entite.indemnite_recouvrement > 0)) {
    out.push({
      niveau: 'BLOQUANT', champ: 'indemnite_recouvrement',
      message: `${entite.raison_sociale} : l'indemnité forfaitaire de recouvrement n'est pas `
        + `renseignée. Elle est fixée à 40 € par l'article D.441-5 du code de commerce.`,
    })
  }
  const delai = Number(entite.delai_paiement_jours)
  if (!(delai > 0)) {
    out.push({
      niveau: 'BLOQUANT', champ: 'delai_paiement_jours',
      message: `${entite.raison_sociale} : le délai de paiement n'est pas renseigné.`,
    })
  } else if (delai > DELAI_MAX_JOURS) {
    out.push({
      niveau: 'AVERTISSEMENT', champ: 'delai_paiement_jours',
      message: `${entite.raison_sociale} : un délai de ${delai} jours dépasse le plafond légal `
        + `de ${DELAI_MAX_JOURS} jours entre professionnels.`,
    })
  }

  // Une facture porte une date de prestation. Sur un dossier CEE, c'est la date de fin des
  // travaux : sans elle, la facture est incomplète et le dossier difficile à défendre.
  if (dossier && !dossier.date_achevement && !dossier.date_pose) {
    out.push({
      niveau: 'AVERTISSEMENT', champ: 'date_prestation',
      message: 'Ni la date de pose ni la date d\'achèvement ne sont renseignées : la facture '
        + 'portera sa date d\'émission comme date de prestation.',
    })
  }

  return out
}

/**
 * Attribue le prochain numéro de facture.
 *
 * Même mécanique que pour les devis, mais sur une série distincte et plus exigeante : les
 * avoirs y prennent leur numéro aussi, parce qu'un avoir EST une facture.
 */
export function attribuerNumeroFacture(db, entiteId, aujourdhui = new Date()) {
  const annee = aujourdhui.getFullYear()
  const e = db.prepare(`SELECT code, devis_prefixe, facture_prefixe, facture_compteur, facture_annee
                        FROM entite_emettrice WHERE id = ?`).get(entiteId)
  if (!e) throw new Error('Société émettrice introuvable.')

  const repart = Number(e.facture_annee) !== annee
  const suivant = repart ? 1 : Number(e.facture_compteur || 0) + 1
  db.prepare('UPDATE entite_emettrice SET facture_compteur = ?, facture_annee = ? WHERE id = ?')
    .run(suivant, annee, entiteId)

  // À défaut de préfixe propre, on suit celui des devis plutôt que le code interne : les
  // deux séries restent alors lisibles ensemble (SPL-2026-0031 / SPL-F-2026-0001), là où
  // le code technique donnerait un SPLIT-F-… qui ne ressemble à rien de ce que voit le client.
  const prefixe = e.facture_prefixe || (e.devis_prefixe ? `${e.devis_prefixe}-F` : `${e.code}-F`)
  return `${prefixe}-${annee}-${String(suivant).padStart(4, '0')}`
}

/** Les lignes que porterait une facture de ce dossier, telles quelles. */
export function lignesFacturables(db, dossierId) {
  return db.prepare(`
    SELECT o.id, o.ordre, o.quantite, o.unite, o.puv, o.taux_tva, o.date_calcul,
           o.volume_cumac, o.prime_beneficiaire,
           f.code AS fiche_code, f.libelle AS fiche_libelle,
           p.marque, p.reference, p.designation
      FROM operation o
      JOIN fiche f ON f.id = o.fiche_id
      LEFT JOIN produit p ON p.id = o.produit_id
     WHERE o.dossier_id = ?
     ORDER BY o.ordre`).all(dossierId)
}

/** Tout ce qu'il faut pour préparer une facture, sans rien écrire. */
export function preparerFacture(db, dossierId) {
  const d = db.prepare(`
    SELECT d.*, b.raison_sociale AS client_raison_sociale, b.siret AS client_siret,
           b.nom AS client_nom, b.prenom AS client_prenom,
           s.adresse AS site_adresse, s.code_postal AS site_cp, s.ville AS site_ville,
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
    ? db.prepare('SELECT * FROM certification_rge WHERE installateur_id = ?').all(entite.installateur_id)
    : []

  const lignes = lignesFacturables(db, dossierId)
  const figees = lignes.filter((l) => l.date_calcul)

  const totaux = totauxDevis(lignes, {
    prime: figees.length ? figees.reduce((s, l) => s + (Number(l.prime_beneficiaire) || 0), 0) : null,
    deduirePrime: !!d.facture_deduire_prime,
    tauxDefaut: entite?.taux_tva_defaut ?? null,
  })

  const anomalies = controlerFacture(entite, certifications, { dossier: d })

  // Une opération non valorisée n'a pas de montant : la facturer reviendrait à facturer
  // zéro sans le dire. On l'annonce comme un bloquant, pas comme une ligne à 0 €.
  const nonFigees = lignes.filter((l) => !l.date_calcul)
  if (nonFigees.length) {
    anomalies.push({
      niveau: 'BLOQUANT', champ: 'operations',
      message: `${nonFigees.length} opération(s) ne sont pas valorisées. Une facture ne peut pas `
        + `porter une ligne dont le montant n'a pas été calculé.`,
    })
  }
  if (lignes.length === 0) {
    anomalies.push({ niveau: 'BLOQUANT', champ: 'operations', message: 'Ce dossier ne porte aucune opération à facturer.' })
  }
  if (!totaux.complet) {
    anomalies.push({
      niveau: 'BLOQUANT', champ: 'totaux',
      message: totaux.lignesSansPrix
        ? `${totaux.lignesSansPrix} ligne(s) sans prix unitaire : le total serait incomplet.`
        : 'Le taux de TVA manque sur au moins une ligne.',
    })
  }

  const dejaEmises = db.prepare(`
    SELECT id, numero, type, date_emission, total_ttc, annule_facture_id
      FROM facture WHERE dossier_id = ? ORDER BY cree_le`).all(dossierId)

  // Les acomptes déjà facturés viennent en déduction du net à payer. Un net négatif veut
  // dire que les acomptes dépassent ce qui reste dû : la facture serait un remboursement
  // déguisé. On bloque en disant quoi faire.
  const acomptes = acomptesDisponibles(db, dossierId)
  const acomptesTtc = arrondi(acomptes.reduce((s, a) => s + Number(a.total_ttc || 0), 0))
  const net = arrondi(Number(totaux.reste || 0) - acomptesTtc)
  if (acomptes.length && net < 0) {
    anomalies.push({
      niveau: 'BLOQUANT', champ: 'acomptes',
      message: `Les acomptes facturés (${eurosTexte(acomptesTtc)}) dépassent le net à payer `
        + `(${eurosTexte(totaux.reste)}). Émettez un avoir sur l'acompte en trop avant de facturer.`,
    })
  }

  return {
    dossier: d, entite, certifications, lignes, totaux, anomalies, dejaEmises,
    acomptes, acomptesTtc, net,
    emettable: !anomalies.some((a) => a.niveau === 'BLOQUANT'),
  }
}

// ── Acomptes ─────────────────────────────────────────────────────
//
// Une facture d'acompte est une facture : même série de numéros, mêmes mentions, même
// règle « rien ne se corrige, tout se contre-passe ». Ce qui la distingue :
//
// - son montant est une part du NET À PAYER par le client (prime déduite si la facture la
//   déduit) : c'est ce que le client verse, la prime venant du délégataire ;
// - ce montant est ventilé par taux de TVA au prorata des lignes du devis, pour que la TVA
//   collectée sur l'acompte soit celle que portera la facture finale ;
// - la facture finale le déduit, et le note. Si cette facture est annulée par un avoir,
//   l'acompte redevient disponible : il a été payé, il reste à imputer.

const dateCourte = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '')
const eurosTexte = (n) => `${Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Acomptes émis, non annulés, et pas déjà déduits d'une facture finale encore valable. */
export function acomptesDisponibles(db, dossierId) {
  return db.prepare(`
    SELECT a.* FROM facture a
     WHERE a.dossier_id = ? AND a.type = 'ACOMPTE'
       AND NOT EXISTS (SELECT 1 FROM facture av WHERE av.annule_facture_id = a.id)
       AND (a.imputee_sur_id IS NULL
            OR EXISTS (SELECT 1 FROM facture av WHERE av.annule_facture_id = a.imputee_sur_id))
     ORDER BY a.cree_le`).all(dossierId)
}

const detailAcomptes = (liste) =>
  liste.map((a) => `${a.numero} du ${dateCourte(a.date_emission)} : ${eurosTexte(a.total_ttc)}`).join(' ; ') || null

/**
 * Prépare un acompte sans rien écrire. `pourcentage` (du net à payer) ou `montantTtc`.
 */
export function preparerAcompte(db, dossierId, { pourcentage = null, montantTtc = null } = {}) {
  const p = preparerFacture(db, dossierId)
  if (!p) return null
  // Les contrôles de la facture valent pour l'acompte, sauf celui des acomptes eux-mêmes :
  // il est refait plus bas, avec le montant demandé.
  const anomalies = p.anomalies.filter((a) => a.champ !== 'acomptes')

  const vivante = p.dejaEmises.find((f) => f.type === 'FACTURE' && !p.dejaEmises.some((a) => a.annule_facture_id === f.id))
  if (vivante) {
    anomalies.push({ niveau: 'BLOQUANT', champ: 'acompte',
      message: `Ce dossier est déjà facturé (${vivante.numero}) : un acompte n'a plus de sens.` })
  }

  const base = arrondi(p.totaux.reste || 0)
  const pct = pourcentage === null || pourcentage === '' ? null : Number(pourcentage)
  const montant = pct !== null ? arrondi(base * pct / 100) : arrondi(montantTtc)
  if (pct !== null && !(pct > 0 && pct <= 100)) {
    anomalies.push({ niveau: 'BLOQUANT', champ: 'acompte', message: 'Le pourcentage doit être compris entre 0 et 100.' })
  } else if (!(montant > 0)) {
    anomalies.push({ niveau: 'BLOQUANT', champ: 'acompte', message: 'Le montant de l\'acompte doit être positif.' })
  } else if (arrondi(p.acomptesTtc + montant) > base) {
    anomalies.push({ niveau: 'BLOQUANT', champ: 'acompte',
      message: `L'acompte (${eurosTexte(montant)}) et ceux déjà facturés (${eurosTexte(p.acomptesTtc)}) `
        + `dépasseraient le net à payer (${eurosTexte(base)}).` })
  }

  // Ventilation par taux, au prorata du TTC de chaque taux. Le dernier taux reçoit le reste
  // à l'arrondi près, pour que la somme des lignes tombe exactement sur le montant.
  const taux = p.totaux.tvas.map((t) => ({ taux: t.taux, ttc: arrondi(t.base + t.montant) }))
  const ttcTotal = taux.reduce((s, t) => s + t.ttc, 0)
  let reparti = 0
  const lignes = taux.map((t, i) => {
    const part = i === taux.length - 1 ? arrondi(montant - reparti) : arrondi(montant * t.ttc / ttcTotal)
    reparti = arrondi(reparti + part)
    return {
      ordre: i + 1,
      designation: `Acompte${pct !== null ? ` de ${pct.toLocaleString('fr-FR')} %` : ''}`
        + `${p.dossier.num_devis ? ` sur le devis ${p.dossier.num_devis}` : ' sur travaux'}`,
      detail: `Net à payer du devis : ${eurosTexte(base)}${taux.length > 1 ? ` · part au taux de ${t.taux} %` : ''}`,
      quantite: 1, unite: null, prix_unitaire_ttc: part, total_ttc: part, taux_tva: t.taux, operation_id: null,
    }
  })
  const ht = arrondi(lignes.reduce((s, l) => s + arrondi(l.total_ttc / (1 + l.taux_tva / 100)), 0))

  return {
    ...p, anomalies, base, montant, pourcentage: pct, lignes,
    totauxAcompte: { ht, tva: arrondi(montant - ht), ttc: montant },
    emettable: !anomalies.some((a) => a.niveau === 'BLOQUANT'),
  }
}

/** Émet la facture d'acompte. Même transaction, même série que la facture. */
export function emettreAcompte(db, dossierId, { pourcentage = null, montantTtc = null, utilisateurId = null, aujourdhui = new Date() } = {}) {
  const p = preparerAcompte(db, dossierId, { pourcentage, montantTtc })
  if (!p) return { ok: false, motifs: ['Dossier introuvable.'] }
  if (!p.emettable) {
    return { ok: false, motifs: p.anomalies.filter((a) => a.niveau === 'BLOQUANT').map((a) => a.message) }
  }

  const d = p.dossier
  const emission = aujourdhui.toISOString().slice(0, 10)
  const delai = Number(p.entite.delai_paiement_jours) || 30
  const echeance = new Date(new Date(emission).getTime() + delai * 86400000).toISOString().slice(0, 10)
  const id = crypto.randomUUID()

  db.exec('BEGIN')
  let numero
  try {
    numero = attribuerNumeroFacture(db, p.entite.id, aujourdhui)
    db.prepare(`INSERT INTO facture (
        id, numero, dossier_id, entite_id, type, date_emission, date_prestation, date_echeance,
        client_nom, client_adresse, client_code_postal, client_ville, client_siret,
        total_ht, total_tva, total_ttc, prime_deduite, reste_a_payer,
        conditions_reglement, taux_penalites, indemnite_recouvrement, emise_par
      ) VALUES (?,?,?,?,'ACOMPTE',?,NULL,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?,?)`)
      .run(id, numero, dossierId, p.entite.id, emission, echeance,
        d.client_raison_sociale || [d.client_prenom, d.client_nom].filter(Boolean).join(' ') || '—',
        d.site_adresse, d.site_cp, d.site_ville, d.client_siret,
        p.totauxAcompte.ht, p.totauxAcompte.tva, p.totauxAcompte.ttc, p.totauxAcompte.ttc,
        p.entite.conditions_reglement, p.entite.taux_penalites, p.entite.indemnite_recouvrement,
        utilisateurId)
    const ins = db.prepare(`INSERT INTO facture_ligne
      (id, facture_id, ordre, designation, detail, quantite, unite, prix_unitaire_ttc,
       total_ttc, taux_tva, operation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    for (const l of p.lignes) {
      ins.run(crypto.randomUUID(), id, l.ordre, l.designation, l.detail, l.quantite, l.unite,
        l.prix_unitaire_ttc, l.total_ttc, l.taux_tva, null)
    }
    figerReglement(db, id, p.entite.id)
    db.prepare(`UPDATE dossier SET entite_id = COALESCE(entite_id, ?) WHERE id = ?`).run(p.entite.id, dossierId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [`Émission interrompue, aucun numéro consommé : ${e.message}`] }
  }
  return { ok: true, id, numero }
}

/**
 * L'aperçu : la facture telle qu'elle SERAIT, sans rien écrire et sans numéro.
 *
 * Le gabarit d'impression ne sait lire qu'une seule forme de facture. Plutôt que de lui
 * apprendre une deuxième forme pour l'aperçu — deux gabarits qui divergent, c'est la
 * garantie qu'un jour l'aperçu ne ressemble plus au document émis —, on habille ici les
 * données préparées exactement comme `lireFacture` habille une facture réelle. Le seul
 * écart est le numéro, laissé nul : c'est lui qui déclenche le filigrane.
 */
export function apercuFacture(db, dossierId, { aujourdhui = new Date() } = {}) {
  const p = preparerFacture(db, dossierId)
  if (!p) return null
  const { dossier: d, entite: e, totaux: t } = p
  if (!e) return { ...p, facture: null }

  const emission = aujourdhui.toISOString().slice(0, 10)
  const delai = Number(e.delai_paiement_jours) || 30

  const facture = {
    numero: null,
    type: 'FACTURE',
    date_emission: emission,
    date_prestation: d.date_achevement || d.date_pose || emission,
    date_echeance: new Date(new Date(emission).getTime() + delai * 86400000).toISOString().slice(0, 10),
    client_nom: d.client_raison_sociale
      || [d.client_prenom, d.client_nom].filter(Boolean).join(' ') || '—',
    client_adresse: d.site_adresse, client_code_postal: d.site_cp,
    client_ville: d.site_ville, client_siret: d.client_siret, client_tva: null,
    total_ht: t.ht,
    total_tva: t.tvas.reduce((s, x) => s + x.montant, 0),
    total_ttc: t.ttc,
    prime_deduite: t.primeDeduite,
    acomptes_ttc: p.acomptes.length ? p.acomptesTtc : null,
    acomptes_detail: detailAcomptes(p.acomptes),
    reste_a_payer: p.net,
    conditions_reglement: e.conditions_reglement,
    taux_penalites: e.taux_penalites,
    indemnite_recouvrement: e.indemnite_recouvrement,
    ...(coordonneesBancaires(db, e.id) || {}),

    raison_sociale: e.raison_sociale, forme_juridique: e.forme_juridique, capital: e.capital,
    entite_siret: e.siret, siren: e.siren, naf: e.naf,
    rcs_ville: e.rcs_ville, rcs_numero: e.rcs_numero, entite_tva: e.tva,
    entite_adresse: e.adresse, entite_cp: e.code_postal, entite_ville: e.ville,
    telephone: e.telephone, email: e.email, logo: e.logo,
    representant_nom: e.representant_nom, representant_qualite: e.representant_qualite,
    assurance_nom: e.assurance_nom, assurance_police: e.assurance_police,
    assurance_couverture: e.assurance_couverture,

    dossier_numero: d.numero, num_devis: d.num_devis,
    delegataire_nom: d.delegataire_nom, delegataire_oblige: d.delegataire_oblige,

    lignes: p.lignes.map((l) => ({
      ordre: l.ordre,
      designation: l.fiche_libelle || l.fiche_code,
      detail: [
        `Opération ${l.fiche_code}`,
        l.volume_cumac ? `${Number(l.volume_cumac).toLocaleString('fr-FR')} kWh cumac` : null,
        [l.marque, l.reference].filter(Boolean).join(' '),
      ].filter(Boolean).join(' · '),
      quantite: l.quantite, unite: l.unite,
      prix_unitaire_ttc: l.puv,
      total_ttc: l.puv === null || l.puv === undefined
        ? null : arrondi(Number(l.puv) * Number(l.quantite ?? 1)),
      taux_tva: l.taux_tva ?? e.taux_tva_defaut ?? null,
      operation_id: l.id,
    })),
    annulee: null, avoir: null,
  }

  return { ...p, facture }
}

/**
 * Émet la facture. C'est ici, et seulement ici, qu'un numéro est consommé.
 *
 * Tout est fait dans une transaction : si l'écriture d'une ligne échoue, le numéro n'est
 * pas consommé non plus. Un numéro attribué à une facture qui n'existe pas, c'est un trou
 * dans la série — exactement ce qu'un contrôle relève.
 */
export function emettreFacture(db, dossierId, { utilisateurId = null, aujourdhui = new Date() } = {}) {
  const p = preparerFacture(db, dossierId)
  if (!p) return { ok: false, motifs: ['Dossier introuvable.'] }
  if (!p.emettable) {
    return { ok: false, motifs: p.anomalies.filter((a) => a.niveau === 'BLOQUANT').map((a) => a.message) }
  }

  const dejaFacture = p.dejaEmises.find((f) => f.type === 'FACTURE' && !p.dejaEmises.some((a) => a.annule_facture_id === f.id))
  if (dejaFacture) {
    return { ok: false, motifs: [`Ce dossier porte déjà la facture ${dejaFacture.numero}. `
      + `Pour la corriger, émettez un avoir puis une nouvelle facture.`] }
  }

  const d = p.dossier
  const emission = aujourdhui.toISOString().slice(0, 10)
  const prestation = d.date_achevement || d.date_pose || emission
  const delai = Number(p.entite.delai_paiement_jours) || 30
  const echeance = new Date(new Date(emission).getTime() + delai * 86400000).toISOString().slice(0, 10)

  const id = crypto.randomUUID()
  db.exec('BEGIN')
  let numero
  try {
    numero = attribuerNumeroFacture(db, p.entite.id, aujourdhui)

    db.prepare(`INSERT INTO facture (
        id, numero, dossier_id, entite_id, type, date_emission, date_prestation, date_echeance,
        client_nom, client_adresse, client_code_postal, client_ville, client_siret,
        total_ht, total_tva, total_ttc, prime_deduite, acomptes_ttc, acomptes_detail, reste_a_payer,
        conditions_reglement, taux_penalites, indemnite_recouvrement, emise_par
      ) VALUES (?,?,?,?,'FACTURE',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, numero, dossierId, p.entite.id, emission, prestation, echeance,
        d.client_raison_sociale || [d.client_prenom, d.client_nom].filter(Boolean).join(' ') || '—',
        d.site_adresse, d.site_cp, d.site_ville, d.client_siret,
        p.totaux.ht, p.totaux.tvas.reduce((s, t) => s + t.montant, 0), p.totaux.ttc,
        p.totaux.primeDeduite, p.acomptes.length ? p.acomptesTtc : null, detailAcomptes(p.acomptes), p.net,
        p.entite.conditions_reglement, p.entite.taux_penalites, p.entite.indemnite_recouvrement,
        utilisateurId)

    const ins = db.prepare(`INSERT INTO facture_ligne
      (id, facture_id, ordre, designation, detail, quantite, unite, prix_unitaire_ttc,
       total_ttc, taux_tva, operation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    for (const l of p.lignes) {
      const total = arrondi(Number(l.puv) * Number(l.quantite ?? 1))
      const detail = [
        `Opération ${l.fiche_code}`,
        l.volume_cumac ? `${Number(l.volume_cumac).toLocaleString('fr-FR')} kWh cumac` : null,
        [l.marque, l.reference].filter(Boolean).join(' '),
      ].filter(Boolean).join(' · ')
      ins.run(crypto.randomUUID(), id, l.ordre, l.fiche_libelle || l.fiche_code, detail,
        l.quantite, l.unite, l.puv, total, l.taux_tva ?? p.entite.taux_tva_defaut, l.id)
    }

    figerReglement(db, id, p.entite.id)

    // Les acomptes déduits sont rattachés à cette facture, dans la même transaction : un
    // acompte ne peut pas être déduit deux fois.
    const imputer = db.prepare('UPDATE facture SET imputee_sur_id = ? WHERE id = ?')
    for (const a of p.acomptes) imputer.run(id, a.id)

    db.prepare(`UPDATE dossier SET entite_id = COALESCE(entite_id, ?) WHERE id = ?`)
      .run(p.entite.id, dossierId)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [`Émission interrompue, aucun numéro consommé : ${e.message}`] }
  }

  return { ok: true, id, numero }
}

/**
 * Émet un avoir annulant une facture.
 *
 * L'avoir reprend les lignes de la facture annulée, en négatif. Il prend son numéro dans
 * la même série : c'est une pièce comptable à part entière, pas une suppression déguisée.
 * La facture d'origine reste intacte et lisible — c'est le point.
 */
export function emettreAvoir(db, factureId, { motif = null, utilisateurId = null, aujourdhui = new Date() } = {}) {
  const f = db.prepare('SELECT * FROM facture WHERE id = ?').get(factureId)
  if (!f) return { ok: false, motifs: ['Facture introuvable.'] }
  if (f.type === 'AVOIR') return { ok: false, motifs: ['Un avoir ne s\'annule pas par un autre avoir.'] }

  // Un acompte déduit d'une facture finale encore valable ne s'annule pas seul : la facture
  // finale afficherait une déduction qui n'existe plus. On annule d'abord la facture finale.
  if (f.type === 'ACOMPTE' && f.imputee_sur_id) {
    const finale = db.prepare(`SELECT numero FROM facture fi WHERE fi.id = ?
      AND NOT EXISTS (SELECT 1 FROM facture av WHERE av.annule_facture_id = fi.id)`).get(f.imputee_sur_id)
    if (finale) {
      return { ok: false, motifs: [`Cet acompte est déduit de la facture ${finale.numero}. `
        + `Annulez d'abord cette facture par un avoir, puis l'acompte.`] }
    }
  }

  const dejaAnnulee = db.prepare('SELECT numero FROM facture WHERE annule_facture_id = ?').get(factureId)
  if (dejaAnnulee) {
    return { ok: false, motifs: [`Cette facture est déjà annulée par l'avoir ${dejaAnnulee.numero}.`] }
  }

  const lignes = db.prepare('SELECT * FROM facture_ligne WHERE facture_id = ? ORDER BY ordre').all(factureId)
  const emission = aujourdhui.toISOString().slice(0, 10)
  const id = crypto.randomUUID()

  db.exec('BEGIN')
  let numero
  try {
    numero = attribuerNumeroFacture(db, f.entite_id, aujourdhui)
    const neg = (v) => (v === null || v === undefined ? null : -Number(v))

    db.prepare(`INSERT INTO facture (
        id, numero, dossier_id, entite_id, type, annule_facture_id,
        date_emission, date_prestation, date_echeance,
        client_nom, client_adresse, client_code_postal, client_ville, client_siret,
        total_ht, total_tva, total_ttc, prime_deduite, acomptes_ttc, acomptes_detail, reste_a_payer,
        conditions_reglement, taux_penalites, indemnite_recouvrement, emise_par
      ) VALUES (?,?,?,?,'AVOIR',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, numero, f.dossier_id, f.entite_id, factureId,
        emission, f.date_prestation, emission,
        f.client_nom, f.client_adresse, f.client_code_postal, f.client_ville, f.client_siret,
        neg(f.total_ht), neg(f.total_tva), neg(f.total_ttc), neg(f.prime_deduite),
        neg(f.acomptes_ttc), f.acomptes_detail, neg(f.reste_a_payer),
        motif || `Annulation de la facture ${f.numero}`,
        f.taux_penalites, f.indemnite_recouvrement, utilisateurId)

    const ins = db.prepare(`INSERT INTO facture_ligne
      (id, facture_id, ordre, designation, detail, quantite, unite, prix_unitaire_ttc,
       total_ttc, taux_tva, operation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    for (const l of lignes) {
      ins.run(crypto.randomUUID(), id, l.ordre, l.designation, l.detail,
        l.quantite, l.unite, l.prix_unitaire_ttc, neg(l.total_ttc), l.taux_tva, l.operation_id)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [`Avoir interrompu, aucun numéro consommé : ${e.message}`] }
  }

  return { ok: true, id, numero, annule: f.numero }
}

/** Une facture telle qu'elle a été émise, lignes comprises. Rien n'est recalculé. */
export function lireFacture(db, factureId) {
  const f = db.prepare(`
    SELECT f.*, e.raison_sociale, e.forme_juridique, e.capital, e.siret AS entite_siret,
           e.siren, e.naf, e.rcs_ville, e.rcs_numero, e.tva AS entite_tva,
           e.adresse AS entite_adresse, e.code_postal AS entite_cp, e.ville AS entite_ville,
           e.telephone, e.email, e.logo, e.representant_nom, e.representant_qualite,
           e.assurance_nom, e.assurance_police, e.assurance_couverture,
           d.numero AS dossier_numero, d.num_devis,
           dg.nom AS delegataire_nom, dg.oblige AS delegataire_oblige
      FROM facture f
      JOIN entite_emettrice e ON e.id = f.entite_id
      JOIN dossier d ON d.id = f.dossier_id
      LEFT JOIN delegataire dg ON dg.id = d.delegataire_id
     WHERE f.id = ?`).get(factureId)
  if (!f) return null

  const lignes = db.prepare('SELECT * FROM facture_ligne WHERE facture_id = ? ORDER BY ordre').all(factureId)
  const annulee = f.annule_facture_id
    ? db.prepare('SELECT numero, date_emission FROM facture WHERE id = ?').get(f.annule_facture_id)
    : null
  const avoir = db.prepare('SELECT numero, date_emission FROM facture WHERE annule_facture_id = ?').get(factureId)

  return { ...f, lignes, annulee, avoir }
}

/** Recopie sur la facture les coordonnées bancaires de la société, au moment de l'émission. */
function figerReglement(db, factureId, entiteId) {
  const c = coordonneesBancaires(db, entiteId)
  if (c) db.prepare('UPDATE facture SET reglement_banque = ?, reglement_iban = ?, reglement_bic = ? WHERE id = ?')
    .run(c.reglement_banque, c.reglement_iban, c.reglement_bic, factureId)
}
