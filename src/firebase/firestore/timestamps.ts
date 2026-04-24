// Canonical helper for normalizing Firestore timestamp-ish values.
//
// Firestore server-authoritative timestamps (written via serverTimestamp() or
// FieldValue.serverTimestamp()) come back as Firestore Timestamp objects on
// reads. Legacy documents in this codebase used ISO strings (new
// Date().toISOString()) instead, so older data may be a plain string rather
// than a Timestamp. A Date instance is also possible when code populates a
// field client-side immediately after write.
//
// Normalise all of them to an ISO-8601 string (or null when absent). Use this
// helper anywhere a reader needs a stable string representation of a
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
