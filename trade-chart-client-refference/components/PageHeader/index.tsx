import PageHeaderButton from '../PageHeaderButton';

export default function PageHeader() {
    const pages = [
        {
            label: 'Charts',
            path: '/charts',
        },
        {
            label: 'Positions',
            path: '/positions',
        },
        {
            label: 'Orders',
            path: '/orders',
        },
        {
            label: 'Trade Book',
            path: '/trade-book',
        },
        {
            label: 'Portfolio Metrics',
            path: '/portfolio-metrics',
        },
    ];

    return (
        <div className='flex py-2 mb-4 sm:justify-end'>
            <nav className='text-xs font-semibold tracking-wide'>
                <ul className='flex justify-between sm:justify-end sm:space-x-4'>
                    {pages.map((page) => (
                        <PageHeaderButton key={page.label} path={page.path} label={page.label} />
                    ))}
                </ul>
            </nav>
        </div>
    );
}
