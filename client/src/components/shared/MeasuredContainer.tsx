import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

type Size = {
  width: number;
  height: number;
};

type Props = {
  className?: string;
  style?: CSSProperties;
  minWidth?: number;
  minHeight?: number;
  height?: number;
  children: (size: Size) => ReactNode;
};

function readSize(element: HTMLDivElement): Size {
  const rect = element.getBoundingClientRect();
  return {
    width: Math.max(0, Math.round(rect.width)),
    height: Math.max(0, Math.round(rect.height)),
  };
}

export function MeasuredContainer({ className, style, minWidth, minHeight, height, children }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const next = readSize(element);
      setSize(prev => (prev.width === next.width && prev.height === next.height ? prev : next));
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  const mergedStyle: CSSProperties = {
    ...style,
    minWidth,
    minHeight,
    ...(height != null ? { height } : null),
  };

  return (
    <div ref={ref} className={className} style={mergedStyle}>
      {size.width > 0 && size.height > 0 ? children(size) : null}
    </div>
  );
}
