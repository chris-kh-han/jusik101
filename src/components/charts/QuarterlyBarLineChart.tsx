'use client';

/**
 * QuarterlyBarLineChart (Visx 구현)
 *
 * 토스 스타일 — primary bar (+ optional secondary bar) + rate line (우측 Y축).
 *
 * 사용처:
 *   1. 수익성: barField='revenue', secondaryBar='netIncome', rateLine='netMargin'
 *   2. 성장성: barField='operatingProfit', rateLine='operatingMargin'
 */

import { useMemo, useState } from 'react';
import { AxisBottom, AxisLeft, AxisRight } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar, LinePath } from '@visx/shape';
import { curveMonotoneX } from '@visx/curve';
import type { QuarterlyDataPoint } from '@/lib/quarterly-utils';
import { formatKoreanCurrency } from '@/lib/financial-utils';

type AmountField = 'revenue' | 'operatingProfit' | 'netIncome';
type RateField = 'netMargin' | 'operatingMargin' | 'debtRatio';

interface BarSpec {
  readonly field: AmountField;
  readonly label: string;
  readonly color: string;
}
interface LineSpec {
  readonly field: RateField;
  readonly label: string;
  readonly color: string;
}

interface ChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly quarters: readonly QuarterlyDataPoint[];
  readonly primaryBar: BarSpec;
  readonly secondaryBar?: BarSpec;
  readonly rateLine?: LineSpec;
}

const margin = { top: 16, right: 56, bottom: 28, left: 56 };
const HEIGHT = 280;

export function QuarterlyBarLineChart({
  title,
  subtitle,
  description,
  quarters,
  primaryBar,
  secondaryBar,
  rateLine,
}: ChartProps) {
  if (quarters.length === 0) {
    return (
      <section>
        <h2 className='text-xl font-bold'>{title}</h2>
        {subtitle && (
          <p className='text-muted-foreground text-sm'>{subtitle}</p>
        )}
        <div className='text-muted-foreground flex h-48 items-center justify-center text-sm'>
          분기 데이터가 없습니다
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className='mb-1 flex items-baseline justify-between gap-3'>
        <h2 className='text-xl font-bold'>{title}</h2>
        {subtitle && (
          <span className='text-muted-foreground text-xs'>{subtitle}</span>
        )}
      </div>

      {description && (
        <p className='text-muted-foreground mb-4 text-sm'>{description}</p>
      )}

      <div className='border-border bg-card rounded-xl border p-4'>
        <ParentSize>
          {({ width }) => (
            <ChartInner
              width={width}
              height={HEIGHT}
              quarters={quarters}
              primaryBar={primaryBar}
              secondaryBar={secondaryBar}
              rateLine={rateLine}
            />
          )}
        </ParentSize>

        {/* Legend */}
        <div className='mt-3 flex flex-wrap items-center gap-3 text-xs'>
          <LegendItem color={primaryBar.color} label={primaryBar.label} />
          {secondaryBar && (
            <LegendItem
              color={secondaryBar.color}
              label={secondaryBar.label}
              opacity={0.55}
            />
          )}
          {rateLine && (
            <LegendItem color={rateLine.color} label={rateLine.label} isLine />
          )}
        </div>
      </div>
    </section>
  );
}

interface InnerProps {
  readonly width: number;
  readonly height: number;
  readonly quarters: readonly QuarterlyDataPoint[];
  readonly primaryBar: BarSpec;
  readonly secondaryBar?: BarSpec;
  readonly rateLine?: LineSpec;
}

function ChartInner({
  width,
  height,
  quarters,
  primaryBar,
  secondaryBar,
  rateLine,
}: InnerProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const data = useMemo(
    () =>
      quarters.map((q, i) => ({
        i,
        label: q.label,
        primary: q[primaryBar.field],
        secondary: secondaryBar ? q[secondaryBar.field] : null,
        rate: rateLine ? q[rateLine.field] : null,
      })),
    [quarters, primaryBar.field, secondaryBar, rateLine],
  );

  if (width === 0) return null;

  const xMax = Math.max(0, width - margin.left - margin.right);
  const yMax = Math.max(0, height - margin.top - margin.bottom);

  // Y axis (amount) — primary + secondary 합쳐서 max
  const amountVals = data.flatMap((d) =>
    [d.primary, d.secondary].filter(
      (v): v is number => v !== null && v !== undefined,
    ),
  );
  const amountMax = amountVals.length ? Math.max(...amountVals, 0) : 1;
  const yScaleAmount = scaleLinear({
    range: [yMax, 0],
    domain: [0, amountMax * 1.15 || 1],
    nice: true,
  });

  // Y axis (rate)
  const rateVals = rateLine
    ? data
        .map((d) => d.rate)
        .filter((v): v is number => v !== null && v !== undefined)
    : [];
  const rateMin = rateVals.length ? Math.min(...rateVals, 0) : 0;
  const rateMax = rateVals.length ? Math.max(...rateVals, 0) : 1;
  const ratePad = (rateMax - rateMin) * 0.2 || 1;
  const yScaleRate = scaleLinear({
    range: [yMax, 0],
    domain: [rateMin - ratePad, rateMax + ratePad],
    nice: true,
  });

  // X axis (band)
  const xScale = scaleBand({
    range: [0, xMax],
    domain: data.map((d) => d.label),
    padding: 0.3,
  });
  const groupBandwidth = xScale.bandwidth();
  const numBars = secondaryBar ? 2 : 1;
  const barWidth = groupBandwidth / numBars;

  return (
    <div className='relative'>
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScaleAmount}
            width={xMax}
            stroke='currentColor'
            strokeOpacity={0.1}
            strokeDasharray='3 3'
            numTicks={5}
          />

          {/* Bars */}
          {data.map((d) => {
            const x0 = xScale(d.label) ?? 0;
            return (
              <Group key={d.i}>
                {d.primary !== null && d.primary !== undefined && (
                  <Bar
                    x={x0}
                    y={yScaleAmount(d.primary)}
                    width={barWidth}
                    height={yMax - yScaleAmount(d.primary)}
                    fill={primaryBar.color}
                    rx={3}
                    onMouseEnter={() => setHoveredIdx(d.i)}
                    onMouseLeave={() => setHoveredIdx(null)}
                  />
                )}
                {secondaryBar &&
                  d.secondary !== null &&
                  d.secondary !== undefined && (
                    <Bar
                      x={x0 + barWidth}
                      y={yScaleAmount(d.secondary)}
                      width={barWidth}
                      height={yMax - yScaleAmount(d.secondary)}
                      fill={secondaryBar.color}
                      fillOpacity={0.55}
                      rx={3}
                      onMouseEnter={() => setHoveredIdx(d.i)}
                      onMouseLeave={() => setHoveredIdx(null)}
                    />
                  )}
              </Group>
            );
          })}

          {/* Line */}
          {rateLine && rateVals.length > 0 && (
            <>
              <LinePath
                data={data.filter(
                  (d) => d.rate !== null && d.rate !== undefined,
                )}
                x={(d) => (xScale(d.label) ?? 0) + groupBandwidth / 2}
                y={(d) => yScaleRate(d.rate as number)}
                stroke={rateLine.color}
                strokeWidth={2}
                curve={curveMonotoneX}
              />
              {data.map((d) =>
                d.rate !== null && d.rate !== undefined ? (
                  <circle
                    key={`dot-${d.i}`}
                    cx={(xScale(d.label) ?? 0) + groupBandwidth / 2}
                    cy={yScaleRate(d.rate)}
                    r={3}
                    fill={rateLine.color}
                  />
                ) : null,
              )}
            </>
          )}

          {/* Axes */}
          <AxisBottom
            top={yMax}
            scale={xScale}
            stroke='currentColor'
            tickStroke='transparent'
            tickLabelProps={{
              fontSize: 10,
              fill: 'currentColor',
              fillOpacity: 0.6,
              textAnchor: 'middle',
              dy: '0.6em',
            }}
          />
          <AxisLeft
            scale={yScaleAmount}
            stroke='transparent'
            tickStroke='transparent'
            numTicks={5}
            tickFormat={(v) =>
              Number(v) === 0
                ? '0'
                : formatKoreanCurrency(Number(v)).replace('원', '')
            }
            tickLabelProps={{
              fontSize: 10,
              fill: 'currentColor',
              fillOpacity: 0.6,
              textAnchor: 'end',
              dx: -4,
              dy: 4,
            }}
          />
          {rateLine && (
            <AxisRight
              left={xMax}
              scale={yScaleRate}
              stroke='transparent'
              tickStroke='transparent'
              numTicks={5}
              tickFormat={(v) => `${Number(v).toFixed(0)}%`}
              tickLabelProps={{
                fontSize: 10,
                fill: 'currentColor',
                fillOpacity: 0.6,
                textAnchor: 'start',
                dx: 4,
                dy: 4,
              }}
            />
          )}
        </Group>
      </svg>

      {hoveredIdx !== null && data[hoveredIdx] && (
        <Tooltip
          point={data[hoveredIdx]}
          primaryBar={primaryBar}
          secondaryBar={secondaryBar}
          rateLine={rateLine}
        />
      )}
    </div>
  );
}

interface TooltipPropsLocal {
  readonly point: {
    readonly label: string;
    readonly primary: number | null;
    readonly secondary: number | null;
    readonly rate: number | null;
  };
  readonly primaryBar: BarSpec;
  readonly secondaryBar?: BarSpec;
  readonly rateLine?: LineSpec;
}

function Tooltip({
  point,
  primaryBar,
  secondaryBar,
  rateLine,
}: TooltipPropsLocal) {
  return (
    <div
      className='border-border bg-card pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-md'
      style={{ minWidth: 160 }}
    >
      <div className='text-muted-foreground mb-1'>{point.label}</div>
      <Row
        color={primaryBar.color}
        label={primaryBar.label}
        value={
          point.primary !== null ? formatKoreanCurrency(point.primary) : '-'
        }
      />
      {secondaryBar && (
        <Row
          color={secondaryBar.color}
          label={secondaryBar.label}
          value={
            point.secondary !== null
              ? formatKoreanCurrency(point.secondary)
              : '-'
          }
        />
      )}
      {rateLine && (
        <Row
          color={rateLine.color}
          label={rateLine.label}
          value={point.rate !== null ? `${point.rate.toFixed(2)}%` : '-'}
        />
      )}
    </div>
  );
}

function Row({
  color,
  label,
  value,
}: {
  readonly color: string;
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className='flex items-center justify-between gap-3'>
      <span className='inline-flex items-center gap-1.5'>
        <span
          className='inline-block h-2 w-2 rounded-full'
          style={{ backgroundColor: color }}
        />
        <span>{label}</span>
      </span>
      <span className='font-medium tabular-nums'>{value}</span>
    </div>
  );
}

function LegendItem({
  color,
  label,
  opacity = 1,
  isLine = false,
}: {
  readonly color: string;
  readonly label: string;
  readonly opacity?: number;
  readonly isLine?: boolean;
}) {
  return (
    <span className='inline-flex items-center gap-1.5'>
      {isLine ? (
        <span
          className='inline-block h-0.5 w-3'
          style={{ backgroundColor: color }}
        />
      ) : (
        <span
          className='inline-block h-2 w-2 rounded-sm'
          style={{ backgroundColor: color, opacity }}
        />
      )}
      <span className='text-muted-foreground'>{label}</span>
    </span>
  );
}
