import { currencyFormatter, dateFormatter } from '../../utils';

export default function PriceChartTooltip({ active, payload, showTime }: any) {
    if (active && payload && payload.length) {
        return (
            <div className='p-2 bg-black'>
                <p className='font-bold'>{dateFormatter(payload[0].payload.timestamp, showTime)}</p>
                <div>
                    <div>High: {currencyFormatter(payload[0].payload.high)}</div>
                    <div>Low: {currencyFormatter(payload[0].payload.low)}</div>
                    <div>Open: {currencyFormatter(payload[0].payload.openClose[0])}</div>
                    <div>Close: {currencyFormatter(payload[0].payload.openClose[1])}</div>
                </div>
            </div>
        );
    }

    return null;
}
