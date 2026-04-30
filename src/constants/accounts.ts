import type { AccountMapping } from '@/types/financial';

/**
 * DART 계정과목명 → 초보자용 쉬운 한글 매핑
 * key: DART 원본 계정과목명
 * value: 쉬운 이름 + 설명 + 카테고리
 */
export const ACCOUNT_MAPPINGS: Readonly<Record<string, AccountMapping>> = {
  // ===== 재무상태표: 자산 =====
  자산총계: {
    simpleName: '회사가 가진 모든 것',
    description:
      '회사가 보유한 모든 재산의 합계예요. 현금, 건물, 기계 등 전부 포함됩니다.',
    category: '자산',
  },
  유동자산: {
    simpleName: '바로 쓸 수 있는 돈',
    description:
      '1년 안에 현금으로 바꿀 수 있는 자산이에요. 현금, 예금, 재고 등이 포함돼요.',
    category: '자산',
  },
  현금및현금성자산: {
    simpleName: '당장 쓸 수 있는 현금',
    description: '은행 계좌의 잔고처럼 바로 사용할 수 있는 돈이에요.',
    category: '자산',
  },
  단기금융상품: {
    simpleName: '잠깐 맡겨둔 돈',
    description:
      '1년 이내에 만기가 돌아오는 예금이나 적금 같은 금융상품이에요.',
    category: '자산',
  },
  매출채권: {
    simpleName: '받을 돈',
    description:
      '물건을 팔았지만 아직 돈을 받지 못한 금액이에요. 외상매출금이라고도 해요.',
    category: '자산',
  },
  재고자산: {
    simpleName: '팔려고 쌓아둔 물건',
    description: '아직 팔지 않은 제품, 원재료, 만들고 있는 물건의 가치예요.',
    category: '자산',
  },
  비유동자산: {
    simpleName: '오래 가지고 있는 재산',
    description: '공장, 건물, 특허처럼 1년 이상 오랫동안 보유하는 자산이에요.',
    category: '자산',
  },
  유형자산: {
    simpleName: '눈에 보이는 재산',
    description: '토지, 건물, 기계장치 등 실물로 존재하는 자산이에요.',
    category: '자산',
  },
  무형자산: {
    simpleName: '눈에 안 보이는 재산',
    description: '특허권, 상표권, 영업권 등 물리적 형태가 없는 자산이에요.',
    category: '자산',
  },
  투자부동산: {
    simpleName: '투자용 부동산',
    description: '임대수익이나 시세차익을 위해 보유하는 부동산이에요.',
    category: '자산',
  },
  장기금융상품: {
    simpleName: '오래 맡겨둔 돈',
    description: '1년 이상 만기인 예금이나 금융상품이에요.',
    category: '자산',
  },

  // ===== 재무상태표: 부채 =====
  부채총계: {
    simpleName: '갚아야 할 빚 전체',
    description: '회사가 갚아야 할 모든 빚의 합계예요.',
    category: '부채',
  },
  유동부채: {
    simpleName: '곧 갚아야 할 빚',
    description: '1년 안에 갚아야 하는 부채예요.',
    category: '부채',
  },
  매입채무: {
    simpleName: '아직 안 낸 대금',
    description: '원재료나 상품을 사고 아직 돈을 내지 않은 금액이에요.',
    category: '부채',
  },
  단기차입금: {
    simpleName: '단기 대출',
    description: '1년 이내에 갚아야 하는 대출금이에요.',
    category: '부채',
  },
  비유동부채: {
    simpleName: '나중에 갚아도 되는 빚',
    description: '1년 이후에 갚으면 되는 장기 부채예요.',
    category: '부채',
  },
  장기차입금: {
    simpleName: '장기 대출',
    description: '1년 이후에 갚는 대출금이에요.',
    category: '부채',
  },
  사채: {
    simpleName: '회사가 발행한 채권',
    description:
      '회사가 돈을 빌리기 위해 발행한 채권이에요. 만기에 원금을 돌려줘야 해요.',
    category: '부채',
  },

  // ===== 재무상태표: 자본 =====
  자본총계: {
    simpleName: '주주의 몫',
    description:
      '자산에서 부채를 빼고 남은 금액이에요. 주주들의 재산이라고 볼 수 있어요.',
    category: '자본',
  },
  자본금: {
    simpleName: '처음 모은 돈',
    description: '회사를 세울 때 주주들이 투자한 금액(액면가 기준)이에요.',
    category: '자본',
  },
  이익잉여금: {
    simpleName: '쌓아온 이익',
    description: '회사가 벌어서 배당하지 않고 쌓아둔 누적 이익이에요.',
    category: '자본',
  },

  // ===== 손익계산서 =====
  매출액: {
    simpleName: '총 판매금액',
    description: '회사가 물건이나 서비스를 팔아서 번 전체 금액이에요.',
    category: '매출',
  },
  매출원가: {
    simpleName: '물건 만드는 데 든 비용',
    description: '제품을 만들거나 서비스를 제공하는 데 직접 들어간 비용이에요.',
    category: '비용',
  },
  매출총이익: {
    simpleName: '기본 이익',
    description: '매출에서 원가만 빼고 남은 이익이에요. 장사의 기본 마진이죠.',
    category: '이익',
  },
  판매비와관리비: {
    simpleName: '운영비',
    description:
      '직원 급여, 광고비, 사무실 임대료 등 회사를 운영하는 데 드는 비용이에요.',
    category: '비용',
  },
  영업이익: {
    simpleName: '본업으로 남긴 돈',
    description:
      '매출에서 원가와 운영비를 빼고 남은 금액. 본업의 수익성을 보여줘요.',
    category: '이익',
  },
  영업외수익: {
    simpleName: '본업 외 번 돈',
    description: '이자수익, 배당금 등 본업이 아닌 활동에서 번 돈이에요.',
    category: '이익',
  },
  영업외비용: {
    simpleName: '본업 외 쓴 돈',
    description: '이자비용, 외환손실 등 본업 외 활동에서 발생한 비용이에요.',
    category: '비용',
  },
  법인세비용: {
    simpleName: '세금',
    description: '회사가 이익에 대해 내는 세금이에요.',
    category: '비용',
  },
  당기순이익: {
    simpleName: '최종 순이익',
    description: '세금, 이자 등 모든 비용을 빼고 최종적으로 남은 돈이에요.',
    category: '이익',
  },

  // ===== 현금흐름표 =====
  영업활동현금흐름: {
    simpleName: '장사해서 들어온 현금',
    description:
      '본업(물건 팔기, 서비스 제공)을 통해 실제로 들어오고 나간 현금이에요.',
    category: '현금흐름',
  },
  투자활동현금흐름: {
    simpleName: '투자에 쓴 현금',
    description:
      '설비 구입, 부동산 매입, 주식 투자 등에 사용하거나 회수한 현금이에요.',
    category: '현금흐름',
  },
  재무활동현금흐름: {
    simpleName: '빌리거나 갚은 현금',
    description:
      '대출을 받거나 갚고, 주식을 발행하거나 배당금을 지급한 현금이에요.',
    category: '현금흐름',
  },
} as const;

/** DART sj_div 코드 → StatementType 매핑 */
export const SJ_DIV_MAP: Readonly<Record<string, string>> = {
  BS: 'BS',
  IS: 'IS',
  CIS: 'IS',
  CF: 'CF',
  SCE: 'SCE',
} as const;

/** 계정과목명으로 간소화된 이름 조회 (없으면 원본 반환) */
export function getSimpleName(accountName: string): string {
  return ACCOUNT_MAPPINGS[accountName]?.simpleName ?? accountName;
}

/** 계정과목명으로 설명 조회 */
export function getDescription(accountName: string): string | undefined {
  return ACCOUNT_MAPPINGS[accountName]?.description;
}

/** 계정과목명으로 카테고리 조회 */
export function getCategory(accountName: string): string | undefined {
  return ACCOUNT_MAPPINGS[accountName]?.category;
}
