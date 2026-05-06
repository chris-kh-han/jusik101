'use client';

/**
 * 메인 페이지 회사 리스트 — 토스 스타일 nation 필터 + 시총 정렬 + 페이지네이션.
 *
 * 우리는 시세 데이터가 없어 거래대금/거래량 정렬은 미지원.
 * 시가총액 정렬 + nation/거래소 필터로 충분히 토스 스타일 구현 가능.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Nation } from '@/types/financial';

interface CompanyItem {
  readonly corpCode: string;
  readonly corpName: string;
  readonly stockCode: string;
  readonly listedMarket: string;
  readonly nation: Nation;
  readonly marketCap: number | null;
}

interface ApiResponse {
  readonly results: readonly CompanyItem[];
  readonly hasMore: boolean;
}

type NationFilter = 'all' | 'kr' | 'us';
type SortMode = 'marketcap_desc' | 'marketcap_asc' | 'name';

const PAGE_SIZE = 20;

export function CompanyListSection() {
  const [nation, setNation] = useState<NationFilter>('all');
  const [sort, setSort] = useState<SortMode>('marketcap_desc');
  const [items, setItems] = useState<readonly CompanyItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  // 필터/정렬 변경 시 첫 페이지부터 다시 로드
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({
          nation,
          sort,
          limit: String(PAGE_SIZE),
          offset: '0',
        });
        const res = await fetch(`/api/companies/list?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ApiResponse = await res.json();
        if (cancelled) return;
        setItems(data.results);
        setHasMore(data.hasMore);
        setOffset(PAGE_SIZE);
      } catch (e) {
        if (!cancelled) {
          console.error('[CompanyListSection] load error:', e);
          setItems([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [nation, sort]);

  const handleLoadMore = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({
        nation,
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      const res = await fetch(`/api/companies/list?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApiResponse = await res.json();
      setItems((prev) => [...prev, ...data.results]);
      setHasMore(data.hasMore);
      setOffset(offset + PAGE_SIZE);
    } catch (e) {
      console.error('[CompanyListSection] loadMore error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section className='w-full max-w-2xl'>
      {/* Nation 탭 + Sort */}
      <div className='mb-4 flex flex-wrap items-center justify-between gap-3'>
        <div className='flex items-center gap-1'>
          <NationTab
            value='all'
            label='전체'
            active={nation === 'all'}
            onClick={() => setNation('all')}
          />
          <NationTab
            value='kr'
            label='국내'
            active={nation === 'kr'}
            onClick={() => setNation('kr')}
          />
          <NationTab
            value='us'
            label='해외'
            active={nation === 'us'}
            onClick={() => setNation('us')}
          />
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortMode)}
          className='border-border bg-card text-foreground rounded-lg border px-3 py-1.5 text-sm'
        >
          <option value='marketcap_desc'>시총 큰 순</option>
          <option value='marketcap_asc'>시총 작은 순</option>
          <option value='name'>가나다 / A-Z</option>
        </select>
      </div>

      {/* List */}
      <ul className='border-border bg-card divide-border divide-y overflow-hidden rounded-2xl border'>
        {items.map((item, idx) => (
          <li key={`${item.nation}-${item.corpCode}`}>
            <CompanyRow rank={idx + 1} item={item} />
          </li>
        ))}
        {items.length === 0 && !isLoading && (
          <li className='text-muted-foreground py-12 text-center text-sm'>
            데이터가 없습니다.
          </li>
        )}
        {isLoading && items.length === 0 && (
          <li className='text-muted-foreground py-12 text-center text-sm'>
            불러오는 중...
          </li>
        )}
      </ul>

      {hasMore && (
        <div className='mt-4 flex justify-center'>
          <button
            onClick={handleLoadMore}
            disabled={isLoading}
            className='border-border bg-card hover:bg-accent rounded-full border px-5 py-2 text-sm font-medium transition-colors disabled:opacity-50'
          >
            {isLoading ? '불러오는 중...' : '더 보기'}
          </button>
        </div>
      )}
    </section>
  );
}

interface NationTabProps {
  readonly value: NationFilter;
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
}

function NationTab({ label, active, onClick }: NationTabProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'bg-foreground text-background'
          : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function CompanyRow({
  rank,
  item,
}: {
  readonly rank: number;
  readonly item: CompanyItem;
}) {
  const flag = item.nation === 'US' ? '🇺🇸' : '🇰🇷';
  const href =
    item.nation === 'US' ? `/us/${item.corpCode}` : `/company/${item.corpCode}`;

  return (
    <Link
      href={href}
      className='hover:bg-accent flex items-center gap-3 px-4 py-3 transition-colors'
    >
      <span className='text-muted-foreground w-6 text-center text-sm tabular-nums'>
        {rank}
      </span>
      <span className='text-base' aria-label={item.nation}>
        {flag}
      </span>
      <div className='min-w-0 flex-1'>
        <div className='truncate font-medium'>{item.corpName}</div>
        <div className='text-muted-foreground text-xs'>
          {item.stockCode}
          {item.listedMarket && (
            <span className='ml-2 inline-block'>{item.listedMarket}</span>
          )}
        </div>
      </div>
      <div className='text-right text-sm tabular-nums'>
        {formatMarketCap(item.marketCap, item.nation)}
      </div>
    </Link>
  );
}

/** 시총 표시: KR=원 단위 → 조/억, US=달러 → T/B/M */
function formatMarketCap(value: number | null, nation: Nation): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '-';

  if (nation === 'US') {
    if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    return `$${value.toLocaleString('en-US')}`;
  }

  // KR: 원 단위
  if (value >= 1e12) return `${(value / 1e12).toFixed(1)}조원`;
  if (value >= 1e8) return `${(value / 1e8).toFixed(0)}억원`;
  return `${value.toLocaleString('ko-KR')}원`;
}
