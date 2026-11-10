import type { AgendaEvent } from './types';
import { addDays } from './dates';

export interface Positioned {
  ev: AgendaEvent;
  /** minutes depuis minuit */
  top: number;
  height: number;
  col: number;
  cols: number;
}

const MIN_VISUAL = 20;

/**
 * Place les évènements d'une journée en colonnes : les créneaux qui se chevauchent
 * sont affichés côte à côte.
 */
export function layoutDay(events: AgendaEvent[], dayStart: number): Positioned[] {
  const dayEnd = addDays(dayStart, 1);
  const items = events
    .map((ev) => {
      const s = (Math.max(ev.startsAt, dayStart) - dayStart) / 60_000;
      const e = (Math.min(ev.endsAt, dayEnd) - dayStart) / 60_000;
      return { ev, top: s, end: Math.max(e, s + MIN_VISUAL), col: 0, cols: 1 };
    })
    .sort((a, b) => a.top - b.top || b.end - a.end);

  let cluster: typeof items = [];
  let colEnds: number[] = [];
  let clusterEnd = -1;

  const flush = () => {
    for (const it of cluster) it.cols = colEnds.length;
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.top >= clusterEnd) flush();
    let col = colEnds.findIndex((end) => end <= it.top);
    if (col === -1) col = colEnds.length;
    colEnds[col] = it.end;
    it.col = col;
    clusterEnd = Math.max(clusterEnd, it.end);
    cluster.push(it);
  }
  flush();

  return items.map((it) => ({ ev: it.ev, top: it.top, height: it.end - it.top, col: it.col, cols: it.cols }));
}
