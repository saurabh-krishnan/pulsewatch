/**
 * Fault-injection service (guide 4 "Demo target", built out in Phase 2).
 *
 *   GET  /health        -> behaves according to the current mode
 *   GET  /mode          -> { mode }
 *   POST /mode {mode}   -> healthy | slow | failing
 *
 * Point a PulseWatch monitor at /health, then flip the mode to produce a
 * repeatable outage for demos and worker tests.
 */
import express from 'express';

type Mode = 'healthy' | 'slow' | 'failing';

const PORT = Number(process.env.DEMO_TARGET_PORT ?? 4100);
const SLOW_DELAY_MS = Number(process.env.DEMO_SLOW_DELAY_MS ?? 8000);

let mode: Mode = 'healthy';

const app = express();
app.use(express.json());

app.get('/health', async (_req, res) => {
  if (mode === 'slow') {
    await new Promise((r) => setTimeout(r, SLOW_DELAY_MS));
    return res.json({ status: 'ok', mode, slow: true });
  }
  if (mode === 'failing') {
    return res.status(503).json({
      status: 'error',
      mode,
      error: `Timeout after 5000ms connecting to 10.0.3.17:5432 (request ${crypto.randomUUID()})`,
    });
  }
  return res.json({ status: 'ok', mode });
});

app.get('/mode', (_req, res) => res.json({ mode }));

/**
 * Webhook sink, so alerting can be tested end to end without pointing at a
 * real Discord server. Set DISCORD_WEBHOOK_URL=http://localhost:4100/webhook
 * and the captured payloads show up on GET /webhook.
 */
const captured: { receivedAt: string; body: unknown }[] = [];

app.post('/webhook', (req, res) => {
  captured.push({ receivedAt: new Date().toISOString(), body: req.body });
  console.log(`[demo-target] webhook captured (${captured.length} total)`);
  // Discord answers 204 on success; mirror that so the client path is realistic.
  res.status(204).send();
});

app.get('/webhook', (_req, res) => res.json({ count: captured.length, captured }));

app.delete('/webhook', (_req, res) => {
  captured.length = 0;
  res.status(204).send();
});

app.post('/mode', (req, res) => {
  const next = req.body?.mode;
  if (next !== 'healthy' && next !== 'slow' && next !== 'failing') {
    return res
      .status(400)
      .json({ error: { code: 'BAD_MODE', message: 'mode must be healthy | slow | failing' } });
  }
  mode = next;
  console.log(`[demo-target] mode -> ${mode}`);
  return res.json({ mode });
});

app.listen(PORT, () => {
  console.log(`[demo-target] listening on http://localhost:${PORT} (mode: ${mode})`);
});
