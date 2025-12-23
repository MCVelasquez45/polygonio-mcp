'use client';

import { useState, useEffect, useMemo } from 'react';

import { useDispatch, useSelector } from 'react-redux';
import { RootState } from '../../redux/store';
import { useGetLatestTradesQuery } from '../../api/apiSlice';
import { addBar } from '../../redux/features/crypto/cryptoSlice';
import MaterialReactTable, { MRT_ColumnDef } from 'material-react-table';
import { currencyFormatter } from '../../utils';
import Loader from '../Loader';

type MarketSummaryTableRow = {
    ticker: string;
    price: number;
    displayName: string;
};

export default function MarketSummaryTable() {
    const dispatch = useDispatch();
    const [rowData, setRowData] = useState<MarketSummaryTableRow[]>([]);

    const bars = useSelector((state: RootState) => state.crypto.bars);

    const { data, isLoading } = useGetLatestTradesQuery({});

    const columns = useMemo<MRT_ColumnDef<MarketSummaryTableRow>[]>(
        () => [
            {
                accessorKey: 'displayName',
                header: 'Name',
            },
            {
                accessorKey: 'ticker',
                header: 'Ticker',
            },
            {
                accessorKey: 'price',
                header: 'Price',
                Cell: ({ cell }) => currencyFormatter(cell.getValue<number>()),
                filterVariant: 'range',
            },
        ],
        [],
    );

    useEffect(() => {
        if (data) {
            for (const symbol in data) {
                const bar = {
                    symbol,
                    price: data[symbol].price,
                };

                dispatch(addBar(bar));
            }
        }
    }, [data]);

    useEffect(() => {
        const updatedRowData = Object.entries(bars).map((bar) => {
            const ticker = bar[0];
            const { price, displayName } = bar[1];

            const rowData: any = {
                ticker,
                price,
                displayName,
            };

            return rowData;
        });

        setRowData(updatedRowData);
    }, [bars]);

    return isLoading ? (
        <Loader fullPage={true} />
    ) : (
        <MaterialReactTable columns={columns} data={rowData} />
    );
}
