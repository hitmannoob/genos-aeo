import { firestore, FieldValue } from '../firebase-admin';

export type CreateBrandServerResult =
  | { success: true; creditsAfter: number }
  | {
      success: false;
      code: CreateBrandServerErrorCode;
      error: string;
    };

type CreateBrandServerErrorCode =
  | 'INSUFFICIENT_CREDITS'
  | 'USER_NOT_FOUND'
  | 'DOC_TOO_LARGE'
  | 'BRAND_ALREADY_EXISTS'
  | 'TRANSACTION_FAILED';

const FIRESTORE_LIMIT_BYTES = 1048576;
const FIRESTORE_SAFETY_MARGIN = 0.8;

function exceedsFirestoreLimit(data: any): boolean {
  const serialized = JSON.stringify(data);
  return Buffer.byteLength(serialized, 'utf8') > (FIRESTORE_LIMIT_BYTES * FIRESTORE_SAFETY_MARGIN);
}

export async function createBrandWithCreditsServer(params: {
  brandId: string;
  userId: string;
  brandData: any;
  creditCost: number;
}): Promise<CreateBrandServerResult> {
  const { brandId, userId, brandData, creditCost } = params;

  if (exceedsFirestoreLimit(brandData)) {
    return {
      success: false,
      code: 'DOC_TOO_LARGE',
      error: 'Brand document exceeds Firestore size limits and cannot be saved atomically.',
    };
  }

  try {
    const creditsAfter = await firestore.runTransaction(async (tx) => {
      const userRef = firestore.collection('users').doc(userId);
      const brandRef = firestore.collection('v8userbrands').doc(brandId);

      const [userSnap, brandSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(brandRef),
      ]);

      if (!userSnap.exists) {
        throw new Error('USER_NOT_FOUND');
      }

      if (brandSnap.exists) {
        throw new Error('BRAND_ALREADY_EXISTS');
      }

      const currentCredits = Number(userSnap.data()?.credits ?? 0);
      if (currentCredits < creditCost) {
        throw new Error('INSUFFICIENT_CREDITS');
      }

      tx.create(brandRef, brandData);
      tx.update(userRef, {
        credits: FieldValue.increment(-creditCost),
      });

      return currentCredits - creditCost;
    });

    return { success: true, creditsAfter };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message === 'INSUFFICIENT_CREDITS' ||
      message === 'USER_NOT_FOUND' ||
      message === 'BRAND_ALREADY_EXISTS'
    ) {
      return {
        success: false,
        code: message as CreateBrandServerErrorCode,
        error: message,
      };
    }

    console.error('❌ createBrandWithCreditsServer failed:', error);
    return {
      success: false,
      code: 'TRANSACTION_FAILED',
      error: message,
    };
  }
}
