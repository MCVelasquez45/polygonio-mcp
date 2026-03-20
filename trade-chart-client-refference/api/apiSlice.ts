import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { HYDRATE } from 'next-redux-wrapper';
import { config } from '../constants';
const SERVER_URL = config.SERVER_URL || '';

export const apiSlice = createApi({
    reducerPath: 'api',
    baseQuery: fetchBaseQuery({ baseUrl: `${SERVER_URL}/api` }),
    extractRehydrationInfo(action, { reducerPath }) {
        if (action.type === HYDRATE) {
            return action.payload[reducerPath]
        }
    },
    endpoints: (builder) => ({
        getAccount: builder.query({
            query: () => '/account/summary',
        }),
        getActivities: builder.query({
            query: () => '/portfolio/activities',
        }),
        getBars: builder.query({
            query: ({ start, symbol, timeframe, interval }) =>
                `/market/crypto/bars/${symbol}?timeframe=${timeframe}&start=${encodeURIComponent(
                    start,
                )}&interval=${interval}`,
        }),
        getLatestTrades: builder.query({
            query: () => '/market/crypto/trades/latest',
        }),
        getOrders: builder.query({
            query: () => '/portfolio/orders',
        }),
        getPortfolioHistory: builder.query({
            query: ({ timeframe, start }) =>
                `/portfolio/history?timeframe=${timeframe}&start=${encodeURIComponent(start)}`,
        }),
        getPositions: builder.query({
            query: () => '/portfolio/positions',
        }),
    }),
});

export const {
    useGetAccountQuery,
    useGetActivitiesQuery,
    useGetBarsQuery,
    useGetLatestTradesQuery,
    useGetOrdersQuery,
    useGetPortfolioHistoryQuery,
    useGetPositionsQuery,
} = apiSlice;
