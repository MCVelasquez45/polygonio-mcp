import { Router } from 'express';
import { getLatestSelection, saveSelection } from './services/selectionStore';

const router = Router();

function normalizeSelectionBody(body: any) {
  const userId = typeof body?.userId === 'string' && body.userId.trim().length ? body.userId : 'default';
  const ticker =
    typeof body?.ticker === 'string'
      ? body.ticker.trim().toUpperCase()
      : typeof body?.selectedTicker === 'string'
        ? body.selectedTicker.trim().toUpperCase()
        : '';
  const contract =
    typeof body?.contract === 'string'
      ? body.contract.trim().toUpperCase()
      : typeof body?.selectedContract === 'string'
        ? body.selectedContract.trim().toUpperCase()
        : typeof body?.contractSymbol === 'string'
          ? body.contractSymbol.trim().toUpperCase()
          : '';
  const rawStrike = typeof body?.strike === 'number' ? body.strike : Number(body?.strike);
  const rawType = String(body?.type ?? body?.optionType ?? body?.callPut ?? '').toLowerCase();
  const type: 'call' | 'put' | undefined = rawType === 'call' || rawType === 'put' ? rawType : undefined;

  const side: 'buy' | 'sell' = body?.side === 'sell' ? 'sell' : 'buy';

  return {
    userId,
    ticker,
    contract,
    expiration: typeof body?.expiration === 'string' ? body.expiration : undefined,
    strike: Number.isFinite(rawStrike) ? rawStrike : undefined,
    type,
    side,
  };
}

router.get('/selection', async (req, res, next) => {
  try {
    const userId = typeof req.query.userId === 'string' && req.query.userId.trim().length ? req.query.userId : 'default';
    const selection = await getLatestSelection(userId);
    res.json({ selection });
  } catch (error) {
    next(error);
  }
});

async function persistSelection(req: any, res: any, next: any) {
  try {
    const selection = normalizeSelectionBody(req.body ?? {});
    if (!selection.ticker || !selection.contract) {
      return res.status(400).json({ error: 'ticker and contract are required' });
    }
    const document = await saveSelection(selection.userId, selection);
    res.json({ selection: document });
  } catch (error) {
    next(error);
  }
}

router.post('/selection', persistSelection);
router.put('/selection', persistSelection);
router.post('/select', persistSelection);
router.put('/select', persistSelection);

export { router as optionsRouter };
