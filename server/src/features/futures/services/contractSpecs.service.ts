import { FuturesContractSpecModel } from '../models/futuresModels';
import { DEFAULT_FUTURES_CONTRACT_SPECS } from './specCatalog';

export async function seedDefaultContractSpecs() {
  for (const spec of DEFAULT_FUTURES_CONTRACT_SPECS) {
    await FuturesContractSpecModel.findOneAndUpdate(
      { symbol: spec.symbol },
      { $set: spec },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  }
}

export async function listActiveContractSpecs() {
  return FuturesContractSpecModel.find({ active: true }).sort({ symbol: 1 }).lean();
}

export async function getContractSpec(symbol: string) {
  return FuturesContractSpecModel.findOne({ symbol: symbol.toUpperCase(), active: true }).lean();
}
