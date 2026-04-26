import { firestore } from '../firebase-admin';
import type { UserBrand } from './getUserBrands';
import { loadBrandQueryResultsServer } from './persistQueryResultServer';

export async function getUserBrandsServer(
  userId: string,
  includeQueryResults: boolean = false
): Promise<{ result?: UserBrand[]; error?: any }> {
  try {
    const snapshot = await firestore
      .collection('v8userbrands')
      .where('userId', '==', userId)
      .get();

    const brands = await Promise.all(
      snapshot.docs.map(async (docSnap) => {
        const brandData = {
          id: docSnap.id,
          ...docSnap.data(),
        } as UserBrand;

        if (includeQueryResults) {
          try {
            const { existingResults } = await loadBrandQueryResultsServer(docSnap.id);
            brandData.queryProcessingResults = existingResults;
          } catch (error) {
            console.warn(`⚠️ Failed to load query results for brand ${docSnap.id}:`, error);
          }
        }

        return brandData;
      })
    );

    return { result: brands };
  } catch (error) {
    console.error('❌ getUserBrandsServer failed:', error);
    return { error };
  }
}

export async function getBrandServer(
  brandId: string,
  userId: string,
  includeQueryResults: boolean = false
): Promise<{ result?: UserBrand; error?: any }> {
  try {
    const docSnap = await firestore.collection('v8userbrands').doc(brandId).get();
    if (!docSnap.exists) {
      return { error: new Error('Brand not found') };
    }

    const brandData = {
      id: docSnap.id,
      ...docSnap.data(),
    } as UserBrand;

    if (brandData.userId !== userId) {
      return { error: new Error('Unauthorized') };
    }

    if (includeQueryResults) {
      const { existingResults } = await loadBrandQueryResultsServer(brandId);
      brandData.queryProcessingResults = existingResults;
    }

    return { result: brandData };
  } catch (error) {
    console.error('❌ getBrandServer failed:', error);
    return { error };
  }
}
