import compression from 'compression';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { listEvents, publishEvent } from './botEventBus.js';
import { evaluateBusIngressPolicy } from './busIngressPolicy.js';
import {
  buildChromeBridgeHealthEvent,
  buildChromeBridgeMessageEvent,
  isLocalBridgeAddress,
} from './chromeDiscordBridge.js';
import { evaluateOperatorAuthPolicy } from './operatorAuthPolicy.js';
import { ArchiveGeneralApiClient, GeneralApiStore } from './generalApi.js';
import { evaluateRelayPolicy } from './relayPolicy.js';
import type { NextFunction, Request, Response } from 'express';
import type {
  AnyPayload,
  EdgeAutomation,
  EdgeDecisionFeed,
  EdgeReadiness,
  PulseAccount,
  PulseEdgeStatus,
  PulseTickerResponse,
  ServiceResult,
  SuiteConfig,
  SuiteSnapshot,
} from '../src/types.js';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

const DEFAULT_EDGE_URL = 'http://localhost:8000';
const DEFAULT_PULSE_URL = 'http://localhost:8001';
const DEFAULT_REFRESH_MS = 5000;
const DEFAULT_PRODUCTION_PORT = 3005;
const DEFAULT_API_PORT = 8005;
const DEFAULT_LISTEN_HOST = '127.0.0.1';
const REQUEST_TIMEOUT_MS = numberFrom(process.env.SENTINEL_CORE_REQUEST_TIMEOUT_MS, 4500);
const SLOW_REQUEST_TIMEOUT_MS = numberFrom(process.env.SENTINEL_CORE_SLOW_REQUEST_TIMEOUT_MS, 15000);

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function cliValue(name: string) {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return undefined;
}

function numberFrom(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveListenHost() {
  return (cliValue('--host') || process.env.HOST || DEFAULT_LISTEN_HOST).trim() || DEFAULT_LISTEN_HOST;
}

function suiteConfig(): SuiteConfig {
  return {
    edgeBaseUrl: stripTrailingSlash(process.env.EDGE_API_URL || DEFAULT_EDGE_URL),
    pulseBaseUrl: stripTrailingSlash(process.env.PULSE_API_URL || DEFAULT_PULSE_URL),
    pulseKeyConfigured: Boolean(process.env.PULSE_EDGE_API_KEY),
    refreshMs: numberFrom(process.env.REFRESH_MS, DEFAULT_REFRESH_MS),
  };
}

function configError<T>(error: string): ServiceResult<T> {
  return {
    ok: false,
    error,
    updatedAt: new Date().toISOString(),
  };
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    const detail = record.detail;
    if (typeof detail === 'string') return detail;
    if (detail && typeof detail === 'object' && typeof (detail as Record<string, unknown>).message === 'string') {
      return String((detail as Record<string, unknown>).message);
    }
    if (typeof record.error === 'string') return record.error;
    if (typeof record.message === 'string') return record.message;
  }
  return fallback;
}

async function fetchJson<T>(
  baseUrl: string,
  endpoint: string,
  headers: HeadersInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ServiceResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...headers,
      },
    });

    const latencyMs = Math.round(performance.now() - started);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : undefined;

    if (!response.ok) {
      return {
        ok: false,
        data: payload as T,
        status: response.status,
        latencyMs,
        updatedAt: new Date().toISOString(),
        error: getErrorMessage(payload, `${response.status} ${response.statusText}`),
      };
    }

    return {
      ok: true,
      data: payload as T,
      status: response.status,
      latencyMs,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      updatedAt: new Date().toISOString(),
      error: isAbort ? `Request timed out after ${timeoutMs} ms` : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postJson<T>(
  baseUrl: string,
  endpoint: string,
  body: unknown,
  headers: HeadersInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<ServiceResult<T>> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    const latencyMs = Math.round(performance.now() - started);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : undefined;

    if (!response.ok) {
      return {
        ok: false,
        data: payload as T,
        status: response.status,
        latencyMs,
        updatedAt: new Date().toISOString(),
        error: getErrorMessage(payload, `${response.status} ${response.statusText}`),
      };
    }

    return {
      ok: true,
      data: payload as T,
      status: response.status,
      latencyMs,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
      updatedAt: new Date().toISOString(),
      error: isAbort ? `Request timed out after ${timeoutMs} ms` : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function pulseEdgeHeaders(): HeadersInit | null {
  const apiKey = process.env.PULSE_EDGE_API_KEY;
  return apiKey ? { 'X-API-Key': apiKey } : null;
}

function ensureLocalBridgeRequest(request: Request, response: Response) {
  if (String(process.env.CHROME_BRIDGE_ALLOW_REMOTE || '').toLowerCase().match(/^(1|true|yes)$/)) {
    return true;
  }
  if (isLocalBridgeAddress(request.ip) || isLocalBridgeAddress(request.socket.remoteAddress)) {
    return true;
  }
  response.status(403).json({ error: 'chrome bridge endpoint only accepts local requests' });
  return false;
}

async function loadSnapshot(): Promise<SuiteSnapshot> {
  const config = suiteConfig();
  const pulseHeaders = pulseEdgeHeaders();
  const missingPulseKey = 'PULSE_EDGE_API_KEY is not configured on the Sentinel Core server.';
  const edge = <T = AnyPayload>(endpoint: string) => fetchJson<T>(config.edgeBaseUrl, endpoint);
  const edgeSlow = <T = AnyPayload>(endpoint: string) => fetchJson<T>(config.edgeBaseUrl, endpoint, {}, SLOW_REQUEST_TIMEOUT_MS);
  const pulse = <T = AnyPayload>(endpoint: string) => fetchJson<T>(config.pulseBaseUrl, endpoint);
  const pulseEdge = <T>(endpoint: string) =>
    pulseHeaders ? fetchJson<T>(config.pulseBaseUrl, endpoint, pulseHeaders) : Promise.resolve(configError<T>(missingPulseKey));
  const pulseEdgeSlow = <T>(endpoint: string) =>
    pulseHeaders
      ? fetchJson<T>(config.pulseBaseUrl, endpoint, pulseHeaders, SLOW_REQUEST_TIMEOUT_MS)
      : Promise.resolve(configError<T>(missingPulseKey));

  const [
    edgeLive,
    edgeHealth,
    edgeReady,
    edgeRateLimit,
    edgeStats,
    edgeNotifications,
    edgeMarkets,
    edgeQueue,
    edgeTickers,
    edgeProvidersHealth,
    edgeMarketDataProviders,
    edgeAutomation,
    edgeDecisions,
    edgeStrategies,
    edgePuzzleKey,
    edgeDryRun,
    edgeSimulationLab,
    edgeBacktestRuns,
    edgeScannerCatalog,
    edgeConfigHash,
    edgeCorrelation,
    edgeHandoffSchema,
    edgePulseStatus,
    edgePulseAccount,
    edgePulsePositions,
    edgePulseQueue,
    pulseHealth,
    pulseEdgeStatus,
    pulseAccount,
    pulseTickers,
    pulseBotStatus,
    pulseBotSnapshot,
    pulseStrategiesRegistry,
    pulseStrategiesPresets,
    pulseTrades,
    pulsePositions,
    pulsePendingSells,
    pulseBrokers,
    pulseBrokerStatus,
    pulseMarkets,
    pulseFxRates,
    pulseReplayStatus,
    pulseReplaySessions,
    pulseRateLimits,
    pulseAuditLogs,
    pulseTraces,
    pulseSettings,
    pulseRiskStatus,
    pulseRiskLimits,
    pulseReconciliationSummary,
    pulsePortfolioStats,
    pulseOrders,
    pulseOrderStats,
    pulseAnalyticsPortfolio,
    pulseOpsServices,
    pulseSloSummary,
  ] = await Promise.all([
    edge<Record<string, unknown>>('/api/live'),
    edge('/api/health'),
    edge<EdgeReadiness>('/api/ready'),
    edge('/api/rate-limit/status'),
    edge('/api/stats'),
    edge('/api/notifications/status'),
    edge('/api/markets'),
    edge('/api/queue'),
    edge('/api/tickers'),
    edge('/api/providers/health'),
    edge('/api/market-data/providers'),
    edge<EdgeAutomation>('/api/automation'),
    edge<EdgeDecisionFeed>('/api/decisions'),
    edge('/api/strategies'),
    edge('/api/strategies/puzzle-key/status'),
    edge('/api/dry-run/status'),
    edge('/api/simulation-lab/status'),
    edge('/api/backtest/runs'),
    edge('/api/scanner-workbench/catalog'),
    edge('/api/config/hash'),
    edge('/api/correlation'),
    edge<Record<string, unknown>>('/api/pulse/handoff/schema'),
    edge('/api/pulse/status'),
    edgeSlow<Record<string, unknown>>('/api/pulse/account'),
    edge<Record<string, unknown>>('/api/pulse/positions'),
    edge('/api/pulse/queue'),
    pulse<Record<string, unknown>>('/api/health'),
    pulseEdge<PulseEdgeStatus>('/api/edge/status'),
    pulseEdgeSlow<PulseAccount>('/api/edge/account/status'),
    pulseEdge<PulseTickerResponse>('/api/edge/tickers'),
    pulseEdge<AnyPayload>('/api/edge/bot/status'),
    pulseEdge<AnyPayload>('/api/edge/bot/snapshot'),
    pulseEdge<AnyPayload>('/api/edge/strategies/registry'),
    pulseEdge<AnyPayload>('/api/edge/strategies/presets'),
    pulseEdge<AnyPayload>('/api/edge/trades'),
    pulseEdge<AnyPayload>('/api/edge/positions'),
    pulseEdge<AnyPayload>('/api/edge/positions/pending-sells'),
    pulseEdge<AnyPayload>('/api/edge/brokers/status'),
    pulseEdge<AnyPayload>('/api/edge/brokers/status'),
    pulseEdge<AnyPayload>('/api/edge/markets'),
    pulseEdge<AnyPayload>('/api/edge/fx-rates'),
    pulseEdge<AnyPayload>('/api/edge/replay/status'),
    pulseEdge<AnyPayload>('/api/edge/replay/sessions'),
    pulseEdge<AnyPayload>('/api/edge/rate-limits'),
    pulseEdge<AnyPayload>('/api/edge/audit-logs'),
    pulse('/api/traces'),
    pulseEdge<AnyPayload>('/api/edge/settings'),
    pulseEdge<AnyPayload>('/api/edge/risk/status'),
    pulseEdge<AnyPayload>('/api/edge/risk/limits'),
    pulseEdge<AnyPayload>('/api/edge/reconciliation/summary'),
    pulseEdge<AnyPayload>('/api/edge/portfolio/stats'),
    pulseEdgeSlow<AnyPayload>('/api/edge/orders'),
    pulseEdge<AnyPayload>('/api/edge/orders/stats'),
    pulseEdge<AnyPayload>('/api/edge/analytics/portfolio'),
    pulseEdge<AnyPayload>('/api/edge/ops/services'),
    pulseEdge<AnyPayload>('/api/edge/slo/summary'),
  ]);

  return {
    config,
    edgeLive,
    edgeHealth,
    edgeReady,
    edgeRateLimit,
    edgeStats,
    edgeNotifications,
    edgeMarkets,
    edgeQueue,
    edgeTickers,
    edgeProvidersHealth,
    edgeMarketDataProviders,
    edgeAutomation,
    edgeDecisions,
    edgeStrategies,
    edgePuzzleKey,
    edgeDryRun,
    edgeSimulationLab,
    edgeBacktestRuns,
    edgeScannerCatalog,
    edgeConfigHash,
    edgeCorrelation,
    edgeHandoffSchema,
    edgePulseStatus,
    edgePulseAccount,
    edgePulsePositions,
    edgePulseQueue,
    pulseHealth,
    pulseEdgeStatus,
    pulseAccount,
    pulseTickers,
    pulseBotStatus,
    pulseBotSnapshot,
    pulseStrategiesRegistry,
    pulseStrategiesPresets,
    pulseTrades,
    pulsePositions,
    pulsePendingSells,
    pulseBrokers,
    pulseBrokerStatus,
    pulseMarkets,
    pulseFxRates,
    pulseReplayStatus,
    pulseReplaySessions,
    pulseRateLimits,
    pulseAuditLogs,
    pulseTraces,
    pulseSettings,
    pulseRiskStatus,
    pulseRiskLimits,
    pulseReconciliationSummary,
    pulsePortfolioStats,
    pulseOrders,
    pulseOrderStats,
    pulseAnalyticsPortfolio,
    pulseOpsServices,
    pulseSloSummary,
  };
}

const app = express();
const distPath = path.resolve(process.cwd(), 'dist');
const distIndex = path.join(distPath, 'index.html');
const port = numberFrom(cliValue('--port') || process.env.PORT, process.env.NODE_ENV === 'production' ? DEFAULT_PRODUCTION_PORT : DEFAULT_API_PORT);
const host = resolveListenHost();

function requireOperatorAccess(request: Request, response: Response, next: NextFunction) {
  const decision = evaluateOperatorAuthPolicy({
    host,
    nodeEnv: process.env.NODE_ENV,
    expectedSecret: process.env.SENTINEL_CORE_OPERATOR_SECRET,
    providedSecret: request.get('X-Sentinel-Core-Operator-Secret'),
  });
  if (!decision.allowed) {
    response.status(decision.status).json({ error: decision.error });
    return;
  }
  next();
}

app.disable('x-powered-by');
app.use(compression());
app.use(express.json({ limit: '512kb' }));
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      },
    },
  }),
);
app.use('/api', requireOperatorAccess);

app.get('/api/sentinel-core/config', (_request, response) => {
  response.json(suiteConfig());
});

const generalApiStore = new GeneralApiStore();
const generalApiClient = new ArchiveGeneralApiClient(generalApiStore);

app.get('/api/general-api', (_request, response) => {
  try {
    response.json({ settings: generalApiStore.public(), contract: 'archive.general.v1', boundary: 'Archive replays and brokers; Sentinel Core only observes.' });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.put('/api/general-api', (request, response) => {
  try {
    response.json({ settings: generalApiStore.public(generalApiStore.save(request.body || {})) });
  } catch (error) {
    response.status(422).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/general-api/test', async (_request, response) => {
  try {
    response.json(await generalApiClient.test());
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/general-api/register', async (_request, response) => {
  try {
    response.json(await generalApiClient.register());
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/general-api/account', async (_request, response) => {
  try {
    response.json(await generalApiClient.account());
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/sentinel-core/snapshot', async (_request, response) => {
  response.json(await loadSnapshot());
});

app.get('/api/sentinel-core/bus/events', (request, response) => {
  const limit = numberFrom(String(request.query.limit || ''), 100);
  const target = typeof request.query.target === 'string' ? request.query.target : undefined;
  const events = listEvents(limit, target);
  response.json({ events, count: events.length });
});

app.post('/api/sentinel-core/bus/events', (request, response) => {
  try {
    const policy = evaluateBusIngressPolicy({
      enabled: process.env.SENTINEL_CORE_BUS_INGRESS_ENABLED,
      expectedSecret: process.env.SENTINEL_CORE_BUS_INGRESS_SECRET,
      providedSecret: request.get('X-Sentinel-Core-Bus-Secret'),
      event: request.body || {},
    });
    if (!policy.allowed) {
      response.status(policy.status).json({ error: policy.error });
      return;
    }
    response.json({ event: publishEvent(request.body || {}) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/discord/chrome-bridge/message', (request, response) => {
  try {
    if (!ensureLocalBridgeRequest(request, response)) return;
    const event = buildChromeBridgeMessageEvent(request.body || {});
    const rawText = String(event.payload?.raw_text || '');
    if (!rawText.trim()) {
      response.status(400).json({ error: 'message content or embed text is required' });
      return;
    }
    const accepted = publishEvent(event);
    response.json({
      status: 'accepted',
      event_id: String(event.payload?.event_id || ''),
      raw_text: rawText,
      bus_event_id: accepted.event_id,
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/discord/chrome-bridge/heartbeat', (request, response) => {
  try {
    if (!ensureLocalBridgeRequest(request, response)) return;
    const event = buildChromeBridgeHealthEvent(request.body || {});
    const accepted = publishEvent(event);
    const healthy = Boolean(event.payload?.healthy);
    response.json({
      healthy,
      status: healthy ? 'healthy' : 'unhealthy',
      issues: healthy ? [] : ['chrome bridge is disabled or not ok'],
      last_heartbeat: event.payload,
      bus_event_id: accepted.event_id,
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/sentinel-core/bus/ecosystem', async (request, response) => {
  const config = suiteConfig();
  const limit = numberFrom(String(request.query.limit || ''), 100);
  const pulseHeaders = pulseEdgeHeaders() || {};
  const [local, edge, pulse] = await Promise.all([
    Promise.resolve({ ok: true, data: { events: listEvents(limit), count: listEvents(limit).length }, updatedAt: new Date().toISOString() }),
    fetchJson(config.edgeBaseUrl, `/api/bus/events?limit=${limit}`),
    fetchJson(config.pulseBaseUrl, `/api/bus/events?limit=${limit}`, pulseHeaders),
  ]);
  response.json({ local, edge, pulse });
});

app.post('/api/sentinel-core/bus/relay', async (request, response) => {
  const config = suiteConfig();
  const body = request.body || {};
  const policy = evaluateRelayPolicy({
    enabled: process.env.SENTINEL_CORE_RELAY_ENABLED,
    expectedSecret: process.env.SENTINEL_CORE_RELAY_SECRET,
    providedSecret: request.get('X-Sentinel-Core-Relay-Secret'),
    targetService: body.targetService,
    target_service: body.target_service,
    endpoint: body.endpoint,
    event: body.event || body,
  });
  if (!policy.allowed) {
    response.status(policy.status).json({ error: policy.error });
    return;
  }
  const event = body.event || body;
  const pulseHeaders = pulseEdgeHeaders();
  if (policy.target === 'pulse' && !pulseHeaders) {
    response.status(503).json({ error: 'Pulse relay requires PULSE_EDGE_API_KEY on the Sentinel Core server.' });
    return;
  }
  const routes: Record<string, { baseUrl: string; headers?: HeadersInit }> = {
    edge: { baseUrl: config.edgeBaseUrl },
    pulse: { baseUrl: config.pulseBaseUrl, headers: pulseHeaders || undefined },
  };
  const route = routes[policy.target];
  const relay = await postJson(route.baseUrl, policy.endpoint, event, route.headers || {});
  publishEvent({
    event_type: 'sentinel-core.relay.attempted',
    source: 'sentinel-core',
    target: policy.target,
    payload: { endpoint: policy.endpoint, relay },
  });
  response.json({ relay });
});

if (fs.existsSync(distIndex)) {
  app.use(express.static(distPath));
  app.get(/.*/, (_request, response) => {
    response.sendFile(distIndex);
  });
}

app.listen(port, host, () => {
  process.stdout.write(`Sentinel Core listening on http://${host}:${port}\n`);
});
