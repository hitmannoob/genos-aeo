// Canonical helper for normalizing timestamp-ish values from heterogeneous sources.
//
// Postgres returns Date instances or ISO strings. Legacy data may also surface
// Firestore Timestamp objects (with a toDate() method) or plain ISO strings on
// reads. Normalize all of them to an ISO-8601 string (or null when absent). Use
// this helper anywhere a reader needs a stable string representation of a
// timestamp field — especially for display, sorting, or cross-comparison.

export function toIsoString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (value && typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}
