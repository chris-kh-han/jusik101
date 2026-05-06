'use client';

/**
 * FinancialStatementTable
 *
 * TradingView 스타일 재무제표 표 (Income Statement 우선, BS/CF 추후).
 *
 * UI:
 *   - 좌측 sticky 컬럼: 행 라벨 (Total revenue, Gross profit ...)
 *   - 가로 스크롤: 분기 또는 연간 시계열
 *   - 우측 끝: TTM (분기 모드만)
 *   - Annual / Quarterly 토글
 *   - 검색 (행 라벨 필터)
 *   - YoY growth 부행 (선택적 표시)
 */

import { useMemo, useState } from 'react';
import type {
  FinancialFactRow,
  FactsTable,
} from '@/lib/us-financial-facts-utils';
import {
  buildFactsTable,
  calculateTtmColumn,
} from '@/lib/us-financial-facts-utils';

interface Props {
  readonly facts: readonly FinancialFactRow[];
  readonly title: string;
}

type Mode = 'quarterly' | 'annual';

export function FinancialStatementTable({ facts, title }: Props) {
  const [mode, setMode] = useState<Mode>('quarterly');
  const [searchQuery, setSearchQuery] = useState('');

  const table: FactsTable = useMemo(
    () => buildFactsTable(facts, mode, mode === 'quarterly' ? 16 : 8),
    [facts, mode],
  );

  const ttmMap = useMemo(
    () => (mode === 'quarterly' ? calculateTtmColumn(facts) : null),
    [facts, mode],
  );

  // 검색 필터 (행 라벨 case-insensitive)
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return table.rows;
    return table.rows.filter(
      (r) =>
        r.display_label.toLowerCase().includes(q) ||
        r.account_name.toLowerCase().includes(q),
    );
  }, [table.rows, searchQuery]);

  if (table.rows.length === 0) {
    return (
      <section>
        <h2 className='text-xl font-bold'>{title}</h2>
        <div className='text-muted-foreground border-border bg-card mt-3 flex h-48 items-center justify-center rounded-xl border text-sm'>
          데이터 없음 — sync 필요
        </div>
      </section>
    );
  }

  return (
    <section>
      {/* 헤더: 제목 + 토글 + 검색 */}
      <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-xl font-bold'>{title}</h2>
        <div className='flex items-center gap-2'>
          <input
            type='text'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder='검색...'
            className='border-border bg-card w-32 rounded-lg border px-3 py-1.5 text-sm'
          />
          <div className='border-border bg-card inline-flex overflow-hidden rounded-lg border'>
            <ToggleButton
              active={mode === 'annual'}
              onClick={() => setMode('annual')}
              label='Annual'
            />
            <ToggleButton
              active={mode === 'quarterly'}
              onClick={() => setMode('quarterly')}
              label='Quarterly'
            />
          </div>
        </div>
      </div>

      {/* 표 */}
      <div className='border-border bg-card overflow-x-auto rounded-xl border'>
        <table className='min-w-full text-sm'>
          <thead className='bg-muted/40 text-muted-foreground'>
            <tr>
              <th className='bg-card sticky left-0 z-10 px-4 py-3 text-left text-xs font-medium'>
                Currency: USD
              </th>
              {table.columns.map((c) => (
                <th
                  key={c.period_end}
                  className='px-3 py-3 text-right text-xs font-medium whitespace-pre'
                >
                  {c.label}
                </th>
              ))}
              {ttmMap && (
                <th className='px-3 py-3 text-right text-xs font-medium'>
                  TTM
                </th>
              )}
            </tr>
          </thead>
          <tbody className='[&>tr]:border-border [&>tr:not(:last-child)]:border-b'>
            {filteredRows.map((row) => {
              const ttmVal = ttmMap?.get(row.account_name);
              return (
                <tr key={row.account_name} className='hover:bg-muted/40'>
                  <td className='bg-card sticky left-0 z-10 px-4 py-2.5'>
                    <div className='font-medium'>{row.display_label}</div>
                  </td>
                  {table.columns.map((c) => {
                    const v = row.values.get(c.period_end);
                    return (
                      <td
                        key={c.period_end}
                        className='px-3 py-2.5 text-right tabular-nums'
                      >
                        {formatValue(v ?? null, row.account_name)}
                      </td>
                    );
                  })}
                  {ttmMap && (
                    <td className='px-3 py-2.5 text-right font-medium tabular-nums'>
                      {formatValue(ttmVal ?? null, row.account_name)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredRows.length === 0 && searchQuery && (
        <p className='text-muted-foreground mt-2 text-center text-sm'>
          "{searchQuery}" 검색 결과 없음
        </p>
      )}
    </section>
  );
}

interface ToggleProps {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly label: string;
}

function ToggleButton({ active, onClick, label }: ToggleProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-foreground text-background' : 'hover:bg-muted'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * 값 포맷:
 *   - EPS / shares 항목: 소수점 2자리 또는 정수
 *   - 나머지: $1.5B / $95.4M / $-3.94B 단위
 */
function formatValue(value: number | null, accountName: string): string {
  if (value === null || !Number.isFinite(value)) return '-';

  // EPS는 작은 값 ($0.26 등)
  if (accountName.includes('Eps')) {
    return value.toFixed(2);
  }
  // Shares outstanding은 큰 값 (16B shares 등) — Billion 표기
  if (accountName.includes('Shares')) {
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    return value.toLocaleString('en-US');
  }

  // 일반 금액 (USD)
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1e12) return `${sign}${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(2)}K`;
  return `${sign}${abs.toFixed(0)}`;
}
