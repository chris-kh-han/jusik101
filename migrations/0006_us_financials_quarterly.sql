-- 0006_us_financials_quarterly.sql
-- 미국 상장사 분기별 재무 시계열 — SEC EDGAR companyfacts XBRL에서 추출
--
-- PnL 항목 (revenue/op_income/net_income): start~end 80~100일 분기 entry
-- BS 항목 (assets/liab/equity): end 시점값, fp/fy로 분기 매핑
-- DPS: 분기별 1주당 현금배당 (USD)
--
-- PK는 (ticker, fiscal_year, fiscal_quarter) — Apple FY2026 Q2 같은 fiscal 기준
-- 캘린더 기준 분기 차트는 페이지에서 fiscalEndDate로 변환

CREATE TABLE us_financials_quarterly (
  ticker          TEXT NOT NULL,
  fiscal_year     INTEGER NOT NULL,             -- Apple FY2026 = 2025-09-28 ~ 2026-09-26
  fiscal_quarter  INTEGER NOT NULL CHECK (fiscal_quarter BETWEEN 1 AND 4),
  period_start    TEXT,                         -- 'YYYY-MM-DD' (PnL 분기 시작일)
  period_end      TEXT NOT NULL,                -- 'YYYY-MM-DD' (분기 종료일)

  -- PnL (단위: USD)
  revenue              REAL,
  operating_income     REAL,
  net_income           REAL,
  eps_basic            REAL,                    -- USD/share
  eps_diluted          REAL,                    -- USD/share

  -- BS (시점값, 단위: USD)
  total_assets         REAL,
  total_liabilities    REAL,
  total_equity         REAL,

  -- 발행주식수 + 배당
  shares_outstanding   REAL,                    -- 분기말 발행주식수
  dividend_per_share   REAL,                    -- USD/share (분기 배당)

  fetched_at      INTEGER NOT NULL,
  PRIMARY KEY (ticker, fiscal_year, fiscal_quarter)
);

CREATE INDEX idx_us_fin_ticker_period ON us_financials_quarterly(ticker, period_end DESC);
CREATE INDEX idx_us_fin_period ON us_financials_quarterly(period_end);
