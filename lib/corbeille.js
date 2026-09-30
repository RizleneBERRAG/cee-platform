/**
 * La corbeille des dossiers.
 *
 * Il n'existait aucune suppression : un doublon ou un dossier de test restait pour toujours
 * dans les listes et les totaux. Deux gestes, de gravité très différente :
 *
 * 1. **Mettre à la corbeille** — réversible. Le dossier sort de toutes les listes, de tous
 *    les totaux, du planning, des rappels, et son client perd l'accès à son espace. Rien
 *    n'est effacé ; « Récupérer » le remet exactement comme il était.
 * 2. **Supprimer définitivement** — depuis la corbeille seulement. Efface le dossier et tout
 *    ce qui n'appartient qu'à lui : opérations, pièces (et leurs fichiers s'ils ne servent
 *    plus ailleurs), notes, rappels, interventions, S.A.V, accès client. Une ligne de journal
 *    garde la trace de la suppression, sans les données.
 *
 * Ce qui a quitté la maison ne se supprime pas : un dossier déposé, dans un lot, facturé ou
 * appelé en paiement est lié à des documents que d'autres détiennent. La suppression
 * définitive refuse en plus un dossier dont le devis est numéroté : la série de devis doit
 * rester justifiable, numéro par numéro.
 *
 * Toutes les fonctions reçoivent la base : elles se testent sur une base jetable.
 */

/** Ce qui empêche de mettre le dossier à la corbeille. Tableau vide = possible. */
export function obstaclesCorbeille(db, dossierId) {
  const d = db.prepare('SELECT id, verrouille, lot_id FROM dossier WHERE id = ?').get(dossierId)
  if (!d) return ['Dossier introuvable.']
  const out = []
  if (d.verrouille) out.push('il est verrouillé (déposé) : déverrouillez-le d\'abord, si c\'est vraiment une erreur')
  if (d.lot_id) out.push('il est dans un lot de dépôt : retirez-l\'en d\'abord')
  const factures = db.prepare('SELECT COUNT(*) AS n FROM facture WHERE dossier_id = ?').get(dossierId).n
  if (factures) out.push(`il porte ${factures} facture(s), acompte(s) ou avoir(s) émis`)
  const appel = db.prepare(`SELECT a.numero FROM appel_paiement_ligne x JOIN appel_paiement a ON a.id = x.appel_id WHERE x.dossier_id = ?`).get(dossierId)
  if (appel) out.push(`il figure dans l'appel à paiement ${appel.numero}`)
  return out
}

/** Ce qui empêche l'effacement définitif — les obstacles ci-dessus, plus le devis numéroté. */
export function obstaclesDefinitifs(db, dossierId) {
  const out = obstaclesCorbeille(db, dossierId)
  const d = db.prepare('SELECT num_devis, supprime_le FROM dossier WHERE id = ?').get(dossierId)
  if (d && !d.supprime_le) out.push("il n'est pas dans la corbeille")
  if (d?.num_devis) out.push(`son devis ${d.num_devis} est numéroté : le supprimer trouerait la série de devis`)
  return out
}

export function mettreALaCorbeille(db, dossierId, { motif, par = null }) {
  const m = String(motif || '').trim()
  if (!m) throw new Error('Indiquez pourquoi ce dossier est supprimé : c\'est ce que lira celui qui voudra le récupérer.')
  const obstacles = obstaclesCorbeille(db, dossierId)
  if (obstacles.length) throw new Error(`Suppression impossible : ${obstacles.join(' ; ')}.`)
  const d = db.prepare('SELECT numero, supprime_le FROM dossier WHERE id = ?').get(dossierId)
  if (d.supprime_le) return
  db.prepare("UPDATE dossier SET supprime_le = datetime('now'), supprime_par = ?, motif_suppression = ? WHERE id = ?").run(par, m, dossierId)
  journal(db, dossierId, dossierId, 'Corbeille', null, `mis à la corbeille : ${m}`, par)
}

export function recuperer(db, dossierId, { par = null } = {}) {
  const d = db.prepare('SELECT supprime_le, motif_suppression FROM dossier WHERE id = ?').get(dossierId)
  if (!d) throw new Error('Dossier introuvable.')
  if (!d.supprime_le) return
  db.prepare('UPDATE dossier SET supprime_le = NULL, supprime_par = NULL, motif_suppression = NULL WHERE id = ?').run(dossierId)
  journal(db, dossierId, dossierId, 'Corbeille', `mis à la corbeille : ${d.motif_suppression || ''}`, 'récupéré', par)
}

/**
 * Efface pour de bon. Renvoie les fichiers dont plus aucune pièce ne parle, pour que
 * l'appelant les retire du disque — hors transaction : un fichier effacé ne se restaure pas
 * par un ROLLBACK.
 */
export function supprimerDefinitivement(db, dossierId, { par = null } = {}) {
  const obstacles = obstaclesDefinitifs(db, dossierId)
  if (obstacles.length) throw new Error(`Suppression définitive impossible : ${obstacles.join(' ; ')}.`)
  const d = db.prepare('SELECT * FROM dossier WHERE id = ?').get(dossierId)
  const sites = new Set([d.site_id, ...db.prepare('SELECT site_id FROM chantier WHERE dossier_id = ?').all(dossierId).map((r) => r.site_id)])
  const pieces = db.prepare('SELECT DISTINCT empreinte, extension FROM document_dossier WHERE dossier_id = ? AND empreinte IS NOT NULL').all(dossierId)

  db.exec('BEGIN')
  try {
    const suppr = (sql) => db.prepare(sql).run(dossierId)
    suppr('DELETE FROM sav WHERE dossier_id = ?')
    suppr('DELETE FROM proposition WHERE dossier_id = ?')
    suppr('DELETE FROM acces_client WHERE dossier_id = ?')
    suppr('DELETE FROM rappel WHERE dossier_id = ?')
    suppr('DELETE FROM intervention WHERE dossier_id = ?')
    suppr('DELETE FROM reponse_qualification WHERE dossier_id = ?')
    suppr('DELETE FROM operation WHERE dossier_id = ?')
    suppr('DELETE FROM chantier WHERE dossier_id = ?')
    suppr('DELETE FROM controle WHERE dossier_id = ?')
    suppr('DELETE FROM audit_energetique WHERE dossier_id = ?')
    suppr('DELETE FROM dossier_intervenant WHERE dossier_id = ?')
    suppr('DELETE FROM note WHERE dossier_id = ?')
    suppr('DELETE FROM document_dossier WHERE dossier_id = ?')
    db.prepare("DELETE FROM journal_champ WHERE dossier_id = ? OR (entite = 'Dossier' AND entite_id = ?)").run(dossierId, dossierId)
    suppr('DELETE FROM dossier WHERE id = ?')
    for (const s of sites) {
      const utilise = db.prepare('SELECT (SELECT COUNT(*) FROM dossier WHERE site_id = ?) + (SELECT COUNT(*) FROM chantier WHERE site_id = ?) AS n').get(s, s).n
      if (!utilise) db.prepare('DELETE FROM site WHERE id = ?').run(s)
    }
    if (!db.prepare('SELECT COUNT(*) AS n FROM dossier WHERE beneficiaire_id = ?').get(d.beneficiaire_id).n) {
      db.prepare('DELETE FROM beneficiaire WHERE id = ?').run(d.beneficiaire_id)
    }
    // La trace : quoi, quand, qui, pourquoi — sans les données effacées.
    journal(db, null, dossierId, 'Suppression définitive', d.numero, d.motif_suppression || null, par)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  const orphelins = pieces.filter((p) => !db.prepare('SELECT 1 AS x FROM document_dossier WHERE empreinte = ?').get(p.empreinte))
  return { numero: d.numero, orphelins }
}

export function listerCorbeille(db, { uniteId } = {}) {
  return db.prepare(`
    SELECT d.id, d.numero, d.supprime_le, d.motif_suppression, d.num_devis, d.unite_affaire_id,
           COALESCE(b.raison_sociale, TRIM(COALESCE(b.prenom, '') || ' ' || COALESCE(b.nom, ''))) AS client,
           s.code_postal, s.ville, f.code AS fiche_code, ua.nom AS unite_nom,
           u.prenom AS par_prenom, u.nom AS par_nom
      FROM dossier d
      JOIN beneficiaire b ON b.id = d.beneficiaire_id
      JOIN site s ON s.id = d.site_id
      JOIN fiche f ON f.id = d.fiche_id
      LEFT JOIN unite_affaire ua ON ua.id = d.unite_affaire_id
      LEFT JOIN utilisateur u ON u.id = d.supprime_par
     WHERE d.supprime_le IS NOT NULL ${uniteId !== undefined ? 'AND d.unite_affaire_id IS ?' : ''}
     ORDER BY d.supprime_le DESC`).all(...(uniteId !== undefined ? [uniteId] : []))
}

function journal(db, dossierId, entiteId, champ, ancienne, nouvelle, par) {
  db.prepare(`INSERT INTO journal_champ (id, entite, entite_id, dossier_id, champ, ancienne, nouvelle, utilisateur_id)
              VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(), 'Dossier', entiteId, dossierId, champ, ancienne, nouvelle, par)
}
