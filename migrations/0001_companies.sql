-- 0001_companies.sql
-- 한국 상장사 마스터 테이블
-- OpenDART corpCode.xml에서 동기화

CREATE TABLE companies (
  corp_code     TEXT PRIMARY KEY,        -- 8자리 DART 고유 코드
  corp_name     TEXT NOT NULL,            -- 회사명 (한글)
  stock_code    TEXT,                     -- 6자리 종목코드 (비상장은 NULL)
  listed_market TEXT,                     -- KOSPI | KOSDAQ | KONEX | OTHER
  modify_date   TEXT,                     -- DART 최종수정일 YYYYMMDD
  updated_at    INTEGER NOT NULL          -- 우리 시스템 갱신 시각 (Unix epoch ms)
);

-- 검색용 인덱스
CREATE INDEX idx_companies_name ON companies(corp_name);
CREATE INDEX idx_companies_stock ON companies(stock_code) WHERE stock_code IS NOT NULL;
CREATE INDEX idx_companies_market ON companies(listed_market);
