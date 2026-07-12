import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { probeHttp, probeTcp } from '../lib/net.mjs';

function startHttp(status = 200) {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.statusCode = status;
      res.end('ok');
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('probeHttp resolves true for a reachable 200', async () => {
  const { server, port } = await startHttp(200);
  try {
    assert.equal(await probeHttp(`http://127.0.0.1:${port}/`), true);
  } finally {
    server.close();
  }
});

test('probeHttp honors an exact expected status', async () => {
  const { server, port } = await startHttp(500);
  try {
    // default acceptance is < 500, so 500 is not "up"
    assert.equal(await probeHttp(`http://127.0.0.1:${port}/`), false);
    // 404 with expect:200 is a mismatch
    const { server: s2, port: p2 } = await startHttp(404);
    assert.equal(await probeHttp(`http://127.0.0.1:${p2}/`, 200), false);
    s2.close();
  } finally {
    server.close();
  }
});

test('probeHttp resolves false for a closed port', async () => {
  // Grab a port then release it so it is (almost certainly) closed.
  const { server, port } = await startHttp(200);
  await new Promise((r) => server.close(r));
  assert.equal(await probeHttp(`http://127.0.0.1:${port}/`), false);
});

test('probeTcp resolves true when something is listening', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal(await probeTcp(port), true);
  } finally {
    server.close();
  }
});
