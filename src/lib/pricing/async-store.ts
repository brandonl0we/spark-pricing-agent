import { PricingResult } from "./schema";

type PendingRecord = {
  createdAt: number;
  status: "pending";
};

type CompleteRecord = {
  createdAt: number;
  result: PricingResult;
  status: "complete";
};

type ErrorRecord = {
  createdAt: number;
  error: string;
  status: "error";
};

type AsyncPricingRecord = PendingRecord | CompleteRecord | ErrorRecord;

const STORE_TTL_MS = 30 * 60 * 1000;

const globalForPricing = globalThis as typeof globalThis & {
  pricingAsyncStore?: Map<string, AsyncPricingRecord>;
};

const store = globalForPricing.pricingAsyncStore ?? new Map<string, AsyncPricingRecord>();
globalForPricing.pricingAsyncStore = store;

function pruneExpiredRecords() {
  const cutoff = Date.now() - STORE_TTL_MS;
  for (const [requestId, record] of store.entries()) {
    if (record.createdAt < cutoff) store.delete(requestId);
  }
}

export function createPendingPricingRequest() {
  pruneExpiredRecords();
  const requestId = crypto.randomUUID();
  store.set(requestId, {
    createdAt: Date.now(),
    status: "pending"
  });
  return requestId;
}

export function getPricingRequestStatus(requestId: string) {
  pruneExpiredRecords();
  return store.get(requestId);
}

export function completePricingRequest(requestId: string, result: PricingResult) {
  pruneExpiredRecords();
  store.set(requestId, {
    createdAt: Date.now(),
    result,
    status: "complete"
  });
}

export function failPricingRequest(requestId: string, error: string) {
  pruneExpiredRecords();
  store.set(requestId, {
    createdAt: Date.now(),
    error,
    status: "error"
  });
}
