'use client';

/**
 * QuarterlyBarLineChart
 *
 * 토스 인베스트의 "수익성", "성장성" 차트 스타일 — 막대 + 선 조합.
 *
 * 사용처:
 *   1. 수익성: barField='revenue', lineField='netIncome', secondaryLineField='netMargin'
 *   2. 성장성: barField='operatingProfit', lineField='operatingMargin'
 */

import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';
import type { QuarterlyDataPoint } from '@/lib/quarterly-utils';
import { formatKoreanCurrency } from '@/lib/financial-utils';

interface ChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly description?: string; // 차트 위 한 줄 인사이트 (예: "직전 분기 대비 +14% 성장")
  readonly quarters: readonly QuarterlyDataPoint[];
  /** 막대로 표시할 필드 (금액) */
  readonly primaryBar:
    | { field: 'revenue'; label: string; color: string }
    | { field: 'operatingProfit'; label: string; color: string }
    | { field: 'netIncome'; label: string; color: string };
  /** 보조 막대 (선택) — 막대 그룹으로 표시 */
  readonly secondaryBar?:
    | { field: 'revenue'; label: string; color: string }
    | { field: 'operatingProfit'; label: string; color: string }
    | { field: 'netIncome'; label: string; color: string };
  /** 우측 Y축 라인 (% 비율) */
  readonly rateLine?:
    | { field: 'netMargin'; label: string; color: string }
    | { field: 'operatingMargin'; label: string; color: string }
    | { field: 'debtRatio'; label: string; color: string };
}

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

  // 차트 데이터 — null은 undefined로 (Recharts는 null도 빈 점으로 처리하지만 명시적으로)
  const data = quarters.map((q) => ({
    label: q.label,
    [primaryBar.field]: q[primaryBar.field] ?? undefined,
    ...(secondaryBar
      ? { [secondaryBar.field]: q[secondaryBar.field] ?? undefined }
      : {}),
    ...(rateLine ? { [rateLine.field]: q[rateLine.field] ?? undefined } : {}),
  }));

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
        <ResponsiveContainer width='100%' height={280}>
          <ComposedChart
            data={data}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray='3 3'
              vertical={false}
              stroke='currentColor'
              className='text-border'
            />
            <XAxis
              dataKey='label'
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId='amount'
              orientation='left'
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) =>
                v === 0 ? '0' : formatKoreanCurrency(v).replace('원', '')
              }
            />
            {rateLine && (
              <YAxis
                yAxisId='rate'
                orientation='right'
                fontSize={11}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
            )}
            <Tooltip
              content={
                <CustomTooltip
                  primaryBar={primaryBar}
                  secondaryBar={secondaryBar}
                  rateLine={rateLine}
                />
              }
              cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType='circle'
              iconSize={8}
            />

            <Bar
              yAxisId='amount'
              dataKey={primaryBar.field}
              name={primaryBar.label}
              fill={primaryBar.color}
              radius={[4, 4, 0, 0]}
              barSize={20}
            />

            {secondaryBar && (
              <Bar
                yAxisId='amount'
                dataKey={secondaryBar.field}
                name={secondaryBar.label}
                fill={secondaryBar.color}
                radius={[4, 4, 0, 0]}
                barSize={20}
                fillOpacity={0.55}
              />
            )}

            {rateLine && (
              <Line
                yAxisId='rate'
                type='monotone'
                dataKey={rateLine.field}
                name={rateLine.label}
                stroke={rateLine.color}
                strokeWidth={2}
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

interface TooltipPayload {
  readonly name: string;
  readonly value: number;
  readonly dataKey: string;
  readonly color: string;
}

interface TooltipProps {
  readonly active?: boolean;
  readonly payload?: readonly TooltipPayload[];
  readonly label?: string;
  readonly primaryBar: ChartProps['primaryBar'];
  readonly secondaryBar?: ChartProps['secondaryBar'];
  readonly rateLine?: ChartProps['rateLine'];
}

function CustomTooltip({ active, payload, label, rateLine }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className='border-border bg-card rounded-lg border p-3 shadow-lg'>
      <p className='mb-1.5 text-xs font-medium'>{label}</p>
      {payload.map((p) => {
        const isRate = rateLine && p.dataKey === rateLine.field;
        return (
          <div
            key={p.dataKey}
            className='flex items-center justify-between gap-4 text-sm'
          >
            <span
              className='inline-flex items-center gap-1.5'
              style={{ color: p.color }}
            >
              <span
                className='h-2 w-2 rounded-full'
                style={{ backgroundColor: p.color }}
              />
              <span className='text-foreground'>{p.name}</span>
            </span>
            <span className='font-medium tabular-nums'>
              {isRate
                ? `${p.value.toFixed(2)}%`
                : formatKoreanCurrency(p.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
