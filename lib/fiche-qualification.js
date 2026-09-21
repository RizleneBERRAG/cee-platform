/**
 * La fiche de qualification client — séchage hybride Hydro Control.
 *
 * ── Pourquoi une structure de données et pas un formulaire écrit à la main ──
 *
 * Seize sections, une centaine de champs, et un document qui évoluera : chaque produit
 * nouveau apportera sa fiche. Écrire ce formulaire en dur, c'est s'engager à rouvrir le
 * code à chaque virgule changée. Décrit ici en données, il se rend tout seul, se contrôle
 * tout seul, et la liste blanche des champs que le client peut remplir s'en déduit — plutôt
 * que d'être tenue à jour en parallèle, ce qui finit toujours par diverger.
 *
 * ── Ce que la fiche N'EST PAS ──
 *
 * Ce n'est pas le dossier. Les réponses du client vivent dans `reponse_qualification`, à
 * côté. Le commercial et le bureau d'études les lisent, s'en servent pour dimensionner, et
 * décident ensuite ce qui devient une opération. Une fiche de qualification remplie n'a
 * jamais créé d'engagement ; la traiter comme une source de calcul reviendrait à valoriser
 * un dossier sur des déclarations non vérifiées.
 *
 * ── Les sections réservées ──
 *
 * Trois sections ne sont PAS remplissables par le client : le dimensionnement (14), qui est
 * le travail du bureau d'études, et la conclusion commerciale (16), qui porte la
 * probabilité de signature — un client n'a pas à lire qu'on estime son projet à 25 %. La
 * check-list (15) lui est en revanche ouverte : c'est lui qui détient les photos et les
 * factures d'énergie.
 */

/** Les types de champ que le rendu sait produire. */
export const TYPES = ['texte', 'texte_long', 'nombre', 'date', 'tel', 'email', 'oui_non', 'choix', 'choix_multiple']

/**
 * La fiche. `reserve: true` sur une section = interne, jamais montrée au client.
 *
 * Chaque champ porte une clé stable (`q.` + un nom) : c'est elle qui est stockée, pas la
 * position. Réordonner la fiche ne doit pas déplacer les réponses déjà données.
 */
export const FICHE_QUALIFICATION = {
  code: 'HYDRO_CONTROL',
  titre: 'Fiche de qualification — système de séchage hybride Hydro Control',
  sections: [
    {
      numero: 1, titre: 'Informations générales',
      champs: [
        { cle: 'q.entreprise', libelle: "Nom de l'entreprise", type: 'texte', max: 200 },
        { cle: 'q.contact_nom', libelle: 'Nom du contact', type: 'texte', max: 120 },
        { cle: 'q.contact_fonction', libelle: 'Fonction', type: 'texte', max: 120 },
        { cle: 'q.contact_tel', libelle: 'Téléphone', type: 'tel', max: 30 },
        { cle: 'q.contact_email', libelle: 'Email', type: 'email', max: 200 },
        { cle: 'q.site_adresse', libelle: 'Adresse du site', type: 'texte', max: 250 },
        { cle: 'q.siret', libelle: 'SIRET', type: 'texte', max: 20 },
      ],
    },
    {
      numero: 2, titre: 'Activité',
      champs: [
        {
          cle: 'q.activite', libelle: 'Votre activité', type: 'choix_multiple',
          valeurs: ['Scierie', 'Coopérative forestière', 'Exploitant forestier', 'Céréales',
            'Fourrage', 'Luzerne', 'Foin', 'Maïs', 'Plantes aromatiques', 'CBD', 'Ail',
            'Oignons', 'Fruits'],
        },
        { cle: 'q.activite_autre', libelle: 'Autre activité', type: 'texte', max: 200 },
      ],
    },
    {
      numero: 3, titre: 'Produit à sécher',
      champs: [
        { cle: 'q.produit_nature', libelle: 'Nature du produit', type: 'texte', max: 200 },
        { cle: 'q.produit_essence', libelle: 'Essence de bois', type: 'texte', max: 120 },
        { cle: 'q.humidite_initiale', libelle: 'Humidité initiale (%)', type: 'nombre', min: 0, max: 100 },
        { cle: 'q.humidite_cible', libelle: 'Humidité cible (%)', type: 'nombre', min: 0, max: 100 },
      ],
    },
    {
      numero: 4, titre: 'Volume à sécher',
      champs: [
        { cle: 'q.prod_annuelle_t', libelle: 'Production annuelle (tonnes)', type: 'nombre', min: 0 },
        { cle: 'q.prod_annuelle_m3', libelle: 'Production annuelle (m³)', type: 'nombre', min: 0 },
        { cle: 'q.prod_mensuelle', libelle: 'Mensuelle', type: 'nombre', min: 0 },
        { cle: 'q.prod_hebdo', libelle: 'Hebdomadaire', type: 'nombre', min: 0 },
        { cle: 'q.prod_jour', libelle: 'Journalière', type: 'nombre', min: 0 },
      ],
    },
    {
      numero: 5, titre: 'Organisation',
      champs: [
        { cle: 'q.cycles_an', libelle: 'Nombre de cycles par an', type: 'nombre', min: 0 },
        { cle: 'q.duree_cycle_j', libelle: "Durée souhaitée d'un cycle (jours)", type: 'nombre', min: 0 },
        { cle: 'q.production_continue', libelle: 'Production continue', type: 'oui_non' },
      ],
    },
    {
      numero: 6, titre: 'Bâtiment',
      champs: [
        { cle: 'q.bat_surface', libelle: 'Surface (m²)', type: 'nombre', min: 0 },
        { cle: 'q.bat_longueur', libelle: 'Longueur (m)', type: 'nombre', min: 0 },
        { cle: 'q.bat_largeur', libelle: 'Largeur (m)', type: 'nombre', min: 0 },
        { cle: 'q.bat_hauteur', libelle: 'Hauteur (m)', type: 'nombre', min: 0 },
        { cle: 'q.bat_volume', libelle: 'Volume (m³)', type: 'nombre', min: 0 },
        { cle: 'q.bat_isolation', libelle: 'Bâtiment isolé', type: 'oui_non' },
      ],
    },
    {
      numero: 7, titre: 'Mode de stockage',
      champs: [
        {
          cle: 'q.stockage', libelle: 'Mode de stockage', type: 'choix_multiple',
          valeurs: ['Palette', 'Big Bag', 'En vrac', 'Claies', 'Box'],
        },
        { cle: 'q.stockage_hauteur', libelle: 'Hauteur de stockage (m)', type: 'nombre', min: 0 },
      ],
    },
    {
      numero: 8, titre: 'Énergie disponible',
      champs: [
        {
          cle: 'q.energie', libelle: 'Énergies disponibles', type: 'choix_multiple',
          valeurs: ['Électricité', 'Gaz', 'Biomasse', 'Fioul', 'Photovoltaïque', 'Solaire thermique'],
        },
        { cle: 'q.energie_kva', libelle: 'Puissance électrique souscrite (kVA)', type: 'nombre', min: 0 },
        { cle: 'q.energie_autre', libelle: 'Autre énergie', type: 'texte', max: 120 },
      ],
    },
    {
      numero: 9, titre: 'Vos objectifs',
      champs: [
        {
          cle: 'q.objectifs', libelle: 'Ce que vous attendez du projet', type: 'choix_multiple',
          valeurs: ['Réduire les coûts', 'Augmenter la capacité', 'Réduire le temps de séchage',
            'Améliorer la qualité', 'Automatiser', 'Valoriser les CEE', 'Réduire le CO₂'],
        },
      ],
    },
    {
      numero: 10, titre: 'Équipement actuel',
      champs: [
        { cle: 'q.sechoir_existant', libelle: 'Séchoir existant', type: 'oui_non' },
        { cle: 'q.sechoir_marque', libelle: 'Marque', type: 'texte', max: 120 },
        { cle: 'q.sechoir_puissance', libelle: 'Puissance (kW)', type: 'nombre', min: 0 },
        { cle: 'q.sechoir_debit', libelle: "Débit d'air (m³/h)", type: 'nombre', min: 0 },
        { cle: 'q.sechoir_problemes', libelle: 'Problèmes rencontrés', type: 'texte_long', max: 1000 },
      ],
    },
    {
      numero: 11, titre: 'Contraintes',
      champs: [
        { cle: 'q.temp_max', libelle: 'Température maximale admissible (°C)', type: 'nombre' },
        { cle: 'q.horaires', libelle: 'Horaires', type: 'texte', max: 200 },
        { cle: 'q.personnel', libelle: 'Personnel disponible', type: 'nombre', min: 0 },
        { cle: 'q.contraintes', libelle: 'Contraintes particulières', type: 'texte_long', max: 1000 },
      ],
    },
    {
      numero: 12, titre: 'Installation',
      champs: [
        { cle: 'q.implantation', libelle: 'Implantation', type: 'choix', valeurs: ['Intérieur', 'Extérieur'] },
        { cle: 'q.distance_hangar', libelle: "Distance jusqu'au hangar (m)", type: 'nombre', min: 0 },
        { cle: 'q.passage_gaines', libelle: 'Passage des gaines possible', type: 'oui_non' },
        { cle: 'q.acces_pl', libelle: 'Accès poids lourd', type: 'oui_non' },
      ],
    },
    {
      numero: 13, titre: 'Aides et financement',
      champs: [
        {
          cle: 'q.financement', libelle: 'Financement envisagé', type: 'choix_multiple',
          valeurs: ['CEE', 'Leasing', 'Crédit', 'Location', 'Autofinancement'],
        },
        { cle: 'q.budget', libelle: 'Budget estimé (€)', type: 'nombre', min: 0 },
      ],
    },
    {
      numero: 14, titre: 'Dimensionnement', reserve: true,
      aide: "Rempli par le bureau d'études.",
      champs: [
        { cle: 'q.dim_capacite', libelle: 'Capacité (tonnes/cycle)', type: 'nombre', min: 0 },
        { cle: 'q.dim_volume_utile', libelle: 'Volume utile (m³)', type: 'nombre', min: 0 },
        { cle: 'q.dim_nb_kits', libelle: 'Nombre de kits', type: 'nombre', min: 0 },
        { cle: 'q.dim_puissance', libelle: 'Puissance thermique (kW)', type: 'nombre', min: 0 },
        { cle: 'q.dim_debit', libelle: "Débit d'air (m³/h)", type: 'nombre', min: 0 },
        { cle: 'q.dim_surface_diffusion', libelle: 'Surface de diffusion (m²)', type: 'nombre', min: 0 },
        { cle: 'q.dim_observations', libelle: 'Observations', type: 'texte_long', max: 2000 },
      ],
    },
    {
      numero: 15, titre: 'Pièces à fournir',
      aide: 'Ce que vous pouvez nous transmettre pour affiner le dimensionnement.',
      champs: [
        {
          cle: 'q.photos', libelle: 'Photos disponibles', type: 'choix_multiple',
          valeurs: ['Site', 'Hangar', 'Stock', 'Accès', 'Réseau électrique', 'Toiture'],
        },
        {
          cle: 'q.documents', libelle: 'Documents disponibles', type: 'choix_multiple',
          valeurs: ['Plan du bâtiment', 'Factures énergie', 'Production annuelle', 'Coordonnées GPS'],
        },
      ],
    },
    {
      numero: 16, titre: 'Conclusion commerciale', reserve: true,
      aide: 'Interne. Jamais visible par le client.',
      champs: [
        {
          cle: 'q.projet_temperature', libelle: 'Projet', type: 'choix',
          valeurs: ['Très chaud', 'Chaud', 'Moyen', 'À suivre', 'Abandonné'],
        },
        { cle: 'q.probabilite', libelle: 'Probabilité', type: 'choix', valeurs: ['90 %', '75 %', '50 %', '25 %', '10 %'] },
        { cle: 'q.date_decision', libelle: 'Date de décision', type: 'date' },
        { cle: 'q.commentaires', libelle: 'Commentaires', type: 'texte_long', max: 2000 },
      ],
    },
  ],
}

/** Tous les champs, à plat, avec leur section. */
export function tousLesChamps(fiche = FICHE_QUALIFICATION) {
  return fiche.sections.flatMap((s) =>
    s.champs.map((c) => ({ ...c, section: s.numero, sectionTitre: s.titre, reserve: !!s.reserve })))
}

/** Les champs que le CLIENT peut remplir : tout sauf les sections réservées. */
export function champsClientQualification(fiche = FICHE_QUALIFICATION) {
  return tousLesChamps(fiche).filter((c) => !c.reserve)
}

/** Les sections visibles par le client. */
export function sectionsClient(fiche = FICHE_QUALIFICATION) {
  return fiche.sections.filter((s) => !s.reserve)
}

export function definitionQualification(cle, fiche = FICHE_QUALIFICATION) {
  return tousLesChamps(fiche).find((c) => c.cle === cle) || null
}

/**
 * Normalise une réponse selon son type. Renvoie `{ok, valeur, motif}`.
 *
 * Les valeurs sont stockées en texte, y compris les nombres : une fiche de qualification
 * est un relevé déclaratif, pas une base de calcul. En faire des réels obligerait à
 * trancher « 12 à 15 tonnes » ou « environ 200 », qui sont des réponses légitimes ici et
 * que l'on perdrait en les forçant. Un choix multiple est stocké en JSON.
 */
export function normaliserReponse(def, brut) {
  if (!def) return { ok: false, motif: 'Champ inconnu.' }

  if (def.type === 'choix_multiple') {
    const liste = Array.isArray(brut) ? brut : brut === undefined || brut === null || brut === '' ? [] : [brut]
    const inconnus = liste.filter((v) => !def.valeurs.includes(String(v)))
    if (inconnus.length) return { ok: false, motif: `« ${def.libelle} » : valeur hors liste (${inconnus.join(', ')}).` }
    return { ok: true, valeur: liste.length ? JSON.stringify(liste.map(String)) : null }
  }

  const s = brut === null || brut === undefined ? '' : String(brut).trim()
  if (s === '') return { ok: true, valeur: null }

  if (def.type === 'choix') {
    if (!def.valeurs.includes(s)) return { ok: false, motif: `« ${def.libelle} » : valeur hors liste.` }
    return { ok: true, valeur: s }
  }
  if (def.type === 'oui_non') {
    if (!['Oui', 'Non'].includes(s)) return { ok: false, motif: `« ${def.libelle} » : répondre Oui ou Non.` }
    return { ok: true, valeur: s }
  }
  if (def.type === 'nombre') {
    const n = Number(s.replace(',', '.').replace(/\s/g, ''))
    if (!Number.isFinite(n)) return { ok: false, motif: `« ${def.libelle} » doit être un nombre.` }
    if (def.min !== undefined && n < def.min) return { ok: false, motif: `« ${def.libelle} » ne peut pas être inférieur à ${def.min}.` }
    if (def.max !== undefined && n > def.max) return { ok: false, motif: `« ${def.libelle} » ne peut pas dépasser ${def.max}.` }
    return { ok: true, valeur: String(n) }
  }
  if (def.type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ok: false, motif: `« ${def.libelle} » : date attendue.` }
    return { ok: true, valeur: s }
  }
  if (def.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) {
    return { ok: false, motif: "L'adresse e-mail ne ressemble pas à une adresse valide." }
  }
  if (def.max && s.length > def.max) {
    return { ok: false, motif: `« ${def.libelle} » dépasse ${def.max} caractères.` }
  }
  return { ok: true, valeur: s }
}

/** Relit une valeur stockée pour l'affichage : un choix multiple redevient un tableau. */
export function lireReponse(def, stockee) {
  if (!def || stockee === null || stockee === undefined) return def?.type === 'choix_multiple' ? [] : ''
  if (def.type === 'choix_multiple') {
    try { const v = JSON.parse(stockee); return Array.isArray(v) ? v : [] } catch { return [] }
  }
  return String(stockee)
}

/** Les réponses d'un dossier, indexées par clé. */
export function reponsesDuDossier(db, dossierId) {
  const lignes = db.prepare('SELECT cle, valeur FROM reponse_qualification WHERE dossier_id = ?').all(dossierId)
  return Object.fromEntries(lignes.map((l) => [l.cle, l.valeur]))
}

/**
 * Enregistre des réponses — côté INTERNE seulement (commercial, bureau d'études).
 *
 * Le client, lui, ne passe jamais par ici : ses réponses deviennent une proposition, qui
 * est arbitrée avant d'atterrir. C'est la même règle que pour le reste de son dossier, et
 * elle vaut autant ici : une fiche de qualification décide du dimensionnement, donc du
 * prix. Elle n'est pas modifiable sans relecture.
 */
export function enregistrerReponses(db, dossierId, valeurs, utilisateurId = null) {
  const motifs = []
  const aEcrire = []

  for (const [cle, brut] of Object.entries(valeurs || {})) {
    const def = definitionQualification(cle)
    if (!def) { motifs.push(`Champ inconnu : ${cle}.`); continue }
    const n = normaliserReponse(def, brut)
    if (!n.ok) { motifs.push(n.motif); continue }
    aEcrire.push({ cle, valeur: n.valeur })
  }
  if (motifs.length) return { ok: false, motifs }

  db.exec('BEGIN')
  try {
    const sup = db.prepare('DELETE FROM reponse_qualification WHERE dossier_id = ? AND cle = ?')
    const ins = db.prepare(`INSERT INTO reponse_qualification (id, dossier_id, cle, valeur, saisi_par, saisi_le)
                            VALUES (?,?,?,?,?,datetime('now'))`)
    for (const l of aEcrire) {
      sup.run(dossierId, l.cle)
      if (l.valeur !== null) ins.run(crypto.randomUUID(), dossierId, l.cle, l.valeur, utilisateurId)
    }
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    return { ok: false, motifs: [e.message] }
  }
  return { ok: true, ecrits: aEcrire.length }
}

/**
 * Ce qui manque pour dimensionner.
 *
 * Volontairement court. Une fiche de qualification n'est pas un questionnaire à remplir
 * intégralement : le commercial en remplit ce qu'il peut voir, le client ce qu'il sait.
 * Ne sont signalés que les champs sans lesquels le bureau d'études ne peut rien calculer.
 */
export const INDISPENSABLES = [
  'q.produit_nature', 'q.humidite_initiale', 'q.humidite_cible',
  'q.bat_surface', 'q.bat_hauteur', 'q.energie',
]

export function completudeQualification(reponses) {
  const manquants = INDISPENSABLES
    .filter((c) => reponses[c] === undefined || reponses[c] === null || reponses[c] === '')
    .map((c) => definitionQualification(c))
    .filter(Boolean)

  const total = champsClientQualification().length
  const remplis = champsClientQualification().filter((c) => {
    const v = reponses[c.cle]
    return v !== undefined && v !== null && v !== ''
  }).length

  return {
    remplis, total,
    taux: total ? Math.round((remplis / total) * 100) : 0,
    manquants,
    dimensionnable: manquants.length === 0,
  }
}
