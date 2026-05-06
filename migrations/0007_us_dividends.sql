-- 0007_us_dividends.sql
-- 미국 상장사 분기별 배당 events — 정확한 ex-dividend / record / payment 날짜
--
-- 1차 소스: SEC EDGAR companyfacts (분기별 dps만 — 날짜 정확도 ↓)
-- 2차 보강 (선택): Yahoo Finance dividend history (ex-date 정확)
--
-- 한국의 dividend_disclosures 테이블에 해당.

CREATE TABLE us_dividends (
  ticker             TEXT NOT NULL,
  ex_dividend_date   TEXT NOT NULL,         -- 'YYYY-MM-DD' (배당락일)
  record_date        TEXT,                  -- 'YYYY-MM-DD' (배당기준일)
  payment_date       TEXT,                  -- 'YYYY-MM-DD' (지급일)
  dividend_per_share REAL NOT NULL,         -- USD/share
  dividend_type      TEXT NOT NULL DEFAULT 'CASH',  -- CASH / STOCK
  source             TEXT NOT NULL,         -- 'edgar' / 'yahoo' / 'manual'
  fetched_at         INTEGER NOT NULL,
  PRIMARY KEY (ticker, ex_dividend_date, dividend_type)
);

CREATE INDEX idx_us_div_ticker_date ON us_dividends(ticker, ex_dividend_date DESC);
CREATE INDEX idx_us_div_date ON us_dividends(ex_dividend_date);
