const warmTickers = new Set<string>();

function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

export function addWarmTickers(tickers: string[]) {
  tickers
    .map(normalizeTicker)
    .filter(Boolean)
    .forEach(ticker => warmTickers.add(ticker));
}

export function getWarmTickers() {
  return Array.from(warmTickers.values());
}

export function clearWarmTickers() {
  warmTickers.clear();
}
