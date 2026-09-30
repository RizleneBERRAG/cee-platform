import { get } from '../../../lib/db.js'
import { majBeneficiaire } from '../../../lib/actions-beneficiaire.js'
import { TYPES_BENEFICIAIRE, REGIMES_REVENU, CIVILITES } from '../../../lib/referentiels-beneficiaire.js'

const opt = (liste) => liste.map(([v, l]) => <option key={v} value={v}>{l}</option>)

/**
 * Bénéficiaire du dossier : la société, son signataire, son siège.
 *
 * Tous les champs sont repris dans le formulaire, y compris ceux qu'on ne touche pas :
 * l'action n'écrit que ce qui a changé, et le journal ne garde que les vraies modifications.
 */
export default function Beneficiaire({ d, modifiable, erreur }) {
  const b = get('SELECT * FROM beneficiaire WHERE id = ?', [d.beneficiaire_id]) || {}
  const champ = (nom, label, props = {}) => (
    <div className="field">
      <label>{label}</label>
      <input key={`${nom}-${b[nom] ?? ''}`} name={nom} defaultValue={b[nom] ?? ''} disabled={!modifiable} {...props} />
    </div>
  )

  return (
    <form action={majBeneficiaire} className="card">
      <input type="hidden" name="dossier_id" value={d.id} />
      <h2>Bénéficiaire</h2>
      {erreur && <div className="alert danger"><b>Bénéficiaire non enregistré</b>{erreur}</div>}

      <div className="grid k4">
        <div className="field">
          <label>Type</label>
          {/* Une valeur reprise d'un import peut sortir de la liste : elle est montrée telle
              quelle. Sinon le menu afficherait la première option, et l'enregistrement
              suivant la substituerait en silence à la vraie valeur. */}
          <select key={`t-${b.type}`} name="type" defaultValue={b.type || 'SOCIETE'} disabled={!modifiable}>
            {b.type && !TYPES_BENEFICIAIRE.some(([v]) => v === b.type) && <option value={b.type}>{b.type} (repris)</option>}
            {opt(TYPES_BENEFICIAIRE)}
          </select>
        </div>
        {champ('raison_sociale', 'Raison sociale')}
        {champ('siret', 'SIRET', { inputMode: 'numeric', placeholder: '14 chiffres' })}
        {champ('code_ape', 'Code APE')}
        <div className="field">
          <label>Régime de revenu</label>
          <select key={`r-${b.regime_revenu}`} name="regime_revenu" defaultValue={b.regime_revenu || 'CLASSIQUE'} disabled={!modifiable}>
            {b.regime_revenu && !REGIMES_REVENU.some(([v]) => v === b.regime_revenu) && <option value={b.regime_revenu}>{b.regime_revenu} (repris)</option>}
            {opt(REGIMES_REVENU)}
          </select>
        </div>
      </div>
      <p className="muted" style={{ fontSize: 12, marginTop: -4 }}>
        Le régime de revenu choisit le barème du deal (classique, précaire, grande précarité) :
        le changer change la prime. Pensez à recalculer ensuite.
      </p>

      <h3 className="sous-titre">Signataire</h3>
      <div className="grid k4">
        <div className="field">
          <label>Civilité</label>
          <select key={`c-${b.civilite}`} name="civilite" defaultValue={b.civilite || ''} disabled={!modifiable}>
            <option value="">—</option>{opt(CIVILITES)}
          </select>
        </div>
        {champ('nom', 'Nom')}
        {champ('prenom', 'Prénom')}
        {champ('fonction', 'Fonction', { placeholder: 'Gérant, président…' })}
        {champ('email', 'E-mail', { type: 'email' })}
        {champ('telephone', 'Téléphone')}
        {champ('telephone_2', 'Second téléphone')}
      </div>

      <h3 className="sous-titre">Siège</h3>
      <div className="grid k3">
        {champ('adresse', 'Adresse')}
        {champ('code_postal', 'Code postal')}
        {champ('ville', 'Ville')}
      </div>

      <button className="btn primary" disabled={!modifiable}>Enregistrer le bénéficiaire</button>
      {d.verrouille ? <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>Dossier verrouillé — déverrouillez-le pour modifier.</span> : null}
    </form>
  )
}
