'use client';

import { Card, CardContent, Typography } from '@mui/material';
import { useGetAccountQuery } from '../../api/apiSlice';
import Loader from '../../components/Loader';
import { currencyFormatter, percentageFormatter } from '../../utils';

export default function PortfolioMetrics() {
    const { data: accountData, isLoading: accountDataIsLoading } = useGetAccountQuery(
        {},
        { pollingInterval: 1000 },
    );

    return accountDataIsLoading ? (
        <Loader fullPage={true} />
    ) : (
        <div className='w-full h-4/5'>
            <Card variant='outlined'>
                <CardContent>
                    <Typography variant='h6'>Buying Power</Typography>
                    <Typography variant='body1'>
                        Stock Buying Power: {currencyFormatter(accountData.stock_buying_power)}
                    </Typography>
                    <Typography variant='body1'>
                        Option Buying Power: {currencyFormatter(accountData.option_buying_power)}
                    </Typography>

                    <Typography variant='h6' sx={{ mt: 2 }}>
                        Portfolio Value
                    </Typography>
                    <Typography variant='body1'>
                        Short Market Value: {currencyFormatter(accountData.short_market_value)} (
                        {percentageFormatter(
                            -accountData.short_market_value /
                                (accountData.long_market_value - accountData.short_market_value),
                            2,
                        )}
                        )
                    </Typography>
                    <Typography variant='body1'>
                        Long Market Value: {currencyFormatter(accountData.long_market_value)} (
                        {percentageFormatter(
                            accountData.long_market_value /
                                (accountData.long_market_value - accountData.short_market_value),
                            2,
                        )}
                        )
                    </Typography>
                    <Typography variant='body1'>
                        Total Market Value: {currencyFormatter(accountData.market_value)}
                    </Typography>

                    <Typography variant='body1'>
                        Cash: {currencyFormatter(accountData.cash)}
                    </Typography>

                    <Typography variant='body1'>
                        Total Equity Value: {currencyFormatter(accountData.equity)}
                    </Typography>
                </CardContent>
            </Card>
        </div>
    );
}
