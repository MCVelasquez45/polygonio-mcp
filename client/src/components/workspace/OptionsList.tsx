import { memo, type ComponentProps } from 'react';
import { OptionsChainPanel } from '../options/OptionsChainPanel';

type Props = {
  panelProps: ComponentProps<typeof OptionsChainPanel>;
  marketClosed?: boolean;
};

export const OptionsList = memo(function OptionsList({ panelProps, marketClosed }: Props) {
  return (
    <div className="lg:col-span-3 min-w-0">
      {marketClosed && (
        <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 text-amber-100 px-4 py-2 text-xs">
          Options quotes are paused — spreads reflect the last available snapshot.
        </div>
      )}
      <OptionsChainPanel {...panelProps} />
    </div>
  );
}, (prev, next) => prev.panelProps === next.panelProps && prev.marketClosed === next.marketClosed);
