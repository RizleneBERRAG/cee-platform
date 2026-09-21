/**
 * Export d'un lot de dépôt.
 *
 * Le format attendu par le registre EMMY n'étant pas public, la sortie reprend
 * les colonnes d'un tableau récapitulatif d'opérations standardisées : une ligne
 * par dossier, les identifiants du bénéficiaire et du site, la fiche et sa version,
 * le volume cumac et les montants figés. Le mapping vers le gabarit exact du
 * délégataire se fait en renommant les en-têtes, sans toucher au code.
 */
import { dossiersDuLot, lot } from './queries.js'
import { completude } from './documents.js'

const COLONNES = [
  ['numero', 'N° dossier'],
  ['ref_externe', 'Référence externe'],
  ['fiche_code', 'Fiche'],
  ['fv_version', 'Version de fiche'],
  ['charte', 'Charte'],
  ['raison_sociale', 'Bénéficiaire'],
  ['siret', 'SIRET'],
  ['regime_revenu', 'Régime'],
  ['avec_mpr', 'MaPrimeRénov'],
  ['adresse_site', 'Adresse du site'],
  ['code_postal', 'Code postal'],
  ['ville', 'Ville'],
  ['departement', 'Département'],
  ['zone_climatique', 'Zone climatique'],
  ['secteur_activite', "Secteur d'activité"],
  ['quantite', 'Quantité'],
  ['unite_variable', 'Unité'],
  ['volume_cumac', 'Volume cumac (kWh)'],
  ['date_engagement', "Date d'engagement"],
  ['date_pose', 'Date de pose'],
  ['date_achevement', "Date d'achèvement"],
  ['delegataire_nom', 'Délégataire'],
  ['prime_delegataire', 'Versé par le délégataire (€)'],
  ['prime_beneficiaire', 'Prime bénéficiaire (€)'],
  ['commission_installateur', 'Commission installateur (€)'],
  ['marge_nette', 'Marge nette (€)'],
  ['completude', 'Complétude des pièces (%)'],
  ['unite_nom', "Unité d'affaire"],
]

const echappe = (v) => {
  if (v == null) return ''
  const s = String(v)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvDuLot(lotId) {
  const l = lot(lotId)
  const dossiers = dossiersDuLot(lotId)

  const lignes = dossiers.map((d) => {
    const comp = completude(d)
    const ligne = {
      ...d,
      adresse_site: d.adresse,
      avec_mpr: d.avec_mpr ? 'oui' : 'non',
      charte: d.charte === 'CDP' ? 'Coup de pouce' : 'Hors coup de pouce',
      regime_revenu: d.regime_revenu === 'PRECAIRE' ? 'Précaire' : 'Classique',
      completude: comp.sansLiasse ? '' : comp.tauxComplet,
    }
    return COLONNES.map(([cle]) => echappe(ligne[cle])).join(';')
  })

  // Point-virgule et BOM : Excel en français ouvre le fichier sans manipulation.
  const entetes = COLONNES.map(([, label]) => echappe(label)).join(';')
  return {
    nomFichier: `${l?.numero || 'lot'}-depot.csv`,
    contenu: '﻿' + [entetes, ...lignes].join('\r\n') + '\r\n',
    nbLignes: lignes.length,
  }
}
