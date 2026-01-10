import { useEffect, useMemo, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventHandler,
  LineStyle,
  type SeriesType,
  type Time,
  type UTCTimestamp,
  type WhitespaceData,
} from 'lightweight-charts';
import { AggregateBar } from '../../types/market';
import { MeasuredContainer } from '../shared/MeasuredContainer';

type Theme = 'dark' | 'light';

export type TradingViewChartProps = {
  bars: AggregateBar[];
  timeframe: string;
  height?: number;
  theme?: Theme;
};

type ThemePalette = {
  background: string;
  text: string;
  grid: string;
  candleUp: string;
  candleDown: string;
  volumeUp: string;
  volumeDown: string;
  sma: string;
};

type ChartCanvasProps = {
  width: number;
  height: number;
  bars: AggregateBar[];
  timeframe: string;
  theme: Theme;
};

const DEFAULT_HEIGHT = 320;
const SMA_PERIOD = 20;
const OR_START_HOUR = 6;
const OR_START_MINUTE = 30;
const OR_END_MINUTE = 35;
const PST_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const DARK_THEME: ThemePalette = {
  background: 'rgba(15, 23, 42, 0.6)',
  text: '#e5e7eb',
  grid: 'rgba(31, 41, 55, 0.45)',
  candleUp: '#10b981',
  candleDown: '#ef4444',
  volumeUp: '#34d399',
  volumeDown: '#f87171',
  sma: '#60a5fa',
};

const LIGHT_THEME: ThemePalette = {
  background: '#f8fafc',
  text: '#0f172a',
  grid: '#e2e8f0',
  candleUp: '#16a34a',
  candleDown: '#dc2626',
  volumeUp: '#22c55e',
  volumeDown: '#f87171',
  sma: '#2563eb',
};

const toUtcTimestamp = (timestamp: number) => Math.floor(timestamp / 1000) as UTCTimestamp;

const mapBarsToCandles = (bars: AggregateBar[]): CandlestickData<UTCTimestamp>[] =>
  bars.map(bar => ({
    time: toUtcTimestamp(bar.timestamp),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  }));

const mapBarsToVolumes = (bars: AggregateBar[], palette: ThemePalette): HistogramData<UTCTimestamp>[] =>
  bars.map(bar => ({
    time: toUtcTimestamp(bar.timestamp),
    value: bar.volume,
    color: bar.close >= bar.open ? palette.volumeUp : palette.volumeDown,
  }));

function resolveTimeframeUnit(timeframe: string) {
  const unit = timeframe.split('/')[1] ?? 'day';
  return unit;
}

function resolveDateFromTime(time: Time): Date | null {
  if (typeof time === 'number') {
    return new Date(time * 1000);
  }
  if (time && typeof time === 'object' && 'year' in time) {
    return new Date(time.year, time.month - 1, time.day);
  }
  return null;
}

function getUserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function buildTickFormatter(timeframe: string) {
  const unit = resolveTimeframeUnit(timeframe);
  const isIntraday = unit === 'minute' || unit === 'hour';
  const timeZone = getUserTimeZone();
  const formatter = new Intl.DateTimeFormat(undefined, isIntraday
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }
    : { month: 'short', day: 'numeric', timeZone }
  );
  return (time: Time) => {
    const date = resolveDateFromTime(time);
    return date ? formatter.format(date) : '';
  };
}

function buildTooltipFormatter(timeframe: string) {
  const unit = resolveTimeframeUnit(timeframe);
  const isIntraday = unit === 'minute' || unit === 'hour';
  const timeZone = getUserTimeZone();
  return new Intl.DateTimeFormat(undefined, isIntraday
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone }
    : { month: 'short', day: 'numeric', timeZone }
  );
}

const computeSma = (
  bars: AggregateBar[],
  period: number,
): Array<LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> => {
  const result: Array<LineData<UTCTimestamp> | WhitespaceData<UTCTimestamp>> = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i += 1) {
    sum += bars[i].close;
    if (i >= period) {
      sum -= bars[i - period].close;
    }
    const time = toUtcTimestamp(bars[i].timestamp);
    if (i < period - 1) {
      result.push({ time });
    } else {
      result.push({ time, value: sum / period });
    }
  }
  return result;
};

function getPstParts(timestamp: number) {
  const parts = PST_FORMATTER.formatToParts(new Date(timestamp));
  const bucket: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      bucket[part.type] = part.value;
    }
  }
  const year = bucket.year ?? '';
  const month = bucket.month ?? '';
  const day = bucket.day ?? '';
  const hour = Number(bucket.hour);
  const minute = Number(bucket.minute);
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }
  return {
    dateKey: `${year}-${month}-${day}`,
    hour,
    minute,
  };
}

function computeOpeningRange(bars: AggregateBar[], timeframe: string) {
  const unit = resolveTimeframeUnit(timeframe);
  const isIntraday = unit === 'minute' || unit === 'hour';
  if (!isIntraday || bars.length === 0) return null;
  const latest = getPstParts(bars[bars.length - 1].timestamp);
  if (!latest) return null;
  const sessionKey = latest.dateKey;
  let high = -Infinity;
  let low = Infinity;
  let found = false;
  for (const bar of bars) {
    const parts = getPstParts(bar.timestamp);
    if (!parts || parts.dateKey !== sessionKey) continue;
    if (parts.hour === OR_START_HOUR && parts.minute >= OR_START_MINUTE && parts.minute < OR_END_MINUTE) {
      found = true;
      if (bar.high > high) high = bar.high;
      if (bar.low < low) low = bar.low;
    }
  }
  if (!found) return null;
  return { high, low };
}

function ChartCanvas({ width, height, bars, timeframe, theme }: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const openingRangeLinesRef = useRef<{ high?: IPriceLine; low?: IPriceLine }>({});
  const prevBarsRef = useRef<AggregateBar[]>([]);
  const lastTimeframeRef = useRef<string>(timeframe);
  const lastThemeRef = useRef<Theme>(theme);

  const palette = useMemo(() => (theme === 'light' ? LIGHT_THEME : DARK_THEME), [theme]);
  const candleData = useMemo(() => mapBarsToCandles(bars), [bars]);
  const volumeData = useMemo(() => mapBarsToVolumes(bars, palette), [bars, palette]);
  const smaData = useMemo(() => computeSma(bars, SMA_PERIOD), [bars]);
  const openingRange = useMemo(() => computeOpeningRange(bars, timeframe), [bars, timeframe]);
  const tooltipClassName =
    theme === 'light'
      ? 'pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-900 shadow-sm opacity-0 transition-opacity whitespace-pre'
      : 'pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-gray-800 bg-gray-950/90 px-3 py-2 text-[11px] text-gray-100 shadow-sm opacity-0 transition-opacity whitespace-pre';

  useEffect(() => {
    const container = containerRef.current;
    if (!container || width === 0 || height === 0) return;

    const shouldRebuild = timeframe !== lastTimeframeRef.current || theme !== lastThemeRef.current || !chartRef.current;
    if (shouldRebuild) {
      if (chartRef.current) {
        chartRef.current.remove();
      }

      const unit = resolveTimeframeUnit(timeframe);
      const isIntraday = unit === 'minute' || unit === 'hour';
      const chart = createChart(container, {
        width,
        height,
        layout: {
          background: { type: ColorType.Solid, color: palette.background },
          textColor: palette.text,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: {
          timeVisible: isIntraday,
          secondsVisible: false,
          tickMarkFormatter: buildTickFormatter(timeframe),
        },
      });

      chartRef.current = chart;
      lastTimeframeRef.current = timeframe;
      lastThemeRef.current = theme;

      const candles = chart.addSeries(CandlestickSeries, {
        upColor: palette.candleUp,
        downColor: palette.candleDown,
        wickUpColor: palette.candleUp,
        wickDownColor: palette.candleDown,
        borderVisible: false,
      });
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
      });
      volume.priceScale().applyOptions({
        scaleMargins: {
          top: 0.8,
          bottom: 0,
        },
      });
      const sma = chart.addSeries(LineSeries, {
        color: palette.sma,
        lineWidth: 2,
      });

      candleSeriesRef.current = candles;
      volumeSeriesRef.current = volume;
      smaSeriesRef.current = sma;
      openingRangeLinesRef.current = {};
      prevBarsRef.current = [];
    } else {
      chartRef.current?.resize(width, height);
    }
  }, [height, palette, theme, timeframe, width]);

  useEffect(() => {
    const chart = chartRef.current;
    const tooltip = tooltipRef.current;
    const candles = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!chart || !tooltip || !candles || !volume) return;

    const timeFormatter = buildTooltipFormatter(timeframe);

    const handler: MouseEventHandler<Time> = param => {
      if (!param.time || !param.point) {
        tooltip.style.opacity = '0';
        return;
      }

      const candle = param.seriesData.get(candles as unknown as ISeriesApi<SeriesType, Time>) as
        | CandlestickData<Time>
        | undefined;
      const volumeBar = param.seriesData.get(volume as unknown as ISeriesApi<SeriesType, Time>) as
        | HistogramData<Time>
        | undefined;
      if (!candle) {
        tooltip.style.opacity = '0';
        return;
      }

      const timeValue = typeof param.time === 'number' ? param.time : undefined;
      const formattedTime = timeValue ? timeFormatter.format(new Date(timeValue * 1000)) : '';
      const volumeValue = volumeBar?.value ?? 0;

      tooltip.textContent =
        `${formattedTime}\n` +
        `O ${candle.open.toFixed(2)}  H ${candle.high.toFixed(2)}\n` +
        `L ${candle.low.toFixed(2)}  C ${candle.close.toFixed(2)}\n` +
        `Vol ${Math.round(volumeValue).toLocaleString()}`;
      tooltip.style.opacity = '1';
    };

    chart.subscribeCrosshairMove(handler);
    return () => {
      chart.unsubscribeCrosshairMove(handler);
    };
  }, [theme, timeframe, width, height]);

  useEffect(() => {
    const candles = candleSeriesRef.current;
    if (!candles) return;
    const existing = openingRangeLinesRef.current;
    if (existing.high) candles.removePriceLine(existing.high);
    if (existing.low) candles.removePriceLine(existing.low);
    openingRangeLinesRef.current = {};
    if (!openingRange) return;
    openingRangeLinesRef.current.high = candles.createPriceLine({
      price: openingRange.high,
      color: '#38bdf8',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'OR High',
    });
    openingRangeLinesRef.current.low = candles.createPriceLine({
      price: openingRange.low,
      color: '#f59e0b',
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'OR Low',
    });
  }, [openingRange, theme, timeframe]);

  useEffect(() => {
    const candles = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    const sma = smaSeriesRef.current;
    if (!candles || !volume || !sma) return;

    if (bars.length === 0) {
      candles.setData([]);
      volume.setData([]);
      sma.setData([]);
      prevBarsRef.current = [];
      return;
    }

    const prevBars = prevBarsRef.current;
    const prevFirst = prevBars[0]?.timestamp ?? null;
    const prevLast = prevBars.at(-1)?.timestamp ?? null;
    const nextFirst = bars[0]?.timestamp ?? null;
    const nextLast = bars.at(-1)?.timestamp ?? null;
    const isSameLength = prevBars.length === bars.length && prevBars.length > 0;
    const isLastUpdateOnly = isSameLength && prevFirst === nextFirst && prevLast === nextLast;

    if (isLastUpdateOnly) {
      const lastCandle = candleData[candleData.length - 1];
      const lastVolume = volumeData[volumeData.length - 1];
      const lastSma = smaData[smaData.length - 1];
      if (lastCandle && lastVolume && lastSma) {
        candles.update(lastCandle);
        volume.update(lastVolume);
        sma.update(lastSma);
      }
    } else {
      candles.setData(candleData);
      volume.setData(volumeData);
      sma.setData(smaData);
      chartRef.current?.timeScale().fitContent();
    }

    prevBarsRef.current = bars;
  }, [bars, candleData, smaData, volumeData]);

  useEffect(
    () => () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = null;
    },
    [],
  );

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={tooltipRef} className={tooltipClassName} />
    </div>
  );
}

export function TradingViewChart({ bars, timeframe, height, theme = 'dark' }: TradingViewChartProps) {
  const resolvedHeight = height ?? DEFAULT_HEIGHT;

  return (
    <MeasuredContainer className="w-full flex-1 min-h-[320px] min-w-0" minWidth={280} minHeight={240} height={resolvedHeight}>
      {({ width, height }) => (
        <ChartCanvas width={width} height={height} bars={bars} timeframe={timeframe} theme={theme} />
      )}
    </MeasuredContainer>
  );
}
