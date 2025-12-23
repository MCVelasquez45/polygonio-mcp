import { XAxis, YAxis, ResponsiveContainer, Tooltip, BarChart, Bar, Cell } from 'recharts';
import { useEffect, useState } from 'react';
import { currencyFormatter, dateFormatter } from '../../utils';
import PriceChartTooltip from '../PriceChartTooltip';
import Candlestick from '../Candlestick';
import Loader from '../Loader';

const prepareData = (data: any) => {
    if (!data) return [];

    return data.map(({ open, close, ...other }: any) => {
        return {
            ...other,
            openClose: [open, close],
        };
    });
};

interface Props {
    data: any;
    isLoading: boolean;
    showTooltipTime: boolean;
}

export default function PriceChart({ data, isLoading, showTooltipTime }: Props) {
    const [minValue, setMinValue] = useState(0);
    const [maxValue, setMaxValue] = useState(0);
    const [chartData, setChartData] = useState([]);
    const [showHighLow, setShowHighLow] = useState(false);

    useEffect(() => {
        if (!data) return;

        const chartData = prepareData(data);
        setChartData(chartData);

        const minValue = chartData.reduce(
            (minValue: any, { low, openClose: [open, close] }: any) => {
                const currentMin = Math.min(low, open, close);
                return minValue === null || currentMin < minValue ? currentMin : minValue;
            },
            null,
        );

        const maxValue = chartData.reduce(
            (maxValue: any, { high, openClose: [open, close] }: any) => {
                const currentMax = Math.max(high, open, close);
                return currentMax > maxValue ? currentMax : maxValue;
            },
            minValue,
        );

        setMinValue(minValue);
        setMaxValue(maxValue);
    }, [data]);

    return (
        <>
            <div className='flex items-center justify-center h-full text-white'>
                {isLoading ? (
                    <Loader />
                ) : (
                    <ResponsiveContainer
                        className='text-white'
                        width='80%'
                        height='80%'
                        minHeight='200px'
                        minWidth='200px'
                    >
                        <BarChart width={300} height={300} data={chartData}>
                            <XAxis
                                dataKey='timestamp'
                                tickFormatter={(value) => dateFormatter(value, !!showTooltipTime)}
                                tick={{ fill: 'white' }}
                                axisLine={{ stroke: 'white', strokeWidth: 2 }}
                                tickLine={false}
                            />
                            <YAxis
                                domain={[minValue, maxValue]}
                                tickFormatter={(value: string) => currencyFormatter(value, 0)}
                                tick={{ fill: 'white' }}
                                axisLine={{ stroke: 'white', strokeWidth: 2 }}
                                tickLine={false}
                                padding={{ bottom: 3 }}
                                allowDataOverflow={true}
                                width={80}
                            />
                            <Tooltip
                                formatter={(value: string) => currencyFormatter(value, 2)}
                                content={<PriceChartTooltip showTime={showTooltipTime} />}
                                cursor={{ fill: 'white', opacity: 0.2 }}
                            />
                            <Bar
                                dataKey='openClose'
                                fill='#8884d8'
                                shape={<Candlestick showHighLow={showHighLow} />}
                                onAnimationStart={() => {
                                    setShowHighLow(false);
                                }}
                                onAnimationEnd={() => setShowHighLow(true)}
                                animationEasing='ease-in'
                                animationDuration={200}
                            >
                                {data.map((entry: any, index: any) => (
                                    <Cell key={`cell-${index}`} fill={'white'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>
        </>
    );
}
