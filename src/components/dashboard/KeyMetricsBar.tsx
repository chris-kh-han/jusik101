import type { FinancialItem } from '@/types/financial';
import { formatKoreanCurrency, formatChangeRate } from '@/lib/financial-utils';
import { findAccountAmount, findPreviousAmount } from '@/lib/data-transform';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface KeyMetricsBarProps {
  readonly items: readonly FinancialItem[];
}

const METRICS = [
  { accountName: '매출액', label: '매출' },
  { accountName: '영업이익', label: '영업이익' },
  { accountName: '당기순이익', label: '순이익' },
] as const;

export function KeyMetricsBar({ items }: KeyMetricsBarProps) {
  return (
    <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
      {METRICS.map(({ accountName, label }) => {
        const current = findAccountAmount(items, accountName);
        const previous = findPreviousAmount(items, accountName);
        const change = formatChangeRate(current, previous);

        return (
          <div
            key={accountName}
            className='border-border bg-card rounded-xl border p-4'
          >
            <p className='text-muted-foreground text-sm'>{label}</p>
            <p className='mt-1 text-2xl font-bold'>
              {formatKoreanCurrency(current)}
            </p>
            <div className='mt-1 flex items-center gap-1'>
              <DirectionIcon direction={change.direction} />
              <span
                className={`text-sm font-medium ${directionColor(change.direction)}`}
              >
                {change.formatted}
              </span>
              <span className='text-muted-foreground text-xs'>전년 대비</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DirectionIcon({
  direction,
}: {
  readonly direction: 'up' | 'down' | 'flat';
}) {
  switch (direction) {
    case 'up':
      return <TrendingUp className='h-4 w-4 text-emerald-500' />;
    case 'down':
      return <TrendingDown className='h-4 w-4 text-red-500' />;
    case 'flat':
      return <Minus className='text-muted-foreground h-4 w-4' />;
  }
}

function directionColor(direction: 'up' | 'down' | 'flat'): string {
  switch (direction) {
    case 'up':
      return 'text-emerald-500';
    case 'down':
      return 'text-red-500';
    case 'flat':
      return 'text-muted-foreground';
  }
}
