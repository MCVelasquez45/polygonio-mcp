'use client';

import { AdvancedRealTimeChart } from 'react-ts-tradingview-widgets';
import { useGetPositionsQuery } from '../../api/apiSlice';
import Loader from '../../components/Loader';

export default function Charts() {
    const { isLoading: positionsQueryIsLoading } = useGetPositionsQuery({});

    return (
        <div className='w-full h-4/5'>
            {positionsQueryIsLoading ? (
                <Loader fullPage={true} />
            ) : (
                <AdvancedRealTimeChart theme='dark' autosize={true} interval='W' />
            )}
        </div>
    );
}
