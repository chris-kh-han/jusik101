'use client';

/**
 * QuarterlyStabilityChart (Visx 구현)
 *
 * 토스 스타일 — 총자본 + 총부채 stacked bar + 부채비율 line.
 */

import { useMemo, useState } from 'react';
import { AxisBottom, AxisLeft, AxisRight } from '@visx/axis';
import { curveMonotoneX } from '@visx/curve';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar, LinePath } from '@visx/shape';
import type { QuarterlyDataPoint } from '@/lib/quarterly-utils';
import { formatKoreanCurrency } from '@/lib/financial-utils';

interface Props {
  readonly title?: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly quarters: readonly QuarterlyDataPoint[];
}

const COLOR_EQUITY = '#0d9488';
const COLOR_DEBT = '#a7f3d0';
const COLOR_RATIO = '#f97316';

const margin = { top: 16, right: 56, bottom: 28, left: 56 };
const HEIGHT = 280;

export function QuarterlyStabilityChart({
  title = '안정성',
  subtitle = '부채·유동·이자보상비율',
  description,
  quarters,
}: Props) {
  if (quarters.length === 0) {
    return (
      <section>
        <h2 className='text-xl font-bold'>{title}</h2>
        <p className='text-muted-foreground text-sm'>{subtitle}</p>
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
        <span className='text-muted-foreground text-xs'>{subtitle}</span>
      </div>
      {description && (
        <p className='text-muted-foreground mb-4 text-sm'>{description}</p>
      )}

      <div className='border-border bg-card rounded-xl border p-4'>
        <ParentSize>
          {({ width }) => (
            <ChartInner width={width} height={HEIGHT} quarters={quarters} />
          )}
        </ParentSize>

        <div className='mt-3 flex flex-wrap items-center gap-3 text-xs'>
          <Legend color={COLOR_EQUITY} label='총자본' />
          <Legend color={COLOR_DEBT} label='총부채' />
          <Legend color={COLOR_RATIO} label='부채비율' isLine />
        </div>
      </div>
    </section>
  );
}

interface InnerProps {
  readonly width: number;
  readonly height: number;
  readonly quarters: readonly QuarterlyDataPoint[];
}

function ChartInner({ width, height, quarters }: InnerProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const data = useMemo(
    () =>
      quarters.map((q, i) => ({
        i,
        label: q.label,
        equity: q.totalEquity ?? null,
        debt: q.totalLiabilities ?? null,
        ratio: q.debtRatio ?? null,
        total: (q.totalEquity ?? 0) + (q.totalLiabilities ?? 0) || null,
      })),
    [quarters],
  );

  if (width === 0) return null;

  const xMax = Math.max(0, width - margin.left - margin.right);
  const yMax = Math.max(0, height - margin.top - margin.bottom);

  const stackedMax = Math.max(...data.map((d) => d.total ?? 0), 0);
  const yScaleAmount = scaleLinear({
    range: [yMax, 0],
    domain: [0, stackedMax * 1.1 || 1],
    nice: true,
  });

  const ratioVals = data
    .map((d) => d.ratio)
    .filter((v): v is number => v !== null && v !== undefined);
  const ratioMin = ratioVals.length ? Math.min(...ratioVals, 0) : 0;
  const ratioMax = ratioVals.length ? Math.max(...ratioVals, 100) : 100;
  const ratioPad = (ratioMax - ratioMin) * 0.2 || 10;
  const yScaleRatio = scaleLinear({
    range: [yMax, 0],
    domain: [ratioMin - ratioPad, ratioMax + ratioPad],
    nice: true,
  });

  const xScale = scaleBand({
    range: [0, xMax],
    domain: data.map((d) => d.label),
    padding: 0.3,
  });
  const barWidth = xScale.bandwidth();

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

          {/* Stacked bars: equity (bottom) + debt (top) */}
          {data.map((d) => {
            const x = xScale(d.label) ?? 0;
            const equity = d.equity ?? 0;
            const debt = d.debt ?? 0;
            const equityHeight = equity > 0 ? yMax - yScaleAmount(equity) : 0;
            const debtHeight = debt > 0 ? yMax - yScaleAmount(debt) : 0;
            const equityY = yMax - equityHeight;
            const debtY = equityY - debtHeight;
            return (
              <Group
                key={d.i}
                onMouseEnter={() => setHoveredIdx(d.i)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{ cursor: 'pointer' }}
              >
                {/* equity (bottom) */}
                {equity > 0 && (
                  <Bar
                    x={x}
                    y={equityY}
                    width={barWidth}
                    height={equityHeight}
                    fill={COLOR_EQUITY}
                  />
                )}
                {/* debt (on top) */}
                {debt > 0 && (
                  <Bar
                    x={x}
                    y={debtY}
                    width={barWidth}
                    height={debtHeight}
                    fill={COLOR_DEBT}
                    rx={3}
                  />
                )}
              </Group>
            );
          })}

          {/* Ratio line */}
          {ratioVals.length > 0 && (
            <>
              <LinePath
                data={data.filter((d) => d.ratio !== null)}
                x={(d) => (xScale(d.label) ?? 0) + barWidth / 2}
                y={(d) => yScaleRatio(d.ratio as number)}
                stroke={COLOR_RATIO}
                strokeWidth={2}
                curve={curveMonotoneX}
              />
              {data.map((d) =>
                d.ratio !== null ? (
                  <circle
                    key={`r-${d.i}`}
                    cx={(xScale(d.label) ?? 0) + barWidth / 2}
                    cy={yScaleRatio(d.ratio)}
                    r={3}
                    fill={COLOR_RATIO}
                  />
                ) : null,
              )}
            </>
          )}

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
          <AxisRight
            left={xMax}
            scale={yScaleRatio}
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
        </Group>
      </svg>

      {hoveredIdx !== null && data[hoveredIdx] && (
        <Tooltip point={data[hoveredIdx]} />
      )}
    </div>
  );
}

function Tooltip({
  point,
}: {
  readonly point: {
    readonly label: string;
    readonly equity: number | null;
    readonly debt: number | null;
    readonly ratio: number | null;
  };
}) {
  return (
    <div
      className='border-border bg-card pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-md'
      style={{ minWidth: 160 }}
    >
      <div className='text-muted-foreground mb-1'>{point.label}</div>
      <Row
        color={COLOR_EQUITY}
        label='총자본'
        value={point.equity !== null ? formatKoreanCurrency(point.equity) : '-'}
      />
      <Row
        color={COLOR_DEBT}
        label='총부채'
        value={point.debt !== null ? formatKoreanCurrency(point.debt) : '-'}
      />
      <Row
        color={COLOR_RATIO}
        label='부채비율'
        value={point.ratio !== null ? `${point.ratio.toFixed(2)}%` : '-'}
      />
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

function Legend({
  color,
  label,
  isLine,
}: {
  readonly color: string;
  readonly label: string;
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
          style={{ backgroundColor: color }}
        />
      )}
      <span className='text-muted-foreground'>{label}</span>
    </span>
  );
}
