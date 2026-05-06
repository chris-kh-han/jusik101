-- 0005_us_companies.sql
-- 미국 상장사 마스터 — SEC EDGAR company_tickers.json + FDR 시총 보강
--
-- ticker가 PK (예: 'AAPL') — CIK는 SEC EDGAR companyfacts 호출용 외래 식별자.
-- 한국 companies 테이블과 격리 (corp_code 형식 다름, 시장도 다름).

CREATE TABLE us_companies (
  ticker         TEXT PRIMARY KEY,           -- 'AAPL', 'TSLA' 등 (대문자)
  cik            TEXT NOT NULL,              -- '0000320193' (10자리 0-pad)
  name           TEXT NOT NULL,              -- 'Apple Inc.'
  exchange       TEXT,                       -- 'NASDAQ' / 'NYSE' / 'AMEX'
  sector         TEXT,                       -- 'Technology' 등 (FDR)
  industry       TEXT,                       -- 'Consumer Electronics' 등 (FDR)
  market_cap     INTEGER,                    -- 달러 단위 (FDR)
  is_sp500       INTEGER NOT NULL DEFAULT 0, -- 1 = S&P 500 구성종목
  fetched_at     INTEGER NOT NULL            -- Unix epoch ms
);

CREATE UNIQUE INDEX idx_us_companies_cik ON us_companies(cik);
CREATE INDEX idx_us_companies_marketcap ON us_companies(market_cap DESC);
CREATE INDEX idx_us_companies_sp500 ON us_companies(is_sp500) WHERE is_sp500 = 1;
