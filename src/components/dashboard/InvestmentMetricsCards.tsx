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

interface Props {
  readonly metrics: InvestmentMetrics;
}

export function InvestmentMetricsCards({ metrics }: Props) {
  const hasValuation = anyDefined(metrics.per, metrics.pbr, metrics.psr);
  const hasIncome = anyDefined(metrics.eps, metrics.bps, metrics.roe);
  const hasDividend = anyDefined(
    metrics.dividendYield,
    metrics.dividendPerShare,
    metrics.payoutRatio,
  );

  if (!hasValuation && !hasIncome && !hasDividend) return null;

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
    </section>
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
