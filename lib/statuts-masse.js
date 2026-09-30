/**
 * Changer le statut de plusieurs dossiers d'un coup — au dépôt d'un lot, à sa validation par
 * le délégataire, au paiement.
 *
 * Chaque dossier garde sa ligne au journal, exactement comme s'il avait été modifié à la
 * main : « qui a passé ce dossier en Payé, et quand » doit rester lisible un an après,
 * même si la réponse est « tout un lot, d'un clic ».
 *
 * Le verrou du dossier ne s'y oppose pas : il protège ce qui entre dans le calcul, et un
 * statut n'y entre pas. Un dossier déposé — donc verrouillé — doit bien pouvoir passer
 * « validé délégataire », puis « payé ».
 */
export const AXES_MASSE = {
  statut_dossier_id: ['DOSSIER', 'Statut dossier'],
  statut_admin_id: ['ADMIN', 'Statut administratif'],
  statut_facturation_id: ['FACTURATION', 'Facturation'],
}

/**
 * @param {object} changements  { statut_dossier_id?, statut_admin_id?, statut_facturation_id? }
 *                              une valeur vide = axe laissé tel quel
 * @returns {number} le nombre de changements réellement écrits
 */
export function statuerDossiers(db, dossierIds, changements, { utilisateurId = null } = {}) {
  const aAppliquer = Object.entries(changements).filter(([k, v]) => AXES_MASSE[k] && v)
  if (!aAppliquer.length || !dossierIds.length) return 0

  const libelles = {}
  for (const [colonne, statutId] of aAppliquer) {
    const s = db.prepare('SELECT libelle, axe FROM statut WHERE id = ?').get(statutId)
    // Un statut d'un autre axe, envoyé directement à l'action, fausserait le pipeline.
    if (!s || s.axe !== AXES_MASSE[colonne][0]) throw new Error(`Statut invalide pour « ${AXES_MASSE[colonne][1]} ».`)
    libelles[statutId] = s.libelle
  }

  const journal = db.prepare(`INSERT INTO journal_champ (id, entite, entite_id, dossier_id, champ, ancienne, nouvelle, utilisateur_id)
                              VALUES (?,?,?,?,?,?,?,?)`)
  let n = 0
  db.exec('BEGIN')
  try {
    for (const id of dossierIds) {
      const d = db.prepare('SELECT * FROM dossier WHERE id = ?').get(id)
      if (!d) continue
      for (const [colonne, statutId] of aAppliquer) {
        if (d[colonne] === statutId) continue
        const avant = d[colonne] ? db.prepare('SELECT libelle FROM statut WHERE id = ?').get(d[colonne])?.libelle : null
        db.prepare(`UPDATE dossier SET ${colonne} = ? WHERE id = ?`).run(statutId, id)
        journal.run(crypto.randomUUID(), 'Dossier', id, id, AXES_MASSE[colonne][1], avant ?? null, libelles[statutId], utilisateurId)
        n++
      }
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  return n
}
