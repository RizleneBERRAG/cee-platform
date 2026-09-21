import { fichesDisponibles, deals, unites, delegataires, statutsParAxe } from '../../../lib/queries.js'
import { creerDossier } from '../../../lib/actions.js'

import { garde } from '../../../lib/garde.js'
import { ZONES_CLIMATIQUES, TYPES_CHAUFFAGE } from '../../../lib/referentiels-site.js'

/**
 * Le type de chauffage conditionne l'éligibilité de plusieurs fiches (celles qui excluent
 * les logements déjà chauffés à l'électricité, notamment). Il est donc réglementaire,
 * au même titre que la zone climatique.
 */
const CHAUFFAGES = [
  ['GAZ', 'Gaz'],
  ['FIOUL', 'Fioul'],
  ['ELECTRIQUE', 'Électrique'],
  ['BOIS', 'Bois'],
  ['RESEAU_CHALEUR', 'Réseau de chaleur'],
  ['POMPE_A_CHALEUR', 'Pompe à chaleur'],
  ['AUTRE', 'Autre'],
]

export const dynamic = 'force-dynamic'

const SECTEURS = [
  ['BUREAUX', 'Bureaux'], ['COMMERCE', 'Commerce'], ['SANTE', 'Santé'],
  ['ENSEIGNEMENT', 'Enseignement'], ['HOTEL_RESTAURANT', 'Hôtellerie-restauration'], ['AUTRE', 'Autre'],
]

export default async function NouveauDossier() {
  await garde('dossier.creer')
  const fiches = fichesDisponibles()
  const listeDeals = deals()
  const listeUnites = unites()
  const listeDelegs = delegataires()
  const statutsDossier = statutsParAxe('DOSSIER')
  const aujourdhui = new Date().toISOString().slice(0, 10)

  return (
    <>
      <h1>Nouveau dossier</h1>
      <p className="lede">
        La version de fiche applicable est déterminée automatiquement à partir de la date d'engagement.
        Si la fiche n'est plus en vigueur à cette date, le dossier est créé mais signalé comme non éligible.
      </p>

      <form action={creerDossier}>
        <div className="grid k2">
          <div className="card">
            <h2>Bénéficiaire</h2>
            <div className="field">
              <label>Type</label>
              <select name="type_beneficiaire" defaultValue="SOCIETE">
                <option value="SOCIETE">Société</option>
                <option value="PARTICULIER">Particulier</option>
              </select>
            </div>
            <div className="field"><label>Raison sociale</label><input name="raison_sociale" required /></div>
            <div className="grid k2" style={{ gap: 10 }}>
              <div className="field"><label>SIRET</label><input name="siret" /></div>
              <div className="field"><label>Code APE</label><input name="code_ape" /></div>
            </div>
            <div className="grid k2" style={{ gap: 10 }}>
              <div className="field"><label>Nom du contact</label><input name="nom" /></div>
              <div className="field"><label>Prénom</label><input name="prenom" /></div>
            </div>
            <div className="grid k2" style={{ gap: 10 }}>
              <div className="field"><label>E-mail</label><input name="email" type="email" /></div>
              <div className="field"><label>Téléphone</label><input name="telephone" /></div>
            </div>
            <div className="field">
              <label>Régime de revenu (décide du barème précaire ou classique)</label>
              <select name="regime_revenu" defaultValue="CLASSIQUE">
                <option value="CLASSIQUE">Classique</option>
                <option value="PRECAIRE">Précaire</option>
              </select>
            </div>
          </div>

          <div className="card">
            <h2>Site des travaux</h2>
            <div className="field"><label>Adresse</label><input name="adresse" required /></div>
            <div className="grid k2" style={{ gap: 10 }}>
              <div className="field"><label>Code postal</label><input name="code_postal" required /></div>
              <div className="field"><label>Ville</label><input name="ville" required /></div>
            </div>
            <div className="grid k2" style={{ gap: 10 }}>
              <div className="field">
                <label>Zone climatique</label>
                <select name="zone_climatique" defaultValue="H1">
                  {ZONES_CLIMATIQUES.map((z) => <option key={z.code} value={z.code}>{z.libelle}</option>)}
                </select>
              </div>
              <div className="field">
                <label>Secteur d'activité</label>
                <select name="secteur_activite" defaultValue="BUREAUX">
                  {SECTEURS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="grid k2" style={{ gap: 10 }}>
              <div className="field"><label>Âge du bâtiment (années)</label><input name="age_batiment" type="number" /></div>
              <div className="field"><label>Surface (m²)</label><input name="surface" type="number" step="any" /></div>
            </div>
            <div className="field">
              <label>Type de chauffage</label>
              <select name="type_chauffage" defaultValue="">
                <option value="">non renseigné</option>
                {CHAUFFAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label><input type="checkbox" name="qpv" style={{ width: 'auto', marginRight: 7 }} />Quartier prioritaire (QPV)</label>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: 14 }}>
          <h2>Opération et valorisation</h2>
          <div className="grid k4">
            <div className="field">
              <label>Fiche d'opération</label>
              <select name="fiche_id" required defaultValue="">
                <option value="" disabled>Choisir…</option>
                {fiches.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} — {f.libelle.slice(0, 40)}{f.date_fin ? ' ⚠' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="field"><label>Quantité</label><input name="quantite" type="number" step="any" defaultValue="0" /></div>
            <div className="field">
              <label>Date d'engagement</label>
              <input name="date_engagement" type="date" defaultValue={aujourdhui} />
            </div>
            <div className="field">
              <label>Charte</label>
              <select name="charte" defaultValue="HORS_CDP">
                <option value="HORS_CDP">Hors coup de pouce</option>
                <option value="CDP">Coup de pouce</option>
              </select>
            </div>
            <div className="field">
              <label>Deal</label>
              <select name="deal_id" defaultValue={listeDeals[0]?.id || ''}>
                <option value="">—</option>
                {listeDeals.map((x) => <option key={x.id} value={x.id}>{x.libelle} ({x.version})</option>)}
              </select>
            </div>
            <div className="field">
              <label>Délégataire</label>
              <select name="delegataire_id" defaultValue="">
                <option value="">—</option>
                {listeDelegs.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Unité d'affaire</label>
              <select name="unite_affaire_id" defaultValue="">
                <option value="">—</option>
                {listeUnites.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Statut de départ</label>
              <select name="statut_dossier_id" defaultValue={statutsDossier[0]?.id || ''}>
                {statutsDossier.map((s) => <option key={s.id} value={s.id}>{s.etape ? `${s.etape} · ` : ''}{s.libelle}</option>)}
              </select>
            </div>
            <div className="field"><label>Source du lead</label><input name="source" /></div>
            <div className="field"><label>Référence externe</label><input name="ref_externe" /></div>
            <div className="field">
              <label style={{ marginTop: 22 }}>
                <input type="checkbox" name="avec_mpr" style={{ width: 'auto', marginRight: 7 }} />
                Avec MaPrimeRénov'
              </label>
            </div>
          </div>
          <button className="btn primary">Créer le dossier</button>
          <a href="/dossiers" className="btn" style={{ marginLeft: 8 }}>Annuler</a>
        </div>
      </form>
    </>
  )
}
