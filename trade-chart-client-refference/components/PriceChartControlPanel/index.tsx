import { TextField } from '@mui/material';
import { DesktopDatePicker, DesktopDateTimePicker } from '@mui/x-date-pickers';
import cn from 'classnames';

interface Props {
    selectedTimeframe: string;
    startDate: string;
    selectedSymbol: string;
    onStartDateChange: (value: string | null) => void;
    onTimeframeChange: (timeframe: string) => void;
    onSelectedSymbolChange: (symbol: string) => void;
}

export default function PriceChartControlPanel({
    selectedTimeframe,
    startDate,
    selectedSymbol,
    onTimeframeChange,
    onStartDateChange,
    onSelectedSymbolChange,
}: Props) {
    const symbols = ['BTCUSD', 'ETHUSD', 'LTCUSD', 'BCHUSD'];
    const timeframes = ['Minute', 'Hour', 'Day', 'Week', 'Month'];

    return (
        <div className='flex flex-col items-center justify-center pb-4 text-white'>
            <div className='p-1 m-1'>
                {selectedTimeframe === 'Day' || selectedTimeframe === 'Month' ? (
                    <DesktopDatePicker
                        label='Start Date'
                        inputFormat='MM/DD/YYYY'
                        value={startDate}
                        onChange={onStartDateChange}
                        renderInput={(params) => <TextField {...params} />}
                    />
                ) : (
                    <DesktopDateTimePicker
                        label='Start Date'
                        inputFormat='MM/DD/YYYY'
                        value={startDate}
                        onChange={onStartDateChange}
                        renderInput={(params) => <TextField {...params} />}
                    />
                )}
            </div>

            <div className='p-1 m-1 border border-white border-1'>
                {symbols.map((symbol) => {
                    return (
                        <button
                            className={cn(
                                'w-20',
                                { 'bg-white': symbol === selectedSymbol },
                                { 'text-black': symbol === selectedSymbol },
                            )}
                            key={symbol}
                            onClick={() => onSelectedSymbolChange(symbol)}
                        >
                            {symbol.replace('USD', '')}
                        </button>
                    );
                })}
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
