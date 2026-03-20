'use client';

import { useState, useEffect, useMemo } from 'react';
import { useGetPositionsQuery } from '../../api/apiSlice';
import MaterialReactTable, { MRT_ColumnDef } from 'material-react-table';
import { currencyFormatter, tableSortingFunctions } from '../../utils';
import Loader from '../Loader';
import { Box, Button } from '@mui/material';
import { ExportToCsv } from 'export-to-csv';
import { FileDownload } from '@mui/icons-material';

type PositionSummaryTableRow = {
    symbol: string;
    quantity: number;
    costBasis: string;
};

export default function PositionSummaryTable() {
    const [rowData, setRowData] = useState<PositionSummaryTableRow[]>([]);

    const { data: positions, isLoading } = useGetPositionsQuery({}, { pollingInterval: 5000 });

    const columns = useMemo<MRT_ColumnDef<PositionSummaryTableRow>[]>(
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
                accessorKey: 'costBasis',
                header: 'Cost Basis',
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
        filename: `positions ${new Date().toLocaleDateString()}`,
    };

    const csvExporter = new ExportToCsv(csvOptions);

    const handleExportData = () => {
        csvExporter.generateCsv(rowData);
    };

    useEffect(() => {
        if (!positions) return;

        const updatedRowData = Object.entries(positions).map((position: any) => {
            const rowData: any = {
                symbol: position[1].symbol,
                quantity: position[1].quantity,
                costBasis: position[1].cost_basis,
            };

            return rowData;
        });

        setRowData(updatedRowData);
    }, [positions]);

    return isLoading ? (
        <Loader fullPage={true} />
    ) : (
        <div className='flex flex-col'>
            <MaterialReactTable
                columns={columns}
                data={rowData}
                autoResetPageIndex={false}
                enableRowActions
                renderRowActions={({ row }: { row: any }) => (
                    <a href={`/fundamentals?symbol=${row.getValue('symbol')}`}>Fundamentals</a>
                )}
                renderTopToolbarCustomActions={() => {
                    return (
                        <Box
                            sx={{
                                display: 'flex',
                                gap: '1rem',
                                p: '0.5rem',
                                flexWrap: 'wrap',
                            }}
                        >
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
                positionActionsColumn='last'
                displayColumnDefOptions={{
                    'mrt-row-actions': {
                        header: '', // change header text
                    },
                }}
                sortingFns={tableSortingFunctions}
            />
        </div>
    );
}
