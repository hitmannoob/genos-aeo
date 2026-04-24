import { doc, updateDoc, arrayUnion, getFirestore, increment, serverTimestamp } from 'firebase/firestore';
import firebase_app from '../config';
import { matchCompetitorsInText } from '@/lib/competitor-matching';

const db = getFirestore(firebase_app);

export interface NewBrandQuery {
  keyword: string;
  query: string;
  category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';
  containsBrand: 0 | 1;
  selected: boolean;
}

/**
 * Append a user-authored query to a brand. Uses arrayUnion for the array and
 * Firestore's atomic increment() for totalQueries so concurrent additions
 * (other tabs, processing jobs) don't clobber each other's count.
 *
 * containsBrand flag uses matchCompetitorsInText — same matcher the rest of
 * the analytics pipeline uses for brand detection — instead of a raw substring.
 */
export async function addQueryToBrand(
  brandId: string,
  rawQuery: string,
  category: NewBrandQuery['category'],
  brand: { companyName?: string; domain?: string }
): Promise<void> {
  const query = rawQuery.trim();
  if (!query) {
    throw new Error('Query is empty');
  }

  const entity = brand.companyName
    ? [{ name: brand.companyName, domain: brand.domain }]
    : [];
  const containsBrand: 0 | 1 =
    entity.length > 0 && matchCompetitorsInText(query, entity).length > 0 ? 1 : 0;

  const newQueryObject: NewBrandQuery = {
    keyword: 'custom',
    query,
    category,
    containsBrand,
    selected: true,
  };

  const brandRef = doc(db, 'v8userbrands', brandId);
  // atomic: arrayUnion + increment in same write — Firestore applies multiple
  // field transforms in a single updateDoc as one write op (all-or-nothing),
  // so totalQueries cannot drift out of sync with the queries array.
  await updateDoc(brandRef, {
    queries: arrayUnion(newQueryObject),
    updatedAt: serverTimestamp(),
    totalQueries: increment(1),
  });
}
