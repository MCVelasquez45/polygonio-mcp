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
  type SeriesMarker,
} from 'lightweight-charts';
import { AggregateBar } from '../../types/market';
import { MeasuredContainer } from '../shared/MeasuredContainer';
import {
  computeBollinger,
  computeEma,
  computeMacd,
  computeRsi,
  computeSessionVwap,
} from '../../lib/chartIndicators';

type Theme = 'dark' | 'light';

/** Which studies render. SMA stays the default so existing behavior holds. */
export type IndicatorToggles = {
  sma: boolean;
  ema: boolean;
  vwap: boolean;
  bollinger: boolean;
  rsi: boolean;
  macd: boolean;
};

export const DEFAULT_INDICATOR_TOGGLES: IndicatorToggles = {
  sma: true,
  ema: false,
  vwap: false,
  bollinger: false,
  rsi: false,
  macd: false,
};

export type TradingViewChartProps = {
  bars: AggregateBar[];
  timeframe: string;
  height?: number;
  theme?: Theme;
  markers?: SeriesMarker<UTCTimestamp>[];
  indicators?: IndicatorToggles;
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
  markers?: SeriesMarker<UTCTimestamp>[];
  indicators: IndicatorToggles;
};

// Study palette — chart-local, mirrors the intel token hues.
const STUDY_COLORS = {
  emaFast: '#f5a623',
  emaSlow: '#a98bf5',
  vwap: '#34c9df',
  bollinger: 'rgba(148, 163, 184, 0.55)',
  rsi: '#6aa5f5',
  macd: '#34c9df',
  macdSignal: '#f5a623',
};
const EMA_FAST_PERIOD = 9;
const EMA_SLOW_PERIOD = 21;

const DEFAULT_HEIGHT = 320;
const SMA_PERIOD = 20;
const OPENING_RANGE_START_MINUTES = 9 * 60 + 30;
const OPENING_RANGE_END_MINUTES = 9 * 60 + 35;
const INTRADAY_MIN_VISIBLE_BARS = 60;
const NON_INTRADAY_MIN_VISIBLE_BARS = 80;
const INTRADAY_RIGHT_OFFSET = 2;
const NON_INTRADAY_RIGHT_OFFSET = 1;
const NY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
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

function resolveVisibleBars(barCount: number, timeframe: string) {
  if (barCount <= 0) return 0;
  const unit = resolveTimeframeUnit(timeframe);
  if (unit === 'minute' || unit === 'hour') {
    return Math.min(barCount, INTRADAY_MIN_VISIBLE_BARS);
  }
  return Math.min(barCount, NON_INTRADAY_MIN_VISIBLE_BARS);
}

function resolveBarSpacing(barCount: number, timeframe: string, width: number) {
  const visibleBars = resolveVisibleBars(barCount, timeframe);
  if (visibleBars <= 0 || width <= 0) return 6;
  const unit = resolveTimeframeUnit(timeframe);
  const base = Math.floor(width / visibleBars);
  const min = unit === 'minute' || unit === 'hour' ? 3 : 8;
  const max = unit === 'minute' || unit === 'hour' ? 10 : 18;
  return Math.max(min, Math.min(max, base));
}

function applyVisibleRange(chart: IChartApi, barCount: number, timeframe: string, width: number) {
  const unit = resolveTimeframeUnit(timeframe);
  const isIntraday = unit === 'minute' || unit === 'hour';
  const visibleBars = resolveVisibleBars(barCount, timeframe);
  const barSpacing = resolveBarSpacing(barCount, timeframe, width);
  chart.timeScale().applyOptions({
    barSpacing,
    minBarSpacing: Math.max(2, Math.floor(barSpacing / 2)),
  });
  if (barCount < 2 || visibleBars <= 0) {
    chart.timeScale().fitContent();
    return;
  }
  const from = Math.max(barCount - visibleBars, 0);
  const to = barCount - 1 + (isIntraday ? INTRADAY_RIGHT_OFFSET : NON_INTRADAY_RIGHT_OFFSET);
  chart.timeScale().setVisibleLogicalRange({ from, to });
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

function getNyParts(timestamp: number) {
  const parts = NY_FORMATTER.formatToParts(new Date(timestamp));
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
  const ranges = new Map<string, { high: number; low: number }>();
  for (const bar of bars) {
    const parts = getNyParts(bar.timestamp);
    if (!parts) continue;
    const minuteOfDay = parts.hour * 60 + parts.minute;
    if (minuteOfDay < OPENING_RANGE_START_MINUTES || minuteOfDay >= OPENING_RANGE_END_MINUTES) continue;
    const existing = ranges.get(parts.dateKey);
    if (!existing) {
      ranges.set(parts.dateKey, { high: bar.high, low: bar.low });
    } else {
      existing.high = Math.max(existing.high, bar.high);
      existing.low = Math.min(existing.low, bar.low);
    }
  }
  if (!ranges.size) return null;
  const sessionKey = Array.from(ranges.keys()).sort().at(-1);
  if (!sessionKey) return null;
  const range = ranges.get(sessionKey);
  if (!range) return null;
  return { high: range.high, low: range.low };
}

function ChartCanvas({
  width,
  height,
  bars,
  timeframe,
  theme,
  markers,
  indicators,
}: ChartCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaFastSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const emaSlowSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const vwapSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbUpperSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbMiddleSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const bbLowerSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const rsiSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdSignalSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const macdHistSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const openingRangeLinesRef = useRef<{ high?: IPriceLine; low?: IPriceLine }>({});
  const prevBarsRef = useRef<AggregateBar[]>([]);
  const lastTimeframeRef = useRef<string>(timeframe);
  const lastThemeRef = useRef<Theme>(theme);
  // A change to the study set rebuilds the chart (rare, user-driven) so pane
  // and series lifecycles stay simple and leak-free.
  const togglesKey = `${indicators.sma}|${indicators.ema}|${indicators.vwap}|${indicators.bollinger}|${indicators.rsi}|${indicators.macd}`;
  const lastTogglesRef = useRef<string>(togglesKey);

  const palette = useMemo(() => (theme === 'light' ? LIGHT_THEME : DARK_THEME), [theme]);
  const normalizedBars = useMemo(() => {
    if (!bars.length) return bars;
    const deduped = new Map<number, AggregateBar>();
    for (const bar of bars) {
      deduped.set(bar.timestamp, bar);
    }
    return Array.from(deduped.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [bars]);
  const candleData = useMemo(() => mapBarsToCandles(normalizedBars), [normalizedBars]);
  const volumeData = useMemo(() => mapBarsToVolumes(normalizedBars, palette), [normalizedBars, palette]);
  const smaData = useMemo(() => computeSma(normalizedBars, SMA_PERIOD), [normalizedBars]);
  const emaFastData = useMemo(
    () => (indicators.ema ? computeEma(normalizedBars, EMA_FAST_PERIOD) : []),
    [normalizedBars, indicators.ema]
  );
  const emaSlowData = useMemo(
    () => (indicators.ema ? computeEma(normalizedBars, EMA_SLOW_PERIOD) : []),
    [normalizedBars, indicators.ema]
  );
  const vwapData = useMemo(
    () => (indicators.vwap ? computeSessionVwap(normalizedBars) : []),
    [normalizedBars, indicators.vwap]
  );
  const bollingerData = useMemo(
    () => (indicators.bollinger ? computeBollinger(normalizedBars) : null),
    [normalizedBars, indicators.bollinger]
  );
  const rsiData = useMemo(
    () => (indicators.rsi ? computeRsi(normalizedBars) : []),
    [normalizedBars, indicators.rsi]
  );
  const macdData = useMemo(
    () => (indicators.macd ? computeMacd(normalizedBars) : null),
    [normalizedBars, indicators.macd]
  );
  const openingRange = useMemo(() => computeOpeningRange(normalizedBars, timeframe), [normalizedBars, timeframe]);
  const tooltipClassName =
    theme === 'light'
      ? 'pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-900 shadow-sm opacity-0 transition-opacity whitespace-pre'
      : 'pointer-events-none absolute left-3 top-3 z-10 rounded-lg border border-gray-800 bg-gray-950/90 px-3 py-2 text-[11px] text-gray-100 shadow-sm opacity-0 transition-opacity whitespace-pre';

  useEffect(() => {
    const container = containerRef.current;
    if (!container || width === 0 || height === 0) return;

    const shouldRebuild =
      theme !== lastThemeRef.current ||
      togglesKey !== lastTogglesRef.current ||
      !chartRef.current;
    if (shouldRebuild) {
      if (chartRef.current) {
        chartRef.current.remove();
      }

      const unit = resolveTimeframeUnit(timeframe);
      const isIntraday = unit === 'minute' || unit === 'hour';
      const priceScaleMargins = isIntraday
        ? { top: 0.12, bottom: 0.18 }
        : { top: 0.08, bottom: 0.08 };
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
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: priceScaleMargins,
        },
        leftPriceScale: {
          visible: false,
        },
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: {
          timeVisible: isIntraday,
          secondsVisible: false,
          tickMarkFormatter: buildTickFormatter(timeframe),
          rightOffset: isIntraday ? INTRADAY_RIGHT_OFFSET : NON_INTRADAY_RIGHT_OFFSET,
          fixLeftEdge: true,
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
        priceScaleId: 'right',
      });
      const volume = chart.addSeries(HistogramSeries, {
        priceFormat: { type: 'volume' },
        priceScaleId: '',
        lastValueVisible: false,
      });
      volume.priceScale().applyOptions({
        scaleMargins: {
          top: 0.82,
          bottom: 0,
        },
      });
      const sma = indicators.sma
        ? chart.addSeries(LineSeries, {
          color: palette.sma,
          lineWidth: 2,
          priceScaleId: 'right',
        })
        : null;

      // ── Overlay studies (main pane) ────────────────────────────────────
      const overlayLine = (color: string, lineWidth: 1 | 2 = 1, dashed = false) =>
        chart.addSeries(LineSeries, {
          color,
          lineWidth,
          priceScaleId: 'right',
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
          lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
        });
      emaFastSeriesRef.current = indicators.ema ? overlayLine(STUDY_COLORS.emaFast, 1) : null;
      emaSlowSeriesRef.current = indicators.ema ? overlayLine(STUDY_COLORS.emaSlow, 1) : null;
      vwapSeriesRef.current = indicators.vwap ? overlayLine(STUDY_COLORS.vwap, 2) : null;
      bbUpperSeriesRef.current = indicators.bollinger ? overlayLine(STUDY_COLORS.bollinger, 1) : null;
      bbMiddleSeriesRef.current = indicators.bollinger ? overlayLine(STUDY_COLORS.bollinger, 1, true) : null;
      bbLowerSeriesRef.current = indicators.bollinger ? overlayLine(STUDY_COLORS.bollinger, 1) : null;

      // ── Oscillator panes (below price) ─────────────────────────────────
      let nextPane = 1;
      if (indicators.rsi) {
        const rsi = chart.addSeries(
          LineSeries,
          { color: STUDY_COLORS.rsi, lineWidth: 1, lastValueVisible: true, priceLineVisible: false },
          nextPane
        );
        rsi.createPriceLine({ price: 70, color: 'rgba(248,113,113,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        rsi.createPriceLine({ price: 30, color: 'rgba(53,210,154,0.5)', lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
        rsiSeriesRef.current = rsi;
        nextPane += 1;
      } else {
        rsiSeriesRef.current = null;
      }
      if (indicators.macd) {
        macdHistSeriesRef.current = chart.addSeries(
          HistogramSeries,
          { priceScaleId: 'right', lastValueVisible: false, priceLineVisible: false },
          nextPane
        );
        macdSeriesRef.current = chart.addSeries(
          LineSeries,
          { color: STUDY_COLORS.macd, lineWidth: 1, lastValueVisible: false, priceLineVisible: false },
          nextPane
        );
        macdSignalSeriesRef.current = chart.addSeries(
          LineSeries,
          { color: STUDY_COLORS.macdSignal, lineWidth: 1, lastValueVisible: false, priceLineVisible: false },
          nextPane
        );
        nextPane += 1;
      } else {
        macdSeriesRef.current = null;
        macdSignalSeriesRef.current = null;
        macdHistSeriesRef.current = null;
      }
      // Keep oscillator panes compact relative to the price pane. The panes
      // API is v5; guard so an older build simply keeps default sizing.
      try {
        const panes = (chart as unknown as { panes?: () => Array<{ setHeight?: (h: number) => void }> }).panes?.() ?? [];
        for (let i = 1; i < panes.length; i += 1) {
          panes[i]?.setHeight?.(Math.max(72, Math.round(height * 0.16)));
        }
      } catch {
        // pane sizing is cosmetic — never fail the chart for it
      }

      candleSeriesRef.current = candles;
      volumeSeriesRef.current = volume;
      smaSeriesRef.current = sma;
      lastTogglesRef.current = togglesKey;
      openingRangeLinesRef.current = {};
      prevBarsRef.current = [];
    } else {
      const unit = resolveTimeframeUnit(timeframe);
      const isIntraday = unit === 'minute' || unit === 'hour';
      chartRef.current?.applyOptions({
        width,
        height,
        rightPriceScale: {
          borderVisible: false,
          scaleMargins: isIntraday
            ? { top: 0.12, bottom: 0.18 }
            : { top: 0.08, bottom: 0.08 },
        },
        timeScale: {
          timeVisible: isIntraday,
          secondsVisible: false,
          tickMarkFormatter: buildTickFormatter(timeframe),
          rightOffset: isIntraday ? INTRADAY_RIGHT_OFFSET : NON_INTRADAY_RIGHT_OFFSET,
          fixLeftEdge: true,
        },
      });
      lastTimeframeRef.current = timeframe;
    }
  }, [height, palette, theme, timeframe, width, togglesKey, indicators]);

  useEffect(() => {
    const chart = chartRef.current;
    const tooltip = tooltipRef.current;
    const candles = candleSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!chart || !tooltip || !candles) return;

    const timeFormatter = buildTooltipFormatter(timeframe);

    const handler: MouseEventHandler<Time> = param => {
      if (!param.time || !param.point) {
        tooltip.style.opacity = '0';
        return;
      }

      const candle = param.seriesData.get(candles as unknown as ISeriesApi<SeriesType, Time>) as
        | CandlestickData<Time>
        | undefined;
      const volumeBar = volume
        ? (param.seriesData.get(volume as unknown as ISeriesApi<SeriesType, Time>) as
          | HistogramData<Time>
          | undefined)
        : undefined;
      if (!candle) {
        tooltip.style.opacity = '0';
        return;
      }

      const timeValue = typeof param.time === 'number' ? param.time : undefined;
      const formattedTime = timeValue ? timeFormatter.format(new Date(timeValue * 1000)) : '';
      const unit = resolveTimeframeUnit(timeframe);
      const isIntraday = unit === 'minute' || unit === 'hour';
      const volumeValue = isIntraday ? volumeBar?.value ?? null : null;
      const volumeLine = volumeValue != null ? `\nVol ${Math.round(volumeValue).toLocaleString()}` : '';

      tooltip.textContent =
        `${formattedTime}\n` +
        `O ${candle.open.toFixed(2)}  H ${candle.high.toFixed(2)}\n` +
        `L ${candle.low.toFixed(2)}  C ${candle.close.toFixed(2)}\n` +
        `${volumeLine}`;
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
    const sma = smaSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!candles) return;
    const unit = resolveTimeframeUnit(timeframe);
    const isIntraday = unit === 'minute' || unit === 'hour';
    const effectiveVolumeData = isIntraday ? volumeData : [];

    if (normalizedBars.length === 0) {
      candles.setData([]);
      if (volume) volume.setData([]);
      sma?.setData([]);
      prevBarsRef.current = [];
      return;
    }

    const prevBars = prevBarsRef.current;
    const prevFirst = prevBars[0]?.timestamp ?? null;
    const prevLast = prevBars.at(-1)?.timestamp ?? null;
    const nextFirst = normalizedBars[0]?.timestamp ?? null;
    const nextLast = normalizedBars.at(-1)?.timestamp ?? null;
    const isSameLength = prevBars.length === normalizedBars.length && prevBars.length > 0;
    const isLastUpdateOnly = isSameLength && prevFirst === nextFirst && prevLast === nextLast;

    if (isLastUpdateOnly) {
      const lastCandle = candleData[candleData.length - 1];
      if (lastCandle) {
        candles.update(lastCandle);
        if (volume) {
          if (isIntraday) {
            const lastVolume = effectiveVolumeData[effectiveVolumeData.length - 1];
            if (lastVolume) volume.update(lastVolume);
          } else {
            volume.setData([]);
          }
        }
        const lastSma = smaData[smaData.length - 1];
        if (sma && lastSma) sma.update(lastSma);
      }
      if (chartRef.current) {
        applyVisibleRange(chartRef.current, normalizedBars.length, timeframe, width);
      }
    } else {
      candles.setData(candleData);
      if (volume) volume.setData(effectiveVolumeData);
      sma?.setData(smaData);
      if (chartRef.current) {
        applyVisibleRange(chartRef.current, normalizedBars.length, timeframe, width);
      }
    }

    prevBarsRef.current = normalizedBars;
    // togglesKey: a study toggle rebuilds the chart with empty series while
    // none of the data inputs change — this effect must re-run to refill them.
  }, [normalizedBars, candleData, smaData, volumeData, timeframe, width, togglesKey]);

  // Study series: recomputed arrays are small (≤ a few hundred points), so a
  // plain setData on every bars/toggle change is both simple and fast enough.
  useEffect(() => {
    emaFastSeriesRef.current?.setData(emaFastData);
    emaSlowSeriesRef.current?.setData(emaSlowData);
    vwapSeriesRef.current?.setData(vwapData);
    if (bollingerData) {
      bbUpperSeriesRef.current?.setData(bollingerData.upper);
      bbMiddleSeriesRef.current?.setData(bollingerData.middle);
      bbLowerSeriesRef.current?.setData(bollingerData.lower);
    }
    rsiSeriesRef.current?.setData(rsiData);
    if (macdData) {
      macdHistSeriesRef.current?.setData(macdData.histogram);
      macdSeriesRef.current?.setData(macdData.macd);
      macdSignalSeriesRef.current?.setData(macdData.signal);
    }
  }, [emaFastData, emaSlowData, vwapData, bollingerData, rsiData, macdData, togglesKey]);

  useEffect(
    () => () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      smaSeriesRef.current = null;
      emaFastSeriesRef.current = null;
      emaSlowSeriesRef.current = null;
      vwapSeriesRef.current = null;
      bbUpperSeriesRef.current = null;
      bbMiddleSeriesRef.current = null;
      bbLowerSeriesRef.current = null;
      rsiSeriesRef.current = null;
      macdSeriesRef.current = null;
      macdSignalSeriesRef.current = null;
      macdHistSeriesRef.current = null;
    },
    [],
  );

  useEffect(() => {
    // lightweight-charts v5 removed ISeriesApi.setMarkers (moved to a plugin);
    // guard at runtime and access via a narrow cast so older builds still render.
    const candles = candleSeriesRef.current as
      | (typeof candleSeriesRef.current & { setMarkers?: (m: unknown[]) => void })
      | null;
    if (!candles || typeof candles.setMarkers !== 'function') return;
    candles.setMarkers(markers || []);
  }, [markers]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      <div ref={tooltipRef} className={tooltipClassName} />
    </div>
  );
}

export function TradingViewChart({
  bars,
  timeframe,
  height,
  theme = 'dark',
  markers,
  indicators = DEFAULT_INDICATOR_TOGGLES,
}: TradingViewChartProps) {
  // Only pin an explicit pixel height when the caller asks for one. Without it
  // the container flexes to fill the chart pane (flex-1) and the ResizeObserver
  // feeds the real size to the canvas — the chart owns its full pane.
  return (
    <MeasuredContainer className="w-full h-full flex-1 min-h-[320px] min-w-0" minWidth={280} minHeight={240} height={height}>
      {({ width, height }) => (
        <ChartCanvas
          width={width}
          height={height}
          bars={bars}
          timeframe={timeframe}
          theme={theme}
          markers={markers}
          indicators={indicators}
        />
      )}
    </MeasuredContainer>
  );
}
