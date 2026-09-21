/**
 * La facture, en HTML imprimable.
 *
 * Même parti que pour le devis : le navigateur sait écrire un PDF, inutile d'installer un
 * moteur de rendu sur le serveur pour un document d'une page.
 *
 * ── Ce que ce gabarit ne prend PAS dans la base courante ──
 *
 * Absolument rien. Tout vient de la facture telle qu'elle a été émise : le client, les
 * lignes, les totaux, les mentions, la société. C'est la règle qui fait qu'une facture
 * réimprimée dans deux ans est identique à celle qu'a reçue le client — même si le client
 * a déménagé, même si l'opération a été corrigée, même si la société a changé d'adresse.
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

/** Le pied de page légal, reconstruit depuis les champs de la société. */
function piedDePage(f) {
  const l1 = [
    f.raison_sociale,
    [f.entite_adresse, f.entite_cp, f.entite_ville].filter(Boolean).join(' '),
    f.entite_siret && `Siret : ${f.entite_siret}`,
    f.naf && `NAF : ${f.naf}`,
    f.entite_tva && `TVA : ${f.entite_tva}`,
  ].filter(Boolean).join(' - ')

  const l2 = [
    f.rcs_ville && `RCS ${f.rcs_ville} ${f.rcs_numero || ''}`.trim(),
    f.forme_juridique && (f.capital === null || f.capital === undefined
      ? f.forme_juridique
      : `${f.forme_juridique} au capital de ${euros(f.capital)}`),
    f.telephone && `Tél : ${f.telephone}`,
    f.email && `Email : ${f.email}`,
  ].filter(Boolean).join(' - ')

  const l3 = [
    f.assurance_nom && `Assurance décennale : ${f.assurance_nom}`,
    f.assurance_police && `police n° ${f.assurance_police}`,
    f.assurance_couverture,
  ].filter(Boolean).join(' — ')

  return [l1, l2, l3].filter(Boolean).map((l) => `<div>${e(l)}</div>`).join('')
}

/**
 * Le document.
 *
 * Un AVOIR est la même page, avec un titre différent, des montants négatifs et un renvoi
 * vers la facture qu'il annule. Le distinguer par un simple signe moins serait illisible :
 * le bandeau le dit en toutes lettres.
 */
export function factureHtml(f) {
  const estAvoir = f.type === 'AVOIR'
  // Une facture sans numéro n'a pas été émise : c'est un aperçu. Le dire en toutes lettres,
  // et le barrer d'un filigrane, évite qu'une impression de travail circule comme une vraie.
  const provisoire = !f.numero
  const titre = provisoire
    ? `${estAvoir ? 'AVOIR' : 'FACTURE'} — PROJET NON ÉMIS`
    : `${estAvoir ? 'AVOIR' : 'FACTURE'} ${f.numero}`

  // Les taux de TVA présents, recalculés depuis les LIGNES de la facture — pas depuis les
  // opérations, qui ont pu bouger depuis.
  const parTaux = new Map()
  for (const l of f.lignes) {
    const t = l.taux_tva
    if (t === null || t === undefined) continue
    parTaux.set(Number(t), (parTaux.get(Number(t)) || 0) + Number(l.total_ttc || 0))
  }
  const tvas = [...parTaux].sort((a, b) => a[0] - b[0]).map(([taux, ttc]) => {
    const ht = Math.round((ttc / (1 + taux / 100)) * 100) / 100
    return { taux, ht, montant: Math.round((ttc - ht) * 100) / 100 }
  })

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${e(titre)} — ${e(f.client_nom)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 24mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
  .feuille { max-width: 190mm; margin: 0 auto; padding-bottom: 26mm; }

  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; }
  .logo { max-height: 70px; max-width: 150px; }
  .logo-absent { font-size: 10px; color: #999; border: 1px dashed #ccc; padding: 18px 12px; }
  .bloc-client { text-align: right; }
  .client-nom { font-size: 14px; font-weight: 700; }

  .bandeau { background: ${estAvoir ? '#8a4b4b' : '#8d8d8d'}; color: #fff; font-weight: 700;
             font-size: 14px; padding: 5px 9px; margin: 14px 0 6px; }
  .haut { display: flex; justify-content: space-between; gap: 24px; margin-top: 10px; }
  .haut .gauche { flex: 1; }
  .haut .droite { text-align: right; margin-top: 4px; }
  h2 { font-size: 12px; margin: 12px 0 3px; }

  table.detail { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.detail thead th { background: #8d8d8d; color: #fff; font-size: 11px; text-align: left;
                          padding: 4px 8px; font-weight: 700; }
  table.detail thead th.num, table.detail td.num { text-align: right; white-space: nowrap; }
  table.detail td { padding: 7px 8px; vertical-align: top; border-bottom: 1px solid #eee; }
  tr.ligne { page-break-inside: avoid; }
  .ligne-titre { font-weight: 700; }
  .ligne-detail { font-size: 10px; color: #555; margin-top: 2px; }

  .bas { display: flex; gap: 20px; margin-top: 16px; page-break-inside: avoid; }
  .reglement { flex: 1; font-size: 10.5px; }
  table.totaux { border-collapse: collapse; min-width: 230px; }
  table.totaux td { padding: 3px 6px; font-size: 11px; }
  table.totaux td.l { text-align: right; }
  table.totaux td.v { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.totaux tr.fort td { font-weight: 700; border-top: 1px solid #333; }
  table.totaux tr.reste td { font-weight: 700; border-top: 2px solid #111; font-size: 12.5px; }

  .mentions { margin-top: 16px; font-size: 9.5px; color: #333; page-break-inside: avoid;
              border-top: 1px solid #ddd; padding-top: 8px; }
  .renvoi { border: 1px solid #8a4b4b; background: #fbf2f2; color: #6b2323; padding: 8px 10px;
            margin: 10px 0; font-size: 11px; }
  .filigrane { position: fixed; top: 45%; left: 0; right: 0; text-align: center;
               font-size: 68px; font-weight: 700; color: rgba(140,60,60,.13);
               letter-spacing: 8px; transform: rotate(-18deg); pointer-events: none; z-index: 99; }

  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #ddd;
           text-align: center; font-size: 8px; color: #333; line-height: 1.35; }
  @media print {
    footer { position: fixed; bottom: 6mm; left: 0; right: 0; margin: 0; border: 0; }
    .feuille { padding-bottom: 0; }
  }
</style>
</head>
<body>
${provisoire ? '<div class="filigrane">NON ÉMISE</div>' : ''}
<div class="feuille">
  <header>
    <div>
      ${f.logo
        ? `<img class="logo" src="${e(f.logo)}" alt="${e(f.raison_sociale)}">`
        : `<div class="logo-absent">${e(f.raison_sociale)}<br>logo non fourni</div>`}
    </div>
    <div class="bloc-client">
      <div class="client-nom">${e(f.client_nom)}</div>
      ${f.client_siret ? `<div>Siret : ${e(f.client_siret)}</div>` : ''}
      ${f.client_adresse ? `<div>${e(f.client_adresse)}</div>` : ''}
      <div>${e(f.client_code_postal || '')} ${e(f.client_ville || '')}</div>
      ${f.client_tva ? `<div>TVA : ${e(f.client_tva)}</div>` : ''}
    </div>
  </header>

  ${f.annulee ? `
    <div class="renvoi">
      Le présent avoir annule la facture <b>${e(f.annulee.numero)}</b> du ${dateFr(f.annulee.date_emission)}.
    </div>` : ''}
  ${f.avoir ? `
    <div class="renvoi">
      Cette facture a été annulée par l'avoir <b>${e(f.avoir.numero)}</b> du ${dateFr(f.avoir.date_emission)}.
    </div>` : ''}

  <div class="haut">
    <div class="gauche">
      <div class="bandeau">${e(titre)}</div>
      <div>Dossier : ${e(f.dossier_numero)}</div>
      ${f.num_devis ? `<div>Devis : ${e(f.num_devis)}</div>` : ''}
      <div>Date d'émission : ${dateFr(f.date_emission)}</div>
      <div>Date de la prestation : ${dateFr(f.date_prestation)}</div>
      ${estAvoir ? '' : `<div><b>Échéance de règlement : ${dateFr(f.date_echeance)}</b></div>`}
    </div>
    <div class="droite">
      <div><strong>${e(f.raison_sociale)}</strong></div>
      ${f.entite_adresse ? `<div>${e(f.entite_adresse)}</div>` : ''}
      <div>${e(f.entite_cp || '')} ${e(f.entite_ville || '')}</div>
      ${f.entite_siret ? `<div>Siret : ${e(f.entite_siret)}</div>` : ''}
      ${f.representant_nom
        ? `<div>Représentée par ${e(f.representant_nom)}${f.representant_qualite ? `, ${e(f.representant_qualite)}` : ''}</div>`
        : ''}
    </div>
  </div>

  <table class="detail">
    <thead>
      <tr>
        <th>Désignation</th>
        <th class="num">Quantité</th>
        <th class="num">P.U TTC</th>
        <th class="num">Total TTC</th>
        <th class="num">TVA</th>
      </tr>
    </thead>
    <tbody>
      ${f.lignes.map((l) => `
      <tr class="ligne">
        <td>
          <div class="ligne-titre">${e(l.designation)}</div>
          ${l.detail ? `<div class="ligne-detail">${e(l.detail)}</div>` : ''}
        </td>
        <td class="num">${nombre(l.quantite)} ${e(l.unite || '')}</td>
        <td class="num">${euros(l.prix_unitaire_ttc)}</td>
        <td class="num">${euros(l.total_ttc)}</td>
        <td class="num">${l.taux_tva === null || l.taux_tva === undefined ? '—' : `${nombre(l.taux_tva, 0)} %`}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <div class="bas">
    <div class="reglement">
      ${f.conditions_reglement
        // Sur un avoir, ce champ porte le MOTIF de l'annulation, pas des conditions de
        // paiement. L'étiqueter « Règlement » ferait lire une raison d'annuler comme une
        // modalité de virement.
        ? `<div><b>${estAvoir ? 'Motif' : 'Règlement'} :</b> ${e(f.conditions_reglement)}</div>`
        : ''}
      ${estAvoir ? '' : `<div style="margin-top:6px"><b>À régler avant le ${dateFr(f.date_echeance)}.</b></div>`}
    </div>
    <table class="totaux">
      <tr><td class="l">Total H.T</td><td class="v">${euros(f.total_ht)}</td></tr>
      ${tvas.map((t) =>
        `<tr><td class="l">TVA ${nombre(t.taux, 0)} %</td><td class="v">${euros(t.montant)}</td></tr>`).join('')}
      <tr class="fort"><td class="l">Total TTC</td><td class="v">${euros(f.total_ttc)}</td></tr>
      ${f.prime_deduite !== null && f.prime_deduite !== undefined
        ? `<tr><td class="l">Prime CEE déduite</td><td class="v">${Number(f.prime_deduite) >= 0 ? '− ' : '+ '}${euros(Math.abs(f.prime_deduite))}</td></tr>`
        : ''}
      <tr class="reste">
        <td class="l">${estAvoir ? 'Montant de l\'avoir' : 'Net à payer'}</td>
        <td class="v">${euros(f.reste_a_payer)}</td>
      </tr>
    </table>
  </div>

  <!-- Les mentions que la loi impose entre professionnels -->
  <div class="mentions">
    <p style="margin:0 0 4px">
      En cas de retard de paiement, des pénalités seront appliquées au taux annuel de
      <b>${nombre(f.taux_penalites, 2)} %</b>, exigibles sans qu'un rappel soit nécessaire.
      Une <b>indemnité forfaitaire de ${euros(f.indemnite_recouvrement)}</b> pour frais de
      recouvrement sera également due (art. L.441-10 et D.441-5 du code de commerce).
      Aucun escompte n'est accordé pour paiement anticipé.
    </p>
    ${f.delegataire_nom ? `
    <p style="margin:4px 0 0">
      Opération valorisée au titre des certificats d'économies d'énergie par
      ${e(f.delegataire_nom)}${f.delegataire_oblige ? ` (mandataire de ${e(f.delegataire_oblige)})` : ''}.
      Le montant de la contribution financière est hors du champ d'application de la TVA.
    </p>` : ''}
  </div>
</div>

<footer>${piedDePage(f)}</footer>
</body>
</html>`
}
