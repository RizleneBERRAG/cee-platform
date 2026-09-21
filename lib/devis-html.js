/**
 * Le devis, en HTML imprimable.
 *
 * ── Pourquoi du HTML et pas un PDF généré côté serveur ──
 *
 * Produire un PDF demanderait une bibliothèque de rendu — un navigateur sans écran, en
 * pratique — soit une centaine de mégaoctets à installer, à mettre à jour et à sécuriser
 * sur le serveur, pour un document d'une page. Le même résultat s'obtient avec la
 * commande Imprimer du navigateur, qui sait déjà écrire un PDF. La mise en page ci-dessous
 * est donc écrite pour l'impression : format A4, pied de page répété, coupures maîtrisées.
 *
 * Le jour où l'émission doit être automatique — envoyer le devis par mail sans qu'un
 * humain clique — il faudra un rendu serveur. Ce fichier restera le gabarit ; c'est
 * l'appelant qui changera.
 *
 * ── Ce que la mise en page reprend de l'existant ──
 *
 * Les devis déjà émis par le groupe ont une structure que leurs clients et leurs
 * délégataires connaissent : bandeau du numéro, bloc client à droite, adresse des travaux,
 * tableau « Détail / Quantité / P.U TTC / Total TTC / TVA », mentions CEE, puis pavé de
 * signature à gauche et totaux à droite. On la reprend. Changer la forme d'un document
 * contractuel sans raison, c'est créer du doute chez celui qui le reçoit.
 */

const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const euros = (n) => (n === null || n === undefined)
  ? '—'
  : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const nombre = (n, d = 2) => (n === null || n === undefined)
  ? '—'
  : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d })

const dateFr = (s) => {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? String(s) : d.toLocaleDateString('fr-FR')
}

/** Le pied de page légal, reconstruit champ par champ plutôt que recopié. */
export function piedDePage(entite) {
  if (!entite) return ''
  const l1 = [
    entite.raison_sociale,
    [entite.adresse, entite.code_postal, entite.ville].filter(Boolean).join(' '),
    entite.siret && `Siret : ${entite.siret}`,
    entite.naf && `NAF : ${entite.naf}`,
    entite.tva && `TVA : ${entite.tva}`,
  ].filter(Boolean).join(' - ')

  const l2 = [
    entite.rcs_ville && `RCS ${entite.rcs_ville} ${entite.rcs_numero || ''}`.trim(),
    entite.forme_juridique && (entite.capital === null || entite.capital === undefined
      ? entite.forme_juridique
      : `${entite.forme_juridique} au capital de ${euros(entite.capital)}`),
    entite.telephone && `Tél : ${entite.telephone}`,
    entite.email && `Email : ${entite.email}`,
  ].filter(Boolean).join(' - ')

  const l3 = [
    entite.assurance_nom && `Assurance décennale : ${entite.assurance_nom}`,
    entite.assurance_police && `police n° ${entite.assurance_police}`,
    entite.assurance_couverture,
  ].filter(Boolean).join(' — ')

  return [l1, l2, l3].filter(Boolean).map((l) => `<div>${e(l)}</div>`).join('')
}

/** Le bloc descriptif d'une opération : la fiche, ses mentions, puis le produit. */
function blocOperation(o, tauxDefaut) {
  const taux = o.taux_tva ?? tauxDefaut
  const totalLigne = (o.puv === null || o.puv === undefined)
    ? null
    : Number(o.puv) * Number(o.quantite ?? 1)

  const caracteristiques = [
    o.marque && ['Marque', o.marque],
    o.reference && ['Référence', o.reference],
    o.designation && ['Modèle', o.designation],
  ].filter(Boolean)

  return `
  <tr class="op">
    <td>
      <div class="op-titre">${e(o.fiche_libelle || o.fiche_code)}</div>
      <p class="op-legal">Opération entrant dans le dispositif de prime C.E.E. (Certificat d'Économie
      d'Énergie), conforme aux recommandations de la fiche technique
      n° <strong>${e(o.fiche_code)}</strong> décrite par le ministère de la Transition énergétique.</p>
      ${o.description ? `<p class="op-desc">${e(o.description)}</p>` : ''}
      <div class="op-chiffres">
        <div>kWh cumac : <strong>${nombre(o.volume_cumac, 0)}</strong></div>
        <div>Prime CEE : <strong>${euros(o.prime_beneficiaire)}</strong></div>
      </div>
      ${caracteristiques.length
        ? `<div class="op-carac">${caracteristiques
            .map(([k, v]) => `<div>${e(k)} : <strong>${e(v)}</strong></div>`).join('')}</div>`
        : ''}
      ${o.date_calcul ? '' : '<div class="op-alerte">Opération non valorisée — elle ne compte dans aucun total.</div>'}
    </td>
    <td class="num">${nombre(o.quantite, 2)}</td>
    <td class="num">${euros(o.puv)}</td>
    <td class="num">${euros(totalLigne)}</td>
    <td class="num">${taux === null || taux === undefined ? '—' : `${nombre(taux, 0)} %`}</td>
  </tr>`
}

/**
 * Le document complet.
 *
 * `numero` est passé par l'appelant : en prévisualisation il vaut null, et le document
 * porte alors la mention PROVISOIRE en clair. Un devis sans numéro qui ressemblerait à un
 * devis définitif est exactement le document qui finit signé par erreur.
 */
export function devisHtml({ dossier, entite, certifications = [], operations = [], totaux, anomalies = [] }, numero = null) {
  const provisoire = !numero
  // Le bandeau écrit déjà « DEVIS » : le titre ne le répète pas.
  const titre = numero || `PROVISOIRE — ${dossier.numero}`
  const client = dossier.client_raison_sociale
    || [dossier.client_prenom, dossier.client_nom].filter(Boolean).join(' ')
    || '—'

  const bloquants = anomalies.filter((a) => a.niveau === 'BLOQUANT')

  const rge = certifications.map((c) =>
    `${c.libelle}${c.numero ? ` n° ${c.numero}` : ''} (valable jusqu'au ${dateFr(c.date_fin)})`).join(' · ')

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>Devis ${e(titre)} — ${e(client)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 22mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
  .feuille { max-width: 190mm; margin: 0 auto; padding-bottom: 26mm; }
  .bloc-client { text-align: right; }
  .haut .droite { margin-top: 4px; }

  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .logo { max-height: 70px; max-width: 150px; }
  .logo-absent { font-size: 10px; color: #999; border: 1px dashed #ccc; padding: 18px 12px; }

  .bandeau { background: #8d8d8d; color: #fff; font-weight: 700; font-size: 13px;
             padding: 4px 8px; margin: 14px 0 6px; }
  .haut { display: flex; justify-content: space-between; gap: 24px; margin-top: 10px; }
  .haut .gauche { flex: 1; }
  .haut .droite { text-align: right; }
  .client-nom { font-size: 14px; font-weight: 700; }
  h2 { font-size: 12px; margin: 12px 0 3px; }

  table.detail { width: 100%; border-collapse: collapse; margin-top: 12px; }
  table.detail thead th { background: #8d8d8d; color: #fff; font-size: 11px; text-align: left;
                          padding: 4px 8px; font-weight: 700; }
  table.detail thead th.num, table.detail td.num { text-align: right; white-space: nowrap; }
  table.detail td { padding: 8px; vertical-align: top; border-bottom: 1px solid #eee; }
  tr.op { page-break-inside: avoid; }
  .op-titre { font-weight: 700; margin-bottom: 3px; }
  .op-legal, .op-desc { margin: 3px 0; font-size: 10px; }
  .op-chiffres { margin: 5px 0; }
  .op-carac { margin-top: 5px; font-size: 10px; }
  .op-alerte { margin-top: 5px; font-size: 10px; color: #a33; font-weight: 700; }

  .bas { display: flex; gap: 20px; margin-top: 16px; page-break-inside: avoid; }
  .signature { flex: 1; border: 1px solid #333; padding: 8px; min-height: 120px; }
  .signature .consigne { font-weight: 700; font-size: 11px; }
  .signature .aide { font-size: 9px; color: #555; }
  table.totaux { border-collapse: collapse; min-width: 210px; }
  table.totaux td { padding: 3px 6px; font-size: 11px; }
  table.totaux td.l { text-align: right; }
  table.totaux td.v { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.totaux tr.fort td { font-weight: 700; border-top: 1px solid #333; }
  table.totaux tr.reste td { font-weight: 700; border-top: 2px solid #111; font-size: 12px; }

  .termes { margin-top: 16px; font-size: 9.5px; page-break-inside: avoid; }
  .termes h3 { font-size: 11px; margin: 0 0 4px; }

  /* À l'écran le pied de page suit le texte ; à l'impression seulement il se fixe en bas
     de chaque page, dans la marge que la règle @page lui réserve. Le fixer aussi à l'écran le
     faisait chevaucher la fin du document dans le navigateur. */
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #ddd;
           text-align: center; font-size: 8px; color: #333; line-height: 1.35; }
  @media print {
    footer { position: fixed; bottom: 6mm; left: 0; right: 0; margin: 0; border: 0; }
    .feuille { padding-bottom: 0; }
  }

  .alerte { border: 2px solid #a33; background: #fdf0f0; color: #7a1f1f; padding: 10px 12px;
            margin-bottom: 14px; font-size: 11px; }
  .alerte h3 { margin: 0 0 6px; font-size: 12px; }
  .alerte ul { margin: 0; padding-left: 18px; }
  .filigrane { position: fixed; top: 45%; left: 0; right: 0; text-align: center;
               font-size: 62px; font-weight: 700; color: rgba(160,0,0,.10);
               transform: rotate(-22deg); pointer-events: none; z-index: 0; }
  @media print { .alerte { border-width: 1px; } }
</style>
</head>
<body>
${provisoire ? '<div class="filigrane">PROVISOIRE</div>' : ''}
<div class="feuille">

${bloquants.length ? `
  <div class="alerte">
    <h3>Ce devis ne peut pas être émis en l'état</h3>
    <ul>${bloquants.map((a) => `<li>${e(a.message)}</li>`).join('')}</ul>
  </div>` : ''}

  <header>
    <div>
      ${entite?.logo
        ? `<img class="logo" src="${e(entite.logo)}" alt="${e(entite.raison_sociale)}">`
        : `<div class="logo-absent">${e(entite?.raison_sociale || 'Société non choisie')}<br>logo non fourni</div>`}
    </div>
    <div class="bloc-client">
      <div class="client-nom">${e(client)}</div>
      ${dossier.client_siret ? `<div>Siret : ${e(dossier.client_siret)}</div>` : ''}
      ${dossier.site_adresse ? `<div>${e(dossier.site_adresse)}</div>` : ''}
      ${dossier.site_cp || dossier.site_ville
        ? `<div>${e(dossier.site_cp || '')} ${e(dossier.site_ville || '')}</div>` : ''}
      ${dossier.client_telephone ? `<div>Tél : ${e(dossier.client_telephone)}</div>` : ''}
      ${dossier.client_email ? `<div>Mail : ${e(dossier.client_email)}</div>` : ''}
    </div>
  </header>

  <div class="haut">
    <div class="gauche">
      <div class="bandeau">DEVIS ${e(titre)}</div>
      <div>Numéro client : ${e(dossier.numero)}</div>
      <div>Date : ${dateFr(dossier.date_proposition || new Date().toISOString())}</div>
      ${entite?.validite_jours ? `<div>Validité : ${e(entite.validite_jours)} jours</div>` : ''}

      <h2>ADRESSE DES TRAVAUX</h2>
      <div>${e(client)}</div>
      ${dossier.site_adresse ? `<div>${e(dossier.site_adresse)}</div>` : ''}
      <div>${e(dossier.site_cp || '')} ${e(dossier.site_ville || '')}</div>
      ${dossier.parcelle_cadastrale ? `<div>Parcelle cadastrale : ${e(dossier.parcelle_cadastrale)}</div>` : ''}
    </div>
    <div class="droite">
      ${entite ? `
        <div><strong>${e(entite.raison_sociale)}</strong></div>
        ${entite.adresse ? `<div>${e(entite.adresse)}</div>` : ''}
        <div>${e(entite.code_postal || '')} ${e(entite.ville || '')}</div>
        ${entite.siret ? `<div>Siret : ${e(entite.siret)}</div>` : ''}
        ${entite.representant_nom
          ? `<div>Représentée par ${e(entite.representant_nom)}${entite.representant_qualite ? `, ${e(entite.representant_qualite)}` : ''}</div>`
          : ''}
        ${rge ? `<div>${e(rge)}</div>` : ''}
      ` : ''}
    </div>
  </div>

  <table class="detail">
    <thead>
      <tr>
        <th>Détail</th>
        <th class="num">Quantité</th>
        <th class="num">P.U TTC</th>
        <th class="num">Total TTC</th>
        <th class="num">TVA</th>
      </tr>
    </thead>
    <tbody>
      ${operations.map((o) => blocOperation(o, entite?.taux_tva_defaut ?? null)).join('')}
    </tbody>
  </table>

  <div class="bas">
    <div class="signature">
      <div class="consigne">Signature, date, cachet commercial &amp; mention « Bon pour accord »</div>
      <div class="aide">Nom, prénom et fonction du signataire</div>
      <div style="height:78px"></div>
      ${entite?.conditions_reglement
        ? `<div class="aide">Mode de paiement : ${e(entite.conditions_reglement)}</div>` : ''}
    </div>
    <table class="totaux">
      <tr><td class="l">Total H.T</td><td class="v">${euros(totaux.ht)}</td></tr>
      ${totaux.tvas.map((t) =>
        `<tr><td class="l">Total TVA ${nombre(t.taux, 0)} %</td><td class="v">${euros(t.montant)}</td></tr>`).join('')}
      <tr class="fort"><td class="l">Total TTC</td><td class="v">${euros(totaux.ttc)}</td></tr>
      ${totaux.primeDeduite !== null
        ? `<tr><td class="l">* Prime CEE</td><td class="v">− ${euros(totaux.primeDeduite)}</td></tr>`
        : totaux.prime !== null
          ? `<tr><td class="l">Prime CEE versée à part</td><td class="v">${euros(totaux.prime)}</td></tr>`
          : ''}
      <tr class="reste"><td class="l">Reste à payer</td><td class="v">${euros(totaux.reste)}</td></tr>
    </table>
  </div>

  ${totaux.primeExcedentaire ? `
    <div class="alerte" style="margin-top:12px">
      La prime CEE calculée (${euros(totaux.prime)}) dépasse le montant des travaux
      (${euros(totaux.ttc)}) de ${euros(totaux.primeExcedentaire)}. La déduction est plafonnée au
      montant des travaux : le reste à payer est nul, il n'est pas négatif. À vérifier avant
      émission — soit le prix de vente est incomplet, soit la valorisation est à revoir.
    </div>` : ''}

  ${!totaux.complet ? `
    <div class="alerte" style="margin-top:12px">
      Totaux incomplets :
      ${totaux.lignesSansPrix ? `${totaux.lignesSansPrix} ligne(s) sans prix unitaire. ` : ''}
      ${totaux.lignesSansTaux ? `${totaux.lignesSansTaux} ligne(s) sans taux de TVA. ` : ''}
      Les montants affichés ne portent que sur les lignes chiffrées.
    </div>` : ''}

  <div class="termes">
    <h3>Termes et conditions CEE</h3>
    <p>* Prime n° ${e(dossier.numero)} liée à la valorisation des certificats d'économies d'énergie
    par ${e(dossier.delegataire_nom || '(délégataire non renseigné)')}${dossier.delegataire_oblige
      ? ` (mandataire de ${e(dossier.delegataire_oblige)})` : ''}, d'un montant de
    ${euros(totaux.prime)}. Ces informations seront reportées sur l'attestation sur l'honneur CEE.
    Sont indiquées également les coordonnées complètes du sous-traitant si l'installation a été
    sous-traitée, avec les informations de son attestation RGE.</p>
    <p>Le financement de cette opération par un énergéticien, grâce au dispositif des certificats
    d'économies d'énergie, est encadré par le ministère en charge de l'énergie. Des inspections
    post-travaux sont opérées fréquemment, par téléphone ou directement à domicile ; vous ne pouvez
    pas vous y opposer sans perdre le bénéfice de ce financement.</p>
    <p>Le montant de cette contribution financière, hors champ d'application de la TVA, est
    susceptible de varier en fonction des éléments techniques définitifs et des volumes CEE
    attribués à l'opération selon les modalités de calcul définies par la réglementation CEE.</p>
    <p>En acceptant ce devis, j'atteste n'avoir jamais bénéficié du dispositif correspondant à
    l'opération ci-dessus pour ce même logement.</p>
  </div>
</div>

<footer>${piedDePage(entite)}</footer>
</body>
</html>`
}
