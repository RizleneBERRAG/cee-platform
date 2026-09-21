import { redirect } from 'next/navigation'
import { db } from '../../../lib/db.js'
import { accesCourant, deconnexionClient, soumettreProposition } from '../actions.js'
import { champsClient, suiviClient, valeurActuelle } from '../../../lib/propositions.js'
import { AGES_BATIMENT, TYPES_CHAUFFAGE } from '../../../lib/referentiels-site.js'
import { reponsesDuDossier } from '../../../lib/fiche-qualification.js'
import Qualification from './Qualification.jsx'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mon dossier' }

const REFERENTIELS = { agesBatiment: AGES_BATIMENT, typesChauffage: TYPES_CHAUFFAGE }

const euros = (n) => (n === null || n === undefined)
  ? '—'
  : `${Number(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/**
 * La fiche que le client consulte.
 *
 * ── Ce qu'il voit, et ce qu'il ne voit pas ──
 *
 * Il voit ce qui le concerne : où en est son dossier, ce qui a été posé chez lui, et la
 * prime qui lui revient. Il ne voit **ni la marge, ni la commission d'apporteur, ni ce que
 * le délégataire verse** : ce sont les conditions commerciales de l'entreprise, et les
 * afficher reviendrait à publier sa grille de prix à chacun de ses clients. La requête
 * ci-dessous ne va pas les chercher — ce n'est pas un masquage à l'affichage, c'est une
 * absence à la source. Un masquage se contourne en lisant le HTML.
 *
 * ── Sur la protection contre la copie ──
 *
 * Le téléchargement et l'impression sont bloqués, et le texte n'est pas sélectionnable.
 * **La capture d'écran, elle, ne peut pas être empêchée** : aucune technologie web ne le
 * permet, et prétendre le contraire serait vendre une sécurité qui n'existe pas. D'où le
 * filigrane : il porte l'identifiant du visiteur et l'horodatage, de sorte qu'une capture
 * qui circule désigne celui à qui l'accès avait été remis. C'est de la traçabilité, pas de
 * l'empêchement — et c'est le mieux qui puisse être fait honnêtement.
 */
export default async function MonDossier({ searchParams }) {
  const acces = await accesCourant()
  if (!acces) redirect('/espace')
  const { m } = await searchParams
  const base = db()

  const d = base.prepare(`
    SELECT d.id, d.numero, d.date_proposition, d.date_signature, d.date_pose,
           d.date_controle, d.date_achevement, d.date_depot, d.num_devis,
           b.nom, b.prenom, b.raison_sociale, b.telephone, b.email,
           s.adresse, s.code_postal, s.ville, s.surface, s.type_chauffage,
           s.age_batiment_tranche, s.parcelle_cadastrale
      FROM dossier d
      LEFT JOIN beneficiaire b ON b.id = d.beneficiaire_id
      LEFT JOIN site s ON s.id = d.site_id
     WHERE d.id = ?`).get(acces.dossier_id)

  if (!d) redirect('/espace')

  // La prime du bénéficiaire, et elle seule. Les autres montants ne sont pas lus.
  const prime = base.prepare(`
    SELECT SUM(prime_beneficiaire) AS p FROM operation
     WHERE dossier_id = ? AND date_calcul IS NOT NULL`).get(acces.dossier_id)?.p ?? null

  const travaux = base.prepare(`
    SELECT f.libelle, o.quantite, o.unite
      FROM operation o JOIN fiche f ON f.id = o.fiche_id
     WHERE o.dossier_id = ? ORDER BY o.ordre`).all(acces.dossier_id)

  const attente = base.prepare(`
    SELECT p.id, p.soumise_le, COUNT(pc.id) AS n
      FROM proposition p LEFT JOIN proposition_champ pc ON pc.proposition_id = p.id
     WHERE p.dossier_id = ? AND p.statut = 'EN_ATTENTE'
     GROUP BY p.id ORDER BY p.soumise_le DESC`).all(acces.dossier_id)

  const suivi = suiviClient(d)
  const reponsesQualif = reponsesDuDossier(base, acces.dossier_id)
  // Les champs de la fiche de qualification sont rendus par leur propre composant : les
  // reprendre ici en produirait une seconde copie, et deux champs de même nom dans un
  // formulaire, c'est une valeur sur deux perdue à l'envoi.
  const champs = champsClient(REFERENTIELS).filter((c) => c.type !== 'qualification')
  const horodatage = new Date().toLocaleString('fr-FR')
  const filigrane = `${acces.identifiant} · ${horodatage}`

  return (
    <>
      <style>{`
        /* Le filigrane : répété, léger, inévitable sur une capture. */
        .filigrane-espace {
          position: fixed; inset: 0; z-index: 9999; pointer-events: none;
          background-repeat: repeat;
          opacity: .13;
          background-image: url("data:image/svg+xml;utf8,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="180">
               <text x="0" y="120" transform="rotate(-24 0 120)" font-family="Arial"
                     font-size="15" fill="#334">${filigrane}</text>
             </svg>`)}");
        }
        /* Le texte des données n'est pas sélectionnable : pas de copier-coller d'un bloc. */
        .protege { user-select: none; -webkit-user-select: none; }
        /* Les champs que le client remplit doivent, eux, rester utilisables. */
        .protege input, .protege select, .protege textarea { user-select: text; -webkit-user-select: text; }
        @media print {
          body * { display: none !important; }
          body::after {
            content: "L'impression de ce document n'est pas autorisée. Votre conseiller peut vous transmettre les pièces dont vous avez besoin.";
            display: block !important; padding: 40px; font: 16px Arial, sans-serif;
          }
        }
      `}</style>
      <div className="filigrane-espace" aria-hidden="true" />

      <main className="protege" style={{ maxWidth: 780, margin: '4vh auto 8vh', padding: '0 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 22, margin: 0 }}>Votre dossier {d.numero}</h1>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 2 }}>
              {d.raison_sociale || [d.prenom, d.nom].filter(Boolean).join(' ')}
            </p>
          </div>
          <form action={deconnexionClient}>
            <button className="btn" style={{ fontSize: 12 }}>Se déconnecter</button>
          </form>
        </div>

        {m && (
          <div style={{ border: '1px solid var(--accent)', background: '#f2f7ff',
                        padding: '9px 11px', borderRadius: 6, fontSize: 13, margin: '14px 0' }}>
            {m}
          </div>
        )}

        {/* ── Où en est le dossier ── */}
        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 15 }}>Avancement</h2>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 2 }}>
            {suivi.etapes.map((e) => (
              <li key={e.code} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px',
                borderLeft: `3px solid ${e.faite ? 'var(--ok)' : suivi.enCours === e.code ? 'var(--accent)' : '#ddd'}`,
                background: suivi.enCours === e.code ? '#f7faff' : 'transparent',
                fontSize: 13.5,
              }}>
                <span style={{ fontWeight: e.faite || suivi.enCours === e.code ? 600 : 400 }}>{e.libelle}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>
                  {e.faite ? new Date(e.date).toLocaleDateString('fr-FR')
                    : suivi.enCours === e.code ? 'en cours' : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ── Les travaux et la prime ── */}
        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 15 }}>Vos travaux</h2>
          {travaux.length === 0
            ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>Aucune opération enregistrée pour l’instant.</p>
            : (
              <ul style={{ paddingLeft: 18, fontSize: 13.5, margin: '6px 0' }}>
                {travaux.map((t, i) => (
                  <li key={i}>{t.libelle}{t.quantite ? ` — ${t.quantite} ${t.unite || ''}`.trimEnd() : ''}</li>
                ))}
              </ul>
            )}
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#f6f8f6',
                        borderRadius: 6, fontSize: 14 }}>
            Prime CEE qui vous revient : <strong>{euros(prime)}</strong>
            {prime === null && (
              <span style={{ color: 'var(--muted)', fontSize: 12 }}> — pas encore calculée</span>
            )}
          </div>
        </section>

        {/* ── Corriger ses informations ── */}
        <section style={{ marginTop: 30 }}>
          <h2 style={{ fontSize: 15 }}>Corriger vos informations</h2>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
            Vos modifications ne sont pas appliquées directement : elles sont transmises pour
            vérification, puis intégrées à votre dossier si elles sont validées.
          </p>

          {attente.length > 0 && (
            <div style={{ border: '1px solid #e0c27a', background: '#fdf8ec', padding: '9px 11px',
                          borderRadius: 6, fontSize: 13, margin: '10px 0' }}>
              {attente.length === 1
                ? `Une demande de ${attente[0].n} modification(s) est en cours d’examen.`
                : `${attente.length} demandes sont en cours d’examen.`}
            </div>
          )}

          <form action={soumettreProposition} style={{ display: 'grid', gap: 12, marginTop: 14 }}>
            {champs.map((c) => {
              const actuelle = valeurActuelle(base, acces.dossier_id, c.champ)
              return (
                <div className="field" key={c.champ}>
                  <label htmlFor={c.champ}>{c.libelle}</label>
                  {c.type === 'liste' ? (
                    <select id={c.champ} name={c.champ} defaultValue={actuelle ?? ''}>
                      <option value="">—</option>
                      {c.valeurs.map((v) => (
                        <option key={v.code} value={v.code}>{v.libelle}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={c.champ} name={c.champ}
                      type={c.type === 'nombre' ? 'number' : c.type === 'email' ? 'email' : c.type === 'tel' ? 'tel' : 'text'}
                      step={c.type === 'nombre' ? 'any' : undefined}
                      maxLength={c.max}
                      defaultValue={actuelle ?? ''}
                    />
                  )}
                </div>
              )
            })}
            <Qualification reponses={reponsesQualif} />

            <div className="field">
              <label htmlFor="message">Un mot pour votre conseiller (facultatif)</label>
              <textarea id="message" name="message" rows={3} maxLength={1000} />
            </div>
            <button className="btn primary">Transmettre mes corrections</button>
          </form>
        </section>

        <p style={{ color: 'var(--muted)', fontSize: 11.5, marginTop: 30, lineHeight: 1.6 }}>
          Les informations affichées ici vous sont réservées. Elles portent votre identifiant
          d’accès ({acces.identifiant}) et l’horodatage de votre consultation.
        </p>
      </main>
    </>
  )
}
