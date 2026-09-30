/**
 * La facture adressée au délégataire pour un appel à paiement, en HTML imprimable.
 *
 * Une ligne par dossier : le délégataire rapproche chaque montant de sa propre liste. La
 * référence de son appel à facturation (AAF) figure en tête — c'est elle qu'il cherche pour
 * mettre la facture en paiement. Tant que la facture n'est pas émise, l'aperçu est barré.
 */
import { piedDePage } from './facture-html.js'

const e = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const euros = (n) => (n === null || n === undefined ? '—'
  : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`)
const kwh = (n) => (n === null || n === undefined ? '—' : Math.round(Number(n)).toLocaleString('fr-FR'))
const dateFr = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—')

/** @param x lireAppel(), @param entite la ligne entite_emettrice */
export function appelHtml(x, entite) {
  const emise = !!x.numero_facture
  const t = x.totaux
  const ht = emise ? x.total_ht : t.ht
  const tva = emise ? x.total_tva : t.tva
  const ttc = emise ? x.total_ttc : t.ttc
  const cumac = emise ? x.total_cumac : t.cumac
  const titre = emise ? `FACTURE ${x.numero_facture}` : 'FACTURE — PROJET NON ÉMIS'
  const pied = entite ? piedDePage({
    raison_sociale: entite.raison_sociale, entite_adresse: entite.adresse, entite_cp: entite.code_postal,
    entite_ville: entite.ville, entite_siret: entite.siret, naf: entite.naf, entite_tva: entite.tva,
    rcs_ville: entite.rcs_ville, rcs_numero: entite.rcs_numero, forme_juridique: entite.forme_juridique,
    capital: entite.capital, telephone: entite.telephone, email: entite.email,
  }) : ''

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<title>${e(titre)} — ${e(x.delegataire_nom)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 24mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 "Helvetica Neue", Arial, sans-serif; color: #111; margin: 0; }
  .feuille { max-width: 190mm; margin: 0 auto; padding-bottom: 26mm; }
  header { display: flex; justify-content: space-between; gap: 20px; }
  .logo { max-height: 70px; max-width: 150px; }
  .client { text-align: right; } .client b { font-size: 14px; }
  .bandeau { background: #8d8d8d; color: #fff; font-weight: 700; font-size: 14px; padding: 5px 9px; margin: 14px 0 6px; }
  table.detail { width: 100%; border-collapse: collapse; margin-top: 12px; }
  table.detail th { background: #8d8d8d; color: #fff; text-align: left; padding: 4px 6px; font-size: 10.5px; }
  table.detail td { padding: 5px 6px; border-bottom: 1px solid #eee; font-size: 10.5px; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .bas { display: flex; gap: 20px; margin-top: 14px; page-break-inside: avoid; }
  .reglement { flex: 1; font-size: 10.5px; }
  table.totaux { border-collapse: collapse; min-width: 230px; }
  table.totaux td { padding: 3px 6px; text-align: right; }
  table.totaux tr.fort td { font-weight: 700; border-top: 2px solid #111; font-size: 12.5px; }
  .mentions { margin-top: 16px; font-size: 9.5px; color: #333; border-top: 1px solid #ddd; padding-top: 8px; }
  .filigrane { position: fixed; top: 45%; left: 0; right: 0; text-align: center; font-size: 68px; font-weight: 700;
               color: rgba(140,60,60,.13); letter-spacing: 8px; transform: rotate(-18deg); pointer-events: none; }
  footer { margin-top: 18px; padding-top: 6px; border-top: 1px solid #ddd; text-align: center; font-size: 8px; line-height: 1.35; }
  @media print { footer { position: fixed; bottom: 6mm; left: 0; right: 0; margin: 0; border: 0; } .feuille { padding-bottom: 0; } }
</style></head>
<body>
${emise ? '' : '<div class="filigrane">NON ÉMISE</div>'}
<div class="feuille">
  <header>
    <div>${entite?.logo ? `<img class="logo" src="${e(entite.logo)}" alt="${e(entite.raison_sociale)}">` : `<b>${e(entite?.raison_sociale || 'Société non choisie')}</b>`}</div>
    <div class="client">
      <b>${e(x.delegataire_nom)}</b>
      ${x.delegataire_oblige ? `<div>Mandataire de ${e(x.delegataire_oblige)}</div>` : ''}
      ${x.delegataire_siren ? `<div>SIREN : ${e(x.delegataire_siren)}</div>` : ''}
    </div>
  </header>

  <div class="bandeau">${e(titre)}</div>
  <div>Date d'émission : ${emise ? dateFr(x.date_facture) : '—'}</div>
  <div><b>Appel à facturation : ${e(x.num_aaf || 'non renseigné')}${x.date_aaf ? ` du ${dateFr(x.date_aaf)}` : ''}</b></div>
  <div>Référence interne : ${e(x.numero)}${x.lot_numero ? ` · lot de dépôt ${e(x.lot_numero)}` : ''}</div>
  <div>Objet : primes dues au titre des certificats d'économies d'énergie des opérations ci-dessous — ${kwh(cumac)} kWh cumac.</div>

  <table class="detail">
    <thead><tr><th>Dossier</th><th>Bénéficiaire</th><th>Fiche</th><th class="num">kWh cumac</th><th class="num">Prime HT</th></tr></thead>
    <tbody>
      ${x.lignes.map((l) => `<tr><td>${e(l.numero)}</td><td>${e(l.client)}${l.siret ? ` <span style="color:#666">(${e(l.siret)})</span>` : ''}</td>
        <td>${e(l.fiche_code)}</td><td class="num">${kwh(l.cumac_valide)}</td><td class="num">${euros(l.prime_ht)}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="bas">
    <div class="reglement">
      ${entite?.conditions_reglement ? `<div><b>Règlement :</b> ${e(entite.conditions_reglement)}</div>` : ''}
      ${entite?.delai_paiement_jours ? `<div>Paiement à ${e(entite.delai_paiement_jours)} jours à compter de la date d'émission.</div>` : ''}
      ${x.reglement_iban ? `<div style="margin-top:6px">Virement${x.reglement_banque ? ` — ${e(x.reglement_banque)}` : ''} : IBAN <b>${e(x.reglement_iban)}</b>${x.reglement_bic ? ` · BIC ${e(x.reglement_bic)}` : ''}</div>` : ''}
    </div>
    <table class="totaux">
      <tr><td>Total H.T</td><td>${euros(ht)}</td></tr>
      <tr><td>TVA ${Number(x.taux_tva).toLocaleString('fr-FR')} %</td><td>${euros(tva)}</td></tr>
      <tr class="fort"><td>Net à payer TTC</td><td>${euros(ttc)}</td></tr>
    </table>
  </div>

  <div class="mentions">
    ${entite ? `En cas de retard de paiement, des pénalités seront appliquées au taux annuel de
    <b>${Number(entite.taux_penalites || 0).toLocaleString('fr-FR')} %</b>, exigibles sans qu'un rappel soit nécessaire.
    Une <b>indemnité forfaitaire de ${euros(entite.indemnite_recouvrement)}</b> pour frais de recouvrement sera également due
    (art. L.441-10 et D.441-5 du code de commerce). Aucun escompte n'est accordé pour paiement anticipé.` : ''}
  </div>
</div>
<footer>${pied}</footer>
</body></html>`
}
