#!/usr/bin/env node
/**
 * /api/alotMatter.json을 분기 보고서 코드로 호출 — 분기별 배당금이 따로 잡히는지 검증.
 *
 * 삼성전자 2024년 4개 보고서 모두 호출:
 *   11013 (1분기) | 11012 (반기) | 11014 (3분기) | 11011 (사업)
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

const REPORTS = [
  { code: '11013', name: '1분기' },
  { code: '11012', name: '반기  ' },
  { code: '11014', name: '3분기' },
  { code: '11011', name: '사업  ' },
];

async function fetchOne(key, year, reportCode) {
  const url = new URL('https://opendart.fss.or.kr/api/alotMatter.json');
  url.searchParams.set('crtfc_key', key);
  url.searchParams.set('corp_code', '00126380');
  url.searchParams.set('bsns_year', String(year));
  url.searchParams.set('reprt_code', reportCode);
  const res = await fetch(url);
  return res.json();
}

async function main() {
  const key = loadKey();
  for (const year of [2024, 2025]) {
    console.log(`\n━━━ ${year}년 ━━━`);
    for (const r of REPORTS) {
      const json = await fetchOne(key, year, r.code);
      if (json.status !== '000') {
        console.log(`  ${r.name} (${r.code}): ${json.status} ${json.message}`);
        continue;
      }
      const items = json.list ?? [];
      // 핵심 항목만: se(구분), thstrm(당기), frmtrm(전기), lwfr(전전기)
      const lines = items
        .filter((it) => /배당|보통주/.test(it.se ?? ''))
        .map((it) => `    ${(it.se ?? '?').padEnd(30)} 당기=${it.thstrm ?? '-'}`);
      console.log(`  ${r.name} (${r.code}): ${items.length}항목`);
      lines.slice(0, 8).forEach((l) => console.log(l));
    }
  }
}

main().catch((err) => {
  console.error('error:', err.message);
  process.exit(1);
});
