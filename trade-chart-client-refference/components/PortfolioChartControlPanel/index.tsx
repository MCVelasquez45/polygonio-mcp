import { TextField } from '@mui/material';
import { DesktopDatePicker } from '@mui/x-date-pickers';
import cn from 'classnames';
import { useEffect, useState } from 'react';
import { differenceInDays } from 'date-fns';

interface Props {
    selectedTimeframe: string;
    startDate: string;
    onStartDateChange: (value: string | null) => void;
    onTimeframeChange: (timeframe: string) => void;
}

export default function PortfolioChartControlPanel({
    selectedTimeframe,
    startDate,
    onTimeframeChange,
    onStartDateChange,
}: Props) {
    const [timeframes, setTimeframes] = useState(['1M', '5M', '15M', '1H', '1D']);

    useEffect(() => {
        const days = differenceInDays(new Date(), new Date(startDate));
        if (days >= 7) {
            setTimeframes(['5M', '15M', '1H', '1D']);
        } else {
            setTimeframes(['1M', '5M', '15M', '1H', '1D']);
        }
    }, [startDate]);

    return (
        <div className='flex flex-col items-center justify-center pb-4 text-white'>
            <div className='p-1 m-1'>
                <DesktopDatePicker
                    label='Start Date'
                    inputFormat='MM/DD/YYYY'
                    value={startDate}
                    onChange={onStartDateChange}
                    renderInput={(params) => <TextField {...params} />}
                />
            </div>

            <div className='p-1 m-1 border border-white border-1'>
                {timeframes.map((timeframe) => {
                    return (
                        <button
                            className={cn(
                                'w-20',
                                { 'bg-white': timeframe === selectedTimeframe },
                                { 'text-black': timeframe === selectedTimeframe },
                            )}
                            key={timeframe}
                            onClick={() => onTimeframeChange(timeframe)}
                        >
                            {timeframe}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
