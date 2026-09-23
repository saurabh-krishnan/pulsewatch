export type MonitorStatus = 'unknown' | 'up' | 'down' | 'paused';
export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type IncidentSource = 'monitor' | 'manual' | 'api';
export type UserRole = 'admin' | 'engineer' | 'viewer';

/** Error buckets used as the first half of a fingerprint key. */
export type ErrorType =
  | 'TIMEOUT'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'CONNECTION_REFUSED'
  | 'DNS_FAILURE'
  | 'TLS_ERROR'
  | 'UNEXPECTED_STATUS'
  | 'DB_TIMEOUT'
  /** Refused by the SSRF policy: the target is a private or reserved address. */
  | 'BLOCKED_TARGET'
  | 'UNKNOWN';
