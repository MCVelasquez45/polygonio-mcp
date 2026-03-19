import { memo, type ComponentProps } from 'react';
import { GreeksPanel } from '../options/GreeksPanel';
import { OrderTicketPanel } from '../trading/OrderTicketPanel';

type Props = {
  greeksProps: ComponentProps<typeof GreeksPanel>;
  orderTicketProps: ComponentProps<typeof OrderTicketPanel>;
};

export const ContractDetails = memo(function ContractDetails({ greeksProps, orderTicketProps }: Props) {
  return (
    <>
      <div className="lg:col-span-2 min-w-0">
        <GreeksPanel {...greeksProps} />
      </div>
      <div className="lg:col-span-1 min-h-[26rem] min-w-0">
        <OrderTicketPanel {...orderTicketProps} />
      </div>
    </>
  );
}, (prev, next) => prev.greeksProps === next.greeksProps && prev.orderTicketProps === next.orderTicketProps);
