import { CRITERES, SECTIONS, COLONNES, COLONNES_PAR_DEFAUT } from '../../lib/recherche.js'
import { TYPES_LEAD, ETATS_DEVIS, ROLES_INTERVENANT } from '../../lib/referentiels-commercial.js'
import Raccourcis from './Raccourcis.jsx'

/**
 * Le formulaire de recherche est construit à partir du catalogue de critères, pas écrit à la main.
 * Ajouter un critère dans lib/recherche.js le fait apparaître ici, dans la barre de filtres
 * actifs et dans l'export, sans toucher à cet écran.
 */

/** Listes déroulantes proposées pour certains critères, alimentées par la base. */
function optionsPour(cle, o) {
  switch (cle) {
    case 'fiche': return o.fiches
    case 'secteur_fiche': return o.secteurs
    case 'statut': return o.statuts
    case 'etape': return o.etapes
    case 'statut_admin': return o.statutsAdmin
    case 'cofrac': return o.cofrac
    case 'departement': return o.departements
    case 'zone': return o.zones
    case 'secteur_act': return o.secteursActivite
    case 'chauffage': return o.chauffages
    case 'regime': return ['PRECAIRE', 'CLASSIQUE']
    case 'charte': return ['CDP', 'HORS_CDP']
    case 'delegataire': return o.delegataires
    case 'installateur': return o.installateurs
    case 'unite': return o.unites
    case 'deal': return o.deals
    case 'lot': return o.lots
    // Les listes fermées du parcours commercial viennent du référentiel, pas de la base :
    // proposer les seules valeurs déjà saisies masquerait les canaux encore inutilisés.
    case 'type_lead': return TYPES_LEAD.map(([id, nom]) => ({ id, nom }))
    case 'etat_devis': return ETATS_DEVIS.map(([id, nom]) => ({ id, nom }))
    case 'role_tenu': return ROLES_INTERVENANT.map(([id, nom]) => ({ id, nom }))
    default: return null
  }
}

function ChampCritere({ cle, def, valeur, options }) {
  const liste = optionsPour(cle, options)

  if (def.type === 'booleen' || def.type === 'est_nul') {
    return (
      <div className="field">
        <label htmlFor={cle}>{def.libelle}</label>
        <select id={cle} name={cle} defaultValue={valeur ?? ''}>
          <option value="">indifférent</option>
          <option value="oui">oui</option>
          {def.type === 'booleen' && <option value="non">non</option>}
        </select>
      </div>
    )
  }

  if (liste) {
    return (
      <div className="field">
        <label htmlFor={cle}>{def.libelle}</label>
        <select id={cle} name={cle} defaultValue={valeur ?? ''}>
          <option value="">tous</option>
          {liste.map((x) => {
            const v = typeof x === 'string' ? x : x.id
            const t = typeof x === 'string' ? x : x.nom
            return <option key={v} value={v}>{t}</option>
          })}
        </select>
      </div>
    )
  }

  const type = def.type.startsWith('date') ? 'date' : def.type.startsWith('nombre') ? 'number' : 'text'
  return (
    <div className="field">
      <label htmlFor={cle}>{def.libelle}</label>
      <input id={cle} name={cle} type={type} defaultValue={valeur ?? ''} step={type === 'number' ? 'any' : undefined} />
    </div>
  )
}

export function FormulaireRecherche({ valeurs, options, colonnes, voitMarge, ouvert }) {
  const parSection = {}
  for (const [cle, def] of Object.entries(CRITERES)) {
    (parSection[def.section] ||= []).push([cle, def])
  }

  return (
    <form method="GET" action="/dossiers">
      <Raccourcis />
      <div className="recherche-rapide">
        <input
          type="search"
          name="q"
          defaultValue={valeurs.q || ''}
          placeholder="N° de dossier, référence, bénéficiaire, SIRET, ville, code de fiche…    ( / )"
          aria-label="Recherche rapide — appuyez sur la touche barre oblique pour y revenir"
        />
        <button className="btn primary">Rechercher</button>
        <a className="btn" href="/dossiers">Réinitialiser</a>
      </div>

      <details className="avance" open={ouvert}>
        <summary>Recherche avancée — {Object.keys(CRITERES).length} critères</summary>
        {/* Rouvre le panneau après envoi, pour enchaîner plusieurs ajustements sans reclic. */}
        <input type="hidden" name="avance" value="1" />
        <div className="avance-corps">
          {SECTIONS.map((section) => (
            <div className="section-critere" key={section}>
              <h3>{section}</h3>
              <div className="grille-critere">
                {(parSection[section] || []).map(([cle, def]) => (
                  <ChampCritere key={cle} cle={cle} def={def} valeur={valeurs[cle]} options={options} />
                ))}
              </div>
            </div>
          ))}

          <div className="section-critere">
            <h3>Colonnes affichées</h3>
            <div className="choix-colonnes">
              {Object.entries(COLONNES)
                .filter(([, c]) => voitMarge || !c.marge)
                .map(([cle, c]) => (
                  <label key={cle}>
                    <input type="checkbox" name="col" value={cle} defaultChecked={colonnes.includes(cle)} />
                    {c.libelle}
                  </label>
                ))}
            </div>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
              Votre choix est conservé dans l'adresse de la page : mettez-la en favori pour
              retrouver votre vue, et partagez-la telle quelle à un collègue.
            </p>
          </div>

          {/* Le tri en cours doit survivre à une nouvelle recherche. */}
          {valeurs.tri && <input type="hidden" name="tri" value={valeurs.tri} />}
          {valeurs.sens && <input type="hidden" name="sens" value={valeurs.sens} />}
          {valeurs.par && <input type="hidden" name="par" value={valeurs.par} />}

          <div className="barre-actions">
            <button className="btn primary">Appliquer</button>
            <a className="btn" href="/dossiers">Tout effacer</a>
          </div>
        </div>
      </details>
    </form>
  )
}

export { COLONNES_PAR_DEFAUT }
