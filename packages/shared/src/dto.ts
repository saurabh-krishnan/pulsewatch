/**
 * Response shapes the API returns and the web app consumes.
 * Dates are ISO strings because that is what survives JSON.
 */
import type { MonitorStatus, UserRole } from './types.js';

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

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: { path: string; message: string }[];
  };
}
