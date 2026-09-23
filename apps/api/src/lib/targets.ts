import { checkMonitorUrl } from '@pulsewatch/shared/ssrf';
import { targetPolicy } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * First line of the SSRF defence: refuse to save a monitor that points at a
 * private or reserved address, with a message that says why. The worker checks
 * again before every request and at connect time, so this is about a clear
 * error at the moment of the mistake, not the only enforcement.
 */
export async function assertAllowedTarget(url: string): Promise<void> {
  const result = await checkMonitorUrl(url, targetPolicy);
  if (!result.ok) {
    throw new HttpError(400, 'TARGET_NOT_ALLOWED', `Monitor URL is not allowed: ${result.reason}`);
  }
}
