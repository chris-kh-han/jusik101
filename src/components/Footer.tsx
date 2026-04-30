export function Footer() {
  return (
    <footer className='border-border bg-muted/30 border-t px-4 py-6'>
      <div className='text-muted-foreground mx-auto max-w-4xl space-y-2 text-center text-xs'>
        <p>
          이 서비스는 투자 조언을 제공하지 않습니다. 모든 투자의 책임은 투자자
          본인에게 있습니다.
        </p>
        <p>
          데이터 출처:{' '}
          <a
            href='https://opendart.fss.or.kr'
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-foreground underline'
          >
            금융감독원 DART
          </a>
          {' | '}
          재무제표 데이터는 실시간이 아니며, 지연이 있을 수 있습니다.
        </p>
      </div>
    </footer>
  );
}
