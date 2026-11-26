import type { NextFunction, Request, Response } from 'express';
import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus metrics for this process (scraped from GET /api/v1/metrics with METRICS_TOKEN).
 * One registry per process; route labels use the route pattern (/clients/:id), never the raw
 * URL, so the number of series stays bounded.
 */
export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const httpDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP requests by method, route pattern and status code',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

/** Express middleware: times every request once its response has been sent. */
export function httpMetrics(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // req.route is set once Express matched a handler; anything else is one series.
    const route = (req.route as { path?: string } | undefined)?.path;
    end({
      method: req.method,
      route: typeof route === 'string' ? route : 'unmatched',
      status_code: String(res.statusCode),
    });
  });
  next();
}
