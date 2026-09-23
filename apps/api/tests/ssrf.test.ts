/**
 * The API's half of the SSRF defence: a monitor pointing at a private or
 * reserved address is refused when saved, with a reason.
 *
 * These run with the production policy (ALLOW_PRIVATE_MONITOR_TARGETS=false)
 * and MONITOR_HOST_ALLOWLIST=10.1.2.3, set in setup.ts. None of them need the
 * network: blocked targets are literals or reserved names, and the "allowed"
 * hosts use the .test TLD, which never resolves.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, makeMonitor, makeService, makeUser, resetDb, VALID_MONITOR } from './helpers.js';

let admin: string;
let serviceId: number;

beforeEach(async () => {
  await resetDb();
  admin = (await makeUser('admin')).token;
  serviceId = (await makeService('payments-api')).id;
});

const createMonitor = (url: string) =>
  api()
    .post(`/api/services/${serviceId}/monitors`)
    .set(bearer(admin))
    .send({ ...VALID_MONITOR, url });

describe('creating a monitor', () => {
  it.each([
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/iam/'],
    ['loopback', 'http://127.0.0.1:5432/'],
    ['localhost by name', 'http://localhost:4000/api/health'],
    ['private 10/8', 'http://10.0.0.5/admin'],
    ['private 172.16/12', 'http://172.16.0.1/'],
    ['private 192.168/16', 'http://192.168.1.1/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv4-mapped metadata', 'http://[::ffff:169.254.169.254]/'],
    ['decimal-encoded loopback', 'http://2130706433/'],
    ['hex-encoded loopback', 'http://0x7f000001/'],
    ['metadata behind a username', 'http://ok.example.test@169.254.169.254/'],
  ])('refuses %s', async (_name, url) => {
    const res = await createMonitor(url);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TARGET_NOT_ALLOWED');
    expect(res.body.error.message).toMatch(/^Monitor URL is not allowed: /);
  });

  it('refuses credentials embedded in the URL', async () => {
    const res = await createMonitor('https://user:hunter2@api.example.test/health');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/embedded credentials/);
  });

  it('explains which range was hit', async () => {
    const res = await createMonitor('http://169.254.169.254/');
    expect(res.body.error.message).toMatch(/metadata/);
  });

  it('accepts an ordinary public hostname', async () => {
    expect((await createMonitor('https://api.example.test/health')).status).toBe(201);
  });

  it('accepts exactly the allow-listed private address, and not its neighbour', async () => {
    expect((await createMonitor('http://10.1.2.3/health')).status).toBe(201);
    expect((await createMonitor('http://10.1.2.4/health')).status).toBe(400);
  });

  it('never stores a refused monitor', async () => {
    await createMonitor('http://169.254.169.254/');
    const list = await api().get(`/api/services/${serviceId}/monitors`).set(bearer(admin));
    expect(list.body).toEqual([]);
  });
});

describe('editing a monitor', () => {
  it('cannot be used to point an existing monitor inward', async () => {
    // Checking only on create would make PATCH the way around it.
    const monitor = await makeMonitor(serviceId, 'https://api.example.test/health');
    const res = await api()
      .patch(`/api/monitors/${monitor.id}`)
      .set(bearer(admin))
      .send({ url: 'http://169.254.169.254/latest/meta-data/' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TARGET_NOT_ALLOWED');
  });

  it('still allows edits that do not touch the URL', async () => {
    const monitor = await makeMonitor(serviceId, 'https://api.example.test/health');
    const res = await api()
      .patch(`/api/monitors/${monitor.id}`)
      .set(bearer(admin))
      .send({ status: 'paused' });
    expect(res.status).toBe(200);
  });
});
