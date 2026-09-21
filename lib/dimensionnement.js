/**
 * Le dimensionnement : du relevé commercial à l'opération chiffrée.
 *
 * ── Ce que ce module fait, et surtout ce qu'il ne fait pas ──
 *
 * Il RASSEMBLE : les réponses du client (volumes, bâtiment, énergie), les conclusions du
 * bureau d'études (puissance thermique, nombre de kits), et il les rapproche pour signaler
 * ce qui ne colle pas.
 *
 * Il ne dimensionne PAS. Aucune formule ici ne propose une puissance ou un nombre de kits :
 * ce calcul dépend du produit, de l'humidité à retirer, du débit, de la technologie
 * installée, et il appartient au bureau d'études. Une plateforme qui suggérerait une
 * puissance « à partir du volume » produirait un chiffre plausible et faux, que quelqu'un
 * finirait par recopier dans un devis.
 *
 * Ce qu'il se permet, c'est l'ARITHMÉTIQUE VÉRIFIABLE : longueur × largeur × hauteur donne
 * un volume, et si le client en a déclaré un autre, il y a une raison à comprendre avant de
 * dimensionner. C'est un contrôle, pas une proposition.
 *
 * ── Le lien avec le calcul CEE ──
 *
 * Sur AGRI-EQ-110, le volume cumac vaut « barème × puissance thermique installée en kW ».
 * La puissance décidée ici est donc LA quantité de l'opération. Elle n'y est pas recopiée
 * automatiquement : le report est une action explicite du bureau d'études, parce qu'il
 * change le montant de la prime et qu'un chiffre qui se propage tout seul est un chiffre
 * que personne ne relit.
 */
import { reponsesDuDossier, definitionQualification, lireReponse } from './fiche-qualification.js'

/** La fiche CEE du séchage solaire hybride. */
export const FICHE_SECHAGE = 'AGRI-EQ-110'

/** Les champs que le bureau d'études renseigne — la section 14 de la fiche. */
export const CHAMPS_DIMENSIONNEMENT = [
  'q.dim_capacite', 'q.dim_volume_utile', 'q.dim_nb_kits',
  'q.dim_puissance', 'q.dim_debit', 'q.dim_surface_diffusion', 'q.dim_observations',
]

/** Les réponses du client qui servent à dimensionner, dans l'ordre où on les lit. */
export const ENTREES_CLIENT = [
  ['q.produit_nature', 'Produit à sécher'],
  ['q.produit_essence', 'Essence de bois'],
  ['q.humidite_initiale', 'Humidité initiale (%)'],
  ['q.humidite_cible', 'Humidité cible (%)'],
  ['q.prod_annuelle_t', 'Production annuelle (t)'],
  ['q.prod_annuelle_m3', 'Production annuelle (m³)'],
  ['q.cycles_an', 'Cycles par an'],
  ['q.duree_cycle_j', 'Durée d\'un cycle (jours)'],
  ['q.bat_surface', 'Surface du bâtiment (m²)'],
  ['q.bat_longueur', 'Longueur (m)'],
  ['q.bat_largeur', 'Largeur (m)'],
  ['q.bat_hauteur', 'Hauteur (m)'],
  ['q.bat_volume', 'Volume déclaré (m³)'],
  ['q.bat_isolation', 'Bâtiment isolé'],
  ['q.stockage', 'Mode de stockage'],
  ['q.stockage_hauteur', 'Hauteur de stockage (m)'],
  ['q.energie', 'Énergies disponibles'],
  ['q.energie_kva', 'Puissance souscrite (kVA)'],
  ['q.temp_max', 'Température max admissible (°C)'],
  ['q.sechoir_existant', 'Séchoir existant'],
  ['q.sechoir_puissance', 'Puissance du séchoir existant (kW)'],
  ['q.implantation', 'Implantation'],
]

const nb = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Ce que l'arithmétique seule permet de dire.
 *
 * Trois écarts, et rien de plus. Chacun est un fait vérifiable, pas un avis :
 * un volume qui ne correspond pas aux dimensions, une humidité cible au-dessus de
 * l'initiale, une puissance décidée qui dépasse ce que le compteur peut fournir.
 */
export function controlesDimensionnement(reponses, entite = {}) {
  const out = []
  const v = (cle) => nb(reponses[cle])

  const L = v('q.bat_longueur'); const l = v('q.bat_largeur'); const h = v('q.bat_hauteur')
  const volumeDeclare = v('q.bat_volume')
  if (L && l && h) {
    const calcule = Math.round(L * l * h)
    if (volumeDeclare && Math.abs(calcule - volumeDeclare) / calcule > 0.1) {
      out.push({
        niveau: 'AVERTISSEMENT', champ: 'q.bat_volume',
        message: `Le volume déclaré (${volumeDeclare} m³) s'écarte de plus de 10 % du produit `
          + `des dimensions (${L} × ${l} × ${h} = ${calcule} m³). L'un des deux est à revoir avant de dimensionner.`,
      })
    }
  }

  const surface = v('q.bat_surface')
  if (L && l && surface) {
    const calculee = Math.round(L * l)
    if (Math.abs(calculee - surface) / calculee > 0.1) {
      out.push({
        niveau: 'AVERTISSEMENT', champ: 'q.bat_surface',
        message: `La surface déclarée (${surface} m²) s'écarte de plus de 10 % de longueur × largeur `
          + `(${calculee} m²).`,
      })
    }
  }

  const hi = v('q.humidite_initiale'); const hc = v('q.humidite_cible')
  if (hi !== null && hc !== null && hc >= hi) {
    out.push({
      niveau: 'BLOQUANT', champ: 'q.humidite_cible',
      message: `L'humidité cible (${hc} %) n'est pas inférieure à l'humidité initiale (${hi} %). `
        + `Il n'y a rien à sécher : l'une des deux valeurs est fausse.`,
    })
  }

  // Une puissance thermique supérieure à ce que le compteur délivre n'est pas une erreur de
  // calcul, mais elle veut dire qu'il faudra augmenter l'abonnement — autant le savoir
  // avant de signer le devis, pas après la pose.
  const puissance = v('q.dim_puissance'); const kva = v('q.energie_kva')
  if (puissance !== null && kva !== null && puissance > kva) {
    out.push({
      niveau: 'AVERTISSEMENT', champ: 'q.dim_puissance',
      message: `La puissance thermique retenue (${puissance} kW) dépasse la puissance électrique `
        + `souscrite du site (${kva} kVA). À vérifier : un renforcement d'abonnement peut être nécessaire.`,
    })
  }

  if (puissance !== null && puissance <= 0) {
    out.push({
      niveau: 'BLOQUANT', champ: 'q.dim_puissance',
      message: 'La puissance thermique doit être strictement positive : c\'est elle qui porte tout le calcul CEE.',
    })
  }

  return out
}

/**
 * L'état du dimensionnement d'un dossier.
 *
 * `reportable` répond à une seule question : peut-on porter ce dimensionnement dans une
 * opération et calculer la prime ? Il faut pour cela une puissance, un type de produit et
 * un type d'installation — les trois entrées du barème AGRI-EQ-110 — et aucun bloquant.
 */
export function etatDimensionnement(db, dossierId) {
  const reponses = reponsesDuDossier(db, dossierId)

  const entrees = ENTREES_CLIENT.map(([cle, libelle]) => {
    const def = definitionQualification(cle)
    return { cle, libelle, valeur: def ? lireReponse(def, reponses[cle]) : (reponses[cle] ?? ''), def }
  })

  const sortie = CHAMPS_DIMENSIONNEMENT.map((cle) => {
    const def = definitionQualification(cle)
    return { cle, libelle: def?.libelle || cle, def, valeur: def ? lireReponse(def, reponses[cle]) : '' }
  })

  const anomalies = controlesDimensionnement(reponses)
  const puissance = nb(reponses['q.dim_puissance'])

  // Le type de produit se DÉDUIT de l'activité déclarée quand elle est nette, mais il n'est
  // jamais imposé : c'est le bureau d'études qui tranche, et le barème forestier vaut plus
  // du double de l'agricole. On propose, on affiche la raison, on laisse corriger.
  const activites = (() => {
    try { return JSON.parse(reponses['q.activite'] || '[]') } catch { return [] }
  })()
  const FORESTIERES = ['Scierie', 'Coopérative forestière', 'Exploitant forestier']
  const suggestionProduit = activites.length === 0 ? null
    : activites.every((a) => FORESTIERES.includes(a)) ? 'FORESTIER'
      : activites.some((a) => FORESTIERES.includes(a)) ? null
        : 'AGRICOLE'

  const operations = db.prepare(`
    SELECT o.id, o.quantite, o.unite, o.type_produit, o.type_installation, o.date_calcul, f.code
      FROM operation o JOIN fiche f ON f.id = o.fiche_id
     WHERE o.dossier_id = ? AND f.code = ?
     ORDER BY o.ordre`).all(dossierId, FICHE_SECHAGE)

  return {
    reponses,
    entrees,
    sortie,
    anomalies,
    puissance,
    suggestionProduit,
    motifSuggestion: suggestionProduit
      ? `Déduit de l'activité déclarée : ${activites.join(', ')}.`
      : activites.length
        ? `L'activité déclarée (${activites.join(', ')}) mélange filières agricole et forestière : à trancher à la main.`
        : "Aucune activité déclarée : le type de produit doit être choisi à la main.",
    operations,
    reportable: puissance !== null && puissance > 0 && !anomalies.some((a) => a.niveau === 'BLOQUANT'),
  }
}

/**
 * Porte le dimensionnement dans une opération AGRI-EQ-110.
 *
 * ── Pourquoi ce n'est pas automatique ──
 *
 * Cette fonction écrit la quantité qui décide de la prime. Elle est appelée sur un geste
 * explicite, jamais en réaction à une saisie. Un chiffre qui se propage tout seul d'un
 * écran à l'autre est un chiffre que plus personne ne relit — et ici, se tromper d'un
 * facteur dix sur la puissance, c'est se tromper d'un facteur dix sur la prime.
 *
 * ── Ce qu'elle refuse de faire ──
 *
 * Elle ne touche pas à une opération FIGÉE. Les montants figés sont ceux qui ont été
 * calculés, présentés, parfois facturés : les réécrire depuis un dimensionnement révisé
 * effacerait l'historique sans laisser de trace. Le bureau d'études révise, la plateforme
 * crée alors une NOUVELLE opération plutôt que d'écraser l'ancienne.
 */
export function reporterDansOperation(db, dossierId, { typeProduit, typeInstallation, utilisateurId = null }) {
  const etat = etatDimensionnement(db, dossierId)
  if (!etat.reportable) {
    return { ok: false, motifs: etat.anomalies.filter((a) => a.niveau === 'BLOQUANT').map((a) => a.message)
      .concat(etat.puissance === null ? ['La puissance thermique n\'est pas renseignée.'] : []) }
  }
  if (!['AGRICOLE', 'FORESTIER'].includes(typeProduit)) {
    return { ok: false, motifs: ['Le type de produit (agricole ou forestier) doit être choisi : le barème en dépend du simple au double.'] }
  }
  if (!['SYSTEME_COMPLET', 'TOITURE_COUPLEE'].includes(typeInstallation)) {
    return { ok: false, motifs: ["Le type d'installation doit être choisi."] }
  }

  const fiche = db.prepare('SELECT id FROM fiche WHERE code = ?').get(FICHE_SECHAGE)
  if (!fiche) return { ok: false, motifs: [`La fiche ${FICHE_SECHAGE} n'est pas chargée dans le référentiel.`] }
  const version = db.prepare(`SELECT id, unite_variable FROM fiche_version WHERE fiche_id = ?
                              ORDER BY date_effet DESC LIMIT 1`).get(fiche.id)

  const chantier = db.prepare('SELECT id FROM chantier WHERE dossier_id = ? ORDER BY ordre LIMIT 1').get(dossierId)

  // Une opération non figée est mise à jour ; une opération figée est laissée telle quelle
  // et une nouvelle est créée à côté.
  const existante = etat.operations.find((o) => !o.date_calcul)

  if (existante) {
    db.prepare(`UPDATE operation SET quantite = ?, unite = ?, type_produit = ?, type_installation = ?
                WHERE id = ?`)
      .run(etat.puissance, version?.unite_variable || 'kW', typeProduit, typeInstallation, existante.id)
    return { ok: true, operationId: existante.id, creee: false, puissance: etat.puissance }
  }

  const id = crypto.randomUUID()
  const ordre = db.prepare('SELECT COALESCE(MAX(ordre), 0) + 1 AS n FROM operation WHERE dossier_id = ?').get(dossierId).n
  db.prepare(`INSERT INTO operation (id, dossier_id, chantier_id, ordre, fiche_id, fiche_version_id,
              charte, quantite, unite, type_produit, type_installation, cout_pose, taux_apporteur)
              VALUES (?,?,?,?,?,?,'HORS_CDP',?,?,?,?,0,0)`)
    .run(id, dossierId, chantier?.id || null, ordre, fiche.id, version.id,
      etat.puissance, version?.unite_variable || 'kW', typeProduit, typeInstallation)

  return { ok: true, operationId: id, creee: true, puissance: etat.puissance }
}
