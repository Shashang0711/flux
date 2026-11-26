/**
 * Cookie with the browser's IANA time zone (set by <TimeZoneCookie />). Kept in a plain module:
 * server components cannot read values exported from 'use client' files.
 */
export const TIME_ZONE_COOKIE = 'flux_tz';
