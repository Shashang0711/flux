export interface HealthStatus {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
  checks: { database: 'up' };
}
