'use client';

/**
 * DividendBarChart
 *
 * 토스 인베스트 "배당금 지급 내역" 차트 — 분기마다 1개의 보라색 세로 막대.
 *
 * x축: 배당락일 시계열 (옆으로 이동)
 * y축: 주당 배당금 (원)
 * 막대 색: 보라 (토스와 동일)
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { QuarterlyDividendPoint } from '@/lib/quarterly-dividend';

interface Props {
  readonly points: readonly QuarterlyDividendPoint[];
}

interface ChartDatum {
  readonly key: string;
  readonly label: string; // x축 표시 (예: '24년 1월')
  readonly fullDate: string; // tooltip용
  readonly dps: number;
}

export function DividendBarChart({ points }: Props) {
  // 시간순 정렬 (오래된 → 최신)
  const sorted = [...points].sort((a, b) =>
    a.exDividendDate.localeCompare(b.exDividendDate),
  );

  const data: ChartDatum[] = sorted.map((p) => ({
    key: `${p.year}-Q${p.quarter}`,
    label: formatXLabel(p.exDividendDate),
    fullDate: formatTooltipDate(p.exDividendDate),
    dps: p.dividendPerShare,
  }));

  if (data.length === 0) {
    return (
      <div className='border-border bg-card text-muted-foreground flex h-[300px] items-center justify-center rounded-xl border text-sm'>
        배당 데이터 없음
      </div>
    );
  }

  return (
    <div className='border-border bg-card rounded-xl border p-4'>
      <ResponsiveContainer width='100%' height={320}>
        <BarChart
          data={[...data]}
          margin={{ top: 16, right: 16, bottom: 24, left: 0 }}
          barCategoryGap='15%'
        >
          <CartesianGrid
            strokeDasharray='3 3'
            vertical={false}
            stroke='currentColor'
            strokeOpacity={0.1}
          />
          <XAxis
            dataKey='label'
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: 'currentColor', strokeOpacity: 0.2 }}
            interval={0}
            angle={-35}
            textAnchor='end'
            height={60}
          />
          <YAxis
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toLocaleString('ko-KR')}원`}
            width={70}
          />
          <Tooltip
            cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
            contentStyle={{
              backgroundColor: 'hsl(var(--card))',
              border: '1px solid hsl(var(--border))',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value) => {
              const n = typeof value === 'number' ? value : Number(value);
              return [
                `${(Number.isFinite(n) ? n : 0).toLocaleString('ko-KR')}원`,
                '주당배당금',
              ];
            }}
            labelFormatter={(_label, payload) => {
              const item = payload?.[0]?.payload as ChartDatum | undefined;
              return item?.fullDate ?? '';
            }}
          />
          <Bar
            dataKey='dps'
            fill='#a855f7'
            radius={[4, 4, 0, 0]}
            maxBarSize={20}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
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
