/**
 * Les listes paramétrables : les référentiels « simples » de Pixel, décrits ici plutôt que
 * codés écran par écran.
 *
 * Chaque liste déclare ses champs et, surtout, **à quoi elle sert** (`usage`). Une liste
 * qu'aucun écran ne lit est dite telle quelle à l'écran de paramétrage : la remplir ne
 * change encore rien, et le laisser croire serait pire que de ne pas l'avoir.
 *
 * Les champs propres à une liste vivent en JSON dans `donnees`. Les contrôles sont faits
 * ici, côté serveur : un IBAN dont la clé est fausse part sur une facture, et c'est un
 * virement perdu.
 *
 * Toutes les fonctions reçoivent la base : elles se testent sur une base jetable.
 */

// ── Contrôles ──────────────────────────────────────────────────
const nettoyer = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase()

/** IBAN : forme, puis clé (ISO 13616, modulo 97 = 1). */
export function ibanValide(v) {
  const s = nettoyer(v)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false
  const ordre = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55))
  let reste = 0
  for (const chiffre of ordre) reste = (reste * 10 + Number(chiffre)) % 97
  return reste === 1
}
export const bicValide = (v) => /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(nettoyer(v))
export const siretValide = (v) => /^\d{14}$/.test(nettoyer(v))
export const sirenValide = (v) => /^\d{9}$/.test(nettoyer(v))
const DEPARTEMENT = /^(0[1-9]|[1-8]\d|9[0-5]|2A|2B|97[1-6])$/

/** « 01, 38 69 » → ['01', '38', '69'] ; une valeur inconnue fait refuser la saisie. */
export function departements(v) {
  const liste = String(v ?? '').toUpperCase().split(/[\s,;]+/).filter(Boolean).map((d) => (/^\d$/.test(d) ? `0${d}` : d))
  const faux = liste.filter((d) => !DEPARTEMENT.test(d))
  if (faux.length) throw new Error(`Département(s) inconnu(s) : ${faux.join(', ')}.`)
  return [...new Set(liste)].sort()
}

// ── Les champs ─────────────────────────────────────────────────
// type : texte | siret | siren | tva | iban | bic | taux | couleur | departements | date
const C = {
  siret: { cle: 'siret', libelle: 'SIRET', type: 'siret' },
  siren: { cle: 'siren', libelle: 'SIREN', type: 'siren' },
  tva: { cle: 'tva', libelle: 'N° TVA', type: 'texte' },
  signataire: { cle: 'signataire', libelle: 'Signataire', type: 'texte' },
  description: { cle: 'description', libelle: 'Description', type: 'texte' },
  typeSociete: { cle: 'type', libelle: 'Type', type: 'texte' },
  contact: { cle: 'contact', libelle: 'Téléphone / e-mail', type: 'texte' },
}

/** Les listes, groupées comme dans le paramétrage de Pixel. */
export const LISTES = {
  source_lead: {
    titre: 'Sources de lead', groupe: 'Commercial', libelle: 'Raison sociale', champs: [C.siren, C.tva, C.contact],
    usage: 'Proposées dans « Source du lead » du parcours commercial du dossier.',
  },
  societe_cliente: {
    titre: 'Sociétés clientes', groupe: 'Commercial', libelle: 'Raison sociale', champs: [C.siret, C.description],
    usage: null,
  },
  amo: {
    titre: 'AMO / MAR', groupe: 'Rénovation', libelle: 'Raison sociale', champs: [C.siret, C.signataire], parDefaut: true,
    usage: "Choisi dans le bloc « AMO / MAR » du dossier (onglet Technique).",
  },
  mandataire_anah: {
    titre: 'Mandataires Anah', groupe: 'Rénovation', libelle: 'Raison sociale', champs: [C.siret, C.signataire], parDefaut: true,
    usage: "Choisi dans le bloc « AMO / MAR » du dossier (onglet Technique).",
  },
  prestataire_energetique: {
    titre: 'Prestataires énergétiques', groupe: 'Rénovation', libelle: 'Raison sociale', champs: [C.siret, C.signataire],
    usage: null,
  },
  logiciel_audit: {
    titre: "Logiciels d'audit", groupe: 'Rénovation', libelle: 'Nom du logiciel',
    champs: [{ cle: 'editeur', libelle: 'Éditeur', type: 'texte' }, { cle: 'version', libelle: 'Version', type: 'texte' }, { cle: 'date_version', libelle: 'Date de version', type: 'date' }],
    usage: "Proposés dans « Logiciel » du bloc Audit énergétique. Le moteur de calcul réglementaire reste une liste fermée.",
  },
  gestionnaire_reseau: {
    titre: 'Gestionnaires de réseau', groupe: 'Réseau de chaleur', libelle: 'Raison sociale', champs: [C.typeSociete, C.siret, C.signataire],
    usage: 'Proposés dans « Gestionnaire » du bloc Réseau public de chaleur.',
  },
  societe_exploitation: {
    titre: "Sociétés d'exploitation", groupe: 'Réseau de chaleur', libelle: 'Raison sociale', champs: [C.typeSociete, C.siret, C.signataire],
    usage: "Proposées dans « Société d'exploitation » du bloc Réseau public de chaleur.",
  },
  marque: {
    titre: 'Marques', groupe: 'Catalogue', libelle: 'Marque', champs: [C.description],
    usage: 'Proposées dans « Marque » du catalogue produits.',
  },
  fournisseur: {
    titre: 'Fournisseurs', groupe: 'Catalogue', libelle: 'Fournisseur', champs: [C.siret, C.description, C.contact],
    usage: null,
  },
  depot_stockage: {
    titre: 'Dépôts de stockage', groupe: 'Catalogue', libelle: 'Dépôt', champs: [{ cle: 'adresse', libelle: 'Adresse', type: 'texte' }],
    usage: null,
  },
  compte_bancaire: {
    titre: 'Comptes bancaires', groupe: 'Facturation', libelle: 'Libellé du compte',
    champs: [{ cle: 'banque', libelle: 'Banque', type: 'texte' }, { cle: 'titulaire', libelle: 'Titulaire', type: 'texte' },
      { cle: 'iban', libelle: 'IBAN', type: 'iban', requis: true }, { cle: 'bic', libelle: 'BIC', type: 'bic', requis: true }],
    usage: 'Choisi sur chaque société émettrice ; ses coordonnées sont imprimées sur les factures et les appels à paiement.',
  },
  taxe: {
    titre: 'Taxes', groupe: 'Facturation', libelle: 'Taxe', champs: [{ cle: 'taux', libelle: 'Taux (%)', type: 'taux', requis: true }],
    usage: null,
  },
  zone_intervention: {
    titre: "Zones d'intervention", groupe: 'Planning', libelle: 'Zone',
    champs: [{ cle: 'couleur', libelle: 'Couleur', type: 'couleur' }, { cle: 'departements', libelle: 'Départements', type: 'departements' }],
    usage: null,
  },
  type_photo: {
    titre: 'Types de photos', groupe: 'Pièces', libelle: 'Type', champs: [C.description],
    usage: null,
  },
}

/** Contrôle et normalise les champs d'une liste. Lève une erreur lisible. */
export function validerDonnees(liste, brut) {
  const def = LISTES[liste]
  if (!def) throw new Error('Liste inconnue.')
  const out = {}
  for (const ch of def.champs) {
    const v = String(brut[ch.cle] ?? '').trim()
    if (!v) {
      if (ch.requis) throw new Error(`${ch.libelle} : obligatoire.`)
      continue
    }
    switch (ch.type) {
      case 'siret': if (!siretValide(v)) throw new Error('Le SIRET doit compter 14 chiffres.'); out[ch.cle] = nettoyer(v); break
      case 'siren': if (!sirenValide(v)) throw new Error('Le SIREN doit compter 9 chiffres.'); out[ch.cle] = nettoyer(v); break
      case 'iban': if (!ibanValide(v)) throw new Error("IBAN invalide : sa clé de contrôle ne correspond pas. Vérifiez chaque caractère."); out[ch.cle] = nettoyer(v).replace(/(.{4})/g, '$1 ').trim(); break
      case 'bic': if (!bicValide(v)) throw new Error('BIC invalide : 8 ou 11 caractères.'); out[ch.cle] = nettoyer(v); break
      case 'taux': { const n = Number(v.replace(',', '.')); if (!(n >= 0 && n <= 100)) throw new Error('Taux invalide.'); out[ch.cle] = n; break }
      case 'couleur': if (!/^#[0-9a-f]{6}$/i.test(v)) throw new Error('Couleur invalide.'); out[ch.cle] = v; break
      case 'departements': out[ch.cle] = departements(v); break
      case 'date': if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${ch.libelle} : date invalide.`); out[ch.cle] = v; break
      default: out[ch.cle] = v
    }
  }
  return out
}

// ── Lecture / écriture ─────────────────────────────────────────
const lire = (r) => (r ? { ...r, donnees: JSON.parse(r.donnees || '{}') } : null)

export function valeursListe(db, liste, { tous = false } = {}) {
  return db.prepare(`SELECT * FROM liste_parametrable WHERE liste = ? ${tous ? '' : 'AND actif = 1'} ORDER BY actif DESC, ordre, libelle`)
    .all(liste).map(lire)
}

export const valeurListe = (db, id) => lire(db.prepare('SELECT * FROM liste_parametrable WHERE id = ?').get(id))

/** Crée ou met à jour. Renvoie l'identifiant. Une seule valeur « par défaut » par liste. */
export function enregistrerValeur(db, liste, { id = null, libelle, donnees = {}, ordre = 0, actif = true, parDefaut = false }) {
  const def = LISTES[liste]
  if (!def) throw new Error('Liste inconnue.')
  const nom = String(libelle ?? '').trim()
  if (!nom) throw new Error(`${def.libelle} : obligatoire.`)
  const propres = validerDonnees(liste, donnees)
  const doublon = db.prepare('SELECT id FROM liste_parametrable WHERE liste = ? AND lower(libelle) = lower(?) AND id IS NOT ?').get(liste, nom, id)
  if (doublon) throw new Error(`« ${nom} » existe déjà dans cette liste.`)
  const defaut = def.parDefaut && parDefaut ? 1 : 0
  if (defaut) db.prepare('UPDATE liste_parametrable SET par_defaut = 0 WHERE liste = ?').run(liste)
  if (id) {
    const avant = db.prepare('SELECT liste FROM liste_parametrable WHERE id = ?').get(id)
    if (!avant || avant.liste !== liste) throw new Error('Valeur introuvable.')
    db.prepare('UPDATE liste_parametrable SET libelle = ?, donnees = ?, ordre = ?, actif = ?, par_defaut = ? WHERE id = ?')
      .run(nom, JSON.stringify(propres), Math.round(Number(ordre) || 0), actif ? 1 : 0, defaut, id)
    return id
  }
  const nid = crypto.randomUUID()
  db.prepare('INSERT INTO liste_parametrable (id, liste, libelle, donnees, ordre, actif, par_defaut) VALUES (?,?,?,?,?,1,?)')
    .run(nid, liste, nom, JSON.stringify(propres), Math.round(Number(ordre) || 0), defaut)
  return nid
}

/** Combien de fois une valeur est utilisée, là où la plateforme la lit. */
export function usages(db, id) {
  return db.prepare(`SELECT
      (SELECT COUNT(*) FROM dossier WHERE amo_id = ? OR mandataire_anah_id = ?) +
      (SELECT COUNT(*) FROM entite_emettrice WHERE compte_bancaire_id = ?) AS n`).get(id, id, id).n
}

/** Les coordonnées bancaires d'une société émettrice, ou null si elle n'a pas de compte. */
export function coordonneesBancaires(db, entiteId) {
  const r = entiteId ? db.prepare(`SELECT l.donnees FROM entite_emettrice e
    JOIN liste_parametrable l ON l.id = e.compte_bancaire_id AND l.liste = 'compte_bancaire'
    WHERE e.id = ?`).get(entiteId) : null
  if (!r) return null
  const d = JSON.parse(r.donnees || '{}')
  return d.iban ? { reglement_banque: d.banque || null, reglement_iban: d.iban, reglement_bic: d.bic || null } : null
}
