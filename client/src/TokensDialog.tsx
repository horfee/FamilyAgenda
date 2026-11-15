import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from './api';
import { addDays, fromInputs, startOfDay, toDateInput } from './dates';
import type { AccessToken } from './types';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium' });

/** Fin de journée de la date saisie (le jeton reste valable toute la journée choisie). */
const endOfDate = (date: string) => addDays(startOfDay(fromInputs(date)), 1) - 1;

interface Form {
  id: string | null; // null = création
  name: string;
  noExpiry: boolean;
  date: string;
}

export function TokensDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const [tokens, setTokens] = useState<AccessToken[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setTokens((await api<{ tokens: AccessToken[] }>('/api/tokens', { token })).tokens);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const startCreate = () => {
    setCreated(null);
    setError('');
    setForm({ id: null, name: '', noExpiry: true, date: toDateInput(addDays(Date.now(), 90)) });
  };

  const startEdit = (t: AccessToken) => {
    setCreated(null);
    setError('');
    setForm({
      id: t.id,
      name: t.name,
      noExpiry: t.expiresAt === null,
      date: toDateInput(t.expiresAt ?? addDays(Date.now(), 90)),
    });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError('');
    const body = { name: form.name.trim(), expiresAt: form.noExpiry ? null : endOfDate(form.date) };
    try {
      if (form.id) {
        await api(`/api/tokens/${form.id}`, { method: 'PATCH', body, token });
      } else {
        const r = await api<{ token: string }>('/api/tokens', { body, token });
        setCreated(r.token);
      }
      setForm(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (t: AccessToken) => {
    if (!confirm(`Supprimer le jeton « ${t.name} » ? Les clients qui l'utilisent perdront l'accès.`)) return;
    try {
      await api(`/api/tokens/${t.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const status = (t: AccessToken) => {
    if (t.expiresAt === null) return 'Sans expiration';
    return t.expiresAt <= Date.now() ? `Expiré le ${dateFmt.format(t.expiresAt)}` : `Expire le ${dateFmt.format(t.expiresAt)}`;
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog">
        <h2>Jetons d'accès (serveur MCP)</h2>
        <p className="muted">
          À utiliser dans l'en-tête <code>Authorization: Bearer …</code> du client MCP. La valeur n'est affichée qu'à la
          création.
        </p>

        {created && (
          <div className="token-created">
            <span>Copiez ce jeton maintenant, il ne sera plus affichable :</span>
            <input readOnly value={created} onFocus={(e) => e.target.select()} />
            <button type="button" onClick={() => void navigator.clipboard?.writeText(created)}>
              Copier
            </button>
          </div>
        )}

        <ul className="token-list">
          {tokens.map((t) => (
            <li key={t.id}>
              <div className="token-info">
                <strong>{t.name}</strong>
                <span className="muted">
                  {t.prefix}… · {status(t)} ·{' '}
                  {t.lastUsedAt ? `utilisé le ${dateFmt.format(t.lastUsedAt)}` : 'jamais utilisé'}
                </span>
              </div>
              <button type="button" onClick={() => startEdit(t)}>
                Modifier
              </button>
              <button type="button" className="danger" onClick={() => void remove(t)}>
                Supprimer
              </button>
            </li>
          ))}
          {tokens.length === 0 && <li className="muted">Aucun jeton.</li>}
        </ul>

        {form ? (
          <form className="token-form" onSubmit={(e) => void submit(e)}>
            <label>
              Nom
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
                autoFocus
                maxLength={60}
              />
            </label>
            <label className="inline">
              <input
                type="checkbox"
                checked={form.noExpiry}
                onChange={(e) => setForm({ ...form, noExpiry: e.target.checked })}
              />
              Sans date d'expiration
            </label>
            {!form.noExpiry && (
              <label>
                Expire le
                <input
                  type="date"
                  value={form.date}
                  min={toDateInput(Date.now())}
                  required
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
            )}
            <div className="actions">
              <span className="spacer" />
              <button type="button" onClick={() => setForm(null)}>
                Annuler
              </button>
              <button className="primary">{form.id ? 'Enregistrer' : 'Créer'}</button>
            </div>
          </form>
        ) : (
          <div className="actions">
            <button type="button" className="primary" onClick={startCreate}>
              Nouveau jeton
            </button>
            <span className="spacer" />
            <button type="button" onClick={onClose}>
              Fermer
            </button>
          </div>
        )}

        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
