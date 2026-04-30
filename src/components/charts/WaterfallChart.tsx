'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { FinancialItem } from '@/types/financial';
import { findAccountAmount } from '@/lib/data-transform';
import { formatKoreanCurrency } from '@/lib/financial-utils';
import { getSimpleName } from '@/constants/accounts';

interface WaterfallChartProps {
  readonly items: readonly FinancialItem[];
}

interface WaterfallDataPoint {
  readonly name: string;
  readonly value: number;
  readonly base: number;
  readonly fill: string;
  readonly isTotal: boolean;
}

export function WaterfallChart({ items }: WaterfallChartProps) {
  const revenue = findAccountAmount(items, '매출액');
  const cogs = findAccountAmount(items, '매출원가');
  const grossProfit = findAccountAmount(items, '매출총이익');
  const sga = findAccountAmount(items, '판매비와관리비');
  const operatingIncome = findAccountAmount(items, '영업이익');
  const netIncome = findAccountAmount(items, '당기순이익');

  if (revenue === 0) {
    return (
      <div className='text-muted-foreground flex h-48 items-center justify-center text-sm'>
        손익계산서 데이터가 없습니다
      </div>
    );
  }

  const data: WaterfallDataPoint[] = buildWaterfallData(
    revenue,
    cogs,
    grossProfit,
    sga,
    operatingIncome,
    netIncome,
  );

  const operatingMargin =
    revenue > 0 ? Math.round((operatingIncome / revenue) * 100) : 0;

  return (
    <div>
      <h3 className='mb-1 text-base font-semibold'>손익계산서</h3>
      <p className='text-muted-foreground mb-4 text-sm'>
        매출에서 비용을 빼고 이익이 남는 과정 (영업이익률: {operatingMargin}%)
      </p>

      <ResponsiveContainer width='100%' height={280}>
        <BarChart data={data} margin={{ left: 10, right: 10 }}>
          <XAxis dataKey='name' fontSize={11} />
          <YAxis
            tickFormatter={(v: number) => formatKoreanCurrency(v)}
            fontSize={11}
          />
          <Tooltip
            content={<WaterfallTooltip />}
            cursor={{ fill: 'transparent' }}
          />
          <ReferenceLine y={0} stroke='#888' strokeDasharray='3 3' />
          {/* 투명 base 바 */}
          <Bar dataKey='base' stackId='waterfall' fill='transparent' />
          {/* 실제 값 바 */}
          <Bar dataKey='value' stackId='waterfall' radius={[4, 4, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className='bg-muted/50 text-muted-foreground mt-4 rounded-lg p-3 text-sm'>
        {operatingMargin > 15
          ? `영업이익률 ${operatingMargin}%로 본업에서 높은 수익을 내고 있어요.`
          : operatingMargin > 0
            ? `영업이익률 ${operatingMargin}%로 본업에서 수익을 내고 있어요.`
            : '영업에서 적자가 나고 있어 주의가 필요해요.'}
      </div>
    </div>
  );
}

function buildWaterfallData(
  revenue: number,
  cogs: number,
  grossProfit: number,
  sga: number,
  operatingIncome: number,
  netIncome: number,
): WaterfallDataPoint[] {
  const actualGross = grossProfit || revenue - Math.abs(cogs);
  const actualOp = operatingIncome || actualGross - Math.abs(sga);

  return [
    {
      name: getSimpleName('매출액'),
      value: revenue,
      base: 0,
      fill: '#3b82f6',
      isTotal: true,
    },
    {
      name: getSimpleName('매출원가'),
      value: -Math.abs(cogs),
      base: revenue,
      fill: '#ef4444',
      isTotal: false,
    },
    {
      name: getSimpleName('매출총이익'),
      value: actualGross,
      base: 0,
      fill: '#22c55e',
      isTotal: true,
    },
    {
      name: getSimpleName('판매비와관리비'),
      value: -Math.abs(sga),
      base: actualGross,
      fill: '#ef4444',
      isTotal: false,
    },
    {
      name: getSimpleName('영업이익'),
      value: actualOp,
      base: 0,
      fill: actualOp >= 0 ? '#22c55e' : '#ef4444',
      isTotal: true,
    },
    {
      name: getSimpleName('당기순이익'),
      value: netIncome,
      base: 0,
      fill: netIncome >= 0 ? '#10b981' : '#ef4444',
      isTotal: true,
    },
  ];
}

function WaterfallTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: WaterfallDataPoint;
  }>;
}) {
  if (!active || !payload?.[0]) return null;

  const { name, value, isTotal } = payload[0].payload;
  const displayValue = isTotal ? value : Math.abs(value);

  return (
    <div className='border-border bg-card rounded-lg border p-3 shadow-lg'>
      <p className='font-medium'>{name}</p>
      <p className='text-lg font-bold'>
        {!isTotal && value < 0 ? '-' : ''}
        {formatKoreanCurrency(displayValue)}
      </p>
    </div>
  );
}
