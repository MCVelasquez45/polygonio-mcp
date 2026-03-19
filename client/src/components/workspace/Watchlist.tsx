import { memo, type ComponentProps } from 'react';
import { TradingSidebar } from '../layout/TradingSidebar';

type Props = {
  sidebarProps: ComponentProps<typeof TradingSidebar>;
};

export const Watchlist = memo(function Watchlist({ sidebarProps }: Props) {
  return <TradingSidebar {...sidebarProps} />;
}, (prev, next) => prev.sidebarProps === next.sidebarProps);
