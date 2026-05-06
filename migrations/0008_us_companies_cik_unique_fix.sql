-- 0008_us_companies_cik_unique_fix.sql
-- us_companies.cik UNIQUE 제거 — 같은 회사의 다중 클래스(A/B) 주식이 같은 CIK 공유
--
-- 예: GOOGL/GOOG → Alphabet (CIK=0001652044), BRK.A/BRK.B → Berkshire (0001067983)
-- ticker가 PK라 식별 가능. CIK은 lookup 가속용 인덱스로만 유지.

DROP INDEX IF EXISTS idx_us_companies_cik;
CREATE INDEX idx_us_companies_cik ON us_companies(cik);
