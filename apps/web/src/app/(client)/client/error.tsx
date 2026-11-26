'use client';

import { useEffect } from 'react';

/** Error boundary for signed-in pages (Next 16 passes `retry`). */
export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="card" role="alert">
      <h1 className="card-title">Something went wrong</h1>
      <p className="muted">The page could not be loaded. It may be a temporary problem.</p>
      <button type="button" className="btn" onClick={() => retry()}>
        Try again
      </button>
    </div>
  );
}
