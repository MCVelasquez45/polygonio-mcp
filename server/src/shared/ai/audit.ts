import type { Collection } from 'mongodb';
import { getCollection } from '../db/mongo';

type AiAuditEntry = {
  feature: string;
  userKey: string;
  status: 'ok' | 'error' | 'blocked';
  createdAt: Date;
  durationMs?: number | null;
  inputChars?: number | null;
  outputChars?: number | null;
  cached?: boolean;
  error?: string | null;
};

const AUDIT_COLLECTION = 'ai_request_audit';
let auditCollection: Collection<AiAuditEntry> | null = null;

function collection(): Collection<AiAuditEntry> {
  if (!auditCollection) {
    auditCollection = getCollection<AiAuditEntry>(AUDIT_COLLECTION);
  }
  return auditCollection;
}

function normalizeError(value: unknown): string | null {
  if (!value) return null;
  const raw = typeof value === 'string' ? value : (value as Error)?.message ?? String(value);
  return raw.slice(0, 500);
}

export async function logAiAudit(entry: Omit<AiAuditEntry, 'createdAt'> & { createdAt?: Date }) {
  try {
    const payload: AiAuditEntry = {
      ...entry,
      createdAt: entry.createdAt ?? new Date(),
      error: normalizeError(entry.error),
    };
    await collection().insertOne(payload);
  } catch (error) {
    console.warn('[AI AUDIT] Failed to write audit log', { error });
  }
}
