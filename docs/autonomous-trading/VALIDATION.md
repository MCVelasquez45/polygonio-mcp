# Validation

Required commands:

```bash
npm run lint
npm run build
npm --prefix server test
npm --prefix client test
git diff --check
```

Focused tests added:

- `server/tests/autonomousTrading.test.mjs`
- `client/src/__tests__/autonomousTraderPanel.test.tsx`

Covered scenarios:

- strict autonomous entry gate
- invalid state transition rejection
- shadow execution creates simulated fills without broker orders
- pipeline persistence is idempotent
- Automation workspace renders unified autonomous status
- Shadow mode label is visible
- pending blocking reasons are visible
- timeline ordering surface renders
- advanced details are collapsed by default

Manual regression remains covered by existing manual trading and execution boundary tests.

