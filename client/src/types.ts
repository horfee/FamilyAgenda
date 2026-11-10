export interface User {
  id: string;
  name: string;
  color: string;
}

export interface AgendaEvent {
  id: string;
  ownerId: string;
  title: string;
  location: string;
  notes: string;
  /** Journée(s) entière(s) : endsAt est EXCLUSIF (minuit du lendemain du dernier jour). */
  allDay: boolean;
  startsAt: number;
  endsAt: number;
  attendees: string[];
  /** Minutes avant startsAt. */
  reminders: number[];
  /** Couleur du créneau (#rrggbb) ; vide = couleur du propriétaire. */
  color?: string;
  deleted?: boolean;
}

/** Mutation en attente d'envoi ; `v` identifie la version locale. */
export type OutboxEntry = AgendaEvent & { v: number };

export interface Session {
  token: string;
  user: User;
}
