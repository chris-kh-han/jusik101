import type { HealthScore } from '@/types/financial';

const GRADE_COLORS: Record<HealthScore['grade'], string> = {
  A: 'text-emerald-500',
  B: 'text-blue-500',
  C: 'text-amber-500',
  D: 'text-orange-500',
  F: 'text-red-500',
};

const GRADE_BG: Record<HealthScore['grade'], string> = {
  A: 'bg-emerald-500/10',
  B: 'bg-blue-500/10',
  C: 'bg-amber-500/10',
  D: 'bg-orange-500/10',
  F: 'bg-red-500/10',
};

interface HealthScoreCardProps {
  readonly healthScore: HealthScore;
}

export function HealthScoreCard({ healthScore }: HealthScoreCardProps) {
  const { score, grade, summary, details } = healthScore;

  return (
    <div className='border-border bg-card rounded-2xl border p-6'>
      <div className='flex items-center gap-6'>
        {/* 점수 원형 */}
        <div
          className={`flex h-24 w-24 flex-shrink-0 flex-col items-center justify-center rounded-full ${GRADE_BG[grade]}`}
        >
          <span className={`text-3xl font-bold ${GRADE_COLORS[grade]}`}>
            {score}
          </span>
          <span className='text-muted-foreground text-xs'>/ 100</span>
        </div>

        <div className='flex-1'>
          <div className='flex items-center gap-2'>
            <h2 className='text-lg font-semibold'>재무 건강 점수</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-sm font-bold ${GRADE_COLORS[grade]} ${GRADE_BG[grade]}`}
            >
              {grade}등급
            </span>
          </div>
          <p className='text-muted-foreground mt-1 text-sm'>{summary}</p>
        </div>
      </div>

      {/* 세부 항목 바 */}
      <div className='mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {details.map((detail) => (
          <div key={detail.category} className='space-y-1'>
            <div className='flex items-center justify-between text-xs'>
              <span className='text-muted-foreground'>{detail.label}</span>
              <span className='font-medium'>{detail.value}</span>
            </div>
            <div className='bg-muted h-1.5 w-full overflow-hidden rounded-full'>
              <div
                className={`h-full rounded-full transition-all ${statusBarColor(detail.status)}`}
                style={{ width: `${detail.value}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function statusBarColor(
  status: 'good' | 'normal' | 'warning' | 'danger',
): string {
  switch (status) {
    case 'good':
      return 'bg-emerald-500';
    case 'normal':
      return 'bg-blue-500';
    case 'warning':
      return 'bg-amber-500';
    case 'danger':
      return 'bg-red-500';
  }
}
