'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDebounce } from '@/hooks/useDebounce';
import { Search, X } from 'lucide-react';
import type { SearchResult } from '@/types/financial';

export function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebounce(query, 300);

  const fetchResults = useCallback(async (searchQuery: string) => {
    if (searchQuery.length === 0) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(searchQuery)}`,
      );
      if (response.ok) {
        const data = (await response.json()) as {
          results?: readonly SearchResult[];
        };
        setResults(data.results ?? []);
        setIsOpen(true);
      }
    } catch {
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResults(debouncedQuery);
  }, [debouncedQuery, fetchResults]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const navigateToCompany = useCallback(
    (corpCode: string) => {
      setIsOpen(false);
      setQuery('');
      router.push(`/company/${corpCode}`);
    },
    [router],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen || results.length === 0) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < results.length - 1 ? prev + 1 : 0,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : results.length - 1,
          );
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && selectedIndex < results.length) {
            navigateToCompany(results[selectedIndex].corpCode);
          }
          break;
        case 'Escape':
          setIsOpen(false);
          setSelectedIndex(-1);
          break;
      }
    },
    [isOpen, results, selectedIndex, navigateToCompany],
  );

  return (
    <div ref={containerRef} className='relative w-full max-w-xl'>
      <div className='relative'>
        <Search className='text-muted-foreground absolute top-1/2 left-4 h-5 w-5 -translate-y-1/2' />
        <input
          ref={inputRef}
          type='text'
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setIsOpen(true);
          }}
          placeholder='기업명 또는 종목코드 검색 (삼성전자, 005930...)'
          className='border-border bg-card placeholder:text-muted-foreground focus:ring-primary/20 h-14 w-full rounded-2xl border pr-12 pl-12 text-base shadow-sm transition-shadow outline-none focus:shadow-md focus:ring-2'
          autoComplete='off'
          spellCheck={false}
        />
        {query.length > 0 && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setIsOpen(false);
              inputRef.current?.focus();
            }}
            className='text-muted-foreground hover:text-foreground absolute top-1/2 right-4 -translate-y-1/2'
            aria-label='검색어 지우기'
          >
            <X className='h-5 w-5' />
          </button>
        )}
      </div>

      {isOpen && results.length > 0 && (
        <ul
          className='border-border bg-card absolute z-50 mt-2 w-full overflow-hidden rounded-xl border shadow-lg'
          role='listbox'
        >
          {results.map((result, index) => (
            <li
              key={result.corpCode}
              role='option'
              aria-selected={index === selectedIndex}
              className={`flex cursor-pointer items-center justify-between px-4 py-3 transition-colors ${
                index === selectedIndex
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted'
              }`}
              onClick={() => navigateToCompany(result.corpCode)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <div>
                <span className='font-medium'>{result.corpName}</span>
                <span className='text-muted-foreground ml-2 text-sm'>
                  {result.stockCode}
                </span>
              </div>
              <span className='bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs'>
                {result.listedMarket}
              </span>
            </li>
          ))}
        </ul>
      )}

      {isOpen && isLoading && (
        <div className='border-border bg-card text-muted-foreground absolute z-50 mt-2 w-full rounded-xl border p-4 text-center text-sm shadow-lg'>
          검색 중...
        </div>
      )}

      {isOpen && !isLoading && query.length > 0 && results.length === 0 && (
        <div className='border-border bg-card text-muted-foreground absolute z-50 mt-2 w-full rounded-xl border p-4 text-center text-sm shadow-lg'>
          검색 결과가 없습니다
        </div>
      )}
    </div>
  );
}
