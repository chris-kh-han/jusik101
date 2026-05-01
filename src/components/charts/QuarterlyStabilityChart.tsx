'use client';

/**
 * QuarterlyStabilityChart
 *
 * 토스 인베스트 "안정성" 차트 — 총자본 + 총부채 막대 + 부채비율 라인.
 *
 * 시점 데이터 (재무상태표는 누적 X)이라 분기 그대로 사용.
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

interface Props {
  readonly title?: string;
  readonly subtitle?: string;
  readonly description?: string;
  readonly quarters: readonly QuarterlyDataPoint[];
}

const COLOR_EQUITY = '#0d9488'; // teal-600
const COLOR_DEBT = '#a7f3d0'; // teal-200
const COLOR_RATIO = '#f97316'; // orange-500

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

  // 차트용 데이터 변환
  const data = quarters.map((q) => ({
    label: q.label,
    totalEquity: q.totalEquity ?? undefined,
    totalLiabilities: q.totalLiabilities ?? undefined,
    debtRatio: q.debtRatio ?? undefined,
  }));

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
            <YAxis
              yAxisId='ratio'
              orientation='right'
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            />
            <Tooltip
              content={<StabilityTooltip />}
              cursor={{ fill: 'currentColor', fillOpacity: 0.05 }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
              iconType='circle'
              iconSize={8}
            />

            <Bar
              yAxisId='amount'
              dataKey='totalEquity'
              name='총자본'
              stackId='balance'
              fill={COLOR_EQUITY}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              yAxisId='amount'
              dataKey='totalLiabilities'
              name='총부채'
              stackId='balance'
              fill={COLOR_DEBT}
              radius={[4, 4, 0, 0]}
            />
            <Line
              yAxisId='ratio'
              type='monotone'
              dataKey='debtRatio'
              name='부채비율'
              stroke={COLOR_RATIO}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
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

function StabilityTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: readonly TooltipPayload[];
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className='border-border bg-card rounded-lg border p-3 shadow-lg'>
      <p className='mb-1.5 text-xs font-medium'>{label}</p>
      {payload.map((p) => {
        const isRate = p.dataKey === 'debtRatio';
        return (
          <div
            key={p.dataKey}
            className='flex items-center justify-between gap-4 text-sm'
          >
            <span className='inline-flex items-center gap-1.5'>
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
