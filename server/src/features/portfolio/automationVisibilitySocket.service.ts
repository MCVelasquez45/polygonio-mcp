import { createHash } from 'crypto';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import { getAutomationVisibility } from './portfolio.service';
import {
  subscribeAutomationEvents,
  type LoggedAutomationEvent,
} from '../automation/services/automationAudit.service';

const SNAPSHOT_INTERVAL_MS = 10_000;
const EVENT_SNAPSHOT_DEBOUNCE_MS = 750;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let eventTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeEvents: (() => void) | null = null;
let lastSnapshotHash: string | null = null;
let emitting = false;

function snapshotHash(snapshot: unknown): string {
  const copy = { ...(snapshot as Record<string, unknown>) };
  delete copy.generatedAt;
  return createHash('sha1').update(JSON.stringify(copy)).digest('hex');
}

async function emitSnapshot(io: SocketIOServer, target?: Socket): Promise<void> {
  if (emitting) return;
  emitting = true;
  try {
    const snapshot = await getAutomationVisibility();
    const hash = snapshotHash(snapshot);
    if (target || hash !== lastSnapshotHash) {
      if (!target) lastSnapshotHash = hash;
      (target ?? io).emit('automation:visibility', snapshot);
    }
  } catch (error: any) {
    const payload = { message: String(error?.message ?? error).slice(0, 300) };
    (target ?? io).emit('automation:visibility:error', payload);
  } finally {
    emitting = false;
  }
}

function scheduleSnapshot(io: SocketIOServer): void {
  if (eventTimer) return;
  eventTimer = setTimeout(() => {
    eventTimer = null;
    void emitSnapshot(io);
  }, EVENT_SNAPSHOT_DEBOUNCE_MS);
  if (typeof eventTimer.unref === 'function') eventTimer.unref();
}

export function registerAutomationVisibilityHandlers(io: SocketIOServer, socket: Socket): void {
  socket.on('automation:visibility:subscribe', () => {
    void emitSnapshot(io, socket);
  });
}

export function startAutomationVisibilityBroadcaster(io: SocketIOServer): void {
  if (started) return;
  started = true;
  timer = setInterval(() => {
    void emitSnapshot(io);
  }, SNAPSHOT_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  unsubscribeEvents = subscribeAutomationEvents((event: LoggedAutomationEvent) => {
    io.emit('automation:event', event);
    scheduleSnapshot(io);
  });
}

export function stopAutomationVisibilityBroadcaster(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (eventTimer) {
    clearTimeout(eventTimer);
    eventTimer = null;
  }
  if (unsubscribeEvents) {
    unsubscribeEvents();
    unsubscribeEvents = null;
  }
  started = false;
  lastSnapshotHash = null;
}
