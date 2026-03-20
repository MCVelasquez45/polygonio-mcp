'use client';

import { useSearchParams } from 'next/navigation';
import { FundamentalData } from 'react-ts-tradingview-widgets';

export default function Fundamentals() {
    const searchParams = useSearchParams();
    let symbol = '';
    if (searchParams) {
        symbol = searchParams.get('symbol') || '';
    }

    return (
        <div className='justify-center w-full h-4/5'>
            <FundamentalData
                symbol={symbol}
                colorTheme='dark'
                autosize={true}
                largeChartUrl='https://trading.robertjosephwayne.com'
            />
        </div>
    );
}
