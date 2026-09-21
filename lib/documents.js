/**
 * Contrôle de complétude documentaire.
 *
 * La liasse exigée dépend du couple (délégataire, fiche) : c'est ce qui permet de dire
 * « ce dossier est complet POUR CE délégataire », et pas seulement « il a des pièces ».
 * Une liasse sans délégataire sert de liasse par défaut pour la fiche.
 */
import { all, get } from './db.js'

export function liassePour({ delegataireId, ficheCode }) {
  return (
    get('SELECT * FROM liasse WHERE actif = 1 AND delegataire_id = ? AND fiche_code = ?', [delegataireId, ficheCode]) ||
    get('SELECT * FROM liasse WHERE actif = 1 AND delegataire_id IS NULL AND fiche_code = ?', [ficheCode]) ||
    get('SELECT * FROM liasse WHERE actif = 1 AND delegataire_id = ? AND fiche_code IS NULL', [delegataireId]) ||
    null
  )
}

export function completude(dossier) {
  const liasse = liassePour({ delegataireId: dossier.delegataire_id, ficheCode: dossier.fiche_code })
  if (!liasse) {
    return { liasse: null, lignes: [], manquants: [], aValider: [], complet: false, tauxComplet: 0, sansLiasse: true }
  }

  const items = all(
    `SELECT li.*, td.code, td.libelle
       FROM liasse_item li JOIN type_document td ON td.id = li.type_document_id
      WHERE li.liasse_id = ? ORDER BY li.ordre`,
    [liasse.id]
  )
  const fournis = all(
    `SELECT dd.*, td.code FROM document_dossier dd
       JOIN type_document td ON td.id = dd.type_document_id
      WHERE dd.dossier_id = ?`,
    [dossier.id]
  )

  const lignes = items.map((it) => {
    const docs = fournis.filter((d) => d.type_document_id === it.type_document_id)
    const valide = docs.some((d) => d.valide_par_delegataire)
    return {
      typeDocumentId: it.type_document_id,
      code: it.code,
      libelle: it.libelle,
      obligatoire: !!it.obligatoire,
      fourni: docs.length > 0,
      valide,
      documents: docs,
      etat: valide ? 'VALIDE' : docs.length ? 'A_VALIDER' : 'MANQUANT',
    }
  })

  const obligatoires = lignes.filter((l) => l.obligatoire)
  const manquants = obligatoires.filter((l) => l.etat === 'MANQUANT')
  const aValider = obligatoires.filter((l) => l.etat === 'A_VALIDER')

  return {
    liasse,
    lignes,
    manquants,
    aValider,
    complet: manquants.length === 0 && aValider.length === 0,
    deposable: manquants.length === 0,
    tauxComplet: obligatoires.length ? Math.round(((obligatoires.length - manquants.length) / obligatoires.length) * 100) : 100,
    sansLiasse: false,
  }
}

export function typesDocuments() {
  return all('SELECT id, code, libelle FROM type_document ORDER BY libelle')
}
