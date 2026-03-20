'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGetActivitiesQuery } from '../../api/apiSlice';
import MaterialReactTable, { MRT_ColumnDef } from 'material-react-table';
import { currencyFormatter, dateFormatter, tableSortingFunctions, toProperCase } from '../../utils';
import Loader from '../Loader';
import { Box, Button, Card } from '@mui/material';
import { ExportToCsv } from 'export-to-csv';
import { FileDownload } from '@mui/icons-material';

type ActivitySummaryTableRow = {
    price: string;
    quantity: string;
    side: string;
    symbol: string;
    transactionTime: Date;
};

export default function ActivitySummaryTableRow() {
    const [rowData, setRowData] = useState<ActivitySummaryTableRow[]>([]);

    const { data: activities, isLoading } = useGetActivitiesQuery({}, { pollingInterval: 5000 });

    const columns = useMemo<MRT_ColumnDef<ActivitySummaryTableRow>[]>(
        () => [
            {
                accessorKey: 'transactionTime',
                header: 'Transaction Time',
                Cell: ({ cell }) => dateFormatter(cell.getValue<string>(), true),
                sortingFn: 'dateSorting',
                enableColumnFilter: false,
            },
            {
                accessorKey: 'symbol',
                header: 'Symbol',
            },
            {
                accessorKey: 'side',
                header: 'Side',
                Cell: ({ cell }) => {
                    let value = cell.getValue<string>();
                    value = value.replace('_', ' ');
                    return toProperCase(value);
                },
            },
            {
                accessorKey: 'price',
                header: 'Price',
                Cell: ({ cell }) => currencyFormatter(cell.getValue<number>()),
                sortingFn: 'currencySorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'quantity',
                header: 'Quantity',
                filterVariant: 'range',
            },
        ],
        [],
    );

    const headers = useMemo(() => {
        const firstRow = rowData[0];
        const headers = [];
        for (const property in firstRow) {
            const column = columns.find((column) => column.accessorKey === property);
            if (column && column.header) {
                headers.push(column.header);
            }
        }
        return headers;
    }, [rowData]);

    const csvOptions = {
        fieldSeparator: ',',
        quoteStrings: '"',
        decimalSeparator: '.',
        showLabels: true,
        useBom: true,
        useKeysAsHeaders: false,
        headers,
        filename: `trade book ${new Date().toLocaleDateString()}`,
    };

    const csvExporter = new ExportToCsv(csvOptions);

    const handleExportData = () => {
        csvExporter.generateCsv(rowData);
    };

    useEffect(() => {
        if (!activities) return;

        const updatedRowData = Object.entries(activities).map((activity: any) => {
            const { price, quantity, side, symbol, transaction_time } = activity[1];

            const rowData: ActivitySummaryTableRow = {
                transactionTime: transaction_time,
                symbol,
                side,
                price,
                quantity,
            };

            return rowData;
        });

        setRowData(updatedRowData);
    }, [activities]);

    return isLoading ? (
        <Loader fullPage={true} />
    ) : (
        <div className='flex flex-col'>
            <MaterialReactTable
                columns={columns}
                data={rowData}
                autoResetPageIndex={false}
                renderTopToolbarCustomActions={() => {
                    return (
                        <Box sx={{ display: 'flex', gap: '1rem', p: '0.5rem', flexWrap: 'wrap' }}>
                            <Button
                                color='info'
                                onClick={handleExportData}
                                startIcon={<FileDownload />}
                                sx={{ color: 'white' }}
                            >
                                Export All Data
                            </Button>
                        </Box>
                    );
                }}
                sortingFns={tableSortingFunctions}
            />
        </div>
    );
}
