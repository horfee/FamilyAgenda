import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, type View } from './Calendar';
import { EventDialog } from './EventDialog';
import { Login } from './Login';
import { useAgenda } from './useAgenda';
import { clearSession, getSession, setSession } from './session';
import { clearAll } from './localdb';
import { disablePush, enablePush, getPushState, type PushState } from './push';
import { addDays, addMonths, fmtMonth, fmtRange, startOfDay, startOfWeek } from './dates';
import type { AgendaEvent, Session } from './types';

export default function App() {
  const [session, setSess] = useState<Session | null>(getSession);

  const logout = useCallback(async () => {
    if (session) await disablePush(session.token).catch(() => undefined);
    clearSession();
    await clearAll();
    setSess(null);
  }, [session]);

  if (!session) {
    return (
      <Login
        onSession={(s) => {
          setSession(s);
          setSess(s);
        }}
      />
    );
  }
  return <Agenda session={session} onLogout={logout} />;
}

/** crypto.randomUUID n'existe qu'en contexte sécurisé (HTTPS/localhost) ; getRandomValues, si. */
const newId = (): string => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

function Agenda({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const { events, users, pending, online, syncing, save, remove, sync } = useAgenda(session, onLogout);
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => startOfDay(Date.now()));
  const [editing, setEditing] = useState<{ ev: AgendaEvent; isNew: boolean } | null>(null);
  const [push, setPush] = useState<PushState>('off');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    void getPushState().then(setPush);
  }, []);

  // Clic sur une notification : l'évènement à ouvrir arrive par l'adresse (app fermée) ou par message
  // (app ouverte). Il reste « en attente » tant que les évènements ne sont pas chargés.
  const [pendingEventId, setPendingEventId] = useState<string | null>(
    () => new URLSearchParams(location.search).get('event'),
  );

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'open-event' && typeof e.data.eventId === 'string') setPendingEventId(e.data.eventId);
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, []);

  useEffect(() => {
    if (!pendingEventId) return;
    const ev = events.find((x) => x.id === pendingEventId);
    if (ev) {
      setCursor(startOfDay(ev.startsAt));
      setEditing({ ev, isNew: false });
      setPendingEventId(null);
      return;
    }
    // Évènement introuvable (supprimé, ou synchro impossible) : on abandonne après un délai.
    const t = setTimeout(() => setPendingEventId(null), 15_000);
    return () => clearTimeout(t);
  }, [pendingEventId, events]);

  useEffect(() => {
    if (!pendingEventId && location.search.includes('event=')) history.replaceState(null, '', location.pathname);
  }, [pendingEventId]);

  const title = useMemo(() => {
    if (view === 'month') return fmtMonth(cursor);
    if (view === 'week') return fmtRange(startOfWeek(cursor), addDays(startOfWeek(cursor), 6));
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(cursor);
  }, [view, cursor]);

  const shift = (dir: 1 | -1) => {
    if (view === 'month') setCursor(addMonths(cursor, dir));
    else setCursor(addDays(cursor, dir * (view === 'week' ? 7 : 1)));
  };

  const create = (startsAt: number, allDay: boolean) => {
    const start = allDay ? startOfDay(startsAt) : startsAt;
    setEditing({
      isNew: true,
      ev: {
        id: newId(),
        ownerId: session.user.id,
        title: '',
        location: '',
        notes: '',
        allDay,
        startsAt: start,
        endsAt: allDay ? addDays(start, 1) : start + 3600_000,
        attendees: [],
        reminders: [],
      },
    });
  };

  const toggleSwitch = async () => {
    try {
      setPush(push === 'on' ? await disablePush(session.token) : await enablePush(session.token));
    } catch (err) {
      alert(`Notifications indisponibles : ${(err as Error).message}`);
    }
  };

  return (
    <div className="app">
      <header>
        <div className="brand">Familly Agenda</div>
        <button
          className="menu-toggle"
          aria-label="Menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          ⋯
        </button>
        <div className="nav">
          <button onClick={() => setCursor(startOfDay(Date.now()))}>Aujourd'hui</button>
          <button onClick={() => shift(-1)} aria-label="Précédent">
            ‹
          </button>
          <button onClick={() => shift(1)} aria-label="Suivant">
            ›
          </button>
          <h2>{title}</h2>
        </div>
        <div className="seg">
          {(['month', 'week', 'day'] as const).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {{ month: 'Mois', week: 'Semaine', day: 'Jour' }[v]}
            </button>
          ))}
        </div>
        <button
          className="primary add"
          aria-label="Nouvel évènement"
          onClick={() => create(Date.now() - (Date.now() % 3600_000) + 3600_000, false)}
        >
          <span className="plus">+</span>
          <span className="add-label"> Évènement</span>
        </button>
        <div className="status" title={online ? 'Connecté' : 'Hors connexion : les modifications seront synchronisées'}>
          <span className={`dot ${online ? 'ok' : 'off'}`} />
          <span className="status-label">{!online ? 'Hors ligne' : syncing ? 'Synchro…' : 'À jour'}</span>
          {pending > 0 && <span className="badge">{pending}</span>}
          <button className="icon" onClick={() => void sync()} aria-label="Synchroniser">
            ↻
          </button>
        </div>
        <div className={`header-extra ${menuOpen ? 'open' : ''}`}>
          {push !== 'unsupported' && (
            <button
              onClick={() => void toggleSwitch()}
              disabled={push === 'denied'}
              title={push === 'denied' ? 'Notifications bloquées dans le navigateur' : undefined}
            >
              {push === 'on' ? 'Notifications : oui' : 'Activer les notifications'}
            </button>
          )}
          <div className="me">
            <span className="avatar" style={{ background: session.user.color }}>
              {session.user.name[0]?.toUpperCase()}
            </span>
            {session.user.name}
            <button onClick={() => confirm('Se déconnecter ? Les données locales seront effacées.') && onLogout()}>
              Quitter
            </button>
          </div>
        </div>
      </header>

      <div className="legend">
        {users.map((u) => (
          <span key={u.id}>
            <i style={{ background: u.color }} />
            {u.name}
          </span>
        ))}
      </div>

      <main>
        <Calendar
          view={view}
          cursor={cursor}
          events={events}
          users={users}
          onCreate={create}
          onOpen={(ev) => setEditing({ ev, isNew: false })}
          onPickDay={(d) => {
            setCursor(d);
            setView('day');
          }}
        />
      </main>

      {editing && (
        <EventDialog
          key={editing.ev.id}
          draft={editing.ev}
          isNew={editing.isNew}
          me={session.user}
          users={users.length ? users : [session.user]}
          onClose={() => setEditing(null)}
          onSave={async (ev) => {
            await save(ev);
            setEditing(null);
          }}
          onDelete={async (ev) => {
            await remove(ev);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
