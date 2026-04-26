import { firestore } from '../firebase-admin';

export interface HistoricalAIResponse {
  provider: string;
  response: string;
  error?: string;
  timestamp: string;
  responseTime?: number;
  tokenCount?: any;
}

export interface HistoricalUserQueryDocument {
  id?: string;
  userId: string;
  brandId: string;
  brandName: string;
  originalQuery: string;
  keyword: string;
  category: string;
  aiResponses: HistoricalAIResponse[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  createdAt?: any;
  updatedAt?: any;
  processedAt?: any;
}

const COLLECTION_NAME = 'v8userqueries';

export async function getQueriesByBrandServer(
  brandId: string
): Promise<{ result?: HistoricalUserQueryDocument[]; error?: any }> {
  try {
    const snapshot = await firestore
      .collection(COLLECTION_NAME)
      .where('brandId', '==', brandId)
      .get();

    const queries = snapshot.docs.map((docSnap) => ({
      id: docSnap.id,
      ...docSnap.data(),
    })) as HistoricalUserQueryDocument[];

    return { result: queries };
  } catch (error) {
    console.error('❌ getQueriesByBrandServer failed:', error);
    return { error };
  }
}
