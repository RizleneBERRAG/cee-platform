import { importerFiches } from '../../../lib/actions.js'
import { garde } from '../../../lib/garde.js'

export const dynamic = 'force-dynamic'

const EXEMPLE = `code;secteur;domaine;libelle;version;date_effet;date_fin;arrete;formule_type;unite;coefficients
BAR-TH-171;BAR;TH;Pompe à chaleur air/eau ou eau/eau;v10;2026-01-01;;;FORFAIT_PAR_UNITE;logement;[{"criteres":{"zoneClimatique":"H1"},"valeur":98000},{"criteres":{"zoneClimatique":"H2"},"valeur":82000},{"criteres":{"zoneClimatique":"H3"},"valeur":60000}]
BAT-EN-101;BAT;EN;Isolation de combles ou de toitures;v30;2022-01-01;;;FORFAIT_PAR_M2;m2;[{"criteres":{},"valeur":1400}]
IND-UT-102;IND;UT;Système de récupération de chaleur sur groupe froid;v20;2021-07-01;;;FORFAIT_PAR_UNITE;kW;[{"criteres":{},"valeur":31000}]`

export default async function ImportReferentiel() {
  await garde('referentiel.gerer')
  return (
    <>
      <h1>Importer le référentiel des fiches</h1>
      <p className="lede">
        Le prototype ne contient que huit fiches, choisies pour illustrer les cas de figure.
        Cet écran permet de charger le catalogue réel à partir d'un fichier CSV — celui de
        votre délégataire, ou une liste constituée à partir des arrêtés.
      </p>

      <div className="grid k2">
        <form action={importerFiches} className="card">
          <h2>Coller le CSV</h2>
          <textarea
            name="csv"
            rows={16}
            placeholder="Collez ici le contenu du fichier CSV, en-tête comprise…"
            style={{
              width: '100%', padding: 10, border: '1px solid var(--border)', borderRadius: 7,
              font: '12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', resize: 'vertical',
            }}
          />
          <button className="btn primary" style={{ marginTop: 10 }}>Importer</button>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            L'import est additif : une fiche déjà présente n'est pas dupliquée, et une version
            déjà connue n'est pas réécrite. Rien n'est jamais écrasé — c'est ce qui protège
            l'historique de calcul des dossiers existants.
          </p>
        </form>

        <div className="card">
          <h2>Format attendu</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Séparateur <b>point-virgule</b>, une ligne d'en-tête. Seules <b>code</b>, <b>secteur</b>,
            <b> domaine</b> et <b>libelle</b> sont obligatoires. Une fiche importée sans coefficient
            existe au référentiel mais ne calcule rien : elle apparaît, et le dossier qui l'utilise
            le signale.
          </p>
          <table>
            <thead><tr><th>Colonne</th><th>Contenu</th></tr></thead>
            <tbody>
              <tr><td className="mono">code</td><td>BAR-TH-171</td></tr>
              <tr><td className="mono">secteur</td><td>BAR · BAT · IND · AGRI · TRA · RES</td></tr>
              <tr><td className="mono">domaine</td><td>EN · TH · EQ · UT · SE · BA · CH · EC</td></tr>
              <tr><td className="mono">libelle</td><td>intitulé de la fiche</td></tr>
              <tr><td className="mono">version</td><td>v10, v30… (défaut : v1)</td></tr>
              <tr><td className="mono">date_effet</td><td>AAAA-MM-JJ</td></tr>
              <tr><td className="mono">date_fin</td><td>vide si en vigueur</td></tr>
              <tr><td className="mono">arrete</td><td>référence de l'arrêté</td></tr>
              <tr><td className="mono">formule_type</td><td>FORFAIT_PAR_UNITE · FORFAIT_PAR_M2 · FORFAIT_FIXE</td></tr>
              <tr><td className="mono">unite</td><td>W, m2, kW, logement…</td></tr>
              <tr><td className="mono">coefficients</td><td>JSON, voir ci-dessous</td></tr>
            </tbody>
          </table>

          <h2 style={{ marginTop: 18 }}>Les coefficients</h2>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
            Une liste de règles. Chaque règle porte ses critères et sa valeur en kWh cumac
            par unité. Le moteur retient la règle <b>la plus spécifique</b> qui correspond au
            dossier ; une règle sans critère sert de valeur par défaut.
          </p>
          <pre style={{
            background: '#f6f7f9', border: '1px solid var(--border)', borderRadius: 7,
            padding: 12, fontSize: 12, overflowX: 'auto', margin: 0,
          }}>{`[
  {"criteres": {"zoneClimatique": "H1"}, "valeur": 98000},
  {"criteres": {"secteurActivite": "BUREAUX"}, "valeur": 35},
  {"criteres": {}, "valeur": 24}
]`}</pre>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            Critères reconnus : <span className="mono">zoneClimatique</span>,
            {' '}<span className="mono">secteurActivite</span>, <span className="mono">charte</span>.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Exemple complet à copier</h2>
        <pre style={{
          background: '#f6f7f9', border: '1px solid var(--border)', borderRadius: 7,
          padding: 12, fontSize: 11.5, overflowX: 'auto', margin: 0, whiteSpace: 'pre',
        }}>{EXEMPLE}</pre>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          Les valeurs de cet exemple sont illustratives. Reprenez les coefficients réels des
          arrêtés ou du gabarit de votre délégataire avant tout usage en production.
        </p>
      </div>

      <p style={{ marginTop: 18 }}>
        <a href="/referentiel" style={{ color: 'var(--accent)' }}>← Retour au référentiel</a>
      </p>
    </>
  )
}
