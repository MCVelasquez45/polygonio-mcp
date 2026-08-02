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
  let accountRequests = 0;
  let orderRequests = 0;
  const fakeAlpaca = await startServer((req, res) => {
    alpacaRequests.push({ method: req.method, url: req.url });
    if (req.method === 'GET' && String(req.url).endsWith('/account')) {
      accountRequests += 1;
      res.setHeader('content-type', 'application/json');
      if (accountRequests === 1) {
        res.statusCode = 200;
        setTimeout(() => {
          res.end(JSON.stringify({ id: 'paper-account', status: 'ACTIVE', buying_power: '100000' }));
        }, 20);
      } else {
        res.statusCode = 429;
        res.end(JSON.stringify({ code: 42910000, message: 'rate limit exceeded' }));
      }
      return;
    }
    if (req.method === 'GET' && String(req.url).includes('/orders')) {
      orderRequests += 1;
      res.setHeader('content-type', 'application/json');
      if (orderRequests === 1) {
        res.statusCode = 200;
        setTimeout(() => {
          res.end(JSON.stringify([{ id: 'filled-1', symbol: 'SPY260724P00756000', status: 'filled' }]));
        }, 20);
      } else {
        res.statusCode = 429;
        res.end(JSON.stringify({ code: 42910000, message: 'rate limit exceeded' }));
      }
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
  process.env.BROKER_CACHE_TTL_MS = '5';

  let routeServer = null;

  try {
    const brokerModule = await import('../dist/features/broker/broker.routes.js');
    const brokerRouter = brokerModule.default?.default ?? brokerModule.default ?? brokerModule;
    const app = express();
    app.use(express.json());
    app.use('/api/broker', brokerRouter);
    routeServer = await startServer(app);

    const base = `http://127.0.0.1:${routeServer.port}`;
    const [accountResponse, concurrentAccountResponse] = await Promise.all([
      fetch(`${base}/api/broker/alpaca/account`),
      fetch(`${base}/api/broker/alpaca/account`),
    ]);
    assert.equal(accountResponse.status, 200);
    assert.equal(concurrentAccountResponse.status, 200);
    assert.equal((await accountResponse.json()).id, 'paper-account');
    assert.equal((await concurrentAccountResponse.json()).id, 'paper-account');
    assert.equal(accountRequests, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    const staleAccountResponse = await fetch(`${base}/api/broker/alpaca/account`);
    assert.equal(staleAccountResponse.status, 200);
    assert.equal(staleAccountResponse.headers.get('x-broker-data-stale'), 'true');
    assert.equal((await staleAccountResponse.json()).id, 'paper-account');
    assert.equal(accountRequests, 2);

    const [getResponse, concurrentGetResponse] = await Promise.all([
      fetch(`${base}/api/broker/alpaca/options/orders?status=filled&limit=50`),
      fetch(`${base}/api/broker/alpaca/options/orders?status=filled&limit=50`),
    ]);
    assert.equal(getResponse.status, 200);
    assert.equal(concurrentGetResponse.status, 200);
    const getPayload = await getResponse.json();
    const concurrentGetPayload = await concurrentGetResponse.json();
    assert.equal(getPayload.orders.length, 1);
    assert.equal(concurrentGetPayload.orders.length, 1);
    assert.equal(getPayload.orders[0].id, 'filled-1');
    assert.equal(alpacaRequests.filter(r => r.method === 'GET' && r.url.includes('/orders')).length, 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    const staleOrdersResponse = await fetch(`${base}/api/broker/alpaca/options/orders?status=filled&limit=50`);
    assert.equal(staleOrdersResponse.status, 200);
    assert.equal(staleOrdersResponse.headers.get('x-broker-data-stale'), 'true');
    assert.equal((await staleOrdersResponse.json()).orders[0].id, 'filled-1');
    assert.equal(orderRequests, 2);

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
