'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import type { GroupedStatements } from '@/types/financial';

const StackedBarChart = dynamic(
  () =>
    import('@/components/charts/StackedBarChart').then(
      (mod) => mod.StackedBarChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const WaterfallChart = dynamic(
  () =>
    import('@/components/charts/WaterfallChart').then(
      (mod) => mod.WaterfallChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

const CashFlowChart = dynamic(
  () =>
    import('@/components/charts/CashFlowChart').then(
      (mod) => mod.CashFlowChart,
    ),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

type Tab = 'balance' | 'income' | 'cashflow';

const TABS: readonly { readonly key: Tab; readonly label: string }[] = [
  { key: 'balance', label: '재무상태표' },
  { key: 'income', label: '손익계산서' },
  { key: 'cashflow', label: '현금흐름표' },
];

interface DashboardChartsProps {
  readonly statements: GroupedStatements;
}

export function DashboardCharts({ statements }: DashboardChartsProps) {
  const [activeTab, setActiveTab] = useState<Tab>('balance');

  return (
    <div className='border-border bg-card rounded-2xl border'>
      {/* 탭 네비게이션 */}
      <div className='border-border flex border-b'>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'border-primary text-primary border-b-2'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 차트 영역 */}
      <div className='p-6'>
        {activeTab === 'balance' && (
          <StackedBarChart items={statements.balanceSheet} />
        )}
        {activeTab === 'income' && (
          <WaterfallChart items={statements.incomeStatement} />
        )}
        {activeTab === 'cashflow' && (
          <CashFlowChart items={statements.cashFlow} />
        )}
      </div>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className='flex h-64 items-center justify-center'>
      <div className='bg-muted h-full w-full animate-pulse rounded' />
    </div>
  );
}
