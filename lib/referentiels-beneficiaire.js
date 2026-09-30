/** Champs modifiables du bénéficiaire, avec le libellé que retient le journal. */
export const CHAMPS_BENEFICIAIRE = {
  type: 'Type de bénéficiaire',
  raison_sociale: 'Raison sociale',
  siret: 'SIRET',
  code_ape: 'Code APE',
  civilite: 'Civilité',
  nom: 'Nom du signataire',
  prenom: 'Prénom du signataire',
  fonction: 'Fonction du signataire',
  email: 'E-mail',
  telephone: 'Téléphone',
  telephone_2: 'Second téléphone',
  adresse: 'Adresse du siège',
  code_postal: 'Code postal du siège',
  ville: 'Ville du siège',
  regime_revenu: 'Régime de revenu',
}

export const TYPES_BENEFICIAIRE = [['SOCIETE', 'Société'], ['PARTICULIER', 'Particulier']]

export const REGIMES_REVENU = [
  ['CLASSIQUE', 'Classique'],
  ['PRECAIRE', 'Précaire'],
  ['GRANDE_PRECARITE', 'Grande précarité'],
]

export const CIVILITES = [['M.', 'M.'], ['Mme', 'Mme']]
