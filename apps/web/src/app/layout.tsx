import type { Metadata } from 'next';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'FLUX',
  description: 'Fluid & Laboratory Unified eXchange',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Render per request, so every page carries this request's CSP nonce (see proxy.ts).
  await connection();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
