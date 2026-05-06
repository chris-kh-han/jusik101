-- 0004_dividend_disclosures.sql
-- 분기/연간 배당 내역 — KRX 정보데이터시스템 또는 OpenDART list.json에서 동기화
--
-- 한 회사가 1년에 여러 번 배당하는 경우 (분기/반기 등) 매 회 별 row.
-- 토스 인베스트 스타일의 "최근 12개월 4번 (3,6,9,12월)" 표시용.

CREATE TABLE dividend_disclosures (
  stock_code         TEXT NOT NULL,                  -- 6자리 종목코드
  ex_dividend_date   TEXT NOT NULL,                  -- 배당락일 YYYY-MM-DD (KRX 기준)
  payment_date       TEXT,                           -- 지급일 YYYY-MM-DD (있으면)
  dividend_per_share INTEGER NOT NULL,               -- 주당 배당금 (원, 보통주)
  dividend_yield     REAL,                           -- 배당수익률 (%, 배당락일 기준)
  dividend_type      TEXT NOT NULL DEFAULT 'CASH',   -- CASH | STOCK
  source             TEXT NOT NULL,                  -- 'krx' | 'dart'
  fetched_at         INTEGER NOT NULL,               -- Unix epoch (ms)
  PRIMARY KEY (stock_code, ex_dividend_date, dividend_type)
);

-- 종목별 시계열 조회용 인덱스
CREATE INDEX idx_div_stock_date ON dividend_disclosures(stock_code, ex_dividend_date DESC);
-- 최근 12개월 sweep용
CREATE INDEX idx_div_date ON dividend_disclosures(ex_dividend_date);
