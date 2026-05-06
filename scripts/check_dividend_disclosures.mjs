#!/usr/bin/env node
/**
 * 삼성전자(00126380) 2024-2025 공시 중 "배당" 관련만 추출
 *
 * 실행:
 *   node scripts/check_dividend_disclosures.mjs
 *   node scripts/check_dividend_disclosures.mjs <api_key>   ← 인자로 직접 전달
 *
 * .env.local에서 자동 로드 시 다음 키 중 하나 인식:
 *   OPENDART_API_KEY, DART_API_KEY, DART_KEY, OPEN_DART_KEY
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CANDIDATE_NAMES = [
  'OPENDART_API_KEY',
  'DART_API_KEY',
  'DART_KEY',
  'OPEN_DART_KEY',
  'OPENDART_KEY',
];

function loadKey() {
  // 1. CLI 인자
  const arg = process.argv[2];
  if (arg && arg.length > 10) {
    console.log('[check] using CLI arg key');
    return arg;
  }

  // 2. process.env (이미 셸에 export 된 경우)
  for (const name of CANDIDATE_NAMES) {
    if (process.env[name]) {
      console.log(`[check] using env: ${name}`);
      return process.env[name];
    }
  }

  // 3. .env.local 파일 직접 파싱
  const envPath = resolve(process.cwd(), '.env.local');
  let content;
  try {
    content = readFileSync(envPath, 'utf-8');
  } catch {
    throw new Error(`.env.local 못 읽음 (${envPath})`);
  }

  // 모든 키-값 출력 (디버깅)
  const allKeys = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (!m) continue;
    allKeys.push(m[1]);
    if (CANDIDATE_NAMES.includes(m[1])) {
      console.log(`[check] using .env.local: ${m[1]}`);
      return m[2].replace(/^['"]|['"]$/g, '');
    }
  }

  // DART/OPENDART 비슷한 거 fuzzy 매치
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (!m) continue;
    if (/DART/i.test(m[1])) {
      console.log(`[check] fuzzy match: ${m[1]}`);
      return m[2].replace(/^['"]|['"]$/g, '');
    }
  }

  throw new Error(
    `.env.local에서 DART 키를 못 찾았어요. 발견된 키: ${allKeys.join(', ')}\n` +
      `해결: node scripts/check_dividend_disclosures.mjs <키값직접붙여넣기>`,
  );
}

async function fetchPage(key, pageNo) {
  const url = new URL('https://opendart.fss.or.kr/api/list.json');
  url.searchParams.set('crtfc_key', key);
  url.searchParams.set('corp_code', '00126380'); // 삼성전자
  url.searchParams.set('bgn_de', '20240101');
  url.searchParams.set('end_de', '20251231');
  url.searchParams.set('page_count', '100');
  url.searchParams.set('page_no', String(pageNo));
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const key = loadKey();
  console.log(`[check] key length: ${key.length}`);

  const allItems = [];
  let pageNo = 1;
  while (true) {
    const json = await fetchPage(key, pageNo);
    if (json.status !== '000') {
      console.log(`[check] page ${pageNo} status: ${json.status} ${json.message}`);
      break;
    }
    allItems.push(...(json.list ?? []));
    const total = json.total_page ?? 1;
    console.log(`[check] page ${pageNo}/${total} → ${json.list?.length ?? 0}건 (누적 ${allItems.length})`);
    if (pageNo >= total) break;
    pageNo += 1;
    if (pageNo > 50) break; // safety
  }

  console.log(`\n[check] 전체 공시: ${allItems.length}건\n`);

  // 1) "배당" 키워드 매치
  const dividend = allItems.filter((item) => item.report_nm?.includes('배당'));
  console.log(`[check] "배당" 포함: ${dividend.length}건`);
  for (const item of dividend) {
    console.log(`  ${item.rcept_dt}  ${item.report_nm}`);
  }

  // 2) 보고서명 종류 통계 (어떤 게 자주 나오는지)
  console.log(`\n[check] 보고서명 빈도 top 30:`);
  const counts = new Map();
  for (const item of allItems) {
    const k = item.report_nm ?? '(unknown)';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  for (const [name, n] of sorted) {
    console.log(`  ${String(n).padStart(3)}× ${name}`);
  }
}

main().catch((err) => {
  console.error('[check] error:', err.message);
  process.exit(1);
});
