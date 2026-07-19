import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function closeServer(server) {
  return new Promise(resolve => {
    if (!server?.listening) {
      resolve();
      return;
    }
    server.close(() => resolve());
  });
}

test('legacy Alpaca option orders route preserves GET and disables POST', async () => {
  const alpacaRequests = [];
  const fakeAlpaca = await startServer((req, res) => {
    alpacaRequests.push({ method: req.method, url: req.url });
    if (req.method === 'GET' && String(req.url).includes('/orders')) {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify([{ id: 'filled-1', symbol: 'SPY260724P00756000', status: 'filled' }]));
      return;
    }
    if (req.method === 'DELETE' && String(req.url).includes('/orders/open-1')) {
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'unexpected fake Alpaca call' }));
  });

  process.env.ALPACA_API_KEY = 'test-key';
  process.env.ALPACA_API_SECRET = 'test-secret';
  process.env.APCA_API_BASE_URL = `http://127.0.0.1:${fakeAlpaca.port}/v2`;
  process.env.ALPACA_PAPER = 'true';

  let routeServer = null;

  try {
    const brokerModule = await import('../dist/features/broker/broker.routes.js');
    const brokerRouter = brokerModule.default?.default ?? brokerModule.default ?? brokerModule;
    const app = express();
    app.use(express.json());
    app.use('/api/broker', brokerRouter);
    routeServer = await startServer(app);

    const base = `http://127.0.0.1:${routeServer.port}`;
    const getResponse = await fetch(`${base}/api/broker/alpaca/options/orders?status=filled&limit=50`);
    assert.equal(getResponse.status, 200);
    const getPayload = await getResponse.json();
    assert.equal(getPayload.orders.length, 1);
    assert.equal(getPayload.orders[0].id, 'filled-1');
    assert.equal(alpacaRequests.filter(r => r.method === 'GET' && r.url.includes('/orders')).length, 1);

    const postResponse = await fetch(`${base}/api/broker/alpaca/options/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ legs: [{ symbol: 'SPY260724P00756000', side: 'sell', qty: 1 }] }),
    });
    assert.equal(postResponse.status, 410);
    const postPayload = await postResponse.json();
    assert.equal(postPayload.error, 'DIRECT_BROKER_SUBMISSION_DISABLED');
    assert.equal(alpacaRequests.filter(r => r.method === 'POST').length, 0);

    const deleteResponse = await fetch(`${base}/api/broker/alpaca/options/orders/open-1`, {
      method: 'DELETE',
    });
    assert.equal(deleteResponse.status, 202);
    const deletePayload = await deleteResponse.json();
    assert.deepEqual(deletePayload, { canceled: true, orderId: 'open-1' });
    assert.equal(alpacaRequests.filter(r => r.method === 'DELETE' && r.url.includes('/orders/open-1')).length, 1);
  } finally {
    await closeServer(routeServer?.server);
    await closeServer(fakeAlpaca.server);
  }
});
