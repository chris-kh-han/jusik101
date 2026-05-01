/**
 * StabilityMetricsCards
 *
 * 토스 인베스트 "재무" 섹션 — 부채비율, 유동비율, 이자보상비율을
 * 큰 숫자 카드 3개로 표시.
 *
 * 데이터 소스:
 *   - 부채비율: OpenDART /fnlttSinglIndx (M220000 안정성지표) 또는 자체 계산
 *   - 유동비율: 동일
 *   - 이자보상비율: OpenDART에 idx_val로 없을 수 있어 영업이익/이자비용 직접 계산도 fallback
 */

export interface StabilityMetrics {
  readonly debtRatio?: number | null; // 부채비율 (%)
  readonly currentRatio?: number | null; // 유동비율 (%)
  readonly interestCoverage?: number | null; // 이자보상비율 (%) — (영업이익/이자비용) * 100
}

interface Props {
  readonly metrics: StabilityMetrics;
}

export function StabilityMetricsCards({ metrics }: Props) {
  const cards: Array<{
    readonly label: string;
    readonly value: number | null | undefined;
    readonly tone: 'good' | 'normal' | 'warning' | 'danger';
    readonly hint?: string;
  }> = [
    {
      label: '부채비율',
      value: metrics.debtRatio,
      tone: toneForDebt(metrics.debtRatio),
      hint: '낮을수록 안정 (200% 미만이면 양호)',
    },
    {
      label: '유동비율',
      value: metrics.currentRatio,
      tone: toneForCurrent(metrics.currentRatio),
      hint: '높을수록 안정 (150% 이상이면 양호)',
    },
    {
      label: '이자보상비율',
      value: metrics.interestCoverage,
      tone: toneForInterest(metrics.interestCoverage),
      hint: '500% 이상이면 이자 부담 낮음',
    },
  ];

  // 모든 값이 비어있으면 섹션 자체 숨김
  if (cards.every((c) => c.value === null || c.value === undefined))
    return null;

  return (
    <section>
      <h2 className='mb-3 text-xl font-bold'>재무</h2>
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        {cards.map((c) => (
          <div
            key={c.label}
            className='border-border bg-card rounded-xl border p-5'
          >
            <p className='text-muted-foreground text-sm'>{c.label}</p>
            <p
              className={`mt-2 text-3xl font-bold tabular-nums ${TONE_TEXT[c.tone]}`}
            >
              {formatPercent(c.value)}
            </p>
            {c.hint && (
              <p className='text-muted-foreground mt-2 text-xs'>{c.hint}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const TONE_TEXT: Record<'good' | 'normal' | 'warning' | 'danger', string> = {
  good: 'text-emerald-600 dark:text-emerald-400',
  normal: 'text-foreground',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-rose-600 dark:text-rose-400',
};

function toneForDebt(v: number | null | undefined) {
  if (v === null || v === undefined) return 'normal';
  if (v < 100) return 'good';
  if (v < 200) return 'normal';
  if (v < 400) return 'warning';
  return 'danger';
}

function toneForCurrent(v: number | null | undefined) {
  if (v === null || v === undefined) return 'normal';
  if (v >= 200) return 'good';
  if (v >= 150) return 'normal';
  if (v >= 100) return 'warning';
  return 'danger';
}

function toneForInterest(v: number | null | undefined) {
  if (v === null || v === undefined) return 'normal';
  if (v >= 500) return 'good';
  if (v >= 200) return 'normal';
  if (v >= 100) return 'warning';
  return 'danger';
}

function formatPercent(v: number | null | undefined): string {
  if (v === null || v === undefined) return '-';
  // 큰 값이면 한 자리, 작은 값이면 두 자리
  return v >= 100 ? `${v.toFixed(1)}%` : `${v.toFixed(2)}%`;
}
