'use client';

/**
 * DividendHistorySection
 *
 * 토스 인베스트 "배당금 지급 내역" 섹션 통합.
 *
 * 구성:
 *   - 헤더 (제목 + "지난 N년 동안 지급한 주당배당금은 총 X원이에요" 요약)
 *   - 기간 선택 드롭다운 (3/5/10년)
 *   - 분기별 막대 차트 (DividendBarChart)
 *   - 테이블 (배당락일 / 배당기준일 / [지급일] / 주당배당금)
 *
 * 주의:
 *   - 데이터 없으면 섹션 자체 숨김
 *   - source='estimated'(공시 본문 미파싱) 추정값/document(정확값) 모두 동일 표시
 */

import { useState } from 'react';
import { DividendBarChart } from '@/components/charts/DividendBarChart';
import type { QuarterlyDividendPoint } from '@/lib/quarterly-dividend';

interface Props {
  readonly points: readonly QuarterlyDividendPoint[];
  readonly fiscalMonth: number;
}

type Period = 3 | 5 | 10;

export function DividendHistorySection({ points, fiscalMonth }: Props) {
  const [period, setPeriod] = useState<Period>(5);

  if (points.length === 0) return null;

  // 기간 필터: 가장 최근 배당락일 기준 N년 (현재 시각 X — 데이터 기준)
  const latestYear = Math.max(...points.map((p) => p.year));
  const cutoffYear = latestYear - period + 1;
  const filtered = points.filter((p) => p.year >= cutoffYear);

  if (filtered.length === 0) return null;

  const totalDps = filtered.reduce((sum, p) => sum + p.dividendPerShare, 0);

  // 테이블: 최신 → 과거
  const sortedDesc = [...filtered].sort((a, b) =>
    b.exDividendDate.localeCompare(a.exDividendDate),
  );

  const hasPaymentDate = filtered.some((p) => p.paymentDate);

  return (
    <section>
      <h2 className='text-xl font-bold'>배당금 지급 내역</h2>
      <p className='text-muted-foreground mt-1 text-sm'>
        지난 {period}년 동안 지급한 주당배당금은 총{' '}
        <span className='text-foreground font-semibold'>
          {totalDps.toLocaleString('ko-KR')}원
        </span>
        이에요.
      </p>

      <div className='mt-3'>
        <select
          value={period}
          onChange={(e) => setPeriod(Number(e.target.value) as Period)}
          className='border-border bg-card text-foreground rounded-lg border px-3 py-1.5 text-sm'
        >
          <option value={3}>3년</option>
          <option value={5}>5년</option>
          <option value={10}>10년</option>
        </select>
      </div>

      <div className='mt-4'>
        <DividendBarChart points={filtered} />
      </div>

      <div className='mt-6 overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-border text-muted-foreground border-b'>
              <th className='py-2 text-left text-xs font-medium'>배당락일</th>
              <th className='py-2 text-left text-xs font-medium'>배당기준일</th>
              {hasPaymentDate && (
                <th className='py-2 text-left text-xs font-medium'>
                  배당 지급일
                </th>
              )}
              <th className='py-2 text-right text-xs font-medium'>
                주당배당금
              </th>
            </tr>
          </thead>
          <tbody className='[&>tr]:border-border [&>tr:not(:last-child)]:border-b'>
            {sortedDesc.map((p) => (
              <tr key={`${p.year}-Q${p.quarter}`}>
                <td className='py-2.5 text-sm'>
                  {formatDate(p.exDividendDate)}
                </td>
                <td className='text-muted-foreground py-2.5 text-sm'>
                  {formatDate(p.fiscalEndDate)}
                </td>
                {hasPaymentDate && (
                  <td className='text-muted-foreground py-2.5 text-sm'>
                    {p.paymentDate ? formatDate(p.paymentDate) : '-'}
                  </td>
                )}
                <td className='py-2.5 text-right text-sm font-medium tabular-nums'>
                  {p.dividendPerShare.toLocaleString('ko-KR')}원
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {fiscalMonth !== 12 && (
        <p className='text-muted-foreground mt-1 text-xs'>
          이 회사는 {fiscalMonth}월 결산입니다.
        </p>
      )}
    </section>
  );
}

/** 'YYYY-MM-DD' → 'YY년 M월 D일' (토스 스타일) */
function formatDate(iso: string): string {
  if (iso.length < 10) return iso;
  const yy = iso.slice(2, 4);
  const mm = parseInt(iso.slice(5, 7), 10);
  const dd = parseInt(iso.slice(8, 10), 10);
  return `${yy}년 ${mm}월 ${dd}일`;
}
