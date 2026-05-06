#!/usr/bin/env node
/**
 * 누적 차감으로 분기별 배당금 추출 — 본 구현 전 마지막 검증.
 *
 * 삼성전자 2024-2025 8개 보고서 호출 → 분기별 단일 dps + ex 추정월 출력.
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

const KEY = loadKey();

async function fetchAlotMatter(year, reportCode) {
  const url = new URL('https://opendart.fss.or.kr/api/alotMatter.json');
  url.searchParams.set('crtfc_key', KEY);
  url.searchParams.set('corp_code', '00126380');
  url.searchParams.set('bsns_year', String(year));
  url.searchParams.set('reprt_code', reportCode);
  const res = await fetch(url);
  const json = await res.json();
  return json.list ?? [];
}

function findDps(items) {
  const item =
    items.find(
      (d) => d.se === '주당 현금배당금(원)' && d.stock_knd === '보통주',
    ) ?? items.find((d) => d.se === '주당 현금배당금(원)');
  if (!item || !item.thstrm || item.thstrm === '-') return 0;
  const n = Number(item.thstrm.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function findStlmDt(items) {
  return items[0]?.stlm_dt ?? '';
}

async function processYear(year) {
  const [q1, h1, q3, fy] = await Promise.all([
    fetchAlotMatter(year, '11013'),
    fetchAlotMatter(year, '11012'),
    fetchAlotMatter(year, '11014'),
    fetchAlotMatter(year, '11011'),
  ]);

  const stlmDt = findStlmDt(fy.length ? fy : q3.length ? q3 : h1.length ? h1 : q1);
  const fiscalMonth =
    stlmDt.length >= 7 ? parseInt(stlmDt.slice(5, 7), 10) : 12;

  const cum = {
    q1: findDps(q1),
    h1: findDps(h1),
    q3: findDps(q3),
    fy: findDps(fy),
  };

  const single = {
    q1: cum.q1,
    q2: cum.h1 - cum.q1,
    q3: cum.q3 - cum.h1,
    q4: cum.fy - cum.q3,
  };

  // 결산월 N월이면 Q1=N-9월, Q2=N-6, Q3=N-3, Q4=N
  const monthOf = (q) => {
    const offset = (q - 4) * 3 + fiscalMonth;
    return ((offset - 1 + 12) % 12) + 1;
  };

  console.log(`\n━━━ ${year}년 (결산월 ${fiscalMonth}월) ━━━`);
  console.log(`누적: Q1=${cum.q1}  H1=${cum.h1}  Q3=${cum.q3}  FY=${cum.fy}`);
  console.log(`분기별:`);
  for (const q of [1, 2, 3, 4]) {
    const dps = single[`q${q}`];
    const month = monthOf(q);
    const note = dps > 0 ? '✓' : dps < 0 ? '⚠️ 음수 (보고서 일부 누락?)' : '-';
    console.log(`  Q${q} (배당락 ~${month}월): ${dps}원 ${note}`);
  }
  const positiveCount = [single.q1, single.q2, single.q3, single.q4].filter((v) => v > 0).length;
  const months = [1, 2, 3, 4]
    .filter((q) => single[`q${q}`] > 0)
    .map(monthOf)
    .sort((a, b) => a - b);
  console.log(`▶ 빈도: ${positiveCount}번 (${months.join(', ')}월)`);
}

async function main() {
  for (const year of [2024, 2025]) {
    await processYear(year);
  }
  console.log('\n');
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
