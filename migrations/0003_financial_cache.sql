-- 0003_financial_cache.sql
-- DART API 응답 캐시 테이블
-- 회사 페이지 첫 방문 시 17회 API 호출 → 두 번째 방문부터 0회 (D1만 읽기)
-- TTL 정책 (TTL은 코드 레벨에서 처리):
--   사업보고서 (11011):       365일
--   분기/반기 보고서 (11012-14): 90일
--   재무비율 (fnlttSinglIndx): 30일
--   배당 (alotMatter):         365일

CREATE TABLE financial_cache (
  corp_code   TEXT NOT NULL,                 -- 8자리 DART 코드
  bsns_year   INTEGER NOT NULL,              -- 사업연도 (예: 2025)
  reprt_code  TEXT NOT NULL,                 -- 11011 사업 / 11012 반기 / 11013 1분기 / 11014 3분기
  fs_div      TEXT NOT NULL DEFAULT '-',     -- CFS 연결 / OFS 별도 / '-' (해당없음)
  endpoint    TEXT NOT NULL,                 -- fnlttSinglAcntAll | fnlttSinglIndx | alotMatter | hyslrSttus
  idx_cl_code TEXT NOT NULL DEFAULT '-',     -- 재무비율 카테고리 (M210000 등) / '-' (해당없음)
  data        TEXT NOT NULL,                 -- DART 응답 list 부분 JSON 문자열
  fetched_at  INTEGER NOT NULL,              -- Unix epoch (ms)
  PRIMARY KEY (corp_code, bsns_year, reprt_code, fs_div, endpoint, idx_cl_code)
);

-- 회사별 캐시 조회 인덱스
CREATE INDEX idx_fin_cache_corp ON financial_cache(corp_code);
-- TTL 만료 청소용 인덱스 (추후 cron으로 오래된 캐시 삭제)
CREATE INDEX idx_fin_cache_age  ON financial_cache(fetched_at);
