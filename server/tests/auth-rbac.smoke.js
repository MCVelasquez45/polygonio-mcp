const assert = require('assert');

process.env.NODE_ENV = 'test';
process.env.AUTH_ALLOW_DEV_TOKENS = 'true';
process.env.AUTH_DEV_VIEWER_TOKEN = 'smoke-viewer-token';
process.env.AUTH_DEV_TRADER_TOKEN = 'smoke-trader-token';
process.env.AUTH_DEV_ADMIN_TOKEN = 'smoke-admin-token';

const { requireAdmin, requireTrader } = require('../dist/shared/auth');

function invoke(middleware, token) {
  const req = {
    user: undefined,
    header(name) {
      if (name.toLowerCase() === 'authorization' && token) {
        return `Bearer ${token}`;
      }
      return undefined;
    }
  };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
  let nextCalled = false;
  middleware(req, res, () => {
    nextCalled = true;
  });
  return {
    status: nextCalled ? 200 : res.statusCode,
    body: res.body,
    user: req.user
  };
}

assert.strictEqual(invoke(requireTrader).status, 401);
assert.strictEqual(invoke(requireAdmin).status, 401);

assert.strictEqual(invoke(requireTrader, 'smoke-viewer-token').status, 403);
assert.strictEqual(invoke(requireAdmin, 'smoke-viewer-token').status, 403);

assert.strictEqual(invoke(requireTrader, 'smoke-trader-token').status, 200);
assert.strictEqual(invoke(requireAdmin, 'smoke-trader-token').status, 403);

assert.strictEqual(invoke(requireTrader, 'smoke-admin-token').status, 200);
assert.strictEqual(invoke(requireAdmin, 'smoke-admin-token').status, 200);

console.log('auth-rbac smoke tests passed');

