import { garde } from '../../lib/garde.js'
import {
  donneesComptes, creerUtilisateur, majUtilisateur, majPermissionsRole,
  genererLienActivation, fermerToutesSessions,
} from '../../lib/actions-auth.js'
import { PERMISSIONS } from '../../lib/permissions.js'

export const dynamic = 'force-dynamic'

export default async function Utilisateurs({ searchParams }) {
  const { u } = await garde('utilisateur.gerer')
  const sp = await searchParams
  const { utilisateurs, roles, unites } = await donneesComptes()

  return (
    <>
      <h1>Comptes et rôles</h1>
      <p className="lede">
        Un compte créé ici n'a pas de mot de passe : il est inutilisable tant que son
        détenteur ne l'a pas choisi lui-même, par un lien d'activation. Personne, pas même
        vous, ne connaît le mot de passe de quiconque.
      </p>

      {sp?.e && <div className="alert danger">{sp.e}</div>}
      {sp?.cree && (
        <div className="alert ok">
          <b>Compte créé pour {sp.cree}</b>
          Générez maintenant son lien d'activation, dans la liste ci-dessous, et transmettez-le-lui.
        </div>
      )}
      {sp?.maj && <div className="alert ok"><b>Modification enregistrée</b></div>}
      {sp?.activation && (
        <div className="alert warn">
          <b>Lien d'activation — valable 48 heures, à usage unique</b>
          <code style={{
            display: 'block', marginTop: 8, padding: 10, background: '#fff',
            border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, wordBreak: 'break-all',
          }}>/activation/{sp.activation}</code>
          <span style={{ display: 'block', marginTop: 8 }}>
            Transmettez-le à l'intéressé par le canal de votre choix. Il ne réapparaîtra pas :
            si vous le perdez, générez-en un nouveau.
          </span>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflowX: 'auto', marginTop: 14 }}>
        <div style={{ padding: '14px 18px 0' }}><h2 style={{ margin: 0 }}>Les comptes</h2></div>
        <table style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th>Personne</th><th>Rôle</th><th>Unité d'affaire</th><th>État</th>
              <th className="num">Sessions</th><th></th>
            </tr>
          </thead>
          <tbody>
            {utilisateurs.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.prenom} {c.nom}</b>
                  <div className="muted mono" style={{ fontSize: 11.5 }}>{c.email}</div>
                </td>
                <td colSpan={3} style={{ padding: 0 }}>
                  <form action={majUtilisateur} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', flexWrap: 'wrap' }}>
                    <input type="hidden" name="id" value={c.id} />
                    <select name="role_id" defaultValue={c.role_id || ''} style={champ}>
                      <option value="">sans rôle</option>
                      {roles.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                    </select>
                    <select name="unite_affaire_id" defaultValue={c.unite_affaire_id || ''} style={champ}>
                      <option value="">toutes</option>
                      {unites.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
                    </select>
                    <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" name="actif" defaultChecked={!!c.actif} /> actif
                    </label>
                    <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }}>Enregistrer</button>
                    {!c.mot_de_passe && <span className="tag" style={{ background: '#fef3c7', color: '#92400e' }}>non activé</span>}
                    {c.bloque_jusqua && new Date(c.bloque_jusqua) > new Date() && (
                      <span className="tag" style={{ background: '#fef2f2', color: '#991b1b' }}>bloqué</span>
                    )}
                  </form>
                </td>
                <td className="num mono">{c.sessions}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <form action={genererLienActivation} style={{ display: 'inline' }}>
                    <input type="hidden" name="utilisateur_id" value={c.id} />
                    <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }}>
                      {c.mot_de_passe ? 'Réinitialiser' : 'Lien d\'activation'}
                    </button>
                  </form>
                  {c.sessions > 0 && (
                    <form action={fermerToutesSessions} style={{ display: 'inline', marginLeft: 6 }}>
                      <input type="hidden" name="utilisateur_id" value={c.id} />
                      <button className="btn" style={{ padding: '3px 9px', fontSize: 12 }}>Déconnecter</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, padding: '10px 18px 16px', margin: 0 }}>
          « Réinitialiser » ne révèle aucun mot de passe : cela produit un lien qui permet à
          l'intéressé d'en choisir un nouveau. L'ancien reste valable jusque-là.
        </p>
      </div>

      <form action={creerUtilisateur} className="card" style={{ marginTop: 14 }}>
        <h2>Ajouter un compte</h2>
        <div className="grid k4">
          <div className="field"><label>Prénom</label><input name="prenom" required /></div>
          <div className="field"><label>Nom</label><input name="nom" required /></div>
          <div className="field"><label>Adresse e-mail</label><input name="email" type="email" required /></div>
          <div className="field">
            <label>Rôle</label>
            <select name="role_id" defaultValue="">
              <option value="">sans rôle</option>
              {roles.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
            </select>
          </div>
        </div>
        <div className="grid k4">
          <div className="field">
            <label>Unité d'affaire</label>
            <select name="unite_affaire_id" defaultValue="">
              <option value="">toutes</option>
              {unites.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          L'unité d'affaire ne compte que pour les rôles sans le droit « voir les dossiers de
          toutes les unités ». Pour les autres, elle est indicative.
        </p>
        <button className="btn primary">Créer le compte</button>
      </form>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>Les droits de chaque rôle</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Les deux qui comptent : <b>Voir les montants et la marge</b> — la grille de ratios est
          le secret de l'affaire — et <b>Voir les dossiers de toutes les unités</b>, sans lequel
          un utilisateur reste enfermé dans la sienne.
        </p>
        <div className="grid k2">
          {roles.map((r) => {
            let actives = []
            try { actives = JSON.parse(r.permissions || '[]') } catch { actives = [] }
            return (
              <form action={majPermissionsRole} key={r.id} className="card" style={{ background: '#fbfcfd' }}>
                <input type="hidden" name="role_id" value={r.id} />
                <h2 style={{ marginTop: 0 }}>{r.nom}</h2>
                <div style={{ display: 'grid', gap: 3 }}>
                  {Object.entries(PERMISSIONS).map(([code, libelle]) => (
                    <label key={code} style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                      <input type="checkbox" name="permission" value={code} defaultChecked={actives.includes(code)} style={{ marginTop: 2 }} />
                      <span style={code === 'marge.voir' || code === 'dossier.tous' ? { fontWeight: 600 } : undefined}>
                        {libelle}
                      </span>
                    </label>
                  ))}
                </div>
                <button className="btn" style={{ marginTop: 10 }}>Enregistrer les droits</button>
              </form>
            )
          })}
        </div>
      </div>
    </>
  )
}

const champ = {
  padding: '4px 7px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  font: 'inherit',
  fontSize: 12,
}
