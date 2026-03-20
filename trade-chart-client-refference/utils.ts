import { format } from 'date-fns';

export function currencyFormatter(value: number | string, maximumFractionDigits = 2): string {
    if (!value) return '';

    if (typeof value === 'string') {
        value = parseFloat(value);
    }

    return value.toLocaleString(undefined, {
        currency: 'usd',
        style: 'currency',
        maximumFractionDigits: maximumFractionDigits,
    });
}

export function percentageFormatter(value: number | string, minimumFractionDigits = 2): string {
    if (!value) return '';

    if (typeof value === 'string') {
        value = parseFloat(value);
    }

    const formattedValue = value.toLocaleString(undefined, {
        style: 'percent',
        minimumFractionDigits,
    });

    return formattedValue;
}

export function dateFormatter(value: any, showTime: boolean): string {
    if (!value || value === 'auto') return '';

    let formattedDate = format(new Date(value), 'M/d/yyyy');
    if (showTime) {
        formattedDate = format(new Date(value), 'M/d/yyyy, pp');
    }
    return formattedDate;
}

export function toProperCase(text: string): string {
    text = text.toLowerCase();
    const characters = text.split('');
    characters[0] = characters[0].toUpperCase();
    return characters.join('');
}

export const tableSortingFunctions = {
    percentageSorting: (rowA: any, rowB: any, columnId: any): number => {
        const rowAFloatValue = parseFloat(rowA.getValue(columnId));
        const rowBFloatValue = parseFloat(rowB.getValue(columnId));
        return rowAFloatValue < rowBFloatValue ? 1 : -1;
    },
    currencySorting: (rowA: any, rowB: any, columnId: any): number => {
        const rowACurrencyString = rowA.getValue(columnId);
        const rowAWithoutCurrencySymbol = rowACurrencyString.toLocaleString();
        const rowAFloatValue = parseFloat(rowAWithoutCurrencySymbol);

        const rowBCurrencyString = rowB.getValue(columnId);
        const rowBWithoutCurrencySymbol = rowBCurrencyString.toLocaleString();
        const rowBFloatValue = parseFloat(rowBWithoutCurrencySymbol);

        return rowAFloatValue < rowBFloatValue ? 1 : -1;
    },
    dateSorting: (rowA: any, rowB: any, columnId: any): number => {
        const rowADateString = rowA.getValue(columnId);
        const rowADate = new Date(rowADateString);

        const rowBDateString = rowB.getValue(columnId);
        const rowBDate = new Date(rowBDateString);

        return rowADate < rowBDate ? 1 : -1;
    },
};
