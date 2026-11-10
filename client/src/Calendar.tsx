import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { AgendaEvent, User } from './types';
import {
  addDays,
  fmtDayLong,
  fmtTime,
  isSameDay,
  overlapsDay,
  startOfDay,
  startOfMonth,
  startOfWeek,
  weekdayFmt,
} from './dates';
import { layoutDay } from './layout';

export type View = 'month' | 'week' | 'day';

interface Props {
  view: View;
  cursor: number;
  events: AgendaEvent[];
  users: User[];
  onCreate: (startsAt: number, allDay: boolean) => void;
  onOpen: (ev: AgendaEvent) => void;
  onPickDay: (dayStart: number) => void;
}

const HOUR_PX = 48;

/** Smartphone (portrait) ou smartphone en paysage. Doit rester aligné sur le CSS. */
const MOBILE_QUERY = '(max-width: 700px), (pointer: coarse) and (max-height: 500px)';

function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(MOBILE_QUERY);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    () => window.matchMedia(MOBILE_QUERY).matches,
  );
}

const colorOf = (users: User[], ev: AgendaEvent) =>
  ev.color || users.find((u) => u.id === ev.ownerId)?.color || '#3b82d4';

const byStart = (a: AgendaEvent, b: AgendaEvent) => a.startsAt - b.startsAt || a.endsAt - b.endsAt;

export function Calendar(props: Props) {
  return props.view === 'month' ? <MonthView {...props} /> : <TimeGrid {...props} />;
}

function MonthView({ cursor, events, users, onCreate, onOpen, onPickDay }: Props) {
  const mobile = useIsMobile();
  const [selected, setSelected] = useState(() => startOfDay(Date.now()));
  const monthStart = startOfMonth(cursor);
  const month = new Date(monthStart).getMonth();
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = startOfDay(Date.now());
  // Sur mobile, le jour sélectionné doit appartenir au mois affiché.
  const sel = startOfMonth(selected) === monthStart ? selected : monthStart;

  const grid = (
    <div className={`month ${mobile ? 'compact' : ''}`}>
      {days.slice(0, 7).map((d) => (
        <div key={d} className="month-head">
          {mobile ? weekdayFmt.format(d).slice(0, 1) : weekdayFmt.format(d)}
        </div>
      ))}
      {days.map((d) => {
        const list = events.filter((e) => overlapsDay(e, d)).sort(byStart);
        const other = new Date(d).getMonth() !== month;
        const cls = `month-cell ${other ? 'other' : ''} ${d === today ? 'today' : ''} ${
          mobile && d === sel ? 'selected' : ''
        }`;

        if (mobile) {
          return (
            <div key={d} className={cls} onClick={() => setSelected(d)}>
              <span className="day-num">{new Date(d).getDate()}</span>
              <div className="dots">
                {list.slice(0, 4).map((ev) => (
                  <i key={ev.id} style={{ background: colorOf(users, ev) }} />
                ))}
              </div>
            </div>
          );
        }

        return (
          <div key={d} className={cls} onClick={() => onCreate(d, true)}>
            <button
              className="day-num"
              onClick={(e) => {
                e.stopPropagation();
                onPickDay(d);
              }}
            >
              {new Date(d).getDate()}
            </button>
            {list.slice(0, 3).map((ev) => (
              <button
                key={ev.id}
                className={`pill ${ev.allDay ? 'solid' : ''}`}
                style={{ '--c': colorOf(users, ev) } as React.CSSProperties}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(ev);
                }}
                title={ev.title}
              >
                {!ev.allDay && isSameDay(ev.startsAt, d) && <b>{fmtTime(ev.startsAt)} </b>}
                {ev.title}
              </button>
            ))}
            {list.length > 3 && (
              <button
                className="more"
                onClick={(e) => {
                  e.stopPropagation();
                  onPickDay(d);
                }}
              >
                +{list.length - 3} autre(s)
              </button>
            )}
          </div>
        );
      })}
    </div>
  );

  if (!mobile) return grid;

  const dayEnd = addDays(sel, 1);
  const dayEvents = events.filter((e) => overlapsDay(e, sel)).sort(byStart);

  return (
    <div className="month-mobile">
      {grid}
      <div className="day-list">
        <div className="day-list-head">
          <b>{fmtDayLong(sel)}</b>
          <span className="spacer" />
          <button onClick={() => onPickDay(sel)}>Vue jour</button>
          <button className="primary" onClick={() => onCreate(sel, true)}>
            + Ajouter
          </button>
        </div>
        {dayEvents.length === 0 && <p className="muted empty">Rien de prévu ce jour-là.</p>}
        {dayEvents.map((ev) => (
          <button
            key={ev.id}
            className="agenda-item"
            style={{ '--c': colorOf(users, ev) } as React.CSSProperties}
            onClick={() => onOpen(ev)}
          >
            <span className="when">
              {ev.allDay ? (
                'Journée'
              ) : (
                <>
                  {fmtTime(Math.max(ev.startsAt, sel))}
                  <small>{Math.min(ev.endsAt, dayEnd) === dayEnd ? '24:00' : fmtTime(ev.endsAt)}</small>
                </>
              )}
            </span>
            <span className="what">
              <b>{ev.title}</b>
              {ev.location && <small>{ev.location}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeGrid({ view, cursor, events, users, onCreate, onOpen }: Props) {
  const start = view === 'week' ? startOfWeek(cursor) : startOfDay(cursor);
  const days = Array.from({ length: view === 'week' ? 7 : 1 }, (_, i) => addDays(start, i));
  const today = startOfDay(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const cols = `52px repeat(${days.length}, minmax(var(--colmin, 0px), 1fr))`;

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, [view]);

  return (
    <div className="grid-wrap">
      {/* Un seul conteneur défilant : l'en-tête et les heures restent collés (sticky) */}
      <div className="grid-scroll" ref={scroller}>
        <div
          className={`grid-inner ${view}`}
          style={{ '--cols': days.length } as React.CSSProperties}
        >
          <div className="grid-head" style={{ gridTemplateColumns: cols }}>
            <div className="corner" />
            {days.map((d) => (
              <div key={d} className={`col-head ${d === today ? 'today' : ''}`}>
                {view === 'week' ? `${weekdayFmt.format(d)} ${new Date(d).getDate()}` : fmtDayLong(d)}
              </div>
            ))}
            <div className="allday-label corner">Journée</div>
            {days.map((d) => (
              <div key={d} className="allday-cell" onClick={() => onCreate(d, true)}>
                {events
                  .filter((e) => e.allDay && overlapsDay(e, d))
                  .sort(byStart)
                  .map((ev) => (
                    <button
                      key={ev.id}
                      className="pill solid"
                      style={{ '--c': colorOf(users, ev) } as React.CSSProperties}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(ev);
                      }}
                      title={ev.title}
                    >
                      {ev.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: cols, height: 24 * HOUR_PX }}>
            <div className="hours">
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} style={{ height: HOUR_PX }}>
                  {h > 0 && `${String(h).padStart(2, '0')}:00`}
                </div>
              ))}
            </div>
            {days.map((d) => {
              const timed = events.filter((e) => !e.allDay && overlapsDay(e, d));
              return (
                <div
                  key={d}
                  className="day-col"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const minutes = Math.floor((e.clientY - rect.top) / HOUR_PX) * 60;
                    onCreate(d + minutes * 60_000, false);
                  }}
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <div key={h} className="hour-line" style={{ top: h * HOUR_PX }} />
                  ))}
                  {d === today && <NowLine />}
                  {layoutDay(timed, d).map((p) => (
                    <button
                      key={p.ev.id}
                      className="block"
                      style={
                        {
                          '--c': colorOf(users, p.ev),
                          top: (p.top / 60) * HOUR_PX,
                          height: Math.max((p.height / 60) * HOUR_PX - 2, 16),
                          left: `calc(${(p.col / p.cols) * 100}% + 1px)`,
                          width: `calc(${100 / p.cols}% - 3px)`,
                        } as React.CSSProperties
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(p.ev);
                      }}
                      title={p.ev.title}
                    >
                      <b>{p.ev.title}</b>
                      <span>
                        {fmtTime(p.ev.startsAt)} – {fmtTime(p.ev.endsAt)}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NowLine() {
  const d = new Date();
  const top = ((d.getHours() * 60 + d.getMinutes()) / 60) * HOUR_PX;
  return <div className="now" style={{ top }} />;
}
