'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGetPortfolioHistoryQuery } from '../../api/apiSlice';
import MaterialReactTable, { MRT_ColumnDef } from 'material-react-table';
import {
    currencyFormatter,
    dateFormatter,
    percentageFormatter,
    tableSortingFunctions,
} from '../../utils';
import Loader from '../Loader';
import { Box, Button, Card } from '@mui/material';
import { ExportToCsv } from 'export-to-csv';
import { FileDownload } from '@mui/icons-material';

type OrderSummaryTableRow = {
    timestamp: Date;
    equity: number;
    dailyProfitLossAmount: number;
    dailyProfitLossPercent: number;
    cumulativeProfitLossAmount: number;
    cumulativeProfitLossPercent: number;
    averageDailyProfitLossPercent: number;
    annualizedProfitLossPercent: number;
};

export default function ReturnSummaryTable() {
    const [rowData, setRowData] = useState<OrderSummaryTableRow[]>([]);

    const { data: portfolioHistory, isLoading } = useGetPortfolioHistoryQuery({});

    const columns = useMemo<MRT_ColumnDef<OrderSummaryTableRow>[]>(
        () => [
            {
                accessorKey: 'timestamp',
                header: 'Timestamp',
                Cell: ({ cell }) => dateFormatter(cell.getValue<number>(), true),
                sortingFn: 'dateSorting',
                enableColumnFilter: false,
                sortDescFirst: false,
            },
            {
                accessorKey: 'equity',
                header: 'Equity',
                Cell: ({ cell }) => currencyFormatter(cell.getValue<number>()),
                sortingFn: 'currencySorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'dailyProfitLossAmount',
                header: 'Daily P/L ($)',
                Cell: ({ cell }) => currencyFormatter(cell.getValue<number>()),
                sortingFn: 'currencySorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'dailyProfitLossPercent',
                header: 'Daily P/L (%)',
                Cell: ({ cell }) => {
                    if (cell.getValue<number>()) {
                        return percentageFormatter(cell.getValue<number>());
                    }
                },
                sortingFn: 'percentageSorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'cumulativeProfitLossAmount',
                header: 'Cumulative P/L ($)',
                Cell: ({ cell }) => currencyFormatter(cell.getValue<number>()),
                sortingFn: 'currencySorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'cumulativeProfitLossPercent',
                header: 'Cumulative P/L (%)',
                Cell: ({ cell }) => {
                    if (cell.getValue<number>()) {
                        return percentageFormatter(cell.getValue<number>());
                    }
                },
                sortingFn: 'percentageSorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'averageDailyProfitLossPercent',
                header: 'Average Daily P/L (%)',
                Cell: ({ cell }) => {
                    if (cell.getValue<number>()) {
                        return percentageFormatter(cell.getValue<number>());
                    }
                },
                sortingFn: 'percentageSorting',
                filterVariant: 'range',
            },
            {
                accessorKey: 'annualizedProfitLossPercent',
                header: 'Annualized P/L (%)',
                Cell: ({ cell }) => {
                    if (cell.getValue<number>()) {
                        return percentageFormatter(cell.getValue<number>());
                    }
                },
                sortingFn: 'percentageSorting',
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
        filename: `returns ${new Date().toLocaleDateString()}`,
    };

    const csvExporter = new ExportToCsv(csvOptions);

    const handleExportData = () => {
        csvExporter.generateCsv(
            rowData.map((row) => {
                return {
                    ...row,
                    timestamp: dateFormatter(row.timestamp, true),
                };
            }),
        );
    };

    useEffect(() => {
        if (!portfolioHistory) return;

        const updatedRowData = Object.entries(portfolioHistory).map((historyItem: any) => {
            const rowData: any = {
                timestamp: historyItem[1].timestamp,
                equity: historyItem[1].equity,
                dailyProfitLossAmount: historyItem[1].daily_pl,
                dailyProfitLossPercent: historyItem[1].daily_pl_percent,
                cumulativeProfitLossAmount: historyItem[1].cumulative_pl,
                cumulativeProfitLossPercent: historyItem[1].cumulative_pl_percent,
                averageDailyProfitLossPercent: historyItem[1].average_daily_pl_percent,
                annualizedProfitLossPercent: historyItem[1].annualized_pl_percent,
            };

            return rowData;
        });

        setRowData(updatedRowData);
    }, [portfolioHistory]);

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
                enablePagination={false}
                enableRowVirtualization
                enableColumnResizing
            />
        </div>
    );
}
