// Integration test for MassiveWsClient against a local mock that speaks the
// Massive/Polygon WebSocket protocol (connected → auth → auth_success →
// subscribe). Validates the auth sequence, subscription lifecycle, and that a
// reconnect re-authenticates and re-subscribes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { MassiveWsClient } from '../dist/shared/data/massiveWs.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMockMassive() {
  const received = { auths: 0, subscribes: [] };
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (socket) => {
    // Massive sends a "connected" status immediately on open.
    socket.send(JSON.stringify([{ ev: 'status', status: 'connected', message: 'Connected Successfully' }]));
    socket.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.action === 'auth') {
        received.auths += 1;
        socket.send(JSON.stringify([{ ev: 'status', status: 'auth_success', message: 'authenticated' }]));
      } else if (msg.action === 'subscribe') {
        received.subscribes.push(msg.params);
        socket.send(JSON.stringify([{ ev: 'status', status: 'success', message: `subscribed to ${msg.params}` }]));
      }
    });
  });
  return new Promise((resolve) => {
    wss.on('listening', () => resolve({ wss, port: wss.address().port, received }));
  });
}

test('WS client authenticates, subscribes, and reconnects+resubscribes', async () => {
  const mock = await startMockMassive();
  const url = `ws://127.0.0.1:${mock.port}/stocks`;
  let connectCount = 0;

  const client = new MassiveWsClient({
    url,
    apiKey: 'test-key',
    assetClass: 'stocks',
    onMessage: () => {},
    onConnect: () => { connectCount += 1; },
  });

  try {
    client.connect();
    // Wait for connected → auth → auth_success.
    for (let i = 0; i < 40 && connectCount < 1; i++) await wait(50);
    assert.equal(connectCount, 1, 'onConnect should fire after auth_success');
    assert.equal(mock.received.auths, 1, 'client should send exactly one auth on first connect');

    // Subscribe and confirm the exact wire format reached the server.
    client.subscribe('T.AAPL');
    for (let i = 0; i < 40 && mock.received.subscribes.length < 1; i++) await wait(50);
    assert.deepEqual(mock.received.subscribes, ['T.AAPL'], 'subscribe params should be forwarded verbatim');

    // Force a server-side drop; the client should reconnect (backoff ~3s),
    // re-auth, and re-subscribe the tracked channel.
    for (const c of mock.wss.clients) c.terminate();
    for (let i = 0; i < 120 && connectCount < 2; i++) await wait(100); // up to 12s
    assert.equal(connectCount, 2, 'onConnect should fire again after reconnect');
    assert.equal(mock.received.auths, 2, 'client should re-authenticate on reconnect');
    assert.ok(
      mock.received.subscribes.filter((p) => p.includes('T.AAPL')).length >= 2,
      'client should re-subscribe tracked channels after reconnect'
    );
  } finally {
    client.disconnect();
    mock.wss.close();
  }
});
