'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { TIME_ZONE_COOKIE } from '@/lib/time-zone';

/**
 * Tells the server the browser's time zone (cookie), so server-rendered pages such as Sample
 * Update can place samples on the viewer's local days. Refreshes once when it changes.
 */
export function TimeZoneCookie() {
  const router = useRouter();
  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const current = document.cookie.match(new RegExp(`(?:^|; )${TIME_ZONE_COOKIE}=([^;]*)`))?.[1];
    if (tz && decodeURIComponent(current ?? '') !== tz) {
      document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(tz)}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    }
  }, [router]);
  return null;
}
