import { BarLoader } from 'react-spinners';
import cn from 'classnames';

export default function Loader({ fullPage }: { fullPage?: boolean }) {
    return (
        <div
            className={cn('flex flex-col items-center justify-center', {
                'absolute w-screen h-screen top-0 left-0': !!fullPage,
            })}
        >
            <BarLoader color='white' />
        </div>
    );
}
