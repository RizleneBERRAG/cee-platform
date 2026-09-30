'use server'

/**
 * Paramétrage.
 *
 * Deux principes gouvernent tout ce fichier.
 *
 * 1. **On ne supprime pas ce qui est utilisé.** Un délégataire, une fiche, un statut rattachés
 *    à des dossiers ne peuvent pas disparaître : ils sont désactivés. Une suppression en
 *    cascade effacerait silencieusement l'historique de dossiers déposés il y a deux ans.
 * 2. **Modifier un tarif ne recalcule jamais les dossiers existants.** Les montants d'un
 *    dossier sont figés à sa date de calcul. Changer les ratios d'un deal crée une nouvelle
 *    version du deal ; les dossiers déjà figés gardent la leur. Sans cela, une correction de
 *    grille réécrirait toute la marge historique — et personne ne s'en apercevrait.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { all, get, run, journaliser } from './db.js'
import { exiger } from './auth.js'
import { RATIOS, anomaliesRatios } from './ratios.js'

const uid = () => crypto.randomUUID()
const txt = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s }
const num = (v) => { const s = String(v ?? '').trim().replace(',', '.'); const n = Number(s); return s === '' || !Number.isFinite(n) ? 0 : n }

/**
 * Comme `num`, mais une case laissée vide reste vide.
 *
 * Réservé aux ratios. Ailleurs, zéro est un défaut acceptable ; sur un tarif, non : une
 * case vide veut dire « on ne connaît pas ce tarif », un zéro veut dire « c'est gratuit ».
 * Écrire l'un pour l'autre ferait calculer des marges sur des conditions inconnues.
 */
const numOuVide = (v) => { const s = String(v ?? '').trim().replace(',', '.'); const n = Number(s); return s === '' || !Number.isFinite(n) ? null : n }
const bool = (v) => (v ? 1 : 0)

const retour = (onglet, message) =>
  redirect(`/parametrage/${onglet}${message ? `?m=${encodeURIComponent(message)}` : ''}`)

/**
 * Ce qu'on ajoute au message de confirmation quand la grille enregistrée est douteuse.
 *
 * L'enregistrement n'est pas refusé : l'écran affiche le détail sur le deal concerné, et
 * refuser d'enregistrer laisserait l'utilisateur avec une grille à moitié corrigée, sans
 * moyen d'y revenir. Mais la confirmation ne doit pas dire « enregistré » tout court quand
 * la grille perd de l'argent sur chaque dossier.
 */
function mentionAnomalies(valeurs, mode = null) {
  const a = anomaliesRatios(valeurs, mode)
  if (a.length === 0) return ''
  const erreurs = a.filter((x) => x.gravite === 'ERREUR').length
  return erreurs > 0
    ? ` ⚠ ${erreurs} incohérence(s) dans la grille — voir le détail sur le deal.`
    : ` ⚠ Une valeur paraît hors d'échelle — voir le détail sur le deal.`
}

/** Combien de dossiers dépendent de cette ligne ? Décide entre suppression et désactivation. */
function usages(table, colonne, id) {
  return get(`SELECT COUNT(*) AS n FROM dossier WHERE ${colonne} = ?`, [id]).n
}

// ══ Délégataires ══════════════════════════════════════════════

export async function enregistrerDelegataire(formData) {
  const u = await exiger('deal.gerer')
  const id = txt(formData.get('id'))
  const nom = txt(formData.get('nom'))
  const oblige = txt(formData.get('oblige'))
  const actif = bool(formData.get('actif'))
  if (!nom) retour('delegataires', 'Le nom est obligatoire.')

  if (id) {
    const avant = get('SELECT * FROM delegataire WHERE id = ?', [id])
    if (!avant) retour('delegataires', 'Délégataire introuvable.')
    run('UPDATE delegataire SET nom = ?, oblige = ?, actif = ? WHERE id = ?', [nom, oblige, actif, id])
    for (const [champ, av, ap] of [['Nom', avant.nom, nom], ['Obligé', avant.oblige, oblige], ['Actif', avant.actif, actif]]) {
      journaliser({ entite: 'Delegataire', entiteId: id, champ, ancienne: av, nouvelle: ap, utilisateurId: u.id })
    }
  } else {
    const nid = uid()
    run('INSERT INTO delegataire (id, nom, oblige, actif) VALUES (?,?,?,?)', [nid, nom, oblige, actif])
    journaliser({ entite: 'Delegataire', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: nom, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/delegataires')
  retour('delegataires', 'Enregistré.')
}

export async function supprimerDelegataire(formData) {
  const u = await exiger('deal.gerer')
  const id = txt(formData.get('id'))
  const d = get('SELECT * FROM delegataire WHERE id = ?', [id])
  if (!d) retour('delegataires', 'Délégataire introuvable.')

  const n = usages('dossier', 'delegataire_id', id)
  const deals = get('SELECT COUNT(*) AS n FROM deal WHERE delegataire_id = ?', [id]).n
  if (n > 0 || deals > 0) {
    // Désactiver plutôt que supprimer : les dossiers passés doivent rester lisibles.
    run('UPDATE delegataire SET actif = 0 WHERE id = ?', [id])
    journaliser({ entite: 'Delegataire', entiteId: id, champ: 'Désactivé', ancienne: 'actif', nouvelle: 'inactif', utilisateurId: u.id })
    revalidatePath('/parametrage/delegataires')
    retour('delegataires', `« ${d.nom} » est utilisé par ${n} dossier(s) et ${deals} deal(s) : il a été désactivé, pas supprimé.`)
  }
  run('DELETE FROM delegataire WHERE id = ?', [id])
  journaliser({ entite: 'Delegataire', entiteId: id, champ: 'Suppression', ancienne: d.nom, nouvelle: null, utilisateurId: u.id })
  revalidatePath('/parametrage/delegataires')
  retour('delegataires', `« ${d.nom} » supprimé.`)
}

// ══ Deals ═════════════════════════════════════════════════════

export async function creerDeal(formData) {
  const u = await exiger('deal.gerer')
  const libelle = txt(formData.get('libelle'))
  const delegataireId = txt(formData.get('delegataire_id'))
  if (!libelle || !delegataireId) retour('deals', 'Libellé et délégataire sont obligatoires.')

  const id = uid()
  const valeurs = RATIOS.map(([c]) => numOuVide(formData.get(c)))
  run(
    `INSERT INTO deal (id, libelle, version, delegataire_id, type_beneficiaire, date_debut, date_fin,
       par_defaut, actif, ${RATIOS.map(([c]) => c).join(', ')})
     VALUES (?,?,?,?,?,?,?,?,?,${RATIOS.map(() => '?').join(',')})`,
    [id, libelle, txt(formData.get('version')) || 'V1', delegataireId,
     txt(formData.get('type_beneficiaire')) || 'B2B_B2C',
     txt(formData.get('date_debut')) || new Date().toISOString().slice(0, 10),
     txt(formData.get('date_fin')), bool(formData.get('par_defaut')), 1, ...valeurs]
  )
  if (formData.get('par_defaut')) run('UPDATE deal SET par_defaut = 0 WHERE id <> ?', [id])
  journaliser({ entite: 'Deal', entiteId: id, champ: 'Création', ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  revalidatePath('/parametrage/deals')
  retour('deals', `Deal « ${libelle} » créé.${mentionAnomalies(Object.fromEntries(RATIOS.map(([c], i) => [c, valeurs[i]])))}`)
}

/**
 * Change les ratios d'un deal.
 *
 * Quand le deal a déjà servi à figer des dossiers, on **ne modifie pas la ligne** : on crée
 * une nouvelle version et on désactive l'ancienne. Les dossiers figés continuent de pointer
 * vers la version qui a servi à les calculer, et leur historique de marge reste vrai.
 */
export async function majRatios(formData) {
  const u = await exiger('deal.gerer')
  const id = txt(formData.get('id'))
  const avant = get('SELECT * FROM deal WHERE id = ?', [id])
  if (!avant) retour('deals', 'Deal introuvable.')

  const nouveaux = Object.fromEntries(RATIOS.map(([c]) => [c, numOuVide(formData.get(c))]))
  // Comparaison en tenant le vide pour ce qu'il est. `Number(null)` vaut 0 : comparer sans
  // précaution ferait passer « vide avant, vide après » pour une modification, et créerait
  // une version de deal à chaque enregistrement sans qu'un seul chiffre ait bougé.
  const changes = RATIOS.filter(([c]) => {
    const av = avant[c] === null || avant[c] === undefined || avant[c] === '' ? null : Number(avant[c])
    return av !== nouveaux[c]
  })

  // ── Le mode de reversement se change SANS créer de version ──
  //
  // Il ne modifie aucun tarif : il dit comment lire ceux qui existent. Le traiter comme un
  // changement de grille créerait une version de deal à chaque fois qu'on répond enfin à
  // la question, et archiverait l'ancienne pour rien. En revanche il change les marges
  // FUTURES, d'où la journalisation.
  const modeChoisi = txt(formData.get('mode_reversement'))
  const modeAvant = avant.mode_reversement || null
  if (modeChoisi !== modeAvant) {
    run('UPDATE deal SET mode_reversement = ? WHERE id = ?', [modeChoisi, id])
    journaliser({
      entite: 'Deal', entiteId: id, champ: 'Mode de reversement',
      ancienne: modeAvant, nouvelle: modeChoisi, utilisateurId: u.id,
    })
  }

  if (changes.length === 0) {
    retour('deals', modeChoisi !== modeAvant
      ? `Mode de reversement enregistré. Les dossiers déjà figés ne sont pas recalculés.`
      : 'Aucun ratio modifié.')
  }

  const figes = get('SELECT COUNT(*) AS n FROM dossier WHERE deal_id = ? AND date_calcul IS NOT NULL', [id]).n

  if (figes > 0) {
    const nid = uid()
    const suivante = prochaineVersion(avant.version)
    run(
      `INSERT INTO deal (id, libelle, version, delegataire_id, type_beneficiaire, date_debut, date_fin,
         num_contrat_standard, num_contrat_cdp, num_contrat_mpr, par_defaut, actif,
         mode_reversement, ${RATIOS.map(([c]) => c).join(', ')})
       VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,${RATIOS.map(() => '?').join(',')})`,
      [nid, avant.libelle, suivante, avant.delegataire_id, avant.type_beneficiaire,
       new Date().toISOString().slice(0, 10), avant.date_fin,
       avant.num_contrat_standard, avant.num_contrat_cdp, avant.num_contrat_mpr, avant.par_defaut,
       modeChoisi,
       ...RATIOS.map(([c]) => nouveaux[c])]
    )
    run('UPDATE deal SET actif = 0, par_defaut = 0, date_fin = ? WHERE id = ?',
      [new Date().toISOString().slice(0, 10), id])
    for (const [champ, ligne, regime, mpr] of changes) {
      journaliser({
        entite: 'Deal', entiteId: nid, champ: `${ligne} — ${regime.toLowerCase()}, ${mpr} (€/MWh)`,
        ancienne: avant[champ], nouvelle: nouveaux[champ], utilisateurId: u.id,
      })
    }
    journaliser({ entite: 'Deal', entiteId: nid, champ: 'Nouvelle version', ancienne: avant.version, nouvelle: suivante, utilisateurId: u.id })
    revalidatePath('/parametrage/deals')
    retour('deals', `${figes} dossier(s) sont figés sur « ${avant.libelle} ${avant.version} » : la version ${suivante} a été créée et l'ancienne archivée. Aucun dossier n'a été recalculé.${mentionAnomalies(nouveaux, modeChoisi)}`)
  }

  for (const [champ, ligne, regime, mpr] of changes) {
    run(`UPDATE deal SET ${champ} = ? WHERE id = ?`, [nouveaux[champ], id])
    journaliser({
      entite: 'Deal', entiteId: id, champ: `${ligne} — ${regime.toLowerCase()}, ${mpr} (€/MWh)`,
      ancienne: avant[champ], nouvelle: nouveaux[champ], utilisateurId: u.id,
    })
  }
  revalidatePath('/parametrage/deals')
  retour('deals', `${changes.length} ratio(s) mis à jour. Aucun dossier n'était figé sur ce deal.${mentionAnomalies(nouveaux, modeChoisi)}`)
}

function prochaineVersion(v) {
  const m = /^V?(\d+)$/i.exec(String(v || 'V1'))
  return m ? `V${Number(m[1]) + 1}` : `${v}-suite`
}

export async function basculerDeal(formData) {
  const u = await exiger('deal.gerer')
  const id = txt(formData.get('id'))
  const champ = String(formData.get('champ')) === 'par_defaut' ? 'par_defaut' : 'actif'
  const d = get('SELECT * FROM deal WHERE id = ?', [id])
  if (!d) retour('deals', 'Deal introuvable.')

  const nouveau = d[champ] ? 0 : 1
  if (champ === 'par_defaut' && nouveau) run('UPDATE deal SET par_defaut = 0')
  run(`UPDATE deal SET ${champ} = ? WHERE id = ?`, [nouveau, id])
  journaliser({ entite: 'Deal', entiteId: id, champ: champ === 'actif' ? 'Actif' : 'Deal par défaut', ancienne: d[champ], nouvelle: nouveau, utilisateurId: u.id })
  revalidatePath('/parametrage/deals')
  retour('deals', 'Enregistré.')
}

// ══ Installateurs RGE ═════════════════════════════════════════

export async function enregistrerInstallateur(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const raison = txt(formData.get('raison_sociale'))
  if (!raison) retour('rge', 'La raison sociale est obligatoire.')
  const siret = txt(formData.get('siret'))
  const actif = bool(formData.get('actif'))

  if (id) {
    const avant = get('SELECT * FROM installateur_rge WHERE id = ?', [id])
    run('UPDATE installateur_rge SET raison_sociale = ?, siret = ?, actif = ? WHERE id = ?', [raison, siret, actif, id])
    journaliser({ entite: 'Installateur', entiteId: id, champ: 'Modification', ancienne: avant?.raison_sociale, nouvelle: raison, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO installateur_rge (id, raison_sociale, siret, actif) VALUES (?,?,?,?)', [nid, raison, siret, actif])
    journaliser({ entite: 'Installateur', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: raison, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/rge')
  retour('rge', 'Enregistré.')
}

export async function ajouterCertification(formData) {
  const u = await exiger('referentiel.gerer')
  const installateurId = txt(formData.get('installateur_id'))
  const libelle = txt(formData.get('libelle'))
  const debut = txt(formData.get('date_debut'))
  const fin = txt(formData.get('date_fin'))
  if (!installateurId || !libelle || !debut || !fin) retour('rge', 'Libellé et les deux dates sont obligatoires.')
  if (fin <= debut) retour('rge', 'La date de fin doit être postérieure à la date de début.')

  const id = uid()
  run('INSERT INTO certification_rge (id, installateur_id, libelle, numero, date_debut, date_fin) VALUES (?,?,?,?,?,?)',
    [id, installateurId, libelle, txt(formData.get('numero')), debut, fin])
  journaliser({ entite: 'Installateur', entiteId: installateurId, champ: 'Certification ajoutée', ancienne: null, nouvelle: `${libelle} (${debut} → ${fin})`, utilisateurId: u.id })
  revalidatePath('/parametrage/rge')
  retour('rge', 'Certification ajoutée.')
}

export async function supprimerCertification(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const c = get('SELECT * FROM certification_rge WHERE id = ?', [id])
  if (!c) retour('rge', 'Certification introuvable.')
  run('DELETE FROM certification_rge WHERE id = ?', [id])
  journaliser({ entite: 'Installateur', entiteId: c.installateur_id, champ: 'Certification retirée', ancienne: c.libelle, nouvelle: null, utilisateurId: u.id })
  revalidatePath('/parametrage/rge')
  retour('rge', 'Certification retirée.')
}

// ══ Types de documents et liasses ═════════════════════════════

export async function enregistrerTypeDocument(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const code = txt(formData.get('code'))?.toUpperCase().replace(/\s+/g, '_')
  const libelle = txt(formData.get('libelle'))
  if (!code || !libelle) retour('pieces', 'Code et libellé sont obligatoires.')

  const doublon = get('SELECT id FROM type_document WHERE code = ? AND id IS NOT ?', [code, id])
  if (doublon) retour('pieces', `Le code « ${code} » est déjà utilisé.`)

  if (id) {
    run('UPDATE type_document SET code = ?, libelle = ? WHERE id = ?', [code, libelle, id])
    journaliser({ entite: 'TypeDocument', entiteId: id, champ: 'Modification', ancienne: null, nouvelle: `${code} — ${libelle}`, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO type_document (id, code, libelle) VALUES (?,?,?)', [nid, code, libelle])
    journaliser({ entite: 'TypeDocument', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: `${code} — ${libelle}`, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/pieces')
  retour('pieces', 'Enregistré.')
}

export async function supprimerTypeDocument(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const t = get('SELECT * FROM type_document WHERE id = ?', [id])
  if (!t) retour('pieces', 'Type introuvable.')

  const pieces = get('SELECT COUNT(*) AS n FROM document_dossier WHERE type_document_id = ?', [id]).n
  const dansLiasses = get('SELECT COUNT(*) AS n FROM liasse_item WHERE type_document_id = ?', [id]).n
  if (pieces > 0) retour('pieces', `« ${t.libelle} » est porté par ${pieces} pièce(s) de dossier : il ne peut pas être supprimé.`)
  if (dansLiasses > 0) retour('pieces', `« ${t.libelle} » figure dans ${dansLiasses} liasse(s) : retirez-l'en d'abord.`)

  run('DELETE FROM type_document WHERE id = ?', [id])
  journaliser({ entite: 'TypeDocument', entiteId: id, champ: 'Suppression', ancienne: t.libelle, nouvelle: null, utilisateurId: u.id })
  revalidatePath('/parametrage/pieces')
  retour('pieces', `« ${t.libelle} » supprimé.`)
}

export async function enregistrerLiasse(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const libelle = txt(formData.get('libelle'))
  if (!libelle) retour('pieces', 'Le libellé est obligatoire.')
  const delegataireId = txt(formData.get('delegataire_id'))
  const ficheCode = txt(formData.get('fiche_code'))
  const actif = bool(formData.get('actif'))

  if (id) {
    run('UPDATE liasse SET libelle = ?, delegataire_id = ?, fiche_code = ?, actif = ? WHERE id = ?',
      [libelle, delegataireId, ficheCode, actif, id])
    journaliser({ entite: 'Liasse', entiteId: id, champ: 'Modification', ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO liasse (id, libelle, delegataire_id, fiche_code, actif) VALUES (?,?,?,?,?)',
      [nid, libelle, delegataireId, ficheCode, actif])
    journaliser({ entite: 'Liasse', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/pieces')
  retour('pieces', 'Enregistré.')
}

export async function majContenuLiasse(formData) {
  const u = await exiger('referentiel.gerer')
  const liasseId = txt(formData.get('liasse_id'))
  const l = get('SELECT * FROM liasse WHERE id = ?', [liasseId])
  if (!l) retour('pieces', 'Liasse introuvable.')

  const choisis = formData.getAll('type').map(String)
  const obligatoires = new Set(formData.getAll('obligatoire').map(String))
  const avant = all('SELECT li.type_document_id, li.obligatoire, td.libelle FROM liasse_item li JOIN type_document td ON td.id = li.type_document_id WHERE li.liasse_id = ?', [liasseId])

  // ── Garder l'ordre déjà choisi ──
  //
  // `ordre` décide de la suite dans laquelle les pièces s'affichent sur CHAQUE dossier
  // qui emploie cette liasse (documents.js : ORDER BY li.ordre). L'ordre utile est celui
  // du métier — attestation, devis, facture, attestation de fin de travaux — et non
  // l'alphabet.
  //
  // Or la page présente les cases dans l'ordre alphabétique des libellés. Renuméroter
  // d'après la position des cases, comme on le faisait, remplaçait donc l'ordre métier
  // par l'ordre alphabétique — au premier enregistrement, sans que personne l'ait demandé
  // ni ne le voie. Enregistrer deux fois de suite ne donnait pas le même résultat que
  // d'enregistrer une fois : c'est ce qu'un contrôle de recette a fini par signaler.
  //
  // On conserve donc le rang des pièces déjà présentes ; les nouvelles se rangent à la
  // suite, dans l'ordre où elles ont été cochées.
  const rangs = new Map(all('SELECT type_document_id, ordre FROM liasse_item WHERE liasse_id = ?', [liasseId])
    .map((r) => [r.type_document_id, r.ordre]))
  let suivant = rangs.size ? Math.max(...rangs.values()) + 1 : 0

  run('DELETE FROM liasse_item WHERE liasse_id = ?', [liasseId])
  choisis.forEach((t) => {
    run('INSERT INTO liasse_item (id, liasse_id, type_document_id, obligatoire, ordre) VALUES (?,?,?,?,?)',
      [uid(), liasseId, t, obligatoires.has(t) ? 1 : 0, rangs.has(t) ? rangs.get(t) : suivant++])
  })

  const apres = all('SELECT li.type_document_id, li.obligatoire, td.libelle FROM liasse_item li JOIN type_document td ON td.id = li.type_document_id WHERE li.liasse_id = ?', [liasseId])
  const desc = (x) => x.map((i) => `${i.libelle}${i.obligatoire ? '*' : ''}`).sort().join(', ')
  journaliser({
    entite: 'Liasse', entiteId: liasseId, champ: `Contenu de « ${l.libelle} »`,
    ancienne: desc(avant), nouvelle: desc(apres), utilisateurId: u.id,
  })
  revalidatePath('/parametrage/pieces')
  retour('pieces', `Liasse « ${l.libelle} » : ${choisis.length} pièce(s), dont ${choisis.filter((t) => obligatoires.has(t)).length} obligatoire(s).`)
}

// ══ Workflow : étapes, statuts, unités ════════════════════════

export async function enregistrerEtape(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const libelle = txt(formData.get('libelle'))
  if (!libelle) retour('workflow', 'Le libellé est obligatoire.')
  const ordre = Math.round(num(formData.get('ordre')))
  const couleur = txt(formData.get('couleur')) || '#64748b'

  if (id) {
    run('UPDATE etape SET libelle = ?, ordre = ?, couleur = ? WHERE id = ?', [libelle, ordre, couleur, id])
    journaliser({ entite: 'Etape', entiteId: id, champ: 'Modification', ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO etape (id, libelle, ordre, couleur) VALUES (?,?,?,?)', [nid, libelle, ordre, couleur])
    journaliser({ entite: 'Etape', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/workflow')
  retour('workflow', 'Enregistré.')
}

export async function enregistrerStatut(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const libelle = txt(formData.get('libelle'))
  if (!libelle) retour('workflow', 'Le libellé est obligatoire.')
  const axe = txt(formData.get('axe')) || 'DOSSIER'
  const etapeId = txt(formData.get('etape_id'))
  const ordre = Math.round(num(formData.get('ordre')))
  const couleur = txt(formData.get('couleur')) || '#64748b'
  const perdu = bool(formData.get('perdu'))

  if (id) {
    const avant = get('SELECT * FROM statut WHERE id = ?', [id])
    run('UPDATE statut SET libelle = ?, axe = ?, etape_id = ?, ordre = ?, couleur = ?, perdu = ? WHERE id = ?',
      [libelle, axe, etapeId, ordre, couleur, perdu, id])
    if (avant && Number(avant.perdu) !== perdu) {
      const n = usages('dossier', 'statut_dossier_id', id)
      journaliser({
        entite: 'Statut', entiteId: id, champ: `« ${libelle} » compte comme perdu`,
        ancienne: avant.perdu ? 'oui' : 'non', nouvelle: perdu ? 'oui' : 'non', utilisateurId: u.id,
      })
      revalidatePath('/parametrage/workflow')
      revalidatePath('/')
      retour('workflow', `« ${libelle} » ${perdu ? 'compte désormais' : 'ne compte plus'} comme perdu : le taux de déperdition du tableau de bord change pour ${n} dossier(s).`)
    }
    journaliser({ entite: 'Statut', entiteId: id, champ: 'Modification', ancienne: avant?.libelle, nouvelle: libelle, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO statut (id, libelle, axe, etape_id, ordre, couleur, perdu) VALUES (?,?,?,?,?,?,?)',
      [nid, libelle, axe, etapeId, ordre, couleur, perdu])
    journaliser({ entite: 'Statut', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: `${libelle} (${axe})`, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/workflow')
  retour('workflow', 'Enregistré.')
}

export async function supprimerStatut(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const s = get('SELECT * FROM statut WHERE id = ?', [id])
  if (!s) retour('workflow', 'Statut introuvable.')

  const colonnes = ['statut_dossier_id', 'statut_admin_id', 'statut_facturation_id', 'statut_installation_id', 'statut_cofrac_id']
  const total = colonnes.reduce((n, c) => n + usages('dossier', c, id), 0)
  if (total > 0) retour('workflow', `« ${s.libelle} » est porté par ${total} dossier(s) : il ne peut pas être supprimé sans les réaffecter.`)

  run('DELETE FROM statut WHERE id = ?', [id])
  journaliser({ entite: 'Statut', entiteId: id, champ: 'Suppression', ancienne: s.libelle, nouvelle: null, utilisateurId: u.id })
  revalidatePath('/parametrage/workflow')
  retour('workflow', `« ${s.libelle} » supprimé.`)
}

export async function enregistrerUnite(formData) {
  const u = await exiger('utilisateur.gerer')
  const id = txt(formData.get('id'))
  const nom = txt(formData.get('nom'))
  if (!nom) retour('workflow', 'Le nom est obligatoire.')
  const type = txt(formData.get('type')) || 'REGIE'
  const actif = bool(formData.get('actif'))

  if (id) {
    run('UPDATE unite_affaire SET nom = ?, type = ?, actif = ? WHERE id = ?', [nom, type, actif, id])
    journaliser({ entite: 'UniteAffaire', entiteId: id, champ: 'Modification', ancienne: null, nouvelle: nom, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO unite_affaire (id, nom, type, actif) VALUES (?,?,?,?)', [nid, nom, type, actif])
    journaliser({ entite: 'UniteAffaire', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: nom, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/workflow')
  retour('workflow', 'Enregistré.')
}

// ══ Types d'intervention (planning) ═══════════════════════════
//
// Pas de suppression : un type retiré se désactive. Il disparaît des listes de création et
// des onglets du planning, mais les interventions passées gardent leur libellé et leur couleur.
export async function enregistrerTypeIntervention(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const libelle = txt(formData.get('libelle'))
  const couleur = txt(formData.get('couleur')) || '#64748b'
  if (!libelle) retour('interventions', 'Le libellé est obligatoire.')
  if (!/^#[0-9a-f]{6}$/i.test(couleur)) retour('interventions', 'Couleur invalide.')
  const ordre = Math.round(num(formData.get('ordre')))
  const actif = bool(formData.get('actif'))
  const description = txt(formData.get('description'))

  if (id) {
    const avant = get('SELECT * FROM type_intervention WHERE id = ?', [id])
    if (!avant) retour('interventions', 'Type introuvable.')
    run('UPDATE type_intervention SET libelle = ?, couleur = ?, ordre = ?, actif = ?, description = ? WHERE id = ?',
      [libelle, couleur, ordre, actif, description, id])
    journaliser({ entite: 'TypeIntervention', entiteId: id, champ: 'Modification',
      ancienne: `${avant.libelle}${avant.actif ? '' : ' (désactivé)'}`, nouvelle: `${libelle}${actif ? '' : ' (désactivé)'}`, utilisateurId: u.id })
  } else {
    // Le code se déduit du libellé : il ne sert qu'aux rapprochements internes (la date de
    // pose du dossier suit le type POSE), et un nouveau type n'en a aucun.
    const base = libelle.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')
    let code = base, k = 2
    while (get('SELECT 1 AS x FROM type_intervention WHERE code = ?', [code])) code = `${base}_${k++}`
    const nid = uid()
    run('INSERT INTO type_intervention (id, code, libelle, couleur, ordre, actif, description) VALUES (?,?,?,?,?,1,?)',
      [nid, code, libelle, couleur, ordre, description])
    journaliser({ entite: 'TypeIntervention', entiteId: nid, champ: 'Création', ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/interventions')
  revalidatePath('/planning')
  retour('interventions', 'Enregistré.')
}

// ══ Listes du S.A.V ═══════════════════════════════════════════
//
// Types, statuts et motifs, dans une même table. Pas de suppression : désactivé, un libellé
// sort des listes de choix mais reste lisible sur les S.A.V qui le portent.
export async function enregistrerReferentielSav(formData) {
  const u = await exiger('referentiel.gerer')
  const id = txt(formData.get('id'))
  const categorie = txt(formData.get('categorie'))
  if (!['TYPE', 'STATUT', 'MOTIF'].includes(categorie)) retour('sav', 'Catégorie inconnue.')
  const libelle = txt(formData.get('libelle'))
  if (!libelle) retour('sav', 'Le libellé est obligatoire.')
  const valeurs = {
    libelle, description: txt(formData.get('description')), ordre: Math.round(num(formData.get('ordre'))),
    actif: id ? bool(formData.get('actif')) : 1, cloture: categorie === 'STATUT' ? bool(formData.get('cloture')) : 0,
  }
  if (id) {
    const avant = get('SELECT * FROM sav_referentiel WHERE id = ? AND categorie = ?', [id, categorie])
    if (!avant) retour('sav', 'Valeur introuvable.')
    run('UPDATE sav_referentiel SET libelle = ?, description = ?, ordre = ?, actif = ?, cloture = ? WHERE id = ?',
      [valeurs.libelle, valeurs.description, valeurs.ordre, valeurs.actif, valeurs.cloture, id])
    journaliser({ entite: 'ReferentielSAV', entiteId: id, champ: categorie, ancienne: avant.libelle, nouvelle: `${libelle}${valeurs.actif ? '' : ' (désactivé)'}`, utilisateurId: u.id })
  } else {
    const nid = uid()
    run('INSERT INTO sav_referentiel (id, categorie, libelle, description, ordre, actif, cloture) VALUES (?,?,?,?,?,?,?)',
      [nid, categorie, valeurs.libelle, valeurs.description, valeurs.ordre, 1, valeurs.cloture])
    journaliser({ entite: 'ReferentielSAV', entiteId: nid, champ: categorie, ancienne: null, nouvelle: libelle, utilisateurId: u.id })
  }
  revalidatePath('/parametrage/sav')
  retour('sav', 'Enregistré.')
}
