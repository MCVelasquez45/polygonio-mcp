import test from 'node:test';
import assert from 'node:assert/strict';

const symbols = await import('../dist/shared/symbols/optionSymbol.js');

test('canonical option symbol translation covers Massive, Alpaca, Mongo, and parsed fields', () => {
  const parsed = symbols.parseOptionSymbol('O:SPY260721C00748000');
  assert.equal(parsed.canonical, 'SPY260721C00748000');
  assert.equal(parsed.massive, 'O:SPY260721C00748000');
  assert.equal(parsed.alpaca, 'SPY260721C00748000');
  assert.equal(parsed.mongoKey, 'SPY260721C00748000');
  assert.equal(parsed.underlying, 'SPY');
  assert.equal(parsed.expiration, '2026-07-21');
  assert.equal(parsed.right, 'call');
  assert.equal(parsed.strike, 748);
});

test('translation normalizes Alpaca position symbols and comparison keys without treating equities as options', () => {
  assert.equal(symbols.toAlpacaOptionSymbol('O:AMD260821P00150000'), 'AMD260821P00150000');
  assert.equal(symbols.toMassiveOptionSymbol('AMD260821P00150000'), 'O:AMD260821P00150000');
  assert.equal(symbols.toMongoOptionSymbolKey('O:AMD260821P00150000'), 'AMD260821P00150000');
  assert.equal(symbols.isOptionSymbol('AMD'), false);
  assert.equal(symbols.isOptionSymbol('SPY'), false);
  assert.equal(symbols.isMassiveOptionSymbol('SPY260721C00748000'), false);
});
