// Single source of truth for the colors used to identify a query's funnel
// category (Awareness / Interest / Consideration / Purchase).
//
// Class strings are written as literal records — Tailwind's content scanner
// only picks up classes that appear verbatim in source, so dynamic
// interpolation like `bg-${hue}-100` would silently strip these styles.

export type QueryCategory = 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';

export const QUERY_CATEGORIES: readonly QueryCategory[] = [
  'Awareness',
  'Interest',
  'Consideration',
  'Purchase',
];

type Hue = 'blue' | 'yellow' | 'purple' | 'green';

const HUE_BY_CATEGORY: Record<QueryCategory, Hue> = {
  Awareness: 'blue',
  Interest: 'yellow',
  Consideration: 'purple',
  Purchase: 'green',
};

const PILL_BY_HUE: Record<Hue, string> = {
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  yellow: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  purple: 'bg-purple-100 text-purple-700 border-purple-200',
  green: 'bg-green-100 text-green-700 border-green-200',
};

const SOLID_BY_HUE: Record<Hue, string> = {
  blue: 'bg-blue-500',
  yellow: 'bg-yellow-500',
  purple: 'bg-purple-500',
  green: 'bg-green-500',
};

const ACCENT_BY_HUE: Record<Hue, string> = {
  blue: 'border-blue-300 bg-blue-50',
  yellow: 'border-yellow-300 bg-yellow-50',
  purple: 'border-purple-300 bg-purple-50',
  green: 'border-green-300 bg-green-50',
};

const FALLBACK_PILL = 'bg-gray-100 text-gray-700 border-gray-200';
const FALLBACK_SOLID = 'bg-gray-500';
const FALLBACK_ACCENT = 'border-gray-300 bg-gray-50';

function hueFor(category: string): Hue | null {
  return HUE_BY_CATEGORY[category as QueryCategory] ?? null;
}

export function getCategoryPillClasses(category: string): string {
  const hue = hueFor(category);
  return hue ? PILL_BY_HUE[hue] : FALLBACK_PILL;
}

export function getCategorySolidClass(category: string): string {
  const hue = hueFor(category);
  return hue ? SOLID_BY_HUE[hue] : FALLBACK_SOLID;
}

export function getCategoryAccentClasses(category: string): string {
  const hue = hueFor(category);
  return hue ? ACCENT_BY_HUE[hue] : FALLBACK_ACCENT;
}
