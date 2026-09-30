import { get, all, db } from '../../../lib/db.js'
import { valeursListe } from '../../../lib/listes.js'
import {
  majDocumentsCommerciaux, majReseau, majAudit, enregistrerControle,
} from '../../../lib/actions-technique.js'
import {
  RESEAU_STATUTS, RESEAU_A_JUSTIFIER, TYPES_AUDIT, ETATS_RAPPORT, MOTEURS_CALCUL,
  MODALITES_CONTROLE, RESULTATS_CONTROLE, PASSAGES, accreditationCouvre, libelleReseau,
} from '../../../lib/referentiels-technique.js'

/**
 * Les blocs réglementaires du dossier.
 *
 * Ils sont regroupés ici plutôt que dans la fiche : la fiche dépassait déjà les 450 lignes,
 * et ces quatre blocs se lisent ensemble — ce sont ceux qu'un contrôleur vient vérifier.
 *
 * Aucun d'eux n'entre dans le calcul. Ils peuvent donc être complétés sur un dossier figé,
 * ce qui est le cas normal : le contrôle a lieu après la pose, longtemps après le calcul.
 */

const opt = (liste) => liste.map(([v, l]) => <option key={v} value={v}>{l}</option>)
const jour = (v) => (v || '').slice(0, 10)

/**
 * `blocs` : les blocs à afficher, parmi devis, reseau, audit, controles. Tous par défaut.
 * La fiche dossier les répartit entre ses onglets ; chacun garde sa propre action.
 */
export default function BlocsTechniques({ dossierId, d, modifiable, blocs = null }) {
  const voir = (cle) => !blocs || blocs.includes(cle)
  const audit = get('SELECT * FROM audit_energetique WHERE dossier_id = ?', [dossierId]) || {}
  const controles = all('SELECT * FROM controle WHERE dossier_id = ? ORDER BY passage', [dossierId])
  const bureaux = all('SELECT * FROM bureau_controle ORDER BY actif DESC, nom')
  const parBureau = new Map(bureaux.map((b) => [b.id, b]))

  // Suggestions tirées des listes du paramétrage ; une saisie libre reste acceptée.
  const suggestions = (id, liste) => (
    <datalist id={id}>{valeursListe(db(), liste).map((x) => <option key={x.id} value={x.libelle}>{x.donnees.version ? `version ${x.donnees.version}` : x.donnees.type || ''}</option>)}</datalist>
  )

  return (
    <>
      {/* Le composant est rendu dans plusieurs onglets : chaque liste de suggestions n'accompagne
          que le bloc qui s'en sert, pour qu'un identifiant n'existe qu'une fois dans la page. */}
      {voir('reseau') && suggestions('liste-gestionnaire-reseau', 'gestionnaire_reseau')}
      {voir('reseau') && suggestions('liste-societe-exploitation', 'societe_exploitation')}
      {voir('audit') && suggestions('liste-logiciel-audit', 'logiciel_audit')}
      {voir('devis') && (<>
      {/* ── Devis et facture ─────────────────────────────────── */}
      <form action={majDocumentsCommerciaux} className="card" style={{ marginTop: 14 }}>
        <input type="hidden" name="dossier_id" value={dossierId} />
        <h2>Devis et facture</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Les deux documents se règlent <b>séparément</b>. Un devis prime déduite suivi d'une
          facture prime non déduite — ou l'inverse — est l'erreur comptable la plus courante
          du métier ; avec un réglage unique, elle était impossible à seulement représenter.
        </p>
        <div className="grid k2">
          {[
            ['Devis', 'devis_conditions', 'devis_deduire_prime'],
            ['Facture', 'facture_conditions', 'facture_deduire_prime'],
          ].map(([titre, cCond, cDed]) => (
            <div key={titre}>
              <b style={{ fontSize: 13 }}>{titre}</b>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 400, marginTop: 8 }}>
                <input key={`${cCond}-${d[cCond]}`} type="checkbox" name={cCond} defaultChecked={!!d[cCond]}
                       style={{ width: 'auto' }} disabled={!modifiable} />
                Mentionner les conditions
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 400, marginTop: 6 }}>
                <input key={`${cDed}-${d[cDed]}`} type="checkbox" name={cDed} defaultChecked={!!d[cDed]}
                       style={{ width: 'auto' }} disabled={!modifiable} />
                Déduire la prime CEE
              </label>
            </div>
          ))}
        </div>
        {!!d.devis_deduire_prime !== !!d.facture_deduire_prime && (
          <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>
            <b>Devis et facture divergent</b>
            La prime CEE est déduite sur {d.devis_deduire_prime ? 'le devis' : 'la facture'} mais
            pas sur {d.devis_deduire_prime ? 'la facture' : 'le devis'}. C'est possible, mais
            c'est rarement voulu : le reste à payer annoncé au client ne sera pas celui facturé.
          </div>
        )}
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!modifiable}>Enregistrer</button>
      </form>
      </>)}

      {voir('reseau') && (<>
      {/* ── Réseau public de chaleur ─────────────────────────── */}
      <form action={majReseau} className="card" style={{ marginTop: 14 }}>
        <input type="hidden" name="dossier_id" value={dossierId} />
        <h2>Réseau public de chaleur</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Sur les opérations de chauffage, l'absence de raccordement à un réseau existant
          doit être <b>justifiée</b>. Sans justification, le dossier est rejetable au contrôle.
        </p>
        <div className="grid k2">
          <div className="field">
            <label>Statut du réseau</label>
            <select key={`rs-${d.reseau_statut || 'vide'}`} name="reseau_statut"
                    defaultValue={d.reseau_statut || ''} disabled={!modifiable}>
              <option value="">non renseigné</option>
              {opt(RESEAU_STATUTS)}
            </select>
          </div>
          <div className="field">
            <label>Gestionnaire de réseau</label>
            <input key={`rg-${d.reseau_gestionnaire}`} name="reseau_gestionnaire" list="liste-gestionnaire-reseau"
                   defaultValue={d.reseau_gestionnaire || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Nom du réseau</label>
            <input key={`rn-${d.reseau_nom}`} name="reseau_nom"
                   defaultValue={d.reseau_nom || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Société d'exploitation</label>
            <input key={`re-${d.reseau_exploitant}`} name="reseau_exploitant" list="liste-societe-exploitation"
                   defaultValue={d.reseau_exploitant || ''} disabled={!modifiable} />
          </div>
        </div>
        {RESEAU_A_JUSTIFIER.has(d.reseau_statut) && !d.reseau_nom && (
          <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>
            <b>Justification incomplète</b>
            Le raccordement est déclaré possible mais le réseau n'est pas nommé. Un contrôleur
            attend de savoir <b>à quel réseau</b> le bâtiment aurait pu se raccorder.
          </div>
        )}
        {!d.reseau_statut && (
          <p className="muted" style={{ fontSize: 12, marginTop: 10, marginBottom: 0 }}>
            Non renseigné. À compléter sur toute opération de chauffage.
          </p>
        )}
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!modifiable}>Enregistrer</button>
      </form>
      </>)}

      {voir('audit') && (<>
      {/* ── Audit énergétique ────────────────────────────────── */}
      <form action={majAudit} className="card" style={{ marginTop: 14 }}>
        <input type="hidden" name="dossier_id" value={dossierId} />
        <h2>Audit énergétique et bureau d'étude</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Obligatoire en rénovation d'ampleur et en rénovation globale. Le moteur de calcul
          doit être identifié <b>et versionné</b> : deux versions d'un même moteur ne donnent
          pas le même résultat, et un rapport produit avec un moteur non reconnu est refusé.
        </p>
        <div className="grid k3">
          <div className="field">
            <label>Type d'audit</label>
            <select key={`ta-${audit.type_audit || 'vide'}`} name="type_audit" defaultValue={audit.type_audit || ''} disabled={!modifiable}>
              <option value="">—</option>{opt(TYPES_AUDIT)}
            </select>
          </div>
          <div className="field">
            <label>Bureau d'étude</label>
            <input key={`be-${audit.bureau_etude}`} name="bureau_etude" defaultValue={audit.bureau_etude || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Auditeur</label>
            <input key={`au-${audit.auditeur}`} name="auditeur" defaultValue={audit.auditeur || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Qualification</label>
            <input key={`qu-${audit.qualification}`} name="qualification" defaultValue={audit.qualification || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Demandé le</label>
            <input key={`ad-${audit.date_demande}`} type="date" name="date_demande" defaultValue={jour(audit.date_demande)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Réalisé le</label>
            <input key={`ar-${audit.date_realisation}`} type="date" name="date_realisation" defaultValue={jour(audit.date_realisation)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Numéro de l'audit</label>
            <input key={`an-${audit.numero_audit}`} name="numero_audit" defaultValue={audit.numero_audit || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Référence du rapport</label>
            <input key={`rr-${audit.reference_rapport}`} name="reference_rapport" defaultValue={audit.reference_rapport || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>État du rapport</label>
            <select key={`er-${audit.etat_rapport || 'vide'}`} name="etat_rapport" defaultValue={audit.etat_rapport || ''} disabled={!modifiable}>
              <option value="">—</option>{opt(ETATS_RAPPORT)}
            </select>
          </div>
          <div className="field">
            <label>Moteur de calcul</label>
            <select key={`mc-${audit.moteur_calcul || 'vide'}`} name="moteur_calcul" defaultValue={audit.moteur_calcul || ''} disabled={!modifiable}>
              <option value="">—</option>{opt(MOTEURS_CALCUL)}
            </select>
          </div>
          <div className="field">
            <label>Logiciel</label>
            <input key={`lo-${audit.logiciel}`} name="logiciel" list="liste-logiciel-audit" defaultValue={audit.logiciel || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Éditeur</label>
            <input key={`ed-${audit.editeur_logiciel}`} name="editeur_logiciel" defaultValue={audit.editeur_logiciel || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Version du logiciel</label>
            <input key={`vl-${audit.version_logiciel}`} name="version_logiciel" defaultValue={audit.version_logiciel || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Date de version</label>
            <input key={`dv-${audit.date_version_logiciel}`} type="date" name="date_version_logiciel" defaultValue={jour(audit.date_version_logiciel)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Coût de l'audit (€)</label>
            <input key={`co-${audit.cout}`} type="number" step="0.01" name="cout" defaultValue={audit.cout ?? ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Facturé le</label>
            <input key={`df-${audit.date_facturation}`} type="date" name="date_facturation" defaultValue={jour(audit.date_facturation)} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>Scénario retenu</label>
            <input key={`sc-${audit.scenario}`} name="scenario" defaultValue={audit.scenario || ''} disabled={!modifiable} />
          </div>
          <div className="field">
            <label>N° de diagnostiqueur</label>
            <input key={`nd-${audit.numero_diagnostiqueur}`} name="numero_diagnostiqueur" defaultValue={audit.numero_diagnostiqueur || ''} disabled={!modifiable} />
          </div>
        </div>
        {audit.moteur_calcul && !audit.version_logiciel && (
          <div className="alert warn" style={{ marginTop: 12, marginBottom: 0 }}>
            <b>Version du moteur manquante</b>
            Le moteur est identifié mais pas sa version. Deux versions ne donnent pas le même
            résultat : sans elle, le rapport n'est pas reproductible.
          </div>
        )}
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!modifiable}>Enregistrer l'audit</button>
      </form>
      </>)}

      {voir('controles') && (<>
      {/* ── Contrôles COFRAC ─────────────────────────────────── */}
      <div className="card" style={{ marginTop: 14 }}>
        <h2>Contrôles</h2>
        <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
          Le contre-contrôle <b>n'écrase pas</b> le premier passage : les deux coexistent.
          Sinon on perd la trace de la non-conformité initiale et de ce qui a été corrigé —
          c'est-à-dire exactement ce qu'un contrôleur vient vérifier.
        </p>

        {PASSAGES.map(([n, titre]) => {
          const c = controles.find((x) => x.passage === n) || {}
          const bureau = c.bureau_controle_id ? parBureau.get(c.bureau_controle_id) : null
          const acc = accreditationCouvre(bureau, c.date)

          return (
            <form action={enregistrerControle} key={n}
                  style={{ borderTop: n === 2 ? '1px solid var(--bord)' : 'none', paddingTop: n === 2 ? 14 : 0, marginTop: n === 2 ? 14 : 0 }}>
              <input type="hidden" name="dossier_id" value={dossierId} />
              <input type="hidden" name="passage" value={n} />
              <b style={{ fontSize: 13 }}>{titre}</b>

              {acc.etat === 'PERIMEE' && (
                <div className="alert danger" style={{ marginTop: 8, marginBottom: 4 }}>
                  <b>Accréditation périmée</b>
                  {acc.message}
                </div>
              )}
              {acc.etat === 'INCONNUE' && acc.message && (
                <div className="alert warn" style={{ marginTop: 8, marginBottom: 4 }}>
                  <b>Accréditation non vérifiable</b>
                  {acc.message}
                </div>
              )}

              <div className="grid k4" style={{ marginTop: 8 }}>
                <div className="field">
                  <label>Bureau de contrôle</label>
                  <select key={`b${n}-${c.bureau_controle_id || 'vide'}`} name="bureau_controle_id"
                          defaultValue={c.bureau_controle_id || ''} disabled={!modifiable}>
                    <option value="">—</option>
                    {bureaux.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nom}
                        {b.date_fin_accreditation ? ` — accréd. jusqu'au ${jour(b.date_fin_accreditation).split('-').reverse().join('/')}` : ' — accréd. inconnue'}
                        {b.actif ? '' : ' (inactif)'}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Date du contrôle</label>
                  <input key={`d${n}-${c.date}`} type="date" name="date" defaultValue={jour(c.date)} disabled={!modifiable} />
                </div>
                <div className="field">
                  <label>Modalité</label>
                  <select key={`m${n}-${c.modalite || 'vide'}`} name="modalite" defaultValue={c.modalite || ''} disabled={!modifiable}>
                    <option value="">—</option>{opt(MODALITES_CONTROLE)}
                  </select>
                </div>
                <div className="field">
                  <label>Résultat</label>
                  <select key={`r${n}-${c.resultat || 'vide'}`} name="resultat" defaultValue={c.resultat || ''} disabled={!modifiable}>
                    <option value="">—</option>{opt(RESULTATS_CONTROLE)}
                  </select>
                </div>
                <div className="field">
                  <label>Montant (€)</label>
                  <input key={`mo${n}-${c.montant}`} type="number" step="0.01" name="montant" defaultValue={c.montant ?? ''} disabled={!modifiable} />
                </div>
                <div className="field">
                  <label>Soldé le</label>
                  <input key={`ds${n}-${c.date_solde}`} type="date" name="date_solde" defaultValue={jour(c.date_solde)} disabled={!modifiable} />
                </div>
                <div className="field">
                  <label style={{ marginTop: 22 }}>
                    <input key={`so${n}-${c.solde_effectue}`} type="checkbox" name="solde_effectue"
                           defaultChecked={!!c.solde_effectue} style={{ width: 'auto', marginRight: 7 }} disabled={!modifiable} />
                    Solde effectué
                  </label>
                </div>
                <div className="field">
                  <label>Motif / observations</label>
                  <input key={`mt${n}-${c.motif}`} name="motif" defaultValue={c.motif || ''} disabled={!modifiable} />
                </div>
              </div>

              {n === 1 && c.resultat === 'NON_CONFORME' && !controles.some((x) => x.passage === 2) && (
                <div className="alert warn" style={{ marginTop: 10, marginBottom: 0 }}>
                  <b>Contre-contrôle attendu</b>
                  Le premier passage est non conforme et aucun second passage n'est enregistré.
                </div>
              )}

              <button className="btn primary" style={{ marginTop: 10 }} disabled={!modifiable}>
                Enregistrer le {n === 1 ? 'contrôle' : 'contre-contrôle'}
              </button>
            </form>
          )
        })}

        {bureaux.length === 0 && (
          <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
            Aucun bureau de contrôle au référentiel. Ajoutez-les dans
            {' '}<a href="/parametrage/controle">Paramétrage › Bureaux de contrôle</a>,
            avec leur date de fin d'accréditation — c'est elle qui permet de détecter
            un contrôle réalisé hors accréditation.
          </p>
        )}
      </div>
      </>)}

      {voir('reseau') && (<>
      {d.reseau_statut && (
        <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
          Réseau : {libelleReseau(d.reseau_statut)}.
        </p>
      )}
      </>)}
    </>
  )
}
