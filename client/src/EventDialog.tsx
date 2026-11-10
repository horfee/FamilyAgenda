import { useState, type FormEvent } from 'react';
import type { AgendaEvent, User } from './types';
import { addDays, fmtEventPeriod, fromInputs, startOfDay, toDateInput, toTimeInput } from './dates';

interface Props {
  draft: AgendaEvent;
  isNew: boolean;
  me: User;
  users: User[];
  onSave: (ev: AgendaEvent) => void;
  onDelete: (ev: AgendaEvent) => void;
  onClose: () => void;
}

const TIMED_REMINDERS: Array<[number, string]> = [
  [0, "À l'heure du début"],
  [5, '5 min avant'],
  [15, '15 min avant'],
  [30, '30 min avant'],
  [60, '1 h avant'],
  [120, '2 h avant'],
  [1440, '1 jour avant'],
  [10080, '1 semaine avant'],
];

const ALLDAY_REMINDERS: Array<[number, string]> = [
  [0, 'À minuit le jour même'],
  [360, 'La veille à 18h'],
  [900, 'La veille à 9h'],
  [2880, '2 jours avant'],
  [10080, '1 semaine avant'],
];

const PALETTE = ['#3b82d4', '#e5484d', '#30a46c', '#f5a524', '#7c5cd8', '#0ea5a4', '#d6409f', '#8b6b4a', '#57606a'];

/** Doit rester aligné sur la limite du serveur (60 jours). */
const MAX_REMINDER_MIN = 60 * 24 * 60;

const toLocalInput = (ms: number) => `${toDateInput(ms)}T${toTimeInput(ms)}`;
const fromLocalInput = (v: string) => {
  const [d, t] = v.split('T');
  return d && t ? fromInputs(d, t) : NaN;
};

export function EventDialog({ draft, isNew, me, users, onSave, onDelete, onClose }: Props) {
  const canEdit = isNew || draft.ownerId === me.id || draft.attendees.includes(me.id);

  const [title, setTitle] = useState(draft.title);
  const [allDay, setAllDay] = useState(draft.allDay);
  const [startDate, setStartDate] = useState(toDateInput(draft.startsAt));
  const [endDate, setEndDate] = useState(toDateInput(draft.allDay ? draft.endsAt - 1 : draft.endsAt));
  const [startTime, setStartTime] = useState(toTimeInput(draft.startsAt));
  const [endTime, setEndTime] = useState(toTimeInput(draft.endsAt));
  const [location, setLocation] = useState(draft.location);
  const [notes, setNotes] = useState(draft.notes);
  const [attendees, setAttendees] = useState<string[]>(draft.attendees);
  const [reminders, setReminders] = useState<number[]>(() =>
    draft.reminders.filter((m) => (draft.allDay ? ALLDAY_REMINDERS : TIMED_REMINDERS).some(([p]) => p === m)),
  );
  // Rappels à heure précise, conservés en instants absolus tant que le dialogue est ouvert.
  const [customAts, setCustomAts] = useState<number[]>(() =>
    draft.reminders
      .filter((m) => !(draft.allDay ? ALLDAY_REMINDERS : TIMED_REMINDERS).some(([p]) => p === m))
      .map((m) => draft.startsAt - m * 60_000),
  );
  const [color, setColor] = useState(draft.color ?? '');
  const [error, setError] = useState('');

  const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const changeAllDay = (v: boolean) => {
    setAllDay(v);
    setReminders([]); // les choix de rappel diffèrent selon le mode
  };

  const computeRange = () =>
    allDay
      ? {
          startsAt: startOfDay(fromInputs(startDate)),
          endsAt: addDays(startOfDay(fromInputs(endDate)), 1),
        }
      : { startsAt: fromInputs(startDate, startTime), endsAt: fromInputs(endDate, endTime) };

  const addCustomReminder = () => {
    const { startsAt } = computeRange();
    const base = Number.isFinite(startsAt) ? startsAt : Date.now();
    setCustomAts([...customAts, base - (allDay ? 900 : 60) * 60_000]);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const { startsAt, endsAt } = computeRange();
    if (!(endsAt > startsAt)) {
      setError('La fin doit être postérieure au début.');
      return;
    }
    const customMinutes = customAts.map((at) => Math.round((startsAt - at) / 60_000));
    if (customMinutes.some((m) => m < 0)) {
      setError("Un rappel à heure précise ne peut pas être après le début de l'évènement.");
      return;
    }
    if (customMinutes.some((m) => m > MAX_REMINDER_MIN)) {
      setError('Un rappel ne peut pas être plus de 60 jours avant le début.');
      return;
    }
    onSave({
      ...draft,
      color,
      title: title.trim(),
      allDay,
      startsAt,
      endsAt,
      location: location.trim(),
      notes,
      attendees,
      reminders: [...new Set([...reminders, ...customMinutes])].sort((a, b) => a - b),
    });
  };

  const presets = allDay ? ALLDAY_REMINDERS : TIMED_REMINDERS;
  const owner = users.find((u) => u.id === draft.ownerId);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" onSubmit={submit}>
        <h2>{isNew ? 'Nouvel évènement' : canEdit ? "Modifier l'évènement" : 'Évènement'}</h2>
        {!canEdit && (
          <p className="muted">
            Créé par {owner?.name ?? '?'} – {fmtEventPeriod(draft)}. Lecture seule : vous n'êtes pas concerné.
          </p>
        )}
        <fieldset disabled={!canEdit}>
          <label>
            Titre
            <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus maxLength={200} />
          </label>

          <label className="inline">
            <input type="checkbox" checked={allDay} onChange={(e) => changeAllDay(e.target.checked)} />
            Journée entière (ou plusieurs jours)
          </label>

          <div className="row">
            <label>
              Début
              <input
                type="date"
                value={startDate}
                required
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
              />
            </label>
            {!allDay && (
              <label>
                Heure
                <input type="time" value={startTime} required onChange={(e) => setStartTime(e.target.value)} />
              </label>
            )}
            <label>
              Fin
              <input type="date" value={endDate} min={startDate} required onChange={(e) => setEndDate(e.target.value)} />
            </label>
            {!allDay && (
              <label>
                Heure
                <input type="time" value={endTime} required onChange={(e) => setEndTime(e.target.value)} />
              </label>
            )}
          </div>

          <label>
            Lieu
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={300} />
          </label>
          <label>
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>

          <div className="group">
            <span className="group-title">Couleur</span>
            <div className="swatches">
              <button
                type="button"
                className={`swatch none ${color === '' ? 'on' : ''}`}
                style={{ background: users.find((u) => u.id === draft.ownerId)?.color ?? me.color }}
                onClick={() => setColor('')}
                title="Par défaut (couleur du propriétaire)"
                aria-label="Couleur par défaut"
              >
                ∅
              </button>
              {PALETTE.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`swatch ${color === c ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Couleur ${c}`}
                />
              ))}
            </div>
          </div>

          <div className="group">
            <span className="group-title">Personnes concernées</span>
            <div className="chips">
              {users.map((u) => {
                const isOwner = u.id === (isNew ? me.id : draft.ownerId);
                const on = isOwner || attendees.includes(u.id);
                return (
                  <button
                    type="button"
                    key={u.id}
                    className={`chip ${on ? 'on' : ''}`}
                    style={on ? { background: u.color, borderColor: u.color } : undefined}
                    disabled={isOwner}
                    onClick={() => setAttendees(toggle(attendees, u.id))}
                  >
                    {u.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="group">
            <span className="group-title">Rappels (notification push sur les smartphones)</span>
            <div className="chips">
              {presets.map(([min, label]) => (
                <button
                  type="button"
                  key={min}
                  className={`chip ${reminders.includes(min) ? 'on accent' : ''}`}
                  onClick={() => setReminders(toggle(reminders, min))}
                >
                  {label}
                </button>
              ))}
              <button type="button" className="chip" onClick={addCustomReminder}>
                + Heure précise
              </button>
            </div>
            {customAts.map((at, i) => (
              <div key={i} className="custom-reminder">
                <input
                  type="datetime-local"
                  value={Number.isFinite(at) ? toLocalInput(at) : ''}
                  required
                  onChange={(e) => {
                    const v = fromLocalInput(e.target.value);
                    if (Number.isFinite(v)) setCustomAts(customAts.map((x, j) => (j === i ? v : x)));
                  }}
                />
                <button
                  type="button"
                  className="icon"
                  aria-label="Supprimer ce rappel"
                  onClick={() => setCustomAts(customAts.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </fieldset>

        {error && <div className="error">{error}</div>}

        <div className="actions">
          {!isNew && canEdit && (
            <button
              type="button"
              className="danger"
              onClick={() => confirm('Supprimer cet évènement ?') && onDelete(draft)}
            >
              Supprimer
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            {canEdit ? 'Annuler' : 'Fermer'}
          </button>
          {canEdit && <button className="primary">Enregistrer</button>}
        </div>
      </form>
    </div>
  );
}
