import { randomUUID } from 'crypto';
import { adminApp, FieldValue, firestore, storage } from '../firebase-admin';
import {
  calculateLatestSessionAnalyticsFromCorpus,
  calculateLifetimeBrandAnalyticsFromCorpus,
  type BrandAnalyticsData,
  type LifetimeBrandAnalytics,
} from './brandAnalytics';
import { calculateLiveCompetitorAnalyticsFromCorpus } from './competitorAnalytics';
import { loadBrandQueryCorpusServer } from './brandQueryCorpusServer';
import { buildLiveRecommendations } from '@/lib/liveRecommendations';

const FIRESTORE_SAFETY_LIMIT_BYTES = 800_000;

function serializeSizeInBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function getStorageBucketName(): string | undefined {
  return (
    (adminApp.options.storageBucket as string | undefined) ||
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  );
}

function buildDownloadUrl(bucketName: string, storagePath: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function saveLargeLifetimePayload(
  analyticsData: LifetimeBrandAnalytics,
  storagePath: string
): Promise<{ storageRef?: Record<string, any>; error?: any }> {
  try {
    const bucketName = getStorageBucketName();
    if (!bucketName) {
      throw new Error('Cloud Storage bucket is not configured');
    }

    const token = randomUUID();
    await storage.bucket(bucketName).file(storagePath).save(JSON.stringify(analyticsData), {
      contentType: 'application/json',
      metadata: {
        metadata: {
          dataType: 'lifetime_analytics',
          brandId: analyticsData.brandId,
          firebaseStorageDownloadTokens: token,
        },
      },
    });

    return {
      storageRef: {
        storagePath,
        downloadUrl: buildDownloadUrl(bucketName, storagePath, token),
        uploadedAt: FieldValue.serverTimestamp(),
      },
    };
  } catch (error) {
    return { error };
  }
}

function normalizeBrandAnalyticsForJson(
  analytics: BrandAnalyticsData | undefined
): BrandAnalyticsData | null {
  if (!analytics) {
    return null;
  }

  return {
    ...analytics,
    createdAt: analytics.processingSessionTimestamp,
    lastUpdated: analytics.processingSessionTimestamp,
  };
}

function normalizeLifetimeAnalyticsForJson(
  analytics: LifetimeBrandAnalytics | undefined
): LifetimeBrandAnalytics | null {
  if (!analytics) {
    return null;
  }

  return {
    ...analytics,
    calculatedAt: new Date().toISOString(),
  };
}

export async function calculateLatestSessionFromBrandDocumentServer(
  brandId: string,
  userId: string
): Promise<{ result?: BrandAnalyticsData | null; error?: any }> {
  const { result: corpus, error } = await loadBrandQueryCorpusServer(brandId, userId);
  if (error || !corpus) {
    return { error: error || new Error('Failed to load brand query corpus') };
  }

  return {
    result: normalizeBrandAnalyticsForJson(
      calculateLatestSessionAnalyticsFromCorpus(userId, corpus)
    ),
  };
}

export async function calculateLifetimeBrandAnalyticsServer(
  brandId: string,
  userId: string
): Promise<{ result?: LifetimeBrandAnalytics | null; error?: any }> {
  const { result: corpus, error } = await loadBrandQueryCorpusServer(brandId, userId);
  if (error || !corpus) {
    return { error: error || new Error('Failed to load brand query corpus') };
  }

  return {
    result: normalizeLifetimeAnalyticsForJson(
      calculateLifetimeBrandAnalyticsFromCorpus(userId, corpus)
    ),
  };
}

export async function calculateLiveCompetitorAnalyticsServer(
  brandId: string,
  userId: string
): Promise<{ result?: ReturnType<typeof calculateLiveCompetitorAnalyticsFromCorpus>; error?: any }> {
  const { result: corpus, error } = await loadBrandQueryCorpusServer(brandId, userId);
  if (error || !corpus) {
    return { error: error || new Error('Failed to load brand query corpus') };
  }

  return {
    result: calculateLiveCompetitorAnalyticsFromCorpus(brandId, corpus),
  };
}

export async function refreshLifetimeSnapshotServer(
  brandId: string,
  userId: string
): Promise<{ success: boolean; error?: any }> {
  try {
    const { result, error } = await calculateLifetimeBrandAnalyticsServer(brandId, userId);
    if (error) {
      console.error('❌ refreshLifetimeSnapshotServer: calculate failed', error);
      return { success: false, error };
    }

    if (!result) {
      return { success: true };
    }

    const docId = `${brandId}_lifetime_latest`;
    const docRef = firestore.collection('v8_lifetime_brand_analytics').doc(docId);
    const existingSnapshot = await docRef.get();
    const existingData = existingSnapshot.exists ? existingSnapshot.data() || {} : {};

    const analyticsDataForFirestore: Record<string, any> = {
      ...result,
      createdAt: existingData.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      documentType: 'lifetime_analytics_latest',
      originalCitationCount: result.allCitations?.length || 0,
      storedInCloudStorage: false,
      dataTruncated: !!result.dataTruncated,
    };

    if (serializeSizeInBytes(analyticsDataForFirestore) > FIRESTORE_SAFETY_LIMIT_BYTES) {
      const storagePath = `lifetime-analytics/${brandId}/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.json`;
      const { storageRef, error: storageError } = await saveLargeLifetimePayload(result, storagePath);

      if (storageError) {
        analyticsDataForFirestore.allCitations = [];
        analyticsDataForFirestore.dataTruncated = true;
        analyticsDataForFirestore.truncationReason = 'cloud_storage_failed';
      } else {
        analyticsDataForFirestore.allCitations = [];
        analyticsDataForFirestore.storedInCloudStorage = true;
        analyticsDataForFirestore.storageRef = storageRef;
      }
    }

    await docRef.set(analyticsDataForFirestore, { merge: true });
    return { success: true };
  } catch (error) {
    console.error('❌ refreshLifetimeSnapshotServer threw', error);
    return { success: false, error };
  }
}

export async function calculateBrandAnalyticsBundleServer(
  brandId: string,
  userId: string,
  options: { includeCompetitors?: boolean } = {}
): Promise<{
      result?: {
        latestAnalytics: BrandAnalyticsData | null;
        lifetimeAnalytics: LifetimeBrandAnalytics | null;
        competitorAnalytics: ReturnType<typeof calculateLiveCompetitorAnalyticsFromCorpus> | null;
        recommendations: ReturnType<typeof buildLiveRecommendations>;
      };
  error?: any;
}> {
  try {
    const { result: corpus, error } = await loadBrandQueryCorpusServer(brandId, userId);
    if (error || !corpus) {
      return { error: error || new Error('Failed to load brand query corpus') };
    }

    const latestAnalytics = normalizeBrandAnalyticsForJson(
      calculateLatestSessionAnalyticsFromCorpus(userId, corpus)
    );
    const lifetimeAnalytics = normalizeLifetimeAnalyticsForJson(
      calculateLifetimeBrandAnalyticsFromCorpus(userId, corpus)
    );

    return {
      result: {
        latestAnalytics,
        lifetimeAnalytics,
        competitorAnalytics: options.includeCompetitors
          ? calculateLiveCompetitorAnalyticsFromCorpus(brandId, corpus)
          : null,
        recommendations: buildLiveRecommendations({
          brand: corpus.brand,
          latestAnalytics,
          lifetimeAnalytics,
        }),
      },
    };
  } catch (error) {
    console.error('❌ calculateBrandAnalyticsBundleServer failed:', error);
    return { error };
  }
}
