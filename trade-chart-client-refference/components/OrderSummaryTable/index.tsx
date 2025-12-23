'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGetOrdersQuery } from '../../api/apiSlice';
import MaterialReactTable, { MRT_ColumnDef } from 'material-react-table';
import { currencyFormatter, tableSortingFunctions } from '../../utils';
import Loader from '../Loader';
import { Box, Button, Card } from '@mui/material';
import { ExportToCsv } from 'export-to-csv';
import { FileDownload } from '@mui/icons-material';

type OrderSummaryTableRow = {
    symbol: string;
    quantity: number;
    side: string;
    type: string;
    timeInForce: string;
    limitPrice: string;
};

export default function OrderSummaryTable() {
    const [rowData, setRowData] = useState<OrderSummaryTableRow[]>([]);

    const { data: orders, isLoading } = useGetOrdersQuery({}, { pollingInterval: 5000 });

    const columns = useMemo<MRT_ColumnDef<OrderSummaryTableRow>[]>(
        () => [
            {
                accessorKey: 'symbol',
                header: 'Symbol',
            },
            {
                accessorKey: 'quantity',
                header: 'Quantity',
            },
            {
                accessorKey: 'side',
                header: 'Side',
                Cell: ({ cell }) => {
                    return cell.getValue<string>().toUpperCase();
                },
            },
            {
                accessorKey: 'type',
                header: 'Type',
                Cell: ({ cell }) => {
                    return cell.getValue<string>().toUpperCase().replace('_', ' ');
                },
            },
            {
                accessorKey: 'timeInForce',
                header: 'Time in Force',
                Cell: ({ cell }) => {
                    return cell.getValue<string>().toUpperCase();
                },
            },
            {
                accessorKey: 'limitPrice',
                header: 'Limit Price',
                Cell: ({ cell }) => currencyFormatter(cell.getValue<number>()),
                sortingFn: 'currencySorting',
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
        filename: `open orders ${new Date().toLocaleDateString()}`,
    };

    const csvExporter = new ExportToCsv(csvOptions);

    const handleExportData = () => {
        csvExporter.generateCsv(rowData);
    };

    useEffect(() => {
        if (!orders) return;

        const updatedRowData = Object.entries(orders).map((order: any) => {
            const rowData: any = {
                symbol: order[1].symbol,
                quantity: order[1].quantity,
                side: order[1].side,
                type: order[1].type,
                timeInForce: order[1].time_in_force,
                limitPrice: order[1].limit_price,
            };

            return rowData;
        });

        setRowData(updatedRowData);
    }, [orders]);

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
