import type { SearchResult } from '@/types/financial';
import companiesData from '@/data/companies.json';

interface CompanyEntry {
  readonly corpCode: string;
  readonly corpName: string;
  readonly stockCode: string;
  readonly listedMarket: string;
}

const companies: readonly CompanyEntry[] = companiesData;

/**
 * 기업 검색 (이름 또는 종목코드)
 * 정확 매치 → 접두사 매치 → 포함 매치 순으로 정렬
 */
export function searchCompanies(
  query: string,
  limit: number = 10,
): readonly SearchResult[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];

  const lowerQuery = trimmed.toLowerCase();

  const scored = companies
    .map((company) => {
      const score = getMatchScore(company, lowerQuery);
      if (score === 0) return null;
      return { company, score };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  return scored
    .toSorted((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ company }) => ({
      corpCode: company.corpCode,
      corpName: company.corpName,
      stockCode: company.stockCode,
      listedMarket: company.listedMarket,
    }));
}

function getMatchScore(company: CompanyEntry, query: string): number {
  const name = company.corpName.toLowerCase();
  const code = company.stockCode;

  // 정확 매치
  if (name === query || code === query) return 100;

  // 접두사 매치
  if (name.startsWith(query)) return 80;
  if (code.startsWith(query)) return 75;

  // 포함 매치
  if (name.includes(query)) return 50;
  if (code.includes(query)) return 45;

  return 0;
}

/**
 * corpCode로 기업 정보 조회
 */
export function findCompanyByCode(corpCode: string): SearchResult | undefined {
  const company = companies.find((c) => c.corpCode === corpCode);
  if (!company) return undefined;

  return {
    corpCode: company.corpCode,
    corpName: company.corpName,
    stockCode: company.stockCode,
    listedMarket: company.listedMarket,
  };
}

/**
 * 종목코드로 기업 정보 조회
 */
export function findCompanyByStockCode(
  stockCode: string,
): SearchResult | undefined {
  const company = companies.find((c) => c.stockCode === stockCode);
  if (!company) return undefined;

  return {
    corpCode: company.corpCode,
    corpName: company.corpName,
    stockCode: company.stockCode,
    listedMarket: company.listedMarket,
  };
}

/**
 * 인기 기업 목록 (기본 표시용)
 */
export function getPopularCompanies(): readonly SearchResult[] {
  return companies.slice(0, 12).map((c) => ({
    corpCode: c.corpCode,
    corpName: c.corpName,
    stockCode: c.stockCode,
    listedMarket: c.listedMarket,
  }));
}
