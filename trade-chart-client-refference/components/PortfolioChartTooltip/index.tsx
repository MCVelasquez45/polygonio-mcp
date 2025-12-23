import { currencyFormatter, dateFormatter } from '../../utils';

export default function PortfolioChartTooltip({ active, payload, showTime }: any) {
    if (active && payload && payload.length) {
        return (
            <div className='p-2 bg-black'>
                <p className='font-bold'>{dateFormatter(payload[0].payload.timestamp, showTime)}</p>
                <div>
                    <div>Equity: {currencyFormatter(payload[0].payload.equity)}</div>
                </div>
            </div>
        );
    }

    return null;
}
