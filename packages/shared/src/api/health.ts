/**
 * Readiness (GET /health): 503 when the database or file storage cannot be reached. A stale
 * notification worker makes the status "degraded" (still serving, but emails are not going out).
 * Liveness (GET /health/live) only says the process is running.
 */
export interface HealthStatus {
  status: 'ok' | 'degraded';
  version: string;
  uptimeSeconds: number;
  checks: {
    database: 'up';
    storage: 'up';
    /** off: this instance does not run the worker. */
    notifications: 'up' | 'stale' | 'off';
  };
}
