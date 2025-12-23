import { useGetAccountQuery } from '../../api/apiSlice';
import { currencyFormatter } from '../../utils';
import { Card, CardContent, Typography } from '@mui/material';

export default function AccountSummary() {
    const { data: accountData } = useGetAccountQuery({}, { pollingInterval: 5000 });

    return (
        <Card variant='outlined'>
            <CardContent>
                <div className='flex flex-col'>
                    <Typography variant='h6'>Account Summary - Paper Trading</Typography>
                    <Typography variant='body1'>
                        Buying Power: {currencyFormatter(accountData.buying_power)}
                    </Typography>
                    <Typography variant='body1'>
                        Cash: {currencyFormatter(accountData.cash)}
                    </Typography>
                    <Typography variant='body1'>
                        Position Market Value:{' '}
                        {currencyFormatter(accountData.position_market_value)}
                    </Typography>
                    <Typography variant='body1'>
                        Equity: {currencyFormatter(accountData.equity)}
                    </Typography>
                </div>
            </CardContent>
        </Card>
    );
}
