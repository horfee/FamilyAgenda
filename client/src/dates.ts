import type { AgendaEvent } from './types';

export const startOfDay = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export const addDays = (ms: number, n: number): number => {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
};

/** Lundi de la semaine contenant ms. */
export const startOfWeek = (ms: number): number => {
  const d = new Date(startOfDay(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
};

export const startOfMonth = (ms: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

export const addMonths = (ms: number, n: number): number => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + n, 1).getTime();
};

export const isSameDay = (a: number, b: number): boolean => startOfDay(a) === startOfDay(b);

const pad = (n: number) => String(n).padStart(2, '0');

export const toDateInput = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const toTimeInput = (ms: number): string => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fromInputs = (date: string, time = '00:00'): number => {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm).getTime();
};

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-FR', opts);
const timeFmt = fmt({ hour: '2-digit', minute: '2-digit' });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const dayLongFmt = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const monthFmt = fmt({ month: 'long', year: 'numeric' });
const shortFmt = fmt({ day: 'numeric', month: 'short' });
export const weekdayFmt = fmt({ weekday: 'short' });

export const fmtTime = (ms: number) => timeFmt.format(ms);
export const fmtDay = (ms: number) => dayFmt.format(ms);
export const fmtDayLong = (ms: number) => dayLongFmt.format(ms);
export const fmtMonth = (ms: number) => monthFmt.format(ms);

export const fmtRange = (from: number, to: number): string => {
  const a = shortFmt.format(from);
  const b = shortFmt.format(to);
  const year = new Date(to).getFullYear();
  return a === b ? `${a} ${year}` : `${a} – ${b} ${year}`;
};

/** Texte lisible de la période d'un évènement. */
export const fmtEventPeriod = (ev: AgendaEvent): string => {
  if (ev.allDay) {
    const last = ev.endsAt - 1;
    return isSameDay(ev.startsAt, last)
      ? `${fmtDayLong(ev.startsAt)} (journée)`
      : `Du ${fmtDay(ev.startsAt)} au ${fmtDay(last)}`;
  }
  return isSameDay(ev.startsAt, ev.endsAt)
    ? `${fmtDayLong(ev.startsAt)}, ${fmtTime(ev.startsAt)} – ${fmtTime(ev.endsAt)}`
    : `${fmtDay(ev.startsAt)} ${fmtTime(ev.startsAt)} → ${fmtDay(ev.endsAt)} ${fmtTime(ev.endsAt)}`;
};

/** L'évènement touche-t-il le jour commençant à dayStart ? */
export const overlapsDay = (ev: AgendaEvent, dayStart: number): boolean =>
  ev.startsAt < addDays(dayStart, 1) && Math.max(ev.endsAt, ev.startsAt + 1) > dayStart;
