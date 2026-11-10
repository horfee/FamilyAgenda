import { useState, type FormEvent } from 'react';
import { api } from './api';
import type { Session } from './types';

export function Login({ onSession }: { onSession: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const s = await api<Session>(mode === 'login' ? '/api/login' : '/api/register', {
        body: { name, password },
      });
      onSession(s);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <h1>Familly Agenda</h1>
        <p className="muted">Agenda partagé</p>
        <label>
          Nom
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus required autoComplete="username" />
        </label>
        <label>
          Mot de passe
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy}>
          {mode === 'login' ? 'Se connecter' : 'Créer le compte'}
        </button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Créer un compte' : 'J\u2019ai déjà un compte'}
        </button>
      </form>
    </div>
  );
}
