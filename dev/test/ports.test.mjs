import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { isPortInUse, findPortProcesses } from '../lib/net.mjs';

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

test('isPortInUse detects a bound port', async () => {
  const { server, port } = await listen();
  try {
    assert.equal(await isPortInUse(port), true);
  } finally {
    server.close();
  }
});

test('findPortProcesses lists the owning pid for a bound port', async () => {
  const { server, port } = await listen();
  try {
    const procs = await findPortProcesses(port);
    // Our own node process should be listed as the listener.
    assert.ok(procs.some((p) => p.pid === process.pid), `expected pid ${process.pid} among ${JSON.stringify(procs)}`);
  } finally {
    server.close();
  }
});

test('a released port reports free', async () => {
  const { server, port } = await listen();
  await new Promise((r) => server.close(r));
  // Small delay for the OS/lsof to reflect the close.
  await new Promise((r) => setTimeout(r, 250));
  assert.equal(await isPortInUse(port), false);
});
