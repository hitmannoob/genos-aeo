import firebase_app from "../config";
import {
  getFirestore,
  doc,
  runTransaction,
  increment,
} from "firebase/firestore";
import { exceedsFirestoreLimit } from "../storage/cloudStorage";

const db = getFirestore(firebase_app);

export type CreateBrandResult =
  | { success: true; creditsAfter: number; usedFallback?: boolean }
  | {
      success: false;
      code:
        | "INSUFFICIENT_CREDITS"
        | "USER_NOT_FOUND"
        | "DOC_TOO_LARGE"
        | "BRAND_ALREADY_EXISTS"
        | "TRANSACTION_FAILED";
      error: string;
    };

// Atomically write the brand document and decrement the user's credit
// balance in a single Firestore transaction. Either both writes commit or
// neither does — this replaces the older "deduct, then save, refund on
// failure" sequence which could lose credits if the browser closed (or the
// network failed) between the two writes.
//
// The transaction can't span Cloud Storage, so callers should handle
// DOC_TOO_LARGE explicitly (initial brand setup docs are ~tens of KB and
// won't hit this in practice).
export async function createBrandWithCredits(params: {
  brandId: string;
  userId: string;
  brandData: any;
  creditCost: number;
}): Promise<CreateBrandResult> {
  const { brandId, userId, brandData, creditCost } = params;

  if (exceedsFirestoreLimit(brandData)) {
    return {
      success: false,
      code: "DOC_TOO_LARGE",
      error:
        "Brand document exceeds Firestore size limits and cannot be saved atomically.",
    };
  }

  try {
    const creditsAfter = await runTransaction(db, async (tx) => {
      const userRef = doc(db, "users", userId);
      const brandRef = doc(db, "v8userbrands", brandId);

      // All reads must happen before writes inside a transaction.
      const [userSnap, brandSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(brandRef),
      ]);

      if (!userSnap.exists()) {
        throw new Error("USER_NOT_FOUND");
      }

      // Refuse to overwrite an existing brand. The caller surfaces this as
      // an "already exists" prompt with an "Open existing" action — the old
      // setDoc({merge:true}) silently clobbered query history when a user
      // re-added the same domain.
      if (brandSnap.exists()) {
        throw new Error("BRAND_ALREADY_EXISTS");
      }

      const currentCredits = (userSnap.data()?.credits ?? 0) as number;
      if (currentCredits < creditCost) {
        throw new Error("INSUFFICIENT_CREDITS");
      }

      tx.set(brandRef, brandData);
      tx.update(userRef, { credits: increment(-creditCost) });

      return currentCredits - creditCost;
    });

    return { success: true, creditsAfter };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg === "INSUFFICIENT_CREDITS" ||
      msg === "USER_NOT_FOUND" ||
      msg === "BRAND_ALREADY_EXISTS"
    ) {
      return {
        success: false,
        code: msg as
          | "INSUFFICIENT_CREDITS"
          | "USER_NOT_FOUND"
          | "BRAND_ALREADY_EXISTS",
        error: msg,
      };
    }
    console.error("❌ createBrandWithCredits transaction failed:", e);
    return {
      success: false,
      code: "TRANSACTION_FAILED",
      error: msg,
    };
  }
}
