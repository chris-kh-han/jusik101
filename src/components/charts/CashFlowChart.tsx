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

interface CashFlowChartProps {
  readonly items: readonly FinancialItem[];
}

const CASH_FLOW_ITEMS = [
  { accountName: '영업활동현금흐름', color: '#3b82f6' },
  { accountName: '투자활동현금흐름', color: '#f59e0b' },
  { accountName: '재무활동현금흐름', color: '#8b5cf6' },
] as const;

export function CashFlowChart({ items }: CashFlowChartProps) {
  const data = CASH_FLOW_ITEMS.map(({ accountName, color }) => ({
    name: getSimpleName(accountName),
    originalName: accountName,
    value: findAccountAmount(items, accountName),
    color,
  }));

  const allZero = data.every((d) => d.value === 0);

  if (allZero) {
    return (
      <div className='text-muted-foreground flex h-48 items-center justify-center text-sm'>
        현금흐름표 데이터가 없습니다
      </div>
    );
  }

  const operatingCF = data[0].value;
  const investingCF = data[1].value;

  return (
    <div>
      <h3 className='mb-1 text-base font-semibold'>현금흐름표</h3>
      <p className='text-muted-foreground mb-4 text-sm'>
        현금이 어디서 들어오고 어디로 나가는지
      </p>

      <ResponsiveContainer width='100%' height={220}>
        <BarChart data={data} margin={{ left: 10, right: 10 }}>
          <XAxis dataKey='name' fontSize={12} />
          <YAxis
            tickFormatter={(v: number) => formatKoreanCurrency(v)}
            fontSize={11}
          />
          <Tooltip
            content={<CashFlowTooltip />}
            cursor={{ fill: 'transparent' }}
          />
          <ReferenceLine y={0} stroke='#888' strokeDasharray='3 3' />
          <Bar dataKey='value' radius={[4, 4, 0, 0]} barSize={48}>
            {data.map((entry) => (
              <Cell key={entry.originalName} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      <div className='bg-muted/50 text-muted-foreground mt-4 rounded-lg p-3 text-sm'>
        {operatingCF > 0 && investingCF < 0
          ? '영업으로 번 돈을 투자에 쓰고 있어요. 건강한 현금흐름 패턴입니다.'
          : operatingCF < 0
            ? '영업에서 현금이 빠져나가고 있어요. 수익구조에 주의가 필요합니다.'
            : '현금흐름 패턴을 확인해보세요.'}
      </div>
    </div>
  );
}

function CashFlowTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload: { originalName: string; value: number };
  }>;
}) {
  if (!active || !payload?.[0]) return null;

  const { originalName, value } = payload[0].payload;

  return (
    <div className='border-border bg-card rounded-lg border p-3 shadow-lg'>
      <p className='font-medium'>{originalName}</p>
      <p className='text-lg font-bold'>{formatKoreanCurrency(value)}</p>
      <p className='text-muted-foreground text-xs'>
        {value > 0 ? '현금 유입' : '현금 유출'}
      </p>
    </div>
  );
}
