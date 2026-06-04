import type { RiskApprovalDecision, RiskApprovalRequestPayload } from "../infra/risk-approvals.js";
import { createRiskApprovalId } from "../infra/risk-approvals.js";

const RESOLVED_ENTRY_GRACE_MS = 15_000;

export type RiskApprovalRecord = {
  id: string;
  request: RiskApprovalRequestPayload;
  createdAtMs: number;
  expiresAtMs: number;
  requestedByConnId?: string | null;
  requestedByDeviceId?: string | null;
  requestedByClientId?: string | null;
  resolvedAtMs?: number;
  decision?: RiskApprovalDecision;
  resolvedBy?: string | null;
};

type PendingEntry = {
  record: RiskApprovalRecord;
  resolve: (decision: RiskApprovalDecision | null) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  promise: Promise<RiskApprovalDecision | null>;
};

export type RiskApprovalIdLookupResult =
  | { kind: "exact" | "prefix"; id: string }
  | { kind: "ambiguous"; ids: string[] }
  | { kind: "none" };

export class RiskApprovalManager {
  private pending = new Map<string, PendingEntry>();

  create(
    request: RiskApprovalRequestPayload,
    timeoutMs: number,
    id?: string | null,
  ): RiskApprovalRecord {
    const now = Date.now();
    const resolvedId =
      id && id.trim().length > 0 ? id.trim() : createRiskApprovalId();
    return {
      id: resolvedId,
      request,
      createdAtMs: now,
      expiresAtMs: now + timeoutMs,
    };
  }

  register(record: RiskApprovalRecord, timeoutMs: number): Promise<RiskApprovalDecision | null> {
    const existing = this.pending.get(record.id);
    if (existing) {
      if (existing.record.resolvedAtMs === undefined) {
        return existing.promise;
      }
      throw new Error(`approval id '${record.id}' already resolved`);
    }
    let resolvePromise: (decision: RiskApprovalDecision | null) => void;
    let rejectPromise: (err: Error) => void;
    const promise = new Promise<RiskApprovalDecision | null>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const entry: PendingEntry = {
      record,
      resolve: resolvePromise!,
      reject: rejectPromise!,
      timer: null as unknown as ReturnType<typeof setTimeout>,
      promise,
    };
    entry.timer = setTimeout(() => {
      this.expire(record.id);
    }, timeoutMs);
    this.pending.set(record.id, entry);
    return promise;
  }

  resolve(recordId: string, decision: RiskApprovalDecision, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending || pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = decision;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(decision);
    setTimeout(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
    return true;
  }

  expire(recordId: string, resolvedBy?: string | null): boolean {
    const pending = this.pending.get(recordId);
    if (!pending || pending.record.resolvedAtMs !== undefined) {
      return false;
    }
    clearTimeout(pending.timer);
    pending.record.resolvedAtMs = Date.now();
    pending.record.decision = undefined;
    pending.record.resolvedBy = resolvedBy ?? null;
    pending.resolve(null);
    setTimeout(() => {
      if (this.pending.get(recordId) === pending) {
        this.pending.delete(recordId);
      }
    }, RESOLVED_ENTRY_GRACE_MS);
    return true;
  }

  getSnapshot(recordId: string): RiskApprovalRecord | null {
    return this.pending.get(recordId)?.record ?? null;
  }

  getDecision(recordId: string): RiskApprovalDecision | null | "pending" | "missing" {
    const pending = this.pending.get(recordId);
    if (!pending) {
      return "missing";
    }
    if (pending.record.resolvedAtMs === undefined) {
      return "pending";
    }
    return pending.record.decision ?? null;
  }

  awaitDecision(recordId: string): Promise<RiskApprovalDecision | null> | null {
    return this.pending.get(recordId)?.promise ?? null;
  }

  lookupPendingId(input: string): RiskApprovalIdLookupResult {
    const normalized = input.trim();
    if (!normalized) {
      return { kind: "none" };
    }
    const exact = this.pending.get(normalized);
    if (exact) {
      return exact.record.resolvedAtMs === undefined
        ? { kind: "exact", id: normalized }
        : { kind: "none" };
    }
    const lowerPrefix = normalized.toLowerCase();
    const matches: string[] = [];
    for (const [id, entry] of this.pending.entries()) {
      if (entry.record.resolvedAtMs !== undefined) {
        continue;
      }
      if (id.toLowerCase().startsWith(lowerPrefix)) {
        matches.push(id);
      }
    }
    if (matches.length === 1) {
      return { kind: "prefix", id: matches[0] };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", ids: matches };
    }
    return { kind: "none" };
  }
}
