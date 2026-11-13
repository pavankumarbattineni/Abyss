/** The API stores timestamps in UTC and sends them without an offset
 * ("2026-11-12T09:30:00"). `new Date()` would read that as *local* time, so
 * every server timestamp goes through here: a value with no zone is UTC. */
const HAS_ZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function parseServerDate(value: string | Date): Date {
  if (value instanceof Date) return value;
  const text = value.trim();
  return new Date(HAS_ZONE.test(text) ? text : `${text}Z`);
}
