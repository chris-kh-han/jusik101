'use client';

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { FinancialItem } from '@/types/financial';
import { findAccountAmount } from '@/lib/data-transform';
import { formatKoreanCurrency } from '@/lib/financial-utils';
import { getSimpleName, getDescription } from '@/constants/accounts';

interface StackedBarChartProps {
  readonly items: readonly FinancialItem[];
}

const COLORS = {
  assets: '#3b82f6',
  liabilities: '#ef4444',
  equity: '#22c55e',
} as const;

export function StackedBarChart({ items }: StackedBarChartProps) {
  const totalAssets = findAccountAmount(items, '자산총계');
  const totalLiabilities = findAccountAmount(items, '부채총계');
  const totalEquity = findAccountAmount(items, '자본총계');

  if (totalAssets === 0 && totalLiabilities === 0 && totalEquity === 0) {
    return <EmptyState />;
  }

  const data = [
    {
      name: getSimpleName('자산총계'),
      value: totalAssets,
      originalName: '자산총계',
      color: COLORS.assets,
    },
    {
      name: getSimpleName('부채총계'),
      value: totalLiabilities,
      originalName: '부채총계',
      color: COLORS.liabilities,
    },
    {
      name: getSimpleName('자본총계'),
      value: totalEquity,
      originalName: '자본총계',
      color: COLORS.equity,
    },
  ];

  const equityRatio =
    totalAssets > 0 ? Math.round((totalEquity / totalAssets) * 100) : 0;

  return (
    <div>
      <h3 className='mb-1 text-base font-semibold'>재무상태표</h3>
      <p className='text-muted-foreground mb-4 text-sm'>
        자산 = 부채 + 자본 (자기자본비율: {equityRatio}%)
      </p>

      <ResponsiveContainer width='100%' height={200}>
        <BarChart data={data} layout='vertical' margin={{ left: 20 }}>
          <XAxis
            type='number'
            tickFormatter={(v: number) => formatKoreanCurrency(v)}
            fontSize={12}
          />
          <YAxis type='category' dataKey='name' width={120} fontSize={12} />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ fill: 'transparent' }}
          />
          <Bar dataKey='value' radius={[0, 4, 4, 0]} barSize={32}>
            {data.map((entry) => (
              <Cell key={entry.originalName} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* 초보자 설명 */}
      <div className='bg-muted/50 text-muted-foreground mt-4 rounded-lg p-3 text-sm'>
        {equityRatio >= 60
          ? `자산 중 ${equityRatio}%가 자기 돈(자본)이에요. 빚 비율이 낮아서 재무가 안정적입니다.`
          : equityRatio >= 40
            ? `자기자본비율이 ${equityRatio}%로 보통 수준이에요.`
            : `자기자본비율이 ${equityRatio}%로 빚이 많은 편이에요. 재무 안정성에 주의가 필요합니다.`}
      </div>
    </div>
  );
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { originalName: string; value: number } }>;
}) {
  if (!active || !payload?.[0]) return null;

  const { originalName, value } = payload[0].payload;
  const description = getDescription(originalName);

  return (
    <div className='border-border bg-card rounded-lg border p-3 shadow-lg'>
      <p className='font-medium'>{originalName}</p>
      <p className='text-lg font-bold'>{formatKoreanCurrency(value)}</p>
      {description && (
        <p className='text-muted-foreground mt-1 max-w-xs text-xs'>
          {description}
        </p>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className='text-muted-foreground flex h-48 items-center justify-center text-sm'>
      재무상태표 데이터가 없습니다
    </div>
  );
}
