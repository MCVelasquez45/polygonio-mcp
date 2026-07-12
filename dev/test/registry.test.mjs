import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/manifest.mjs';
import { writeTempRegistry, cleanup, REPO_ROOT } from './helpers.mjs';

const load = (yaml) => {
  const f = writeTempRegistry(yaml);
  try {
    return loadRegistry(f, REPO_ROOT);
  } finally {
    cleanup(f);
  }
};

test('loads a valid registry with defaults applied', () => {
  const { services, profiles } = load(`
defaults:
  restart: { policy: always }
profiles:
  full: { all: true }
services:
  a:
    command: echo a
    port: 4000
    category: backend
  b:
    command: echo b
    dependsOn: [a]
`);
  assert.equal(services.length, 2);
  const a = services.find((s) => s.id === 'a');
  assert.equal(a.restart.policy, 'always'); // default merged
  assert.equal(a.category, 'backend');
  assert.deepEqual(services.find((s) => s.id === 'b').dependsOn, ['a']);
  assert.ok(profiles.full.all);
});

test('rejects duplicate ports among enabled services', () => {
  assert.throws(
    () =>
      load(`
services:
  a: { command: echo a, port: 4000 }
  b: { command: echo b, port: 4000 }
`),
    /port 4000 is claimed/
  );
});

test('allows duplicate port if one service is disabled', () => {
  const { services } = load(`
services:
  a: { command: echo a, port: 4000 }
  b: { command: echo b, port: 4000, enabled: false }
`);
  assert.equal(services.length, 2);
});

test('rejects unknown dependency', () => {
  assert.throws(
    () =>
      load(`
services:
  a: { command: echo a, dependsOn: [ghost] }
`),
    /depends on unknown service "ghost"/
  );
});

test('detects dependency cycles', () => {
  assert.throws(
    () =>
      load(`
services:
  a: { command: echo a, dependsOn: [b] }
  b: { command: echo b, dependsOn: [a] }
`),
    /cycle detected/
  );
});

test('rejects a service with no command', () => {
  assert.throws(() => load(`services:\n  a: { port: 4000 }\n`), /missing a "command"/);
});

test('rejects a profile referencing an unknown id', () => {
  assert.throws(
    () =>
      load(`
profiles:
  x: { ids: [nope] }
services:
  a: { command: echo a }
`),
    /unknown service id "nope"/
  );
});
