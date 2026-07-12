import type { ExtendedError, Socket } from 'socket.io';
import {
  authenticateToken,
  getBearerToken,
  roleAtLeast,
  type AuthRole,
  type AuthUser
} from './auth';

export const SOCKET_ROOMS = {
  authenticated: 'auth:authenticated',
  trader: 'auth:trader',
  admin: 'auth:admin'
} as const;

declare module 'socket.io' {
  interface SocketData {
    user?: AuthUser;
  }
}

function getSocketToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.trim();
  }

  const headerToken = getBearerToken(socket.handshake.headers.authorization);
  if (headerToken) return headerToken;

  const queryToken = socket.handshake.query.token;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
}

function authError(message: string, status: 401 | 403): ExtendedError {
  const error = new Error(message) as ExtendedError & { data?: { status: number; code: string } };
  error.data = { status, code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN' };
  return error;
}

export function authenticateSocket(socket: Socket, next: (err?: ExtendedError) => void) {
  const token = getSocketToken(socket);
  const user = authenticateToken(token);
  if (!user) {
    return next(authError(token ? 'Invalid authentication token' : 'Missing authentication token', 401));
  }
  socket.data.user = user;
  next();
}

export function joinAuthorizedSocketRooms(socket: Socket) {
  const role = socket.data.user?.role;
  socket.join(SOCKET_ROOMS.authenticated);
  if (role && roleAtLeast(role, 'trader')) {
    socket.join(SOCKET_ROOMS.trader);
  }
  if (role && roleAtLeast(role, 'admin')) {
    socket.join(SOCKET_ROOMS.admin);
  }
}

export function socketHasRole(socket: Socket, minimum: AuthRole) {
  const role = socket.data.user?.role;
  return Boolean(role && roleAtLeast(role, minimum));
}

