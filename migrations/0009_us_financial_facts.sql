-- 0009_us_financial_facts.sql
-- 정규화된 미국 재무제표 fact 테이블 — TradingView 스타일 분기/연 표 위해.
--
-- 한 row = (ticker, fiscal_year, period, account_name) 단위 1개 값.
-- 항목 추가 시 컬럼 X, row 추가만 하면 됨 (BS/CF 추후 동일 테이블에 추가 가능).
--
-- period:
--   'Q1' / 'Q2' / 'Q3' / 'Q4'  → 분기 단독값
--   'FY'                       → 연간 누적값 (Annual 토글 표시용)
--
-- category:
--   'IS' = Income Statement
--   'BS' = Balance Sheet (추후)
--   'CF' = Cash Flow (추후)

CREATE TABLE us_financial_facts (
  ticker         TEXT NOT NULL,
  fiscal_year    INTEGER NOT NULL,
  period         TEXT NOT NULL,           -- 'Q1' / 'Q2' / 'Q3' / 'Q4' / 'FY'
  period_end     TEXT NOT NULL,           -- 'YYYY-MM-DD'
  category       TEXT NOT NULL,           -- 'IS' / 'BS' / 'CF'
  account_name   TEXT NOT NULL,           -- TradingView 친화 영문 키 (예: 'TotalRevenue')
  display_label  TEXT NOT NULL,           -- 표 행 라벨 (한국어 또는 영문)
  display_order  INTEGER NOT NULL,        -- 행 정렬 (작을수록 위)
  value          REAL,                    -- 단위는 USD (대부분), share/percent (일부 — 추후 unit 컬럼 추가 가능)
  fetched_at     INTEGER NOT NULL,
  PRIMARY KEY (ticker, fiscal_year, period, category, account_name)
);

-- 종목별 + 카테고리별 시계열 조회용
CREATE INDEX idx_us_facts_ticker_cat
  ON us_financial_facts(ticker, category, period_end DESC);

-- 카테고리 + 계정 단일 조회용 (cross-company 비교 등)
CREATE INDEX idx_us_facts_account
  ON us_financial_facts(category, account_name, period_end DESC);
