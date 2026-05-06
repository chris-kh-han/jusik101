'use client';

/**
 * DividendBarChart (Visx 구현)
 *
 * 토스 인베스트 "배당금 지급 내역" 차트 — 분기마다 1개의 보라색 세로 막대.
 *
 * x축: 배당락일 시계열 (오래된 → 최신)
 * y축: 주당 배당금 (USD 또는 원)
 * 막대 색: 보라
 *
 * Visx 기반 — Recharts 대비 ~70% 작은 bundle.
 */

import { useMemo, useState } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { GridRows } from '@visx/grid';
import { Group } from '@visx/group';
import { ParentSize } from '@visx/responsive';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar } from '@visx/shape';
import type { QuarterlyDividendPoint } from '@/lib/quarterly-dividend';

interface Props {
  readonly points: readonly QuarterlyDividendPoint[];
}

interface ChartDatum {
  readonly key: string;
  readonly label: string;
  readonly fullDate: string;
  readonly dps: number;
}

const margin = { top: 16, right: 16, bottom: 36, left: 60 };
const HEIGHT = 300;
const BAR_COLOR = '#a855f7';

export function DividendBarChart({ points }: Props) {
  const data: ChartDatum[] = useMemo(() => {
    const sorted = [...points].sort((a, b) =>
      a.exDividendDate.localeCompare(b.exDividendDate),
    );
    return sorted.map((p) => ({
      key: `${p.year}-Q${p.quarter}`,
      label: formatXLabel(p.exDividendDate),
      fullDate: formatTooltipDate(p.exDividendDate),
      dps: p.dividendPerShare,
    }));
  }, [points]);

  if (data.length === 0) {
    return (
      <div className='border-border bg-card text-muted-foreground flex h-[320px] items-center justify-center rounded-xl border text-sm'>
        배당 데이터 없음
      </div>
    );
  }

  return (
    <div className='border-border bg-card rounded-xl border p-4'>
      <ParentSize>
        {({ width }) => (
          <ChartInner width={width} height={HEIGHT} data={data} />
        )}
      </ParentSize>
    </div>
  );
}

interface InnerProps {
  readonly width: number;
  readonly height: number;
  readonly data: readonly ChartDatum[];
}

function ChartInner({ width, height, data }: InnerProps) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);

  if (width === 0) return null;

  const xMax = Math.max(0, width - margin.left - margin.right);
  const yMax = Math.max(0, height - margin.top - margin.bottom);

  // 1년 단위 ticks (토스 스타일) — 분기마다 라벨이 너무 많아 막대 침범 방지
  const yearTicks = (() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const d of data) {
      const year = d.label.split(' ')[0]; // '22년'
      if (year && !seen.has(year)) {
        seen.add(year);
        out.push(d.label);
      }
    }
    return out;
  })();

  const maxDps = Math.max(...data.map((d) => d.dps), 0);
  const yDomainMax = maxDps > 0 ? maxDps * 1.15 : 1;

  const xScale = scaleBand({
    range: [0, xMax],
    domain: data.map((d) => d.label),
    padding: 0.3,
  });
  const yScale = scaleLinear({
    range: [yMax, 0],
    domain: [0, yDomainMax],
    nice: true,
  });

  const hovered = data.find((d) => d.key === hoveredKey) ?? null;

  return (
    <div className='relative'>
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          <GridRows
            scale={yScale}
            width={xMax}
            stroke='currentColor'
            strokeOpacity={0.1}
            strokeDasharray='3 3'
            numTicks={5}
          />
          {data.map((d, i) => {
            const x = xScale(d.label) ?? 0;
            const barW = xScale.bandwidth();
            const y = yScale(d.dps);
            const barH = Math.max(0, yMax - y);
            const isHovered = hoveredKey === d.key;
            return (
              <Bar
                key={d.key}
                x={x}
                y={y}
                width={barW}
                height={barH}
                fill={BAR_COLOR}
                fillOpacity={isHovered ? 1 : 0.85}
                rx={4}
                onMouseEnter={() => setHoveredKey(d.key)}
                onMouseLeave={() => setHoveredKey(null)}
                style={{ cursor: 'pointer' }}
              />
            );
          })}
          <AxisBottom
            top={yMax}
            scale={xScale}
            stroke='currentColor'
            tickStroke='transparent'
            tickValues={yearTicks}
            tickLabelProps={{
              fontSize: 11,
              fill: 'currentColor',
              fillOpacity: 0.7,
              textAnchor: 'middle',
              dy: '0.6em',
            }}
          />
          <AxisLeft
            scale={yScale}
            stroke='transparent'
            tickStroke='transparent'
            numTicks={5}
            tickFormat={(v) => formatTickValue(Number(v))}
            tickLabelProps={{
              fontSize: 11,
              fill: 'currentColor',
              fillOpacity: 0.6,
              textAnchor: 'end',
              dx: -4,
              dy: 4,
            }}
          />
        </Group>
      </svg>

      {hovered && (
        <div
          className='border-border bg-card pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-md'
          style={{ minWidth: 140 }}
        >
          <div className='text-muted-foreground'>{hovered.fullDate}</div>
          <div className='font-semibold'>
            {hovered.dps >= 1
              ? hovered.dps.toLocaleString('en-US')
              : hovered.dps.toFixed(2)}{' '}
            <span className='text-muted-foreground font-normal'>
              주당배당금
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTickValue(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(0)}K`;
  if (Math.abs(v) >= 1) return v.toFixed(0);
  return v.toFixed(2);
}

/** '2024-12-27' → '24년 12월' */
function formatXLabel(iso: string): string {
  if (iso.length < 10) return iso;
  const yy = iso.slice(2, 4);
  const mm = parseInt(iso.slice(5, 7), 10);
  return `${yy}년 ${mm}월`;
}

/** '2024-12-27' → '2024년 12월 27일' */
function formatTooltipDate(iso: string): string {
  if (iso.length < 10) return iso;
  const yyyy = iso.slice(0, 4);
  const mm = parseInt(iso.slice(5, 7), 10);
  const dd = parseInt(iso.slice(8, 10), 10);
  return `${yyyy}년 ${mm}월 ${dd}일`;
}
