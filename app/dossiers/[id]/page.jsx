import {
  dossier, calculDossier, statutsParAxe, deals, journalDossier, notesDossier,
} from '../../../lib/queries.js'
import { euros, nombre } from '../../../lib/marge.js'
import { majDossier, majSite, recalculer, basculerVerrou, ajouterNote, ajouterDocument, validerDocument, supprimerDocument } from '../../../lib/actions.js'
import { completude, typesDocuments } from '../../../lib/documents.js'
import { garde, a } from '../../../lib/garde.js'
import { poids, APERCU, TAILLE_MAX } from '../../../lib/fichiers.js'
import BlocsTechniques from './BlocsTechniques.jsx'
import Operations from './Operations.jsx'
import Commercial from './Commercial.jsx'
import { operationsDuDossier } from '../../../lib/operations.js'
import { ZONES_CLIMATIQUES, TYPES_CHAUFFAGE } from '../../../lib/referentiels-site.js'
import EspaceClient from './EspaceClient.jsx'
import Dimensionnement from './Dimensionnement.jsx'
import { etatDimensionnement, FICHE_SECHAGE } from '../../../lib/dimensionnement.js'
import { calculerCumac } from '../../../lib/cumac.js'
import { accesDuDossier } from '../../../lib/acces-client.js'
import { enAttente } from '../../../lib/propositions.js'
import { db } from '../../../lib/db.js'

export const dynamic = 'force-dynamic'

const SECTEURS_SITE = [
  ['BUREAUX', 'Bureaux'], ['COMMERCE', 'Commerce'], ['SANTE', 'Santé'],
  ['ENSEIGNEMENT', 'Enseignement'], ['HOTEL_RESTAURANT', 'Hôtellerie-restauration'],
  ['INDUSTRIE', 'Industrie'], ['AGRICOLE', 'Agricole'], ['RESIDENTIEL', 'Résidentiel'],
  ['AUTRE', 'Autre'],
]

const CHAUFFAGES = [
  ['GAZ', 'Gaz'], ['FIOUL', 'Fioul'], ['ELECTRIQUE', 'Électrique'], ['BOIS', 'Bois'],
  ['RESEAU_CHALEUR', 'Réseau de chaleur'], ['POMPE_A_CHALEUR', 'Pompe à chaleur'], ['AUTRE', 'Autre'],
]

const AXES = [
  ['statut_dossier_id', 'DOSSIER', 'Statut dossier'],
  ['statut_admin_id', 'ADMIN', 'Statut administratif'],
  ['statut_facturation_id', 'FACTURATION', 'Facturation'],
  ['statut_installation_id', 'INSTALLATION', 'Installation'],
  ['statut_cofrac_id', 'COFRAC', 'Contrôle COFRAC'],
]

export default async function FicheDossier({ params, searchParams }) {
  const { u, portee } = await garde('dossier.voir')
  const { id } = await params
  const sp = await searchParams
  // La portée est passée à la requête : un dossier d'une autre unité ressort « introuvable »,
  // sans révéler qu'il existe.
  const d = dossier(id, portee)
  if (!d) return <p>Dossier introuvable.</p>

  const voitMarge = a(u, 'marge.voir')
  const peutModifier = a(u, 'dossier.modifier') && !d.verrouille

  const c = calculDossier(d, { tauxApporteur: 8 })
  const v = c.valorisation
  const listeDeals = deals()
  const journal = journalDossier(id)
  const notes = notesDossier(id)
  const statuts = Object.fromEntries(AXES.map(([, axe]) => [axe, statutsParAxe(axe)]))
  const comp = completude(d)
  const types = typesDocuments()

  // Les deux cartes de tête décrivent l'opération PRINCIPALE. Tant qu'il n'y en a qu'une,
  // c'est le dossier ; dès qu'il y en a plusieurs, le dire évite de lire un volume partiel
  // comme s'il était le total.
  const ops = operationsDuDossier(id)
  const multi = ops.length > 1

  // La dernière facture du dossier qui n'a pas été annulée par un avoir. Une facture
  // annulée ne doit pas s'afficher comme si elle valait encore — c'est tout l'intérêt de
  // l'avoir.
  const factureVivante = db().prepare(`
    SELECT f.id, f.numero FROM facture f
     WHERE f.dossier_id = ? AND f.type = 'FACTURE'
       AND NOT EXISTS (SELECT 1 FROM facture a WHERE a.annule_facture_id = f.id)
     ORDER BY f.cree_le DESC LIMIT 1`).get(id)

  // Le message d'une création d'accès porte deux secrets d'un coup : on les sépare pour
  // pouvoir les présenter lisiblement, plutôt qu'en une phrase où le client recopiera de
  // travers un code de onze caractères.
  const codeAcces = (() => {
    const m = /Identifiant\s*:\s*([A-Z0-9-]+)\s*—\s*Code\s*:\s*([A-Z0-9-]+)/.exec(sp?.m || '')
    return m ? { identifiant: m[1], code: m[2] } : null
  })()

  const fige = d.date_calcul != null
  const ecart = fige && v ? Math.round((v.margeNette - (d.marge_nette ?? 0)) * 100) / 100 : 0

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ marginBottom: 6 }}>
            {d.numero}{' '}
            <span key={d.statut_dossier_id || 'vide'} className="pill" style={{ background: d.statut_couleur, verticalAlign: 'middle' }}>{d.statut_libelle}</span>
            {d.verrouille ? <span className="tag" style={{ marginLeft: 8, background: '#fef2f2', color: '#991b1b' }}>verrouillé</span> : null}
          </h1>
          <p className="lede" style={{ marginBottom: 0 }}>
            {d.raison_sociale} — {d.ville} ({d.departement}) · fiche {d.fiche_code} · unité {d.unite_nom}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {voitMarge && a(u, 'dossier.modifier') && (
            <form action={recalculer}>
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="taux_apporteur" value="8" />
              <button className="btn primary" disabled={!peutModifier}>
                {fige ? 'Recalculer' : 'Calculer et figer'}
              </button>
            </form>
          )}
          {/* Prévisualiser n'attribue aucun numéro : le lien peut être ouvert autant de
              fois qu'on veut sans trouer la série de devis de la société. L'émission,
              elle, est un POST — depuis l'onglet Commercial. */}
          <a href={`/dossiers/${d.id}/devis`} target="_blank" rel="noopener" className="btn">
            {d.num_devis ? `Devis ${d.num_devis}` : 'Aperçu du devis'}
          </a>
          {/* Même règle pour la facture, en plus strict : une facture émise ne se
              renumérote ni ne se modifie. Ce lien n'écrit rien. */}
          <a href={`/dossiers/${d.id}/facture`} target="_blank" rel="noopener" className="btn">
            {factureVivante ? `Facture ${factureVivante.numero}` : 'Aperçu de la facture'}
          </a>
          {/* L'émission et l'avoir sont des POST : ce sont les deux seuls gestes qui
              consomment un numéro de la série, et aucun rafraîchissement ne doit les
              rejouer. Ils ouvrent le document dans un onglet. */}
          {a(u, 'dossier.modifier') && !factureVivante && (
            <form method="post" action={`/dossiers/${d.id}/facture`} target="_blank">
              <button className="btn">Émettre la facture</button>
            </form>
          )}
          {a(u, 'dossier.modifier') && factureVivante && (
            <form method="post" action={`/dossiers/${d.id}/facture?avoir=${factureVivante.id}`} target="_blank">
              <button className="btn">Émettre un avoir</button>
            </form>
          )}
          {a(u, 'dossier.verrouiller') && (
            <form action={basculerVerrou}>
              <input type="hidden" name="id" value={d.id} />
              <button className="btn">{d.verrouille ? 'Déverrouiller' : 'Verrouiller'}</button>
            </form>
          )}
        </div>
      </div>

      {/* ── Ce que les actions ont à dire ──
          Sept actions de cet écran renvoient un message par l'adresse (`?m=`) : code
          d'accès client, révocation, arbitrage d'une proposition, refus du
          dimensionnement. Aucune ne l'affichait. Le plus grave était le code d'accès du
          client : il n'existe en clair qu'à cet instant précis — perdu ici, il était perdu
          pour de bon, et l'accès devenait inutilisable. */}
      {sp?.m && (
        codeAcces ? (
          <div className="alert" style={{ marginTop: 14, borderColor: 'var(--accent)', background: '#f5f7ff' }}>
            <b>Accès client créé — notez le code maintenant</b>
            <div style={{ marginTop: 8, display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .4 }}>Identifiant</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 19, fontWeight: 700 }}>{codeAcces.identifiant}</div>
              </div>
              <div>
                <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: .4 }}>Code d’accès</div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 19, fontWeight: 700 }}>{codeAcces.code}</div>
              </div>
            </div>
            <p style={{ margin: '10px 0 0', fontSize: 12.5 }}>
              Le code n’est pas conservé en clair : il ne sera plus jamais affiché. Transmettez-le
              au client, puis <a href={`/dossiers/${d.id}`}>effacez-le de la barre d’adresse</a>.
            </p>
          </div>
        ) : (
          <div className="alert" style={{ marginTop: 14 }}>{sp.m}</div>
        )
      )}

      {!c.eligibilite.applicable && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <b>Dossier non éligible en l'état</b>
          {c.eligibilite.motif} La date d'engagement retenue est le {fr(d.date_engagement)}.
        </div>
      )}
      {voitMarge && fige && ecart !== 0 && (
        <div className="alert warn" style={{ marginTop: 14 }}>
          <b>Les montants figés ne correspondent plus au calcul courant</b>
          Marge figée {euros(d.marge_nette)} · calcul actuel {euros(v.margeNette)} (écart {ecart > 0 ? '+' : ''}{euros(ecart)}).
          Les montants du dossier restent ceux du {fr(d.date_calcul)} tant que vous ne recalculez pas.
        </div>
      )}

      <div className="grid k2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Calcul du volume{multi ? <span className="tag" style={{ marginLeft: 6, textTransform: 'none' }}>opération principale</span> : null}</h2>
          <div className="rowline"><span className="muted">Fiche</span><b className="mono">{d.fiche_code} — {d.fv_version}</b></div>
          <div className="rowline"><span className="muted">Validité</span><span className="mono">{fr(d.fv_date_effet)} → {d.fv_date_fin ? fr(d.fv_date_fin) : 'en vigueur'}</span></div>
          <div className="rowline"><span className="muted">Secteur / zone</span><span>{d.secteur_activite} · {d.zone_climatique || '—'}</span></div>
          <div className="rowline"><span className="muted">Coefficient retenu</span><span className="mono">{c.cumac.coefficient ?? '—'}</span></div>
          <div className="rowline total"><span>Volume cumac</span><span className="mono">{nombre(c.cumac.cumac / 1000)} MWh</span></div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{c.cumac.detail}</p>
        </div>

        {voitMarge ? (
        <div className="card">
          <h2>Valorisation {fige ? <span className="tag" style={{ marginLeft: 6 }}>figée le {fr(d.date_calcul)}</span> : null}</h2>
          {v ? (
            <>
              <div className="rowline">
                <span className="muted">Régime</span>
                <b>{v.regime === 'PRECAIRE' ? 'Précaire' : 'Classique'}{v.avecMpr ? ' · avec MPR' : ' · sans MPR'}</b>
              </div>
              <div className="rowline"><span className="muted">Deal</span><span>{c.deal.libelle} ({c.deal.version})</span></div>
              <div className="rowline"><span>Versé par le délégataire</span><b className="mono">{euros(fige ? d.prime_delegataire : v.caDelegataire)}</b></div>
              <div className="rowline"><span className="muted">− prime cédée au bénéficiaire</span><span className="mono">− {euros(fige ? d.prime_beneficiaire : v.primeBeneficiaire)}</span></div>
              <div className="rowline"><span className="muted">− commission installateur</span><span className="mono">− {euros(fige ? d.commission_installateur : v.commissionInstallateur)}</span></div>
              <div className="rowline"><span className="muted">− commission apporteur</span><span className="mono">− {euros(fige ? d.commission_apporteur : v.commissionApporteur)}</span></div>
              <div className="rowline total">
                <span>Marge nette</span>
                <span className="mono" style={{ color: (fige ? d.marge_nette : v.margeNette) >= 0 ? 'var(--ok)' : 'var(--danger)' }}>
                  {euros(fige ? d.marge_nette : v.margeNette)}
                </span>
              </div>
              {!fige && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Montants indicatifs — cliquez « Calculer et figer » pour les arrêter sur le dossier.</p>}
            </>
          ) : <p className="muted">Aucun deal rattaché.</p>}
        </div>
        ) : (
          <div className="card">
            <h2>Valorisation</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Les montants de ce dossier ne vous sont pas accessibles. Ils ne sont pas seulement
              masqués : le serveur ne les envoie pas.
            </p>
          </div>
        )}
      </div>

      {a(u, 'dossier.modifier') ? (
      <form action={majDossier} className="card" style={{ marginTop: 14 }}>
        <input type="hidden" name="id" value={d.id} />
        <h2>Modifier le dossier</h2>
        <div className="grid k4">
          {AXES.map(([champ, axe, label]) => (
            <div className="field" key={champ}>
              <label>{label}</label>
              <select key={`${champ}-${d[champ] || 'vide'}`} name={champ} defaultValue={d[champ] || ''} disabled={!peutModifier}>
                <option value="">—</option>
                {statuts[axe].map((s) => (
                  <option key={s.id} value={s.id}>{s.etape ? `${s.etape} · ` : ''}{s.libelle}</option>
                ))}
              </select>
            </div>
          ))}
          <div className="field">
            <label>Deal</label>
            <select key={`deal-${d.deal_id || 'vide'}`} name="deal_id" defaultValue={d.deal_id || ''} disabled={!peutModifier}>
              <option value="">—</option>
              {listeDeals.map((x) => <option key={x.id} value={x.id}>{x.libelle} ({x.version})</option>)}
            </select>
          </div>
          <div className="field">
            <label>Quantité ({d.unite_variable})</label>
            <input key={`q-${d.quantite}`} type="number" step="any" name="quantite" defaultValue={d.quantite} disabled={!peutModifier} />
          </div>
          <div className="field">
            <label>Charte</label>
            <select key={`charte-${d.charte}`} name="charte" defaultValue={d.charte} disabled={!peutModifier}>
              <option value="HORS_CDP">Hors coup de pouce</option>
              <option value="CDP">Coup de pouce</option>
            </select>
          </div>
          <div className="field">
            <label>Date d'engagement</label>
            <input key={`de-${d.date_engagement}`} type="date" name="date_engagement" defaultValue={(d.date_engagement || '').slice(0, 10)} disabled={!peutModifier} />
          </div>
          <div className="field">
            <label>Date de pose</label>
            <input key={`dp-${d.date_pose}`} type="date" name="date_pose" defaultValue={(d.date_pose || '').slice(0, 10)} disabled={!peutModifier} />
          </div>
          <div className="field">
            <label>Date de dépôt</label>
            <input key={`dd-${d.date_depot}`} type="date" name="date_depot" defaultValue={(d.date_depot || '').slice(0, 10)} disabled={!peutModifier} />
          </div>
          <div className="field">
            <label>Source</label>
            <input key={`src-${d.source}`} type="text" name="source" defaultValue={d.source || ''} disabled={!peutModifier} />
          </div>
          <div className="field">
            <label style={{ marginTop: 22 }}>
              <input key={`mpr-${d.avec_mpr}`} type="checkbox" name="avec_mpr" defaultChecked={!!d.avec_mpr} disabled={!peutModifier} style={{ width: 'auto', marginRight: 7 }} />
              Avec MaPrimeRénov'
            </label>
          </div>
        </div>
        <button className="btn primary" disabled={!peutModifier}>Enregistrer</button>
        {d.verrouille ? <span className="muted" style={{ marginLeft: 10, fontSize: 12.5 }}>Dossier verrouillé — déverrouillez-le pour modifier.</span> : null}
      </form>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Modifier le dossier</h2>
          <p className="muted" style={{ marginTop: 0 }}>Vous avez un accès en lecture seule sur ce dossier.</p>
        </div>
      )}

      {sp?.site && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <b>Site non enregistré</b>
          {sp.site}
        </div>
      )}

      {a(u, 'dossier.modifier') && (
        <form action={majSite} className="card" style={{ marginTop: 14 }}>
          <input type="hidden" name="dossier_id" value={d.id} />
          <h2>Site et données réglementaires</h2>
          <p className="muted" style={{ marginTop: -6, marginBottom: 12, fontSize: 12.5 }}>
            La zone climatique et le secteur d'activité <b>entrent dans le calcul du cumac</b>.
            Les corriger change le volume, donc la marge : pensez à recalculer ensuite.
          </p>
          <div className="grid k3">
            <div className="field">
              <label>Adresse</label>
              <input key={`a-${d.adresse}`} name="adresse" defaultValue={d.adresse || ''} disabled={!peutModifier} required />
            </div>
            <div className="field">
              <label>Code postal</label>
              <input key={`cp-${d.code_postal}`} name="code_postal" defaultValue={d.code_postal || ''} disabled={!peutModifier} required />
            </div>
            <div className="field">
              <label>Ville</label>
              <input key={`v-${d.ville}`} name="ville" defaultValue={d.ville || ''} disabled={!peutModifier} required />
            </div>
            <div className="field">
              <label>Zone climatique</label>
              <select key={`z-${d.zone_climatique}`} name="zone_climatique" defaultValue={d.zone_climatique || ''} disabled={!peutModifier}>
                <option value="">non renseignée</option>
                {ZONES_CLIMATIQUES.map((z) => <option key={z.code} value={z.code}>{z.libelle}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Secteur d'activité</label>
              <select key={`s-${d.secteur_activite}`} name="secteur_activite" defaultValue={d.secteur_activite || ''} disabled={!peutModifier}>
                <option value="">non renseigné</option>
                {SECTEURS_SITE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Type de chauffage</label>
              <select key={`c-${d.type_chauffage}`} name="type_chauffage" defaultValue={d.type_chauffage || ''} disabled={!peutModifier}>
                <option value="">non renseigné</option>
                {CHAUFFAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Âge du bâtiment (années)</label>
              <input key={`ag-${d.age_batiment}`} name="age_batiment" type="number" defaultValue={d.age_batiment ?? ''} disabled={!peutModifier} />
            </div>
            <div className="field">
              <label>Surface (m²)</label>
              <input key={`su-${d.surface}`} name="surface" type="number" step="any" defaultValue={d.surface ?? ''} disabled={!peutModifier} />
            </div>
            <div className="field">
              <label>Quartier prioritaire</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontWeight: 400, marginTop: 6 }}>
                <input key={`q-${d.qpv}`} type="checkbox" name="qpv" defaultChecked={!!d.qpv}
                       style={{ width: 'auto' }} disabled={!peutModifier} />
                Le site est en QPV
              </label>
            </div>
          </div>
          <button className="btn primary" disabled={!peutModifier}>Enregistrer le site</button>
        </form>
      )}

      <Operations dossierId={d.id} d={d} modifiable={peutModifier} voitMarge={voitMarge} />

      <Commercial dossierId={d.id} d={d} modifiable={peutModifier} />

      {/* Blocs réglementaires : réseau de chaleur, audit, contrôles, devis/facture.
          Ils n'entrent pas dans le calcul et restent donc saisissables sur un dossier figé. */}
      <BlocsTechniques dossierId={d.id} d={d} modifiable={peutModifier} />

      {sp?.piece && (
        <div className="alert danger" style={{ marginTop: 14 }}>
          <b>Pièce refusée</b>
          {sp.piece}
        </div>
      )}


      <div className="card" style={{ marginTop: 14 }}>
        <h2>
          Pièces du dossier
          {comp.liasse ? <span className="tag" style={{ marginLeft: 8, textTransform: 'none' }}>{comp.liasse.libelle}</span> : null}
        </h2>
        {comp.sansLiasse ? (
          <p className="muted">
            Aucune liasse n'est paramétrée pour ce couple délégataire / fiche : impossible de contrôler la complétude.
          </p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div className="bar" style={{ flex: 1 }}>
                <span style={{ width: `${comp.tauxComplet}%`, background: comp.complet ? 'var(--ok)' : comp.deposable ? 'var(--warn)' : 'var(--danger)' }} />
              </div>
              <b className="mono" style={{ minWidth: 42, textAlign: 'right' }}>{comp.tauxComplet} %</b>
              {comp.complet
                ? <span className="pill" style={{ background: 'var(--ok)' }}>Complet et validé</span>
                : comp.deposable
                  ? <span className="pill" style={{ background: 'var(--warn)' }}>{comp.aValider.length} pièce(s) en attente de validation</span>
                  : <span className="pill" style={{ background: 'var(--danger)' }}>{comp.manquants.length} pièce(s) manquante(s)</span>}
            </div>

            <table>
              <thead><tr><th>Pièce</th><th>État</th><th>Fichier</th><th></th></tr></thead>
              <tbody>
                {comp.lignes.map((l) => (
                  <tr key={l.typeDocumentId}>
                    <td>
                      {l.libelle}
                      {l.obligatoire ? <span className="muted"> *</span> : <span className="muted" style={{ fontSize: 11.5 }}> (facultative)</span>}
                    </td>
                    <td>
                      {l.etat === 'VALIDE' && <span className="pill" style={{ background: 'var(--ok)' }}>Validée</span>}
                      {l.etat === 'A_VALIDER' && <span className="pill" style={{ background: 'var(--warn)' }}>À valider</span>}
                      {l.etat === 'MANQUANT' && <span className="pill" style={{ background: l.obligatoire ? 'var(--danger)' : '#94a3b8' }}>Manquante</span>}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {l.documents.length === 0 && <span className="muted">—</span>}
                      {l.documents.map((doc) => (
                        <div key={doc.id} style={{ marginBottom: 3 }}>
                          {doc.empreinte ? (
                            <>
                              <a href={`/piece/${doc.id}`} className="lien-dossier" style={{ fontWeight: 500 }}>
                                {doc.nom_fichier}
                              </a>
                              {APERCU.has(doc.type_mime) && (
                                <a href={`/piece/${doc.id}?apercu=1`} target="_blank" rel="noopener"
                                   className="tag" style={{ marginLeft: 6 }}>voir</a>
                              )}
                              <span className="muted" style={{ marginLeft: 6, fontSize: 11 }}>{poids(doc.taille)}</span>
                            </>
                          ) : (
                            <>
                              <span>{doc.nom_fichier}</span>
                              <span className="tag warn" style={{ marginLeft: 6 }}>sans fichier</span>
                            </>
                          )}
                        </div>
                      ))}
                    </td>
                    <td className="right">
                      {l.documents.map((doc) => (
                        <span key={doc.id} style={{ display: 'inline-flex', gap: 6 }}>
                          {a(u, 'piece.valider') && (
                            <form action={validerDocument} style={{ display: 'inline' }}>
                              <input type="hidden" name="document_id" value={doc.id} />
                              <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }} disabled={!!d.verrouille}>
                                {doc.valide_par_delegataire ? 'Invalider' : 'Valider'}
                              </button>
                            </form>
                          )}
                          {a(u, 'piece.deposer') && (
                            <form action={supprimerDocument} style={{ display: 'inline' }}>
                              <input type="hidden" name="document_id" value={doc.id} />
                              <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }} disabled={!!d.verrouille}>Retirer</button>
                            </form>
                          )}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {a(u, 'piece.deposer') && (
              <form key={`doc-${comp.lignes.reduce((s, l) => s + l.documents.length, 0)}`}
                    action={ajouterDocument} style={{ marginTop: 14 }}>
                <input type="hidden" name="dossier_id" value={d.id} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div className="field" style={{ marginBottom: 0, minWidth: 230 }}>
                    <label>Type de pièce</label>
                    <select name="type_document_id" disabled={!peutModifier}>
                      {types.map((t) => <option key={t.id} value={t.id}>{t.libelle}</option>)}
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 240 }}>
                    <label>Fichier</label>
                    <input type="file" name="fichier" disabled={!peutModifier}
                           accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.tif,.tiff,.doc,.docx,.xls,.xlsx,.zip" />
                  </div>
                  <button className="btn primary" disabled={!peutModifier}>Déposer la pièce</button>
                </div>
                <p className="muted" style={{ fontSize: 11.5, marginTop: 8, marginBottom: 0 }}>
                  PDF, images, documents Office et ZIP, jusqu'à {TAILLE_MAX / 1048576} Mo.
                  Le type est vérifié <b>d'après le contenu</b>, pas d'après l'extension.
                  Un fichier déjà présent à l'identique n'est pas stocké deux fois.
                </p>
              </form>
            )}
          </>
        )}
      </div>

      <div className="grid k2" style={{ marginTop: 14 }}>
        <div className="card">
          <h2>Journal des modifications</h2>
          {journal.length === 0 ? <p className="muted">Aucune modification enregistrée.</p> : (
            <table>
              <thead><tr><th>Quand</th><th>Champ</th><th>Avant</th><th>Après</th><th>Par</th></tr></thead>
              <tbody>
                {journal.map((j) => (
                  <tr key={j.id}>
                    <td className="mono muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{dt(j.created_at)}</td>
                    <td>{j.champ}</td>
                    <td className="muted">{j.ancienne ?? '—'}</td>
                    <td><b>{j.nouvelle ?? '—'}</b></td>
                    <td className="muted">{j.prenom ? `${j.prenom} ${j.nom}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Notes et échanges</h2>
          <form key={`note-${notes.length}`} action={ajouterNote} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input type="hidden" name="dossier_id" value={d.id} />
            <select name="canal" style={{ width: 130, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, font: 'inherit' }}>
              <option value="NOTE">Note</option>
              <option value="APPEL">Appel</option>
              <option value="SMS">SMS</option>
              <option value="EMAIL">E-mail</option>
            </select>
            <input name="contenu" placeholder="Ajouter une note…" style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 7, font: 'inherit' }} />
            <button className="btn">Ajouter</button>
          </form>
          {notes.length === 0 ? <p className="muted">Aucune note.</p> : notes.map((n) => (
            <div key={n.id} style={{ padding: '9px 0', borderBottom: '1px solid #f0f2f4' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span className="tag">{n.canal}</span>
                <span className="muted mono" style={{ fontSize: 11.5 }}>{dt(n.created_at)}</span>
              </div>
              <div style={{ marginTop: 4 }}>{n.contenu}</div>
              <div className="muted" style={{ fontSize: 11.5 }}>{n.prenom ? `${n.prenom} ${n.nom}` : ''}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Le dimensionnement n'a de sens que sur un dossier de séchage : il ne s'affiche
          que si la fiche du dossier est celle-là, ou si des réponses de qualification
          existent déjà. Ailleurs, ce serait un pavé vide de plus sur l'écran. */}
      {(() => {
        const etat = etatDimensionnement(db(), d.id)
        const pertinent = d.fiche_code === FICHE_SECHAGE || Object.keys(etat.reponses).length > 0
        if (!pertinent) return null

        // Le volume tel que la fiche le calcule, avec les critères réellement saisis.
        //
        // On regarde l'opération EN COURS — celle qui n'est pas encore figée — plutôt que
        // la première venue : c'est elle que le dimensionnement vient d'alimenter. Prendre
        // `operations[0]` affichait le volume d'une opération figée de longue date, et
        // laissait croire que le report n'avait rien fait.
        const op = etat.operations.find((o) => !o.date_calcul) || etat.operations[0]
        const fv = op ? db().prepare(`SELECT fv.* FROM fiche_version fv JOIN fiche f ON f.id = fv.fiche_id
                             WHERE f.code = ? ORDER BY fv.date_effet DESC LIMIT 1`).get(FICHE_SECHAGE) : null
        const cumac = op && fv ? calculerCumac({
          ficheVersion: fv,
          quantite: op.quantite,
          contexte: {
            zoneClimatique: d.zone_climatique,
            typeProduit: op.type_produit,
            typeInstallation: op.type_installation,
          },
        }) : null

        return (
          <Dimensionnement
            dossierId={d.id}
            etat={etat}
            cumac={cumac}
            peutModifier={peutModifier && a(u, 'dossier.modifier')}
          />
        )
      })()}

      <EspaceClient
        dossierId={d.id}
        acces={accesDuDossier(db(), d.id)}
        propositions={enAttente(db(), d.id)}
        peutModifier={peutModifier && a(u, 'dossier.modifier')}
      />

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Conditions d'éligibilité de la fiche</h2>
        {c.conditions.length === 0 ? <p className="muted">Aucune condition paramétrée.</p> : (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {c.conditions.map((cd) => <li key={cd.code} style={{ marginBottom: 5 }}>{cd.libelle}</li>)}
          </ul>
        )}
      </div>

      <p style={{ marginTop: 18 }}>
        <a href="/dossiers" style={{ color: 'var(--accent)' }}>← Retour à la liste</a>
      </p>
    </>
  )
}

function fr(d) { return d ? new Date(d).toLocaleDateString('fr-FR') : '—' }
function dt(d) {
  if (!d) return '—'
  const x = new Date(d.includes('T') ? d : d.replace(' ', 'T') + 'Z')
  return x.toLocaleDateString('fr-FR') + ' ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}
