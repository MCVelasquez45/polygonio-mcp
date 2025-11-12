import { useEffect, useRef } from 'react';

type ChartPaneProps = {
  report?: string;
};

export default function ChartPane({ report }: ChartPaneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    const context = canvasRef.current.getContext('2d');
    if (!context) return;

    console.log('[CLIENT] Chart updating with report payload:', report);
    context.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    context.fillStyle = '#2563eb';
    context.fillRect(12, 40, 180, 12);
    context.fillRect(12, 80, 120, 12);
    context.fillRect(12, 120, 220, 12);
    context.fillStyle = '#1d4ed8';
    context.fillRect(12, 160, 140, 12);
  }, [report]);

  return (
    <section>
      <h3>Market Snapshot</h3>
      <canvas ref={canvasRef} width={360} height={200} style={{ width: '100%', background: '#f8fafc', borderRadius: 12 }} />
      <p style={{ color: 'rgba(15, 23, 42, 0.6)' }}>
        Charts placeholder. Replace with TradingView or custom visualisations once live data is flowing.
      </p>
    </section>
  );
}
