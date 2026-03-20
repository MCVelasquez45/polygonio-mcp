import { configureStore } from '@reduxjs/toolkit';
import { apiSlice } from '../api/apiSlice';
import cryptoReducer, { CryptoState } from './features/crypto/cryptoSlice';
import { createWrapper } from 'next-redux-wrapper';

export const store = configureStore({
    reducer: {
        crypto: cryptoReducer,
        [apiSlice.reducerPath]: apiSlice.reducer,
    },
    middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(apiSlice.middleware),
});

export interface RootState {
    crypto: CryptoState;
}


