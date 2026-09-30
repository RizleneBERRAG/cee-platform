/**
 * Les sociétés émettrices : celles au nom desquelles partent devis, factures et appels à
 * paiement. Elles se chargeaient à la main depuis db/entites.json ; elles se règlent
 * désormais à l'écran.
 *
 * Trois règles, parce qu'une erreur ici se retrouve imprimée sur des documents légaux :
 *
 * 1. **Les identifiants se contrôlent entre eux.** Le SIRET commence par le SIREN, et la
 *    clé du numéro de TVA se recalcule depuis le SIREN : une faute de frappe dans l'un est
 *    refusée plutôt qu'imprimée.
 * 2. **Une série en cours ne change pas de préfixe.** Le préfixe fait partie du numéro : le
 *    changer après une première émission dans l'année couperait la série en deux, et elle
 *    ne serait plus justifiable d'un bout à l'autre. Les compteurs, eux, ne se saisissent
 *    jamais.
 * 3. **Une seule société par défaut.**
 *
 * Reçoit la base en paramètre : se teste sur une base jetable.
 */
import { tvaFrValide } from './devis.js'

const nettoyer = (v) => String(v ?? '').replace(/\s/g, '')

/** [colonne, libellé, type, groupe] — l'ordre est celui de l'écran. */
export const CHAMPS_SOCIETE = [
  ['code', 'Code interne', 'code', 'Identité'],
  ['raison_sociale', 'Raison sociale', 'requis', 'Identité'],
  ['forme_juridique', 'Forme juridique', 'texte', 'Identité'],
  ['capital', 'Capital social (€)', 'nombre', 'Identité'],
  ['siren', 'SIREN', 'siren', 'Identité'],
  ['siret', "SIRET de l'établissement", 'siret', 'Identité'],
  ['naf', 'Code NAF', 'texte', 'Identité'],
  ['rcs_ville', 'Ville du RCS', 'texte', 'Identité'],
  ['rcs_numero', 'N° RCS', 'texte', 'Identité'],
  ['tva', 'N° TVA intracommunautaire', 'tva', 'Identité'],
  ['adresse', 'Adresse', 'texte', 'Coordonnées'],
  ['code_postal', 'Code postal', 'texte', 'Coordonnées'],
  ['ville', 'Ville', 'texte', 'Coordonnées'],
  ['telephone', 'Téléphone', 'texte', 'Coordonnées'],
  ['email', 'E-mail', 'email', 'Coordonnées'],
  ['site_web', 'Site web', 'texte', 'Coordonnées'],
  ['representant_nom', 'Représentée par', 'texte', 'Coordonnées'],
  ['representant_qualite', 'Qualité', 'texte', 'Coordonnées'],
  ['assurance_nom', 'Assureur décennale', 'texte', 'Assurance et RGE'],
  ['assurance_police', 'N° de police', 'texte', 'Assurance et RGE'],
  ['assurance_couverture', 'Zone / activités couvertes', 'texte', 'Assurance et RGE'],
  ['installateur_id', 'Installateur RGE rattaché', 'installateur', 'Assurance et RGE'],
  ['devis_prefixe', 'Préfixe des devis', 'prefixe', 'Documents'],
  ['facture_prefixe', 'Préfixe des factures', 'prefixe', 'Documents'],
  ['validite_jours', 'Validité des devis (jours)', 'entier', 'Documents'],
  ['taux_tva_defaut', 'TVA par défaut (%)', 'nombre', 'Documents'],
  ['conditions_reglement', 'Conditions de règlement', 'texte', 'Documents'],
  ['mentions_pied', 'Mentions en pied de page', 'texte', 'Documents'],
  ['compte_bancaire_id', 'Compte bancaire', 'compte', 'Documents'],
  ['taux_penalites', 'Pénalités de retard (% annuel)', 'nombre', 'Mentions légales des factures'],
  ['indemnite_recouvrement', 'Indemnité de recouvrement (€)', 'nombre', 'Mentions légales des factures'],
  ['delai_paiement_jours', 'Délai de paiement (jours)', 'entier', 'Mentions légales des factures'],
]

/**
 * Champs qui ont une valeur par défaut en base et ne peuvent pas être vides : laissés vides
 * à la création, ils prennent ce défaut ; vidés ensuite, ils sont refusés.
 */
const AVEC_DEFAUT = ['validite_jours', 'taux_penalites', 'indemnite_recouvrement', 'delai_paiement_jours']

/** Contrôle et normalise. `avant` : la société telle qu'en base (null pour une création). */
export function validerSociete(db, brut, avant = null) {
  const v = {}
  for (const [col, libelle, type] of CHAMPS_SOCIETE) {
    let x = brut[col] === undefined ? (avant ? avant[col] : null) : String(brut[col] ?? '').trim()
    if (x === '' || x === undefined) x = null
    if (x === null) {
      if (type === 'requis' || type === 'code' || (avant && AVEC_DEFAUT.includes(col))) throw new Error(`${libelle} : obligatoire.`)
      v[col] = null
      continue
    }
    switch (type) {
      case 'code':
        x = String(x).toUpperCase()
        if (!/^[A-Z0-9_-]{2,20}$/.test(x)) throw new Error('Code interne : 2 à 20 lettres, chiffres, tirets.')
        break
      case 'siren': x = nettoyer(x); if (!/^\d{9}$/.test(x)) throw new Error('Le SIREN compte 9 chiffres.'); break
      case 'siret': x = nettoyer(x); if (!/^\d{14}$/.test(x)) throw new Error('Le SIRET compte 14 chiffres.'); break
      case 'tva': x = nettoyer(x).toUpperCase(); break
      case 'email': if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)) throw new Error('E-mail invalide.'); break
      case 'prefixe': x = String(x).toUpperCase(); if (!/^[A-Z0-9-]{1,12}$/.test(x)) throw new Error(`${libelle} : lettres, chiffres et tirets.`); break
      case 'nombre': { const n = Number(String(x).replace(',', '.')); if (!Number.isFinite(n) || n < 0) throw new Error(`${libelle} : nombre positif attendu.`); x = n; break }
      case 'entier': { const n = Number(x); if (!Number.isInteger(n) || n < 0) throw new Error(`${libelle} : nombre entier attendu.`); x = n; break }
      case 'installateur': if (!db.prepare('SELECT 1 AS x FROM installateur_rge WHERE id = ?').get(x)) throw new Error('Installateur RGE inconnu.'); break
      case 'compte': if (!db.prepare("SELECT 1 AS x FROM liste_parametrable WHERE id = ? AND liste = 'compte_bancaire'").get(x)) throw new Error('Compte bancaire inconnu.'); break
      default: break
    }
    v[col] = x
  }

  // Les identifiants entre eux.
  if (v.siret && v.siren && !v.siret.startsWith(v.siren)) throw new Error(`Le SIRET ${v.siret} ne commence pas par le SIREN ${v.siren}.`)
  if (v.tva && !tvaFrValide(v.tva, v.siren)) {
    throw new Error(`Le numéro de TVA ${v.tva} ne correspond pas au SIREN ${v.siren || '(non renseigné)'} : sa clé de contrôle est fausse.`)
  }
  if (db.prepare('SELECT 1 AS x FROM entite_emettrice WHERE code = ? AND id IS NOT ?').get(v.code, avant?.id ?? null)) {
    throw new Error(`Le code ${v.code} est déjà pris.`)
  }

  // Une série entamée cette année garde son préfixe.
  const annee = new Date().getFullYear()
  if (avant) {
    for (const [col, compteur, an, nom] of [['devis_prefixe', 'devis_compteur', 'devis_annee', 'devis'], ['facture_prefixe', 'facture_compteur', 'facture_annee', 'factures']]) {
      if ((v[col] || null) !== (avant[col] || null) && Number(avant[compteur]) > 0 && Number(avant[an]) === annee) {
        throw new Error(`La série de ${nom} ${avant[col] || ''} est entamée cette année (${avant[compteur]} émis) : changer son préfixe la couperait en deux. Le changement se fera au 1er janvier.`)
      }
    }
  }
  return v
}

/** Crée ou met à jour. Renvoie { id, changes } — les colonnes réellement modifiées. */
export function enregistrerSociete(db, id, brut, { logo, parDefaut = false, actif = true } = {}) {
  const avant = id ? db.prepare('SELECT * FROM entite_emettrice WHERE id = ?').get(id) : null
  if (id && !avant) throw new Error('Société introuvable.')
  const v = validerSociete(db, brut, avant)
  if (logo !== undefined) v.logo = logo
  v.actif = actif ? 1 : 0
  // Une société désactivée n'est pas la société par défaut : elle n'émet plus rien.
  v.par_defaut = parDefaut && actif ? 1 : 0

  db.exec('BEGIN')
  try {
    if (v.par_defaut) db.prepare('UPDATE entite_emettrice SET par_defaut = 0 WHERE id IS NOT ?').run(id)
    let changes
    if (avant) {
      changes = Object.keys(v).filter((k) => String(avant[k] ?? '') !== String(v[k] ?? ''))
      if (changes.length) db.prepare(`UPDATE entite_emettrice SET ${changes.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...changes.map((k) => v[k]), id)
    } else {
      id = crypto.randomUUID()
      // Un champ vide n'est pas écrit : la base lui donne sa valeur par défaut.
      const cols = Object.keys(v).filter((k) => v[k] !== null && v[k] !== undefined)
      db.prepare(`INSERT INTO entite_emettrice (id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`).run(id, ...cols.map((k) => v[k]))
      changes = ['création']
    }
    db.exec('COMMIT')
    return { id, changes, avant }
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

/**
 * Un logo envoyé depuis l'écran, gardé en base sous forme d'image intégrée. Un fichier
 * déposé dans public/ ne serait pas servi par `next start` avant la compilation suivante.
 * Le type est lu dans le contenu, pas dans le nom : un SVG (qui peut porter du script)
 * ou un HTML renommé sont refusés.
 */
export function logoEnImage(octets) {
  const b = Buffer.from(octets)
  if (b.length === 0) return undefined
  if (b.length > 300 * 1024) throw new Error('Logo trop lourd : 300 Ko au plus.')
  const type = b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG' ? 'image/png'
    : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg'
      : b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null
  if (!type) throw new Error('Logo refusé : PNG, JPEG ou WebP uniquement.')
  return `data:${type};base64,${b.toString('base64')}`
}
