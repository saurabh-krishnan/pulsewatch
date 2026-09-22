/**
 * Response shapes the API returns and the web app consumes.
 * Dates are ISO strings because that is what survives JSON.
 */
import type {
  IncidentSeverity,
  IncidentSource,
  IncidentStatus,
  MonitorStatus,
  UserRole,
} from './types.js';

export interface UserDto {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: UserDto;
}

export interface ServiceDto {
  id: number;
  name: string;
  description: string | null;
  ownerId: number | null;
  ownerName: string | null;
  tags: string[];
  isPublic: boolean;
  createdAt: string;
  monitorCount: number;
}

export interface MonitorDto {
  id: number;
  serviceId: number;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
  status: MonitorStatus;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  nextCheckAt: string;
  lastCheckedAt: string | null;
}

export interface IncidentEventDto {
  id: number;
  type: string;
  message: string | null;
  createdAt: string;
  /** null means the system did it, not a person. */
  userName: string | null;
}

export interface IncidentDto {
  id: number;
  serviceId: number;
  serviceName: string;
  monitorId: number | null;
  monitorUrl: string | null;
  title: string;
  description: string | null;
  errorType: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: IncidentSource;
  tags: string[];
  openedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  /** Present on the detail response only. */
  events?: IncidentEventDto[];
}

export interface CheckResultDto {
  id: number;
  checkedAt: string;
  success: boolean;
  statusCode: number | null;
  responseTimeMs: number | null;
  errorMessage: string | null;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}
