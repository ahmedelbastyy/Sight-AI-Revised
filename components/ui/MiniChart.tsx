import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import Svg, { Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useApp } from '../../contexts/AppContext';
import { fetchChartForPeriod } from '../../services/stockService';

interface MiniChartProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showGradient?: boolean;
}

export function MiniChart({ data, width = 80, height = 32, color, showGradient = true }: MiniChartProps) {
  if (!data || data.length < 2) return null;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = color || (isPositive ? '#10B981' : '#EF4444');

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((val, i) => ({
    x: (i / (data.length - 1)) * width,
    y: padding + ((max - val) / range) * (height - padding * 2),
  }));

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) / 3;
    const cp1y = points[i - 1].y;
    const cp2x = points[i].x - (points[i].x - points[i - 1].x) / 3;
    const cp2y = points[i].y;
    linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${points[i].x} ${points[i].y}`;
  }

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={`grad-${lineColor.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={lineColor} stopOpacity="0.3" />
          <Stop offset="1" stopColor={lineColor} stopOpacity="0" />
        </LinearGradient>
      </Defs>
      {showGradient ? (
        <Path d={areaPath} fill={`url(#grad-${lineColor.replace('#', '')})`} />
      ) : null}
      <Path d={linePath} stroke={lineColor} strokeWidth={1.5} fill="none" />
    </Svg>
  );
}

// Hook to fetch 1D chart data for a ticker (used by StockCard)
const dayChartCache = new Map<string, { data: number[]; timestamp: number }>();
const DAY_CHART_TTL = 60000; // 1 minute cache

export function useDayChartData(ticker: string): number[] {
  const [data, setData] = useState<number[]>([]);

  useEffect(() => {
    let cancelled = false;
    const cached = dayChartCache.get(ticker);
    if (cached && Date.now() - cached.timestamp < DAY_CHART_TTL) {
      setData(cached.data);
      return;
    }
    fetchChartForPeriod(ticker, '1D').then(chartData => {
      if (cancelled) return;
      if (chartData.length > 2) {
        dayChartCache.set(ticker, { data: chartData, timestamp: Date.now() });
        setData(chartData);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ticker]);

  return data;
}

interface LargeChartProps {
  data: number[];
  width: number;
  height: number;
  color?: string;
}

export function LargeChart({ data, width, height, color }: LargeChartProps) {
  const { currentTheme: t } = useApp();
  if (!data || data.length < 2) return null;

  const isPositive = data[data.length - 1] >= data[0];
  const lineColor = color || (isPositive ? t.bullish : t.bearish);

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padY = 16;
  // Reserve right side for labels
  const labelWidth = 52;
  const padX = 4;

  const chartWidth = Math.max(1, width - labelWidth);
  const effectiveWidth = chartWidth - padX * 2;
  const effectiveHeight = height - padY * 2;

  const points = data.map((val, i) => ({
    x: padX + (i / (data.length - 1)) * effectiveWidth,
    y: padY + ((max - val) / range) * effectiveHeight,
  }));

  let linePath = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const cp1x = points[i - 1].x + (points[i].x - points[i - 1].x) / 3;
    const cp1y = points[i - 1].y;
    const cp2x = points[i].x - (points[i].x - points[i - 1].x) / 3;
    const cp2y = points[i].y;
    linePath += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${points[i].x} ${points[i].y}`;
  }

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height} L ${points[0].x} ${height} Z`;

  // Grid lines
  const gridLines = [];
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = padY + (i / gridCount) * effectiveHeight;
    const value = max - (i / gridCount) * range;
    gridLines.push({ y, value });
  }

  return (
    <View style={{ flexDirection: 'row' }}>
      <Svg width={chartWidth} height={height}>
        <Defs>
          <LinearGradient id="largeGrad" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={lineColor} stopOpacity="0.2" />
            <Stop offset="1" stopColor={lineColor} stopOpacity="0.01" />
          </LinearGradient>
        </Defs>
        {gridLines.map((line, i) => (
          <Path
            key={i}
            d={`M ${padX} ${line.y} L ${chartWidth - padX} ${line.y}`}
            stroke={t.border}
            strokeWidth={0.5}
            strokeDasharray="4,4"
          />
        ))}
        <Path d={areaPath} fill="url(#largeGrad)" />
        <Path d={linePath} stroke={lineColor} strokeWidth={2} fill="none" />
      </Svg>
      <View style={{ width: labelWidth, justifyContent: 'space-between', paddingVertical: padY - 6 }}>
        {gridLines.map((line, i) => (
          <Text key={i} style={{ fontSize: 10, color: t.textTertiary, fontWeight: '500', textAlign: 'right', paddingRight: 4 }}>
            ${line.value.toFixed(0)}
          </Text>
        ))}
      </View>
    </View>
  );
}
