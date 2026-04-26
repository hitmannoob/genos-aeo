import { FieldValue, firestore } from '../firebase-admin';
import { matchCompetitorsInText } from '@/lib/competitor-matching';

const VALID_QUERY_CATEGORIES = new Set([
  'Awareness',
  'Interest',
  'Consideration',
  'Purchase',
]);

export async function addKeywordToBrandServer(
  brandId: string,
  userId: string,
  keyword: string
): Promise<void> {
  const topic = keyword.trim();
  if (!topic) {
    throw new Error('Topic is empty');
  }

  const brandRef = firestore.collection('v8userbrands').doc(brandId);
  const brandSnapshot = await brandRef.get();
  if (!brandSnapshot.exists) {
    throw new Error('Brand not found');
  }

  const brandData = brandSnapshot.data() || {};
  if (brandData.userId !== userId) {
    throw new Error('Unauthorized');
  }

  await brandRef.update({
    keywords: FieldValue.arrayUnion(topic),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function addQueryToBrandServer(args: {
  brandId: string;
  userId: string;
  rawQuery: string;
  category: string;
  keyword: string;
}): Promise<void> {
  const query = args.rawQuery.trim();
  const topic = args.keyword.trim();
  const category = args.category.trim();

  if (!query) {
    throw new Error('Query is empty');
  }

  if (!topic) {
    throw new Error('Topic is required');
  }

  if (!VALID_QUERY_CATEGORIES.has(category)) {
    throw new Error('Invalid query category');
  }

  const brandRef = firestore.collection('v8userbrands').doc(args.brandId);
  const brandSnapshot = await brandRef.get();
  if (!brandSnapshot.exists) {
    throw new Error('Brand not found');
  }

  const brandData = brandSnapshot.data() || {};
  if (brandData.userId !== args.userId) {
    throw new Error('Unauthorized');
  }

  const entity = typeof brandData.companyName === 'string' && brandData.companyName.trim().length > 0
    ? [{ name: brandData.companyName, domain: brandData.domain }]
    : [];

  const containsBrand: 0 | 1 =
    entity.length > 0 && matchCompetitorsInText(query, entity).length > 0 ? 1 : 0;

  await brandRef.update({
    queries: FieldValue.arrayUnion({
      keyword: topic,
      query,
      category,
      containsBrand,
      selected: true,
    }),
    updatedAt: FieldValue.serverTimestamp(),
    totalQueries: FieldValue.increment(1),
  });
}
