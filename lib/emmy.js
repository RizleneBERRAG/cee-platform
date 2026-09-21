/**
 * L'export de dépôt : le tableau récapitulatif des opérations.
 *
 * ── Ce que je sais, et ce que je ne sais pas ──
 *
 * L'arrêté du 4 septembre 2014 (annexe 6) fixe les INFORMATIONS qu'une demande de CEE doit
 * porter, opération par opération. Je les ai relevées dans le texte de l'arrêté. En
 * revanche, la disposition exacte du tableau — l'ordre des colonnes, leurs intitulés au
 * caractère près — vit dans les annexes 6-1 et 6-2, que je n'ai pas pu obtenir : Légifrance
 * refuse la consultation automatisée, et les reprises de l'arrêté que j'ai trouvées ne les
 * reproduisent pas.
 *
 * Je ne l'invente donc pas. Ce fichier définit les CHAMPS (leur contenu, leur format, leur
 * caractère obligatoire), pas une feuille de calcul officielle. Le tableau qui part
 * réellement en dépôt est celui du délégataire : c'est lui qui fournit son gabarit, et
 * `delegataire.gabarit_export` l'exprime en correspondances « leur intitulé → notre champ ».
 * Sans gabarit, l'export sort avec les intitulés de l'annexe 6, utilisables pour relire et
 * pour recopier, pas pour déposer tel quel.
 *
 * ── Pourquoi l'export contrôle avant d'écrire ──
 *
 * Une demande incomplète n'est pas refusée le jour du dépôt : elle revient des semaines
 * plus tard, après instruction, et le volume est immobilisé pendant ce temps. Une colonne
 * vide dans un fichier a donc un coût très supérieur à un refus immédiat. L'export énumère
 * ligne par ligne ce qui manque, et le refuse quand un champ obligatoire est absent — à
 * moins qu'on demande explicitement la sortie incomplète, pour travailler dessus.
 *
 * ── Les formats, qui ne sont pas négociables ──
 *
 * Dates en jj/mm/aaaa, volumes en kWh cumac entiers, SIREN à 9 chiffres, SIRET à 14. Un
 * SIRET tronqué par un tableur ayant lu « 0824... » comme un nombre est une cause classique
 * de rejet : les identifiants sortent donc en texte, jamais en nombre.
 */

/** Une date ISO (aaaa-mm-jj) rendue au format du registre. */
export function dateFr(v) {
  if (!v) return null
  const s = String(v).slice(0, 10)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

/** Les chiffres d'un identifiant, sans espaces ni ponctuation. */
const chiffres = (v) => (v == null ? null : String(v).replace(/\D/g, '') || null)

export const siretValide = (v) => chiffres(v)?.length === 14
export const sirenValide = (v) => chiffres(v)?.length === 9

/** Le SIREN contenu dans un SIRET, quand seul le SIRET est connu. */
export const sirenDeSiret = (v) => (siretValide(v) ? chiffres(v).slice(0, 9) : null)

const entier = (v) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v)))
const deuxDecimales = (v) =>
  (v === null || v === undefined || v === '' ? null : (Math.round(Number(v) * 100) / 100).toFixed(2))

/**
 * Les champs du tableau récapitulatif.
 *
 * `obligatoire` peut être `true`, `false`, ou une fonction qui décide au cas par cas : le
 * sous-traitant n'est exigé que « lorsque la fiche d'opération standardisée le mentionne »,
 * le nom d'une personne physique ne s'applique pas à une société, et ainsi de suite.
 *
 * `valeur` ne devine jamais. Un champ que la plateforme ne porte pas rend `null`, et le
 * contrôle le signale — il ne rend pas une chaîne vide qui passerait inaperçue.
 */
export const CHAMPS = [
  {
    code: 'reference_emmy', libelle: 'Référence EMMY de la demande', obligatoire: false,
    valeur: (l) => l.lot?.reference_emmy || null,
    aide: "Attribuée par le registre à l'ouverture de la demande ; à saisir sur le lot.",
  },
  {
    code: 'reference_interne', libelle: "Référence interne de l'opération", obligatoire: true,
    valeur: (l) => l.d.numero || null,
  },
  {
    code: 'fiche', libelle: "Référence de la fiche d'opération standardisée", obligatoire: true,
    valeur: (l) => l.d.fiche_code || null,
  },
  {
    code: 'beneficiaire_nom', libelle: 'Nom du bénéficiaire', obligatoire: true,
    valeur: (l) => l.d.raison_sociale
      || [l.d.beneficiaire_prenom, l.d.beneficiaire_nom].filter(Boolean).join(' ') || null,
  },
  {
    code: 'beneficiaire_siret', libelle: 'SIRET du bénéficiaire', obligatoire: (l) => !!l.d.raison_sociale,
    valeur: (l) => chiffres(l.d.siret),
    controle: (v) => (v && !siretValide(v) ? `SIRET de ${String(v).length} chiffres — il en faut 14` : null),
    aide: "Exigé pour un bénéficiaire personne morale ; sans objet pour un particulier.",
  },
  {
    code: 'beneficiaire_telephone', libelle: 'Téléphone du bénéficiaire', obligatoire: false,
    valeur: (l) => l.d.telephone || null,
  },
  {
    code: 'beneficiaire_email', libelle: 'Courriel du bénéficiaire', obligatoire: false,
    valeur: (l) => l.d.email || null,
  },
  {
    code: 'adresse_travaux', libelle: 'Adresse des travaux', obligatoire: true,
    valeur: (l) => l.d.adresse || null,
  },
  { code: 'code_postal', libelle: 'Code postal', obligatoire: true, valeur: (l) => l.d.code_postal || null },
  { code: 'ville', libelle: 'Commune', obligatoire: true, valeur: (l) => l.d.ville || null },
  {
    code: 'date_engagement', libelle: "Date d'engagement de l'opération", obligatoire: true,
    valeur: (l) => dateFr(l.d.date_engagement),
    aide: "Date de signature du devis. C'est elle qui détermine la version de fiche applicable.",
  },
  {
    code: 'date_achevement', libelle: "Date d'achèvement de l'opération", obligatoire: true,
    valeur: (l) => dateFr(l.d.date_achevement || l.d.date_pose),
  },
  {
    code: 'date_facture', libelle: 'Date de la facture', obligatoire: true,
    valeur: (l) => dateFr(l.facture?.date_emission),
    aide: "Reprise de la facture émise dans la plateforme ; sinon, à émettre.",
  },
  {
    code: 'volume_cumac', libelle: "Volume de certificats (kWh cumac)", obligatoire: true,
    valeur: (l) => entier(l.d.volume_cumac),
    controle: (v) => (v !== null && v <= 0 ? 'volume nul ou négatif' : null),
  },
  {
    code: 'professionnel_siren', libelle: 'SIREN du professionnel ayant réalisé les travaux', obligatoire: true,
    valeur: (l) => chiffres(l.installateur?.siret ? sirenDeSiret(l.installateur.siret) : null)
      || chiffres(l.entite?.siren),
    controle: (v) => (v && !sirenValide(v) ? `SIREN de ${String(v).length} chiffres — il en faut 9` : null),
  },
  {
    code: 'professionnel_raison_sociale', libelle: 'Raison sociale du professionnel', obligatoire: true,
    valeur: (l) => l.installateur?.raison_sociale || l.entite?.raison_sociale || null,
  },
  {
    code: 'professionnel_siret', libelle: "SIRET de l'entreprise ayant réalisé l'opération", obligatoire: true,
    valeur: (l) => chiffres(l.installateur?.siret) || chiffres(l.entite?.siret),
    controle: (v) => (v && !siretValide(v) ? `SIRET de ${String(v).length} chiffres — il en faut 14` : null),
  },
  {
    code: 'sous_traitant_siren', libelle: 'SIREN du sous-traitant', obligatoire: false,
    valeur: (l) => chiffres(l.d.sous_traitant_siren),
    controle: (v) => (v && !sirenValide(v) ? `SIREN de ${String(v).length} chiffres — il en faut 9` : null),
    aide: "À renseigner seulement si la fiche d'opération standardisée le prévoit.",
  },
  {
    code: 'sous_traitant_raison_sociale', libelle: 'Raison sociale du sous-traitant', obligatoire: false,
    valeur: (l) => l.d.sous_traitant_raison_sociale || null,
  },
  {
    code: 'controle_organisme', libelle: "Raison sociale de l'organisme de contrôle", obligatoire: false,
    valeur: (l) => l.controle?.bureau_nom || null,
  },
  {
    code: 'controle_date', libelle: 'Date du contrôle', obligatoire: false,
    valeur: (l) => dateFr(l.controle?.date),
  },
  {
    code: 'role_actif_nature', libelle: 'Nature du rôle actif et incitatif', obligatoire: true,
    valeur: (l) => (l.d.prime_beneficiaire === null || l.d.prime_beneficiaire === undefined
      ? null
      : (l.d.destinataire_prime === 'INSTALLATEUR'
        ? "Prime versée à l'installateur et déduite de la facture du bénéficiaire"
        : 'Prime versée au bénéficiaire')),
  },
  {
    code: 'role_actif_montant', type: 'montant', libelle: 'Montant du rôle actif et incitatif (€)', obligatoire: true,
    valeur: (l) => deuxDecimales(l.d.prime_beneficiaire),
  },
  {
    code: 'bonification', libelle: 'Nature de la bonification', obligatoire: false,
    valeur: (l) => (l.d.charte === 'CDP' ? 'Coup de pouce' : null),
  },
  {
    code: 'mandataire', libelle: 'Mandataire assurant le rôle actif et incitatif', obligatoire: false,
    valeur: (l) => l.d.delegataire_nom || null,
  },
  {
    code: 'cout_operation', type: 'montant', libelle: "Coût de l'opération (€ TTC)", obligatoire: true,
    // Le coût déclaré au registre et le montant facturé au client sont le même chiffre. Le
    // relire sur la facture émise, plutôt que de le ressaisir, supprime la seule façon de
    // les faire diverger.
    valeur: (l) => deuxDecimales(
      l.d.cout_operation ?? (l.facture ? l.facture.total_ttc : null)),
    aide: "Repris de la facture émise ; une saisie sur le dossier le remplace.",
  },
  {
    code: 'aides_hors_cee', type: 'montant', libelle: 'Aides financières hors CEE (€)', obligatoire: false,
    valeur: (l) => deuxDecimales(l.d.aides_hors_cee),
    aide: "MaPrimeRénov' comprise. Zéro se saisit : laisser vide ne veut pas dire « aucune ».",
  },
  {
    code: 'nb_logements', libelle: 'Nombre de logements', obligatoire: false,
    valeur: (l) => entier(l.d.nb_logements),
  },
  {
    code: 'commentaires', libelle: 'Commentaires', obligatoire: false,
    valeur: (l) => l.d.ref_externe || null,
  },
]

const CHAMPS_PAR_CODE = new Map(CHAMPS.map((c) => [c.code, c]))

/** Les données brutes d'une ligne de dépôt, rassemblées sans rien calculer. */
export function ligneDepot(db, dossierId) {
  const d = db.prepare(`
    SELECT d.*, b.raison_sociale, b.siret, b.email, b.telephone, b.regime_revenu,
           b.nom AS beneficiaire_nom, b.prenom AS beneficiaire_prenom,
           s.adresse, s.code_postal, s.ville,
           f.code AS fiche_code,
           dg.nom AS delegataire_nom
      FROM dossier d
      JOIN beneficiaire b ON b.id = d.beneficiaire_id
      JOIN site s ON s.id = d.site_id
      JOIN fiche f ON f.id = d.fiche_id
      LEFT JOIN delegataire dg ON dg.id = d.delegataire_id
     WHERE d.id = ?`).get(dossierId)
  if (!d) return null

  const lot = d.lot_id ? db.prepare('SELECT * FROM lot WHERE id = ?').get(d.lot_id) : null
  const installateur = d.installateur_id
    ? db.prepare('SELECT * FROM installateur_rge WHERE id = ?').get(d.installateur_id)
    : null
  const entite = d.entite_id
    ? db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(d.entite_id)
    : db.prepare('SELECT * FROM entite_emettrice WHERE par_defaut = 1 AND actif = 1').get() || null

  // La facture qui fait foi est celle qui n'a pas été annulée par un avoir.
  const facture = db.prepare(`
    SELECT f.* FROM facture f
     WHERE f.dossier_id = ? AND f.type = 'FACTURE'
       AND NOT EXISTS (SELECT 1 FROM facture a WHERE a.annule_facture_id = f.id)
     ORDER BY f.cree_le DESC LIMIT 1`).get(dossierId) || null

  const controle = db.prepare(`
    SELECT c.*, bc.nom AS bureau_nom
      FROM controle c LEFT JOIN bureau_controle bc ON bc.id = c.bureau_controle_id
     WHERE c.dossier_id = ? AND c.resultat IS NOT NULL
     ORDER BY c.passage DESC LIMIT 1`).get(dossierId) || null

  return { d, lot, installateur, entite, facture, controle }
}

/**
 * Les valeurs d'une ligne, champ par champ, avec ce qui manque.
 *
 * Rien n'est remplacé par une valeur par défaut : un champ absent reste `null` et se
 * retrouve dans `manquants`. C'est la seule façon qu'une colonne vide se remarque.
 */
export function valeursLigne(source) {
  const valeurs = {}
  const manquants = []
  const anomalies = []

  for (const c of CHAMPS) {
    let v = null
    try { v = c.valeur(source) } catch { v = null }
    if (v === '' ) v = null
    valeurs[c.code] = v

    const exige = typeof c.obligatoire === 'function' ? !!c.obligatoire(source) : !!c.obligatoire
    if (exige && (v === null || v === undefined)) {
      manquants.push({ champ: c.code, libelle: c.libelle, aide: c.aide || null })
    }
    if (v !== null && v !== undefined && c.controle) {
      const motif = c.controle(v)
      if (motif) anomalies.push({ champ: c.code, libelle: c.libelle, motif })
    }
  }

  return { valeurs, manquants, anomalies }
}

/**
 * Le gabarit d'un délégataire, ou celui de l'annexe 6 à défaut.
 *
 * Un gabarit illisible ou qui désigne un champ inconnu n'est pas appliqué à moitié : on
 * retombe sur les intitulés de l'annexe et on le DIT. Un export dont une colonne sur trois
 * serait silencieusement vide serait pire qu'un export au mauvais format.
 */
export function gabarit(delegataire) {
  const parDefaut = CHAMPS.map((c) => ({ colonne: c.libelle, champ: c.code }))
  if (!delegataire?.gabarit_export) return { colonnes: parDefaut, source: 'ANNEXE_6', avertissement: null }

  let brut
  try { brut = JSON.parse(delegataire.gabarit_export) } catch {
    return {
      colonnes: parDefaut, source: 'ANNEXE_6',
      avertissement: `Le gabarit enregistré pour ${delegataire.nom} n'est pas un JSON lisible. `
        + `L'export sort avec les intitulés de l'annexe 6.`,
    }
  }
  if (!Array.isArray(brut) || brut.length === 0) {
    return {
      colonnes: parDefaut, source: 'ANNEXE_6',
      avertissement: `Le gabarit de ${delegataire.nom} est vide. L'export sort avec les intitulés de l'annexe 6.`,
    }
  }

  const inconnus = brut.filter((x) => x.champ && !CHAMPS_PAR_CODE.has(x.champ)).map((x) => x.champ)
  if (inconnus.length) {
    return {
      colonnes: parDefaut, source: 'ANNEXE_6',
      avertissement: `Le gabarit de ${delegataire.nom} désigne des champs inconnus `
        + `(${inconnus.join(', ')}). L'export sort avec les intitulés de l'annexe 6 plutôt `
        + `qu'avec des colonnes vides.`,
    }
  }

  return {
    colonnes: brut.map((x) => ({ colonne: x.colonne || x.champ, champ: x.champ || null })),
    source: 'GABARIT',
    avertissement: null,
  }
}

/** Le tableau complet d'un lot, prêt à être mis en forme — et ce qui l'empêche de partir. */
export function tableauDepot(db, lotId) {
  const lot = db.prepare('SELECT * FROM lot WHERE id = ?').get(lotId)
  if (!lot) return null

  const delegataire = lot.delegataire_id
    ? db.prepare('SELECT * FROM delegataire WHERE id = ?').get(lot.delegataire_id)
    : null
  const g = gabarit(delegataire)

  const ids = db.prepare('SELECT id FROM dossier WHERE lot_id = ? ORDER BY numero').all(lotId)
  const lignes = ids.map(({ id }) => {
    const source = ligneDepot(db, id)
    // Le lot du dossier et le lot demandé sont le même : on passe la référence EMMY du lot
    // demandé, pour qu'un dossier rattaché à l'instant ne sorte pas sans référence.
    if (source) source.lot = source.lot || lot
    const r = source ? valeursLigne(source) : { valeurs: {}, manquants: [], anomalies: [] }
    return { id, numero: source?.d.numero || id, ...r }
  })

  const incomplets = lignes.filter((l) => l.manquants.length)
  return {
    lot, delegataire, gabarit: g, lignes,
    incomplets: incomplets.length,
    deposable: incomplets.length === 0,
    avertissements: [g.avertissement].filter(Boolean),
  }
}

const echappe = (v) => {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Le fichier.
 *
 * Point-virgule et BOM parce qu'Excel français ouvre alors le fichier sans manipulation.
 * Les identifiants sortent préfixés d'un `="…"` quand on demande la protection tableur :
 * sans cela Excel lit « 0824080782 » comme un nombre, perd le zéro de tête, et le SIRET
 * ainsi tronqué fait rejeter la demande.
 */
export function csvDepot(db, lotId, { incompletAutorise = false, protegerIdentifiants = true, decimaleFr = true } = {}) {
  const t = tableauDepot(db, lotId)
  if (!t) return { ok: false, motifs: ['Lot introuvable.'] }
  if (t.lignes.length === 0) return { ok: false, motifs: ['Ce lot ne porte aucun dossier.'] }

  if (!t.deposable && !incompletAutorise) {
    const detail = t.lignes
      .filter((l) => l.manquants.length)
      .slice(0, 20)
      .map((l) => `${l.numero} : ${l.manquants.map((m) => m.libelle).join(', ')}`)
    return {
      ok: false,
      motifs: [
        `${t.incomplets} dossier(s) sur ${t.lignes.length} n'ont pas tous les champs exigés.`,
        ...detail,
        ...(t.incomplets > 20 ? [`… et ${t.incomplets - 20} autres.`] : []),
      ],
      tableau: t,
    }
  }

  // ── La cellule ──
  //
  // La protection des identifiants s'applique APRÈS l'échappement, et seulement à une
  // valeur entièrement numérique. Deux raisons, dans cet ordre :
  //
  // 1. `="01234567800019"` est la seule écriture qu'Excel relit comme du texte ; échappée
  //    en CSV, elle redeviendrait la chaîne littérale `="…"` affichée telle quelle.
  // 2. Une cellule qui commence par `=` est une formule. La restreindre aux valeurs
  //    purement numériques garantit qu'aucun texte saisi ailleurs — un nom de client, un
  //    commentaire — ne puisse se retrouver exécuté à l'ouverture du fichier.
  const cellule = (champ, v) => {
    if (v === null || v === undefined) return ''
    let brut = String(v)

    // ── La virgule décimale ──
    //
    // Un montant écrit « 1500.00 » ouvert dans un tableur français n'est pas un nombre :
    // c'est du texte, ou pire, une date. Le destinataire est une société française qui
    // ouvrira ce fichier dans Excel en français ; les montants sortent donc à la virgule.
    // Le séparateur de colonnes étant le point-virgule, elle ne crée aucune ambiguïté.
    if (CHAMPS_PAR_CODE.get(champ)?.type === 'montant' && decimaleFr) {
      brut = brut.replace('.', ',')
    }

    const protegeable = protegerIdentifiants
      && /siret|siren|code_postal/.test(champ)
      && /^\d+$/.test(brut)
    return protegeable ? `="${brut}"` : echappe(brut)
  }

  const entetes = t.gabarit.colonnes.map((c) => echappe(c.colonne)).join(';')
  const corps = t.lignes.map((l) => t.gabarit.colonnes
    .map((c) => (c.champ ? cellule(c.champ, l.valeurs[c.champ]) : ''))
    .join(';'))

  return {
    ok: true,
    tableau: t,
    nomFichier: `${t.lot.numero || 'lot'}-depot-${t.gabarit.source === 'GABARIT' ? 'gabarit' : 'annexe6'}.csv`,
    contenu: '﻿' + [entetes, ...corps].join('\r\n') + '\r\n',
    nbLignes: corps.length,
    incomplet: !t.deposable,
  }
}
