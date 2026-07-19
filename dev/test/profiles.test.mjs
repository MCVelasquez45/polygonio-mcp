import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry } from '../lib/manifest.mjs';
import { resolveProfile, applyProfile } from '../lib/profiles.mjs';
import { writeTempRegistry, cleanup, REPO_ROOT } from './helpers.mjs';

const FIXTURE = `
profiles:
  full:      { all: true }
  mcp:       { categories: [mcp] }
  frontend:  { ids: [frontend] }
  research:  { tags: [research] }
services:
  mcp:      { command: echo mcp, category: mcp, tags: [research] }
  backend:  { command: echo be, category: backend, dependsOn: [mcp] }
  frontend: { command: echo fe, category: frontend, dependsOn: [backend] }
  offthing: { command: echo o, category: worker, enabled: false }
`;

function load() {
  const f = writeTempRegistry(FIXTURE);
  try {
    return loadRegistry(f, REPO_ROOT);
  } finally {
    cleanup(f);
  }
}

test('full profile selects all enabled services', () => {
  const { services, profiles } = load();
  const ids = resolveProfile(services, profiles, 'full');
  assert.deepEqual(new Set(ids), new Set(['mcp', 'backend', 'frontend']));
  assert.ok(!ids.has('offthing')); // disabled excluded
});

test('category profile selects matching services', () => {
  const { services, profiles } = load();
  assert.deepEqual([...resolveProfile(services, profiles, 'mcp')], ['mcp']);
});

test('id profile pulls in transitive dependencies', () => {
  const { services, profiles } = load();
  const ids = resolveProfile(services, profiles, 'frontend');
  assert.deepEqual(new Set(ids), new Set(['frontend', 'backend', 'mcp']));
});

test('tag profile matches by tag', () => {
  const { services, profiles } = load();
  assert.deepEqual([...resolveProfile(services, profiles, 'research')], ['mcp']);
});

test('applyProfile disables services outside the profile', () => {
  const { services, profiles } = load();
  const applied = applyProfile(services, profiles, 'mcp');
  const enabled = applied.filter((s) => s.enabled).map((s) => s.id);
  assert.deepEqual(enabled, ['mcp']);
});

test('unknown profile throws', () => {
  const { services, profiles } = load();
  assert.throws(() => resolveProfile(services, profiles, 'nope'), /unknown profile/);
});
