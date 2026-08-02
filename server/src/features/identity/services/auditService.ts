// Append-only audit logging for identity/security events.
//
// Best-effort: an audit write failure must never break an auth flow, but it is
// logged to the structured log so it is not silent. Also mirrors every event
// into the structured log for real-time observability.

import type { Request } from 'express';
import { AuditLogModel, type AuditOutcome } from '../models/auditLog.model';
import { isMongoReady } from '../../../shared/db/mongo';
import { writeStructuredLog } from '../../../shared/logging/safeLogging';

export type AuditInput = {
  actorId: string;
  action: string;
  outcome?: AuditOutcome;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string;
  ua?: string;
  meta?: Record<string, unknown>;
};

export function clientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return req.ip || req.socket.remoteAddress || '';
}

export function clientUa(req: Request): string {
  return (req.header('user-agent') || '').slice(0, 512);
}

export async function recordAudit(input: AuditInput): Promise<void> {
  const outcome: AuditOutcome = input.outcome ?? 'success';
  writeStructuredLog({
    component: 'server',
    module: 'identity',
    event: `AUDIT_${input.action}`,
    severity: outcome === 'success' ? 'info' : 'warning',
    context: {
      actorId: input.actorId,
      outcome,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      ...(input.meta ?? {}),
    },
  });

  if (!isMongoReady()) return;
  try {
    await AuditLogModel.create({
      actorId: input.actorId,
      action: input.action,
      outcome,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      ip: input.ip ?? '',
      ua: input.ua ?? '',
      meta: input.meta ?? {},
    });
  } catch (error) {
    writeStructuredLog({
      component: 'server',
      module: 'identity',
      event: 'AUDIT_WRITE_FAILED',
      severity: 'error',
      context: { action: input.action, error: (error as Error)?.message },
    });
  }
}

/** Convenience: record an audit event derived from a request. */
export async function recordAuditFromRequest(
  req: Request,
  input: Omit<AuditInput, 'ip' | 'ua'>
): Promise<void> {
  await recordAudit({ ...input, ip: clientIp(req), ua: clientUa(req) });
}
