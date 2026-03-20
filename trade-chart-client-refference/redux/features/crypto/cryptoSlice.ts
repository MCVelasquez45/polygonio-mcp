import { createSlice } from '@reduxjs/toolkit';

import { cryptoSymbol } from 'crypto-symbol';
const { nameLookup } = cryptoSymbol({});

const initialState = { bars: {} } as CryptoState;

export const cryptoSlice = createSlice({
    name: 'crypto',
    initialState,
    reducers: {
        addBar: (state, action) => {
            const bar = action.payload;

            if (!bar.symbol.endsWith('USD')) return;

            const ticker = bar.symbol.replace('/', '').replace('USD', '');
            const displayName = nameLookup(ticker);

            if (!state.bars[ticker]) {
                state.bars[ticker] = {};
            }

            state.bars[ticker].price = bar.price;

            if (!state.bars[ticker].displayName) {
                state.bars[ticker].displayName = displayName;
            }
        },
    },
});

export interface CryptoState {
    bars: {
        [key: string]: {
            price?: number;
            displayName?: string;
        };
    };
}

export const { addBar } = cryptoSlice.actions;

export default cryptoSlice.reducer;
