import { importerDossiers } from '../../../lib/actions.js'
import { all } from '../../../lib/db.js'
import { garde } from '../../../lib/garde.js'

export const dynamic = 'force-dynamic'

const COLONNES = [
  ['fiche', 'BAT-EQ-127', true, 'Doit exister au référentiel. Sinon la ligne est rejetée, jamais devinée.'],
  ['quantite', '1200', true, 'Nombre strictement positif. Unité selon la fiche (W, m², kW…).'],
  ['date_engagement', '15/01/2026', true, "Commande la version de fiche retenue, donc la valorisation."],
  ['ref_externe', 'PX-48211', false, "Votre n° dans Pixel CRM. C'est la clé anti-doublon : réimporter le même fichier ne recrée rien."],
  ['raison_sociale', 'Boulangerie Martin', false, ''],
  ['siret', '80012345600017', false, 'Regroupe les dossiers d\'un même bénéficiaire.'],
  ['regime_revenu', 'précaire / classique', false, 'Défaut : classique.'],
  ['adresse', '12 rue de la Paix', false, ''],
  ['code_postal', '69003', false, 'Sert à déduire le département, et la zone climatique si elle manque.'],
  ['ville', 'Lyon', false, ''],
  ['zone_climatique', 'H1 / H2 / H3', false, 'À fournir si vous l\'avez : sinon elle est déduite du département, ce qui est approximatif.'],
  ['secteur_activite', 'BUREAUX', false, 'Utilisé par les fiches dont le coefficient dépend du secteur.'],
  ['charte', 'oui / non', false, 'Coup de pouce. Défaut : hors CDP.'],
  ['avec_mpr', 'oui / non', false, "MaPrimeRénov'. Défaut : non."],
  ['deal', 'nom du deal', false, 'Sinon le deal marqué par défaut est appliqué, et le rapport le compte.'],
  ['delegataire', 'Délégataire A', false, ''],
  ['installateur', 'nom de l\'installateur', false, ''],
  ['unite_affaire', 'Régie Nord', false, ''],
  ['statut', 'À traiter', false, ''],
  ['date_pose', '02/02/2026', false, ''],
  ['cout_pose', '850', false, 'Déduit de la marge nette.'],
]

export default async function ImportDossiers() {
  await garde('dossier.importer')
  const fiches = all('SELECT code FROM fiche ORDER BY code')
  const deals = all('SELECT libelle, par_defaut FROM deal WHERE actif = 1 ORDER BY par_defaut DESC')
  const derniers = all(
    'SELECT id, nom_fichier, lignes, crees, rejetes, simulation, created_at FROM import_lot ORDER BY created_at DESC LIMIT 5'
  )

  return (
    <>
      <h1>Importer des dossiers</h1>
      <p className="lede">
        Charge en une fois un export de votre CRM actuel. Une ligne est entièrement valide ou
        entièrement rejetée — jamais à moitié créée. Commencez par une simulation : elle ne
        touche pas la base et vous dit exactement ce qui passerait.
      </p>

      <form action={importerDossiers} className="card">
        <h2>Le fichier</h2>
        <input
          type="file"
          name="fichier"
          accept=".csv,.txt,text/csv,text/plain"
          style={{ display: 'block', marginBottom: 12, fontSize: 13 }}
        />
        <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
          Séparateur point-virgule, virgule ou tabulation — détecté tout seul. Encodage UTF-8.
          Ou collez directement le contenu ci-dessous.
        </p>
        <textarea
          name="csv"
          rows={8}
          placeholder="fiche;quantite;date_engagement;ref_externe;raison_sociale…"
          style={{
            width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 7,
            font: '12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn" name="mode" value="simulation">Simuler sans rien écrire</button>
          <button className="btn primary" name="mode" value="import">Importer pour de bon</button>
        </div>
      </form>

      <div className="grid k2" style={{ marginTop: 14 }}>
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <div style={{ padding: '14px 18px 0' }}>
            <h2 style={{ margin: 0 }}>Colonnes reconnues</h2>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Les noms sont reconnus sans tenir compte des accents, majuscules ni espaces, et
              plusieurs synonymes courants sont acceptés (<span className="mono">cp</span> pour
              code postal, <span className="mono">client</span> pour raison sociale…).
              Les colonnes en trop sont ignorées sans bruit.
            </p>
          </div>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Colonne</th><th>Exemple</th><th>Remarque</th></tr></thead>
            <tbody>
              {COLONNES.map(([nom, exemple, obligatoire, note]) => (
                <tr key={nom}>
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {nom}{obligatoire && <span style={{ color: 'var(--danger)' }}> *</span>}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{exemple}</td>
                  <td className="muted" style={{ fontSize: 11.5 }}>{note}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12, padding: '10px 18px 16px', margin: 0 }}>
            <span style={{ color: 'var(--danger)' }}>*</span> obligatoire.
          </p>
        </div>

        <div>
          <div className="card">
            <h2>Ce qui est dans la base</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
              Une ligne dont la fiche n'est pas dans cette liste est rejetée. Chargez d'abord votre
              catalogue par <a href="/referentiel/import" style={{ color: 'var(--accent)' }}>l'import du référentiel</a>.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
              {fiches.map((f) => <span key={f.code} className="tag mono">{f.code}</span>)}
            </div>
            <b style={{ fontSize: 13 }}>Deals</b>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 6 }}>
              {deals.length === 0
                ? <span className="muted" style={{ fontSize: 12 }}>Aucun deal actif — aucune marge ne sera calculée.</span>
                : deals.map((d) => (
                  <span key={d.libelle} className="tag">
                    {d.libelle}{d.par_defaut ? ' (défaut)' : ''}
                  </span>
                ))}
            </div>
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h2>Ce que l'import ne fera pas</h2>
            <ul className="muted" style={{ fontSize: 12.5, marginTop: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>Créer une fiche absente du référentiel — un coefficient inventé fausserait toute la marge.</li>
              <li>Écraser un dossier existant : une référence externe déjà connue est ignorée.</li>
              <li>Refuser un dossier dont la fiche n'était plus en vigueur à sa date d'engagement — c'est un fait historique, il est importé et signalé.</li>
            </ul>
          </div>

          {derniers.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}>
              <h2>Imports précédents</h2>
              <table>
                <thead><tr><th>Fichier</th><th>Date</th><th className="num">Créés</th><th className="num">Rejetés</th></tr></thead>
                <tbody>
                  {derniers.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <a href={`/dossiers/import/${l.id}`} style={{ color: 'var(--accent)' }}>{l.nom_fichier}</a>
                        {l.simulation ? <span className="tag" style={{ marginLeft: 6 }}>simulation</span> : null}
                      </td>
                      <td className="mono" style={{ fontSize: 11.5 }}>
                        {new Date(l.created_at + 'Z').toLocaleString('fr-FR')}
                      </td>
                      <td className="num mono">{l.crees}</td>
                      <td className="num mono" style={{ color: l.rejetes ? 'var(--danger)' : undefined }}>{l.rejetes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <p style={{ marginTop: 18 }}>
        <a href="/dossiers" style={{ color: 'var(--accent)' }}>← Retour aux dossiers</a>
      </p>
    </>
  )
}
