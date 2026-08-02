import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuthenticated, requireMongoIdentity } from '../identity/identity.middleware';
import { requireCsrf } from '../../shared/identity/csrf';
import { getIdentityConfig } from '../../shared/identity/config';
import { recordAuditFromRequest } from '../identity/services/auditService';
import { AuditLogModel } from '../identity/models/auditLog.model';
import { SessionModel } from '../identity/models/session.model';
import { BROKER_DIRECTORY, ACTIVE_BROKER_PROVIDERS, getBrokerEntry } from './brokerRegistry';
import { isBrokerOAuthConfigured } from './brokerConfig';
import {
  beginBrokerOAuth, completeBrokerOAuth, connectionHealth, disconnectBroker,
  listConnections, syncConnections,
} from './brokerPlatform.service';
import type { BrokerProvider } from '../identity/models/brokerConnection.model';

export const brokerageRouter = express.Router();
type ActiveProvider = Exclude<BrokerProvider, 'paper'>;
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;
const asyncRoute = (handler: AsyncHandler) => (req: Request, res: Response, next: NextFunction): void => { handler(req, res, next).catch(next); };

function activeProvider(value: unknown): ActiveProvider | null {
  const provider = String(value ?? '') as ActiveProvider;
  return ACTIVE_BROKER_PROVIDERS.has(provider) ? provider : null;
}

function environment(value: unknown): 'paper' | 'live' {
  return value === 'live' ? 'live' : 'paper';
}

brokerageRouter.get('/', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  const connections = await listConnections(req.auth!.actorId);
  res.json({
    brokers: BROKER_DIRECTORY.map(broker => ({
      ...broker,
      configured: broker.available && isBrokerOAuthConfigured(broker.provider as ActiveProvider),
      connections: connections.filter(connection => connection.provider === broker.provider),
    })),
  });
}));

brokerageRouter.get('/status', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  res.json(await connectionHealth(req.auth!.actorId));
}));

brokerageRouter.get('/security', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  const actorId = req.auth!.actorId;
  const [sessions, activity, brokers] = await Promise.all([
    SessionModel.find({ userId: actorId, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastUsedAt: -1 }).select('device lastUsedAt createdAt').lean(),
    AuditLogModel.find({ actorId }).sort({ createdAt: -1 }).limit(20).select('action outcome createdAt ip ua targetType').lean(),
    listConnections(actorId),
  ]);
  res.json({
    controls: { oauthAuthentication: true, encryption: 'AES-256-GCM', transport: 'TLS 1.3', revocableAccess: true },
    sessionStatus: 'active', lastLogin: activity.find(item => item.action === 'LOGIN')?.createdAt ?? null,
    connectedDevices: sessions.map(session => ({ id: String(session._id), device: session.device, lastUsedAt: session.lastUsedAt, createdAt: session.createdAt })),
    connectedBrokers: brokers, activity,
  });
}));

brokerageRouter.post('/sync', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const resolvedProvider = req.body?.provider ? activeProvider(req.body.provider) : undefined;
  if (req.body?.provider && !resolvedProvider) { res.status(404).json({ error: 'BROKER_NOT_SUPPORTED' }); return; }
  const provider = resolvedProvider ?? undefined;
  const results = await syncConnections(req.auth!.actorId, provider);
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'BROKER_SYNCED', targetType: 'broker_connection', meta: { provider: provider ?? 'all', count: results.length } });
  res.json({ results });
}));

brokerageRouter.get('/:provider', requireMongoIdentity, requireAuthenticated, asyncRoute(async (req, res) => {
  const entry = getBrokerEntry(req.params.provider);
  if (!entry) { res.status(404).json({ error: 'BROKER_NOT_FOUND' }); return; }
  const connections = await listConnections(req.auth!.actorId);
  res.json({ broker: { ...entry, configured: entry.available && isBrokerOAuthConfigured(entry.provider as ActiveProvider) }, connections: connections.filter(item => item.provider === entry.provider) });
}));

brokerageRouter.post('/:provider/connect', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const provider = activeProvider(req.params.provider);
  if (!provider) { res.status(404).json({ error: 'BROKER_NOT_SUPPORTED' }); return; }
  const result = await beginBrokerOAuth({ actorId: req.auth!.actorId, provider, environment: environment(req.body?.environment), returnTo: req.body?.returnTo });
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'BROKER_OAUTH_STARTED', targetType: 'broker_provider', targetId: provider, meta: { environment: environment(req.body?.environment) } });
  res.status(201).json(result);
}));

brokerageRouter.get('/:provider/callback', requireMongoIdentity, asyncRoute(async (req, res) => {
  const provider = activeProvider(req.params.provider);
  if (!provider) { res.status(404).json({ error: 'BROKER_NOT_SUPPORTED' }); return; }
  const state = String(req.query.state ?? '');
  const code = String(req.query.code ?? '');
  if (!state || !code || req.query.error) {
    res.redirect(303, `${getIdentityConfig().appBaseUrl}/onboarding?broker=${encodeURIComponent(provider)}&connection=denied`);
    return;
  }
  try {
    const result = await completeBrokerOAuth({ provider, state, code });
    await recordAuditFromRequest(req, { actorId: result.actorId, action: 'BROKER_CONNECTED', targetType: 'broker_connection', targetId: result.connection.id, meta: { provider } });
    const separator = result.returnTo.includes('?') ? '&' : '?';
    res.redirect(303, `${getIdentityConfig().appBaseUrl}${result.returnTo}${separator}broker=${encodeURIComponent(provider)}&connection=success`);
  } catch (error) {
    await recordAuditFromRequest(req, { actorId: 'broker-oauth', action: 'BROKER_OAUTH_FAILED', outcome: 'failure', targetType: 'broker_provider', targetId: provider });
    res.redirect(303, `${getIdentityConfig().appBaseUrl}/onboarding?broker=${encodeURIComponent(provider)}&connection=failed`);
  }
}));

brokerageRouter.post('/:provider/reconnect', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const provider = activeProvider(req.params.provider);
  if (!provider) { res.status(404).json({ error: 'BROKER_NOT_SUPPORTED' }); return; }
  const result = await beginBrokerOAuth({ actorId: req.auth!.actorId, provider, environment: environment(req.body?.environment), returnTo: req.body?.returnTo ?? '/terminal?settings=brokers' });
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'BROKER_RECONNECT_STARTED', targetType: 'broker_provider', targetId: provider });
  res.status(201).json(result);
}));

brokerageRouter.post('/:provider/disconnect', requireMongoIdentity, requireAuthenticated, requireCsrf, asyncRoute(async (req, res) => {
  const provider = activeProvider(req.params.provider);
  if (!provider) { res.status(404).json({ error: 'BROKER_NOT_SUPPORTED' }); return; }
  const result = await disconnectBroker({ actorId: req.auth!.actorId, provider, connectionId: req.body?.connectionId });
  await recordAuditFromRequest(req, { actorId: req.auth!.actorId, action: 'BROKER_DISCONNECTED', targetType: 'broker_connection', targetId: result.connectionId, meta: { provider } });
  res.json(result);
}));
