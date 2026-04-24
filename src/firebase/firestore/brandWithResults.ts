// Shared loader: fetches a brand + its full queryProcessingResults (including
// the Cloud Storage fallback) once, so brand analytics and competitor analytics
// hooks don't each hit Firestore + Cloud Storage independently.

import { getBrandInfo } from './brandDataService';
import { retrieveDocumentWithLargeData } from '../storage/cloudStorage';

export interface BrandWithResults {
  brand: any;              // UserBrand doc with queryProcessingResults populated
  dataTruncated: boolean;  // true when Cloud Storage retries all failed and we fell back to the Firestore-truncated copy
}

export async function loadBrandWithQueryResults(brandId: string): Promise<BrandWithResults> {
  const brand = await getBrandInfo(brandId);
  if (!brand) {
    throw new Error('Brand not found');
  }

  let dataTruncated = false;

  if ((brand as any).storageReferences?.queryProcessingResults) {
    const maxRetries = 3;
    let retrieved = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { document: full } = await retrieveDocumentWithLargeData(
          'v8userbrands',
          brandId,
          ['queryProcessingResults']
        );
        if (full?.queryProcessingResults) {
          brand.queryProcessingResults = full.queryProcessingResults;
          retrieved = true;
          break;
        }
      } catch (err) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(r => setTimeout(r, delay));
        } else {
          console.error('❌ Cloud Storage load failed after retries; using Firestore-truncated data', err);
        }
      }
    }

    if (!retrieved) {
      dataTruncated = true;
    }
  }

  return { brand, dataTruncated };
}

// Stable react-query key so multiple hooks share one in-flight fetch per brand.
export const brandWithResultsQueryKey = (brandId: string | undefined) =>
  ['brandWithResults', brandId] as const;
