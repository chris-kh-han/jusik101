export default function Loading() {
  return (
    <div className='mx-auto max-w-5xl px-4 py-8'>
      <div className='mb-8'>
        <div className='bg-muted mb-4 h-4 w-16 animate-pulse rounded' />
        <div className='bg-muted h-9 w-48 animate-pulse rounded' />
        <div className='bg-muted mt-2 h-4 w-32 animate-pulse rounded' />
      </div>

      {/* Health score skeleton */}
      <div className='border-border bg-card mb-6 rounded-2xl border p-6'>
        <div className='flex items-center gap-6'>
          <div className='bg-muted h-24 w-24 animate-pulse rounded-full' />
          <div className='flex-1 space-y-2'>
            <div className='bg-muted h-6 w-40 animate-pulse rounded' />
            <div className='bg-muted h-4 w-full animate-pulse rounded' />
          </div>
        </div>
      </div>

      {/* Metrics skeleton */}
      <div className='mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3'>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className='border-border bg-card rounded-xl border p-4'>
            <div className='bg-muted h-4 w-16 animate-pulse rounded' />
            <div className='bg-muted mt-2 h-8 w-24 animate-pulse rounded' />
            <div className='bg-muted mt-2 h-4 w-20 animate-pulse rounded' />
          </div>
        ))}
      </div>

      {/* Chart skeleton */}
      <div className='border-border bg-card rounded-2xl border p-6'>
        <div className='bg-muted h-64 w-full animate-pulse rounded' />
      </div>
    </div>
  );
}
