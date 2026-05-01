/**
 * CompanyHeaderSection
 *
 * 토스 인베스트 스타일 헤더 — 회사 기본정보 + 핵심 메타 정보를
 * 가로 그리드로 표시.
 *
 * 표시 필드 (가능한 것만 — 데이터 없으면 카드 숨김):
 *   - 시가총액
 *   - 대표이사
 *   - 상장일 (DART 미제공 → 보통 숨김)
 *   - 발행주식수 (DART /company.json 에 없음, 추후 보완)
 *   - 사업자번호
 *   - 결산월
 *   - 홈페이지
 */

import { ExternalLink } from 'lucide-react';
import { formatKoreanCurrency } from '@/lib/financial-utils';

export interface CompanyHeaderInfo {
  readonly corpName: string;
  readonly stockCode: string;
  readonly listedMarket: string;
  readonly ceoName?: string | null;
  readonly homepage?: string | null;
  readonly establishedDate?: string | null; // YYYYMMDD
  readonly settlementMonth?: string | null; // 12 (월)
  readonly marketCap?: number | null; // 원 단위
  readonly bizNo?: string | null;
}

interface Props {
  readonly company: CompanyHeaderInfo;
  readonly summary?: string;
  readonly fiscalYearLabel?: string; // 예: "2025년 사업보고서 기준"
}

interface MetaItem {
  readonly label: string;
  readonly value: string;
  readonly secondary?: string;
}

export function CompanyHeaderSection({
  company,
  summary,
  fiscalYearLabel,
}: Props) {
  const items: MetaItem[] = [];

  if (company.marketCap && company.marketCap > 0) {
    items.push({
      label: '시가총액',
      value: formatKoreanCurrency(company.marketCap),
    });
  }

  if (company.ceoName) {
    items.push({
      label: '대표이사',
      value: company.ceoName,
    });
  }

  if (company.establishedDate && company.establishedDate.length === 8) {
    const y = company.establishedDate.slice(0, 4);
    const m = company.establishedDate.slice(4, 6);
    const d = company.establishedDate.slice(6, 8);
    items.push({
      label: '설립일',
      value: `${y}년 ${parseInt(m, 10)}월 ${parseInt(d, 10)}일`,
    });
  }

  if (company.settlementMonth) {
    items.push({
      label: '결산월',
      value: `${parseInt(company.settlementMonth, 10)}월`,
    });
  }

  if (company.bizNo) {
    items.push({
      label: '사업자번호',
      value: formatBizNo(company.bizNo),
    });
  }

  return (
    <section className='border-border bg-card rounded-2xl border p-6'>
      {/* 1행: 회사명 + 코드 + 시장 + 홈페이지 */}
      <div className='flex flex-wrap items-baseline justify-between gap-4'>
        <div className='flex flex-wrap items-baseline gap-3'>
          <h1 className='text-3xl font-bold tracking-tight'>
            {company.corpName}
          </h1>
          <span className='text-muted-foreground text-base'>
            {company.stockCode}
          </span>
          <span className='bg-muted text-foreground rounded-full px-2 py-0.5 text-xs font-medium'>
            {company.listedMarket || 'OTHER'}
          </span>
        </div>

        {company.homepage && (
          <a
            href={normalizeUrl(company.homepage)}
            target='_blank'
            rel='noopener noreferrer'
            className='border-border bg-background hover:bg-accent inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors'
          >
            <ExternalLink className='h-3.5 w-3.5' />
            홈페이지
          </a>
        )}
      </div>

      {/* 사업 요약 */}
      {summary && (
        <p className='bg-muted/40 mt-4 rounded-lg px-4 py-3 text-sm leading-relaxed'>
          {summary}
        </p>
      )}

      {fiscalYearLabel && (
        <p className='text-muted-foreground mt-3 text-sm'>{fiscalYearLabel}</p>
      )}

      {/* 메타 정보 그리드 */}
      {items.length > 0 && (
        <div className='border-border mt-5 grid grid-cols-2 gap-x-6 gap-y-4 border-t pt-5 sm:grid-cols-3 lg:grid-cols-4'>
          {items.map((it) => (
            <div key={it.label}>
              <p className='text-muted-foreground text-xs'>{it.label}</p>
              <p className='mt-1 text-base font-semibold'>{it.value}</p>
              {it.secondary && (
                <p className='text-muted-foreground text-xs'>{it.secondary}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** 사업자번호 포맷팅: 1248100998 → 124-81-00998 */
function formatBizNo(raw: string): string {
  if (raw.length === 10) {
    return `${raw.slice(0, 3)}-${raw.slice(3, 5)}-${raw.slice(5)}`;
  }
  return raw;
}

/** URL 정규화 (http(s):// 누락 시 추가) */
function normalizeUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}
