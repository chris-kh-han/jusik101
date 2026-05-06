#!/usr/bin/env node
/**
 * DART /api/cashDvdndDcsn.json 테스트
 *
 * 주요사항보고서 - 현금ㆍ현물배당결정 구조화 데이터.
 *
 * 응답 필드 (예상):
 *   - corp_code, corp_name
 *   - rcept_no                 공시번호
 *   - dvdn_kind                배당 구분 (현금/현물)
 *   - thdt_dvdn_qy             배당금총액
 *   - stock_knd                주식 종류 (보통주/우선주)
 *   - per_stk_dvdn_amount      1주당 배당금
 *   - dvdn_rt                  배당률
 *   - dvdn_bsis_dt             배당기준일  ← ★ 토스 표시용
 *   - dvdn_pymnt_dt            배당지급예정일
 *   - bd_rsltn_de              이사회결의일
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadKey() {
  const envPath = resolve(process.cwd(), '.env.local');
  const content = readFileSync(envPath, 'utf-8');
  for (const line of content.split('\n')) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/);
    if (m && /DART/i.test(m[1])) return m[2].replace(/^['"]|['"]$/g, '');
  }
  throw new Error('DART key not found');
}

async function main() {
  const key = loadKey();

  // 삼성전자 2024-2025 현금배당결정
  const url = new URL('https://opendart.fss.or.kr/api/cashDvdndDcsn.json');
  url.searchParams.set('crtfc_key', key);
  url.searchParams.set('corp_code', '00126380');
  url.searchParams.set('bgn_de', '20240101');
  url.searchParams.set('end_de', '20251231');

  const res = await fetch(url);
  const json = await res.json();

  console.log(`status: ${json.status}`);
  console.log(`message: ${json.message}`);
  console.log(`list length: ${json.list?.length ?? 0}`);
  console.log('');

  if (!json.list || json.list.length === 0) {
    console.log('샘플 응답 전체:');
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  // 첫 항목의 모든 키 (구조 파악용)
  console.log('첫 항목 전체 필드:');
  console.log(JSON.stringify(json.list[0], null, 2));
  console.log('');

  // 핵심 필드만 요약 (모든 항목)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('rcept_dt   bsis_dt    pymnt_dt   주식종류 1주배당금');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const item of json.list) {
    const rcept = item.rcept_no?.slice(0, 8) ?? '?';
    const bsis = item.dvdn_bsis_dt ?? item.dvdn_record_de ?? '?';
    const pymnt = item.dvdn_pymnt_dt ?? item.pay_de ?? '?';
    const kind = (item.stock_knd ?? '?').padEnd(8);
    const amt = item.per_stk_dvdn_amount ?? item.stk_per_dvdn_amount ?? '?';
    console.log(`${rcept}  ${bsis}  ${pymnt}  ${kind} ${amt}`);
  }
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
