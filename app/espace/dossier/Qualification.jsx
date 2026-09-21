import { sectionsClient, lireReponse } from '../../../lib/fiche-qualification.js'

/**
 * La fiche de qualification, telle que le client la remplit.
 *
 * ── Ce qui est affiché, et ce qui ne l'est pas ──
 *
 * Seules les sections non réservées. Le dimensionnement (14) est le travail du bureau
 * d'études, et la conclusion commerciale (16) porte la probabilité de signature : montrer
 * à un client qu'on estime son projet à 25 % serait une maladresse durable. Ces sections
 * ne sont pas masquées par du CSS — `sectionsClient()` ne les renvoie pas, donc elles
 * n'existent pas dans le HTML envoyé.
 *
 * ── Pourquoi tout est facultatif ──
 *
 * Aucun champ n'est obligatoire. Une fiche de qualification se remplit en plusieurs fois,
 * souvent à deux, et un formulaire qui refuse d'être envoyé tant qu'il n'est pas complet
 * finit rempli n'importe comment pour pouvoir passer. Ce qui manque vraiment pour
 * dimensionner est signalé au commercial, pas imposé au client.
 */
export default function Qualification({ reponses }) {
  return (
    <section style={{ marginTop: 34 }}>
      <h2 style={{ fontSize: 15 }}>Votre projet de séchage</h2>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 0 }}>
        Plus ces informations sont précises, plus le dimensionnement sera juste. Rien n’est
        obligatoire : remplissez ce que vous savez, vous pourrez compléter plus tard. Comme
        le reste, vos réponses nous sont transmises pour vérification.
      </p>

      {sectionsClient().map((s) => (
        <fieldset key={s.numero}
                  style={{ border: '1px solid #e2e5ea', borderRadius: 8, padding: '12px 14px', margin: '14px 0' }}>
          <legend style={{ fontSize: 13, fontWeight: 700, padding: '0 6px' }}>
            {s.numero}. {s.titre}
          </legend>
          {s.aide && (
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 0 }}>{s.aide}</p>
          )}

          <div style={{ display: 'grid', gap: 10 }}>
            {s.champs.map((c) => {
              const nom = `qualification.q.${c.cle.replace(/^q\./, '')}`
              const valeur = lireReponse(c, reponses[c.cle])

              if (c.type === 'choix_multiple') {
                return (
                  <div key={c.cle}>
                    <span style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      {c.libelle}
                    </span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                      {c.valeurs.map((v) => (
                        <label key={v} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <input type="checkbox" name={nom} value={v}
                                 defaultChecked={valeur.includes(v)} style={{ width: 'auto' }} />
                          {v}
                        </label>
                      ))}
                    </div>
                  </div>
                )
              }

              if (c.type === 'choix' || c.type === 'oui_non') {
                const options = c.type === 'oui_non' ? ['Oui', 'Non'] : c.valeurs
                return (
                  <div className="field" key={c.cle}>
                    <label htmlFor={nom}>{c.libelle}</label>
                    <select id={nom} name={nom} defaultValue={valeur}>
                      <option value="">—</option>
                      {options.map((v) => <option key={v} value={v}>{v}</option>)}
                    </select>
                  </div>
                )
              }

              if (c.type === 'texte_long') {
                return (
                  <div className="field" key={c.cle}>
                    <label htmlFor={nom}>{c.libelle}</label>
                    <textarea id={nom} name={nom} rows={3} maxLength={c.max} defaultValue={valeur} />
                  </div>
                )
              }

              return (
                <div className="field" key={c.cle}>
                  <label htmlFor={nom}>{c.libelle}</label>
                  <input
                    id={nom} name={nom}
                    type={c.type === 'nombre' ? 'number' : c.type === 'date' ? 'date'
                      : c.type === 'email' ? 'email' : c.type === 'tel' ? 'tel' : 'text'}
                    step={c.type === 'nombre' ? 'any' : undefined}
                    min={c.type === 'nombre' && c.min !== undefined ? c.min : undefined}
                    max={c.type === 'nombre' && c.max !== undefined && c.max <= 100 ? c.max : undefined}
                    maxLength={c.type !== 'nombre' ? c.max : undefined}
                    defaultValue={valeur}
                  />
                </div>
              )
            })}
          </div>
        </fieldset>
      ))}
    </section>
  )
}
