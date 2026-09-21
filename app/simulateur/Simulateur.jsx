'use client'

import { useMemo, useState } from 'react'
import { calculerCumac, ficheApplicable, conditionsLisibles } from '../../lib/cumac.js'
import { calculerValorisation, dealApplicable, euros, nombre } from '../../lib/marge.js'
import { ZONES_CLIMATIQUES, TYPES_CHAUFFAGE } from '../../lib/referentiels-site.js'

const SECTEURS = [
  ['BUREAUX', 'Bureaux'], ['COMMERCE', 'Commerce'], ['SANTE', 'Santé'],
  ['ENSEIGNEMENT', 'Enseignement'], ['HOTEL_RESTAURANT', 'Hôtellerie-restauration'], ['AUTRE', 'Autre'],
]

export default function Simulateur({ fiches, deals }) {
  const [ficheId, setFicheId] = useState(fiches.find((f) => !f.date_fin)?.version_id || fiches[0]?.version_id)
  const [dealId, setDealId] = useState(deals[0]?.id)
  const [quantite, setQuantite] = useState(2400)
  const [secteur, setSecteur] = useState('BUREAUX')
  const [zone, setZone] = useState('H1')
  const [regime, setRegime] = useState('CLASSIQUE')
  const [avecMpr, setAvecMpr] = useState(false)
  const [dateEngagement, setDateEngagement] = useState(new Date().toISOString().slice(0, 10))
  const [coutPose, setCoutPose] = useState(0)
  const [tauxApporteur, setTauxApporteur] = useState(8)

  const fiche = fiches.find((f) => f.version_id === ficheId)
  const deal = deals.find((d) => d.id === dealId)

  const resultat = useMemo(() => {
    if (!fiche) return null
    const fv = {
      version: fiche.version, date_effet: fiche.date_effet, date_fin: fiche.date_fin,
      arrete_reference: fiche.arrete_reference, motif_fin: fiche.motif_fin,
      formule_type: fiche.formule_type, unite_variable: fiche.unite_variable,
      coefficients: fiche.coefficients, conditions: fiche.conditions,
    }
    const eligibilite = ficheApplicable(fv, dateEngagement)
    const cumac = calculerCumac({
      ficheVersion: fv, quantite,
      contexte: { secteurActivite: secteur, zoneClimatique: zone },
    })
    const dealOk = deal ? dealApplicable(deal, dateEngagement) : null
    const valorisation = deal
      ? calculerValorisation({ cumac: cumac.cumac, deal, regime, avecMpr, coutPose, tauxApporteur })
      : null
    return { eligibilite, cumac, dealOk, valorisation, conditions: conditionsLisibles(fiche.conditions) }
  }, [fiche, deal, quantite, secteur, zone, regime, avecMpr, dateEngagement, coutPose, tauxApporteur])

  const v = resultat?.valorisation
  const bloque = resultat && !resultat.eligibilite.applicable

  return (
    <div className="grid k2">
      <div className="card">
        <h2>Paramètres</h2>

        <div className="field">
          <label>Fiche d'opération</label>
          <select value={ficheId} onChange={(e) => setFicheId(e.target.value)}>
            {fiches.map((f) => (
              <option key={f.version_id} value={f.version_id}>
                {f.code} — {f.libelle}{f.date_fin ? ' (validité limitée)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Date d'engagement (signature du devis)</label>
          <input type="date" value={dateEngagement} onChange={(e) => setDateEngagement(e.target.value)} />
        </div>

        <div className="field">
          <label>Quantité{fiche?.unite_variable ? ` (${fiche.unite_variable})` : ''}</label>
          <input type="number" value={quantite} onChange={(e) => setQuantite(Number(e.target.value))} />
        </div>

        <div className="field">
          <label>Secteur d'activité</label>
          <select value={secteur} onChange={(e) => setSecteur(e.target.value)}>
            {SECTEURS.map(([v2, l]) => <option key={v2} value={v2}>{l}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Zone climatique</label>
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {ZONES_CLIMATIQUES.map((z) => <option key={z.code} value={z.code}>{z.libelle}</option>)}
          </select>
        </div>

        <div className="field">
          <label>Deal (contrat délégataire)</label>
          <select value={dealId} onChange={(e) => setDealId(e.target.value)}>
            {deals.map((d) => <option key={d.id} value={d.id}>{d.libelle} — {d.version} ({d.delegataire_nom})</option>)}
          </select>
        </div>

        <div className="field">
          <label>Régime du bénéficiaire</label>
          <select value={regime} onChange={(e) => setRegime(e.target.value)}>
            <option value="CLASSIQUE">Classique</option>
            <option value="PRECAIRE">Précaire</option>
          </select>
        </div>

        <div className="field">
          <label>
            <input type="checkbox" checked={avecMpr} onChange={(e) => setAvecMpr(e.target.checked)} style={{ width: 'auto', marginRight: 7 }} />
            Dossier avec MaPrimeRénov'
          </label>
        </div>

        <div className="field">
          <label>Coût de pose (€)</label>
          <input type="number" value={coutPose} onChange={(e) => setCoutPose(Number(e.target.value))} />
        </div>

        <div className="field">
          <label>Commission apporteur (% du versé délégataire)</label>
          <input type="number" value={tauxApporteur} onChange={(e) => setTauxApporteur(Number(e.target.value))} />
        </div>
      </div>

      <div>
        {bloque && (
          <div className="alert danger">
            <b>Opération non valorisable à cette date</b>
            {resultat.eligibilite.motif}
          </div>
        )}
        {resultat?.dealOk && !resultat.dealOk.applicable && (
          <div className="alert warn">
            <b>Deal non applicable à cette date</b>
            {resultat.dealOk.motif}
          </div>
        )}

        <div className="card" style={{ marginBottom: 14 }}>
          <h2>Volume</h2>
          <div className="rowline">
            <span className="muted">Coefficient retenu</span>
            <span className="mono">{resultat?.cumac.coefficient ?? '—'} kWh cumac/{fiche?.unite_variable}</span>
          </div>
          <div className="rowline total">
            <span>Volume cumac</span>
            <span className="mono">{bloque ? '0' : nombre(resultat?.cumac.cumac / 1000)} MWh</span>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>{resultat?.cumac.detail}</p>
        </div>

        <div className="card">
          <h2>Marge</h2>
          {v && !bloque ? (
            <>
              <div className="rowline"><span>Versé par le délégataire</span><b className="mono">{euros(v.caDelegataire)}</b></div>
              <div className="rowline"><span className="muted">− prime cédée au bénéficiaire</span><span className="mono">− {euros(v.primeBeneficiaire)}</span></div>
              <div className="rowline"><span className="muted">− commission installateur</span><span className="mono">− {euros(v.commissionInstallateur)}</span></div>
              <div className="rowline"><span className="muted">− commission apporteur</span><span className="mono">− {euros(v.commissionApporteur)}</span></div>
              <div className="rowline"><span className="muted">− coût de pose</span><span className="mono">− {euros(v.coutPose)}</span></div>
              <div className="rowline total">
                <span>Marge nette</span>
                <span className="mono" style={{ color: v.margeNette > 0 ? 'var(--ok)' : 'var(--danger)' }}>
                  {euros(v.margeNette)}
                  <span className="muted" style={{ fontSize: 12, fontWeight: 500, marginLeft: 6 }}>({v.tauxMarge} %)</span>
                </span>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Ratios appliqués — régime {v.regime === 'PRECAIRE' ? 'précaire' : 'classique'},
                {v.avecMpr ? ' avec' : ' sans'} MPR : délégataire {v.ratios.delegataire.toFixed(2)} €/MWh,
                cédée {v.ratios.cedeBeneficiaire.toFixed(2)} €/MWh,
                installateur {v.ratios.gardeInstallateur.toFixed(2)} €/MWh.
              </p>
            </>
          ) : (
            <p className="muted">
              {bloque ? "Aucune valorisation possible : la fiche n'est pas applicable à cette date d'engagement."
                      : 'Sélectionnez un deal pour obtenir la marge.'}
            </p>
          )}
        </div>

        {resultat?.conditions?.length > 0 && (
          <div className="card" style={{ marginTop: 14 }}>
            <h2>Conditions à vérifier avant engagement</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {resultat.conditions.map((c) => <li key={c.code} style={{ marginBottom: 5 }}>{c.libelle}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
