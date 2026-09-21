/**
 * Listes fermées du parcours commercial.
 *
 * Elles remplacent des champs libres. « Source » était un texte : le même canal s'écrivait
 * « call center », « CallCenter » et « CC », et aucun décompte n'était possible. Une liste
 * fermée coûte une contrainte à la saisie et rend la question « quel canal rapporte le plus
 * de marge » enfin calculable.
 */

/**
 * Les rôles qui interviennent sur un dossier, dans l'ordre du parcours.
 *
 * `commissionne` marque ceux pour qui un taux a un sens. Il reste **indicatif** : la
 * commission qui entre dans la marge est celle portée par l'opération. Afficher un taux
 * ici sans qu'il calcule quoi que ce soit serait trompeur, donc l'écran le dit.
 */
export const ROLES_INTERVENANT = [
  ['APPORTEUR', "Apporteur d'affaires", true],
  ['TELE_OPERATEUR', 'Télé-opérateur', false],
  ['CONFIRMATEUR', 'Confirmateur de RDV', false],
  ['COMMERCIAL_TERRAIN', 'Commercial terrain', true],
  ['COMMERCIAL', 'Commercial sédentaire', true],
  ['RESP_COMMERCIALE', 'Responsable commercial', false],
  ['MANAGER', 'Manager', false],
  ['PREVISITEUR', 'Prévisiteur technique', false],
]

export const TYPES_LEAD = [
  ['FORM', 'Formulaire web'],
  ['APPEL_ENTRANT', 'Appel entrant'],
  ['PARRAINAGE', 'Parrainage'],
  ['CALL_CENTER', 'Call center'],
  ['PORTE_A_PORTE', 'Porte-à-porte'],
  ['STAND', 'Stand / foire'],
  ['FRONT_OFFICE', 'Front office'],
  ['BACK_OFFICE', 'Back office'],
  ['MAIL', 'Mail'],
  ['TRANSFERT_CHAUD', 'Transfert à chaud'],
]

/**
 * États d'un devis.
 *
 * `ORIGINAL_RECU_NON_CONFORME` n'est pas une subtilité : un original reçu mais non conforme
 * est la première cause de dossier bloqué au dépôt. Le distinguer de « reçu » permet de le
 * relancer au lieu de le découvrir six mois plus tard.
 */
export const ETATS_DEVIS = [
  ['A_EDITER', 'À éditer'],
  ['A_SIGNER', 'À signer'],
  ['SIGNE', 'Signé'],
  ['ANNULE', 'Annulé'],
  ['ORIGINAL_RECU', 'Original reçu'],
  ['ORIGINAL_RECU_NON_CONFORME', 'Original reçu non conforme'],
]

const libelle = (liste, v) => liste.find(([k]) => k === v)?.[1] ?? null
export const libelleRole = (v) => libelle(ROLES_INTERVENANT, v)
export const libelleTypeLead = (v) => libelle(TYPES_LEAD, v)
export const libelleEtatDevis = (v) => libelle(ETATS_DEVIS, v)
export const roleCommissionne = (v) => !!ROLES_INTERVENANT.find(([k]) => k === v)?.[2]

/** Valide contre une liste fermée. Renvoie null plutôt qu'une valeur inventée. */
export function valeurDe(liste, v) {
  const s = String(v ?? '').trim()
  if (!s) return null
  return liste.some(([k]) => k === s) ? s : null
}

/**
 * Incohérences du parcours commercial.
 *
 * Ce ne sont pas des erreurs de saisie mais des **trous de suivi** : chacune correspond à
 * un dossier qui va rester bloqué sans que personne ne s'en aperçoive. Les signaler à
 * l'écran vaut mieux qu'un tableau de bord qu'on regarde une fois par mois.
 *
 * @returns {Array<{gravite:'ERREUR'|'ATTENTION', message:string}>}
 */
export function anomaliesCommerciales(d) {
  const out = []
  const j = (v) => (v ? String(v).slice(0, 10) : null)
  const fr = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : null)

  const proposition = j(d?.date_proposition)
  const signature = j(d?.date_signature)
  const planifie = j(d?.date_rdv_planifie)
  const visite = j(d?.date_rdv_visite)

  if (proposition && signature && signature < proposition) {
    out.push({
      gravite: 'ERREUR',
      message: `Le devis est signé le ${fr(signature)}, avant d'avoir été proposé le ${fr(proposition)}. ` +
        `L'une des deux dates est fausse — et c'est la date de signature qui fait foi pour la version de fiche applicable.`,
    })
  }
  if (planifie && visite && visite < planifie) {
    out.push({
      gravite: 'ERREUR',
      message: `Le rendez-vous est visité le ${fr(visite)}, avant d'avoir été planifié le ${fr(planifie)}.`,
    })
  }
  if (d?.etat_devis === 'SIGNE' && !signature) {
    out.push({
      gravite: 'ATTENTION',
      message: 'Le devis est marqué signé mais sans date de signature. ' +
        "C'est cette date qui détermine l'arrêté applicable : sans elle, l'éligibilité n'est pas défendable.",
    })
  }
  if (d?.etat_devis === 'ORIGINAL_RECU_NON_CONFORME') {
    out.push({
      gravite: 'ATTENTION',
      message: "L'original reçu est non conforme. Tant qu'il n'est pas régularisé, le dossier sera refusé au dépôt.",
    })
  }
  if (d?.rdv_confirme && !d?.date_confirmation) {
    out.push({
      gravite: 'ATTENTION',
      message: 'Le rendez-vous est marqué confirmé sans date de confirmation.',
    })
  }
  return out
}
