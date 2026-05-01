/**
 * InvestmentMetricsCards
 *
 * 토스 인베스트 "투자 지표" 섹션 — 가치평가 / 수익 / 배당 3개 그룹.
 *
 * 데이터 소스:
 *   - PER, PBR, EPS, BPS, ROE: OpenDART /fnlttSinglIndx (M210000 수익성지표)
 *   - 배당수익률, 주당배당금: /alotMatter
 *
 * Note: PSR은 OpenDART에 없음 (시총/매출 직접 계산하려면 시총 필요)
 *       PER, PBR도 일반적으로 시장가 기준 — DART는 회계상 값
 */

import type { ReactNode } from 'react';

export interface InvestmentMetrics {
  readonly per?: number | null; // 주가수익비율
  readonly pbr?: number | null; // 주가순자산비율
  readonly psr?: number | null; // 주가매출비율
  readonly eps?: number | null; // 주당순이익 (원)
  readonly bps?: number | null; // 주당순자산 (원)
  readonly roe?: number | null; // 자기자본이익률 (%)
  readonly dividendYield?: number | null; // 배당수익률 (%)
  readonly dividendPerShare?: number | null; // 주당 현금배당금 (원)
  readonly payoutRatio?: number | null; // 배당성향 (%)
}

/** 배당 다년치 (최신 → 과거 순) */
export interface DividendHistoryRow {
  readonly periodLabel: string; // '당기' | '전기' | '전전기'
  readonly dividendYield?: number | null;
  readonly dividendPerShare?: number | null;
  readonly payoutRatio?: number | null;
  readonly eps?: number | null;
}

interface Props {
  readonly metrics: InvestmentMetrics;
  readonly dividendHistory?: readonly DividendHistoryRow[];
}

export function InvestmentMetricsCards({ metrics, dividendHistory }: Props) {
  const hasValuation = anyDefined(metrics.per, metrics.pbr, metrics.psr);
  const hasIncome = anyDefined(metrics.eps, metrics.bps, metrics.roe);
  const hasDividend = anyDefined(
    metrics.dividendYield,
    metrics.dividendPerShare,
    metrics.payoutRatio,
  );

  if (!hasValuation && !hasIncome && !hasDividend) return null;

  const showHistory = dividendHistory && dividendHistory.length >= 2;

  return (
    <section>
      <h2 className='mb-1 text-xl font-bold'>투자 지표</h2>
      <p className='text-muted-foreground mb-4 text-xs'>
        OpenDART 기준 (시장가 반영 X — 회계상 값)
      </p>

      <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
        {hasValuation && (
          <Card title='가치평가'>
            <Row
              label='PER'
              tooltip='주가수익비율'
              value={formatX(metrics.per)}
            />
            <Row
              label='PBR'
              tooltip='주가순자산비율'
              value={formatX(metrics.pbr)}
            />
            <Row
              label='PSR'
              tooltip='주가매출비율'
              value={formatX(metrics.psr)}
            />
          </Card>
        )}

        {hasIncome && (
          <Card title='수익'>
            <Row
              label='EPS'
              tooltip='주당순이익'
              value={formatWon(metrics.eps)}
            />
            <Row
              label='BPS'
              tooltip='주당순자산'
              value={formatWon(metrics.bps)}
            />
            <Row
              label='ROE'
              tooltip='자기자본이익률'
              value={formatPercent(metrics.roe)}
            />
          </Card>
        )}

        {hasDividend && (
          <Card title='배당'>
            <Row
              label='배당수익률'
              value={formatPercent(metrics.dividendYield)}
            />
            <Row
              label='주당 배당금'
              value={formatWon(metrics.dividendPerShare)}
            />
            <Row label='배당성향' value={formatPercent(metrics.payoutRatio)} />
          </Card>
        )}
      </div>

      {showHistory && <DividendHistoryTable history={dividendHistory} />}
    </section>
  );
}

interface HistoryProps {
  readonly history: readonly DividendHistoryRow[];
}

function DividendHistoryTable({ history }: HistoryProps) {
  // 데이터 있는 행만
  const rows = history.filter(
    (r) =>
      r.dividendYield !== null ||
      r.dividendPerShare !== null ||
      r.payoutRatio !== null ||
      r.eps !== null,
  );
  if (rows.length === 0) return null;

  return (
    <div className='border-border bg-card mt-3 rounded-xl border p-4'>
      <h3 className='text-sm font-semibold'>배당 추이</h3>
      <p className='text-muted-foreground mt-0.5 mb-3 text-xs'>
        최근 3년 (당기 → 전전기)
      </p>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-border text-muted-foreground border-b'>
              <th className='py-2 text-left text-xs font-medium'>항목</th>
              {rows.map((r) => (
                <th
                  key={r.periodLabel}
                  className='py-2 text-right text-xs font-medium'
                >
                  {r.periodLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className='[&>tr]:border-border [&>tr:not(:last-child)]:border-b'>
            <HistoryRow
              label='주당 배당금'
              rows={rows}
              fmt={formatWon}
              field='dividendPerShare'
            />
            <HistoryRow
              label='배당수익률'
              rows={rows}
              fmt={formatPercent}
              field='dividendYield'
            />
            <HistoryRow
              label='배당성향'
              rows={rows}
              fmt={formatPercent}
              field='payoutRatio'
            />
            <HistoryRow
              label='주당 순이익(EPS)'
              rows={rows}
              fmt={formatWon}
              field='eps'
            />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HistoryRow({
  label,
  rows,
  fmt,
  field,
}: {
  readonly label: string;
  readonly rows: readonly DividendHistoryRow[];
  readonly fmt: (v: number | null | undefined) => string;
  readonly field: keyof Omit<DividendHistoryRow, 'periodLabel'>;
}) {
  // 모든 값이 null이면 row 자체 숨김
  if (rows.every((r) => r[field] === null || r[field] === undefined))
    return null;

  return (
    <tr>
      <td className='text-muted-foreground py-2 text-xs'>{label}</td>
      {rows.map((r) => (
        <td
          key={r.periodLabel}
          className='py-2 text-right text-sm font-medium tabular-nums'
        >
          {fmt(r[field])}
        </td>
      ))}
    </tr>
  );
}

interface CardProps {
  readonly title: string;
  readonly children: ReactNode;
}

function Card({ title, children }: CardProps) {
  return (
    <div className='border-border bg-card rounded-xl border p-4'>
      <h3 className='text-sm font-semibold'>{title}</h3>
      <div className='mt-3 space-y-2.5'>{children}</div>
    </div>
  );
}

interface RowProps {
  readonly label: string;
  readonly tooltip?: string;
  readonly value: string;
}

function Row({ label, tooltip, value }: RowProps) {
  return (
    <div className='flex items-center justify-between'>
      <span className='text-muted-foreground text-sm' title={tooltip}>
        {label}
      </span>
      <span className='text-sm font-medium tabular-nums'>{value}</span>
    </div>
  );
}

// ── 헬퍼 ──────────────────────────────────────────

function anyDefined(...vals: Array<number | null | undefined>): boolean {
  return vals.some((v) => v !== null && v !== undefined);
}

function formatX(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${v.toFixed(1)}배`;
}

function formatWon(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  return `${v.toFixed(1)}%`;
}
