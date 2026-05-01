-- 0002_market_data.sql
-- 시장 분류 (KOSPI/KOSDAQ) + 시가총액 추가
-- KRX/Naver Finance에서 동기화

-- 시가총액 (원 단위, NULL 가능 - 비상장 또는 데이터 없음)
ALTER TABLE companies ADD COLUMN market_cap INTEGER;

-- 시가총액 기반 정렬용 인덱스
-- (검색 결과를 시총 큰 순으로 정렬할 때 사용)
CREATE INDEX idx_companies_market_cap ON companies(market_cap) WHERE market_cap IS NOT NULL;

-- listed_market 컬럼은 기존 그대로 사용
-- 값 도메인: 'KOSPI' | 'KOSDAQ' | 'KONEX' | 'OTHER' | NULL
-- 기존 'LISTED' 값은 sync 시 정확한 값으로 업데이트됨
