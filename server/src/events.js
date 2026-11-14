const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Valide et normalise un évènement venant d'un client. Retourne null si invalide. */
export function sanitizeEvent(input, validUserIds) {
  if (!input || typeof input.id !== 'string' || input.id.length < 8 || input.id.length > 64) return null;
  const title = str(input.title, 200).trim();
  const startsAt = Number(input.startsAt);
  const endsAt = Number(input.endsAt);
  if (!input.deleted && !title) return null;
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt < startsAt) return null;
  return {
    id: input.id,
    title: title || '(supprimé)',
    location: str(input.location, 300),
    notes: str(input.notes, 5000),
    allDay: !!input.allDay,
    startsAt,
    endsAt,
    attendees: Array.isArray(input.attendees)
      ? [...new Set(input.attendees.filter((id) => validUserIds.has(id)))]
      : [],
    reminders: Array.isArray(input.reminders)
      ? [...new Set(input.reminders.map(Number).filter((m) => Number.isInteger(m) && m >= 0 && m <= 60 * 24 * 60))]
      : [],
    color: typeof input.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color.toLowerCase() : '',
    deleted: !!input.deleted,
  };
}
