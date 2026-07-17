import React from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  Bot,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Gauge,
  GitBranch,
  LineChart,
  ListChecks,
  Network,
  RadioTower,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  SlidersHorizontal,
  Table2,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  loadGeneralApiSettings,
  loadSuiteSnapshot,
  registerGeneralApi,
  saveGeneralApiSettings,
  testGeneralApi,
} from './api';
import { normalizeExecutionLifecycle } from './botLifecycle';
import type {
  AnyPayload,
  EdgeDecisionFeed,
  GeneralApiSettings,
  PulseAccount,
  PulsePosition,
  PulseTicker,
  PulseTickerResponse,
  ServiceResult,
  ServiceTone,
  SuiteSnapshot,
} from './types';

type TabKey = 'matrix' | 'edge' | 'pulse' | 'trade' | 'risk' | 'strategy' | 'ops' | 'general-api';

type Feature = {
  name: string;
  source: 'Edge' | 'Pulse' | 'Sentinel Core';
  endpoint: string;
  service?: ServiceResult<unknown>;
  detail?: string;
  icon?: React.ReactNode;
};

type MatrixRow = {
  label: string;
  route: string;
  service?: ServiceResult<unknown>;
  detail?: string;
};

function numberFrom(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : Number.NaN;
}

function formatMoney(value: unknown) {
  const number = numberFrom(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(number);
}

function formatPct(value: unknown) {
  const number = numberFrom(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  return `${number.toFixed(2)}%`;
}

function formatNumber(value: unknown) {
  const number = numberFrom(value);
  if (!Number.isFinite(number)) return 'Unavailable';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(number);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function compactValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return 'Unavailable';
}

function serviceTone(service?: ServiceResult<unknown>): ServiceTone {
  if (!service) return 'pending';
  return service.ok ? 'good' : 'bad';
}

function healthTone(ok: boolean | undefined): ServiceTone {
  if (ok === undefined) return 'pending';
  return ok ? 'good' : 'bad';
}

function statusWord(service?: ServiceResult<unknown>) {
  if (!service) return 'Waiting';
  if (service.ok) return 'Online';
  if (service.status) return `${service.status}`;
  return 'Offline';
}

function latencyWord(service?: ServiceResult<unknown>) {
  if (!service) return 'pending';
  if (typeof service.latencyMs === 'number') return `${service.latencyMs} ms`;
  return service.ok ? 'ok' : 'failed';
}

function dataCount(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  const record = asRecord(value);
  const candidateKeys = [
    'items',
    'data',
    'results',
    'tickers',
    'positions',
    'trades',
    'brokers',
    'markets',
    'strategies',
    'sessions',
    'orders',
    'services',
    'events',
    'decisions',
    'entries',
  ];

  for (const key of candidateKeys) {
    const candidate = record[key];
    if (Array.isArray(candidate)) return candidate.length;
    const nested = asRecord(candidate);
    for (const nestedKey of candidateKeys) {
      if (Array.isArray(nested[nestedKey])) return (nested[nestedKey] as unknown[]).length;
    }
  }

  const keys = Object.keys(record);
  return keys.length ? keys.length : null;
}

function serviceSummary(service?: ServiceResult<unknown>, detail?: string) {
  if (!service) return detail ?? 'Not sampled';
  if (!service.ok) return service.error ?? 'No response';
  const count = dataCount(service.data);
  if (count !== null) return `${count} records`;
  return detail ?? latencyWord(service);
}

function responseDetail(service?: ServiceResult<unknown>, fallback = 'No detail') {
  if (!service) return fallback;
  if (!service.ok) return service.error ?? fallback;
  if (service.status) return `HTTP ${service.status} / ${latencyWord(service)}`;
  return latencyWord(service);
}

function decisionList(feed?: EdgeDecisionFeed | AnyPayload) {
  const record = asRecord(feed);
  if (Array.isArray(record.decisions)) return record.decisions as Array<Record<string, unknown>>;
  if (Array.isArray(record.entries)) return record.entries as Array<Record<string, unknown>>;
  if (Array.isArray(record.data)) return record.data as Array<Record<string, unknown>>;
  const nested = asRecord(record.data);
  if (Array.isArray(nested.decisions)) return nested.decisions as Array<Record<string, unknown>>;
  if (Array.isArray(nested.entries)) return nested.entries as Array<Record<string, unknown>>;
  return [];
}

function latestDecision(snapshot: SuiteSnapshot | null) {
  return decisionList(snapshot?.edgeDecisions.data)[0] ?? null;
}

function normalizeAccount(account?: PulseAccount) {
  const accountRecord = asRecord(account);
  const nested = asRecord(account?.account);
  return { ...nested, ...accountRecord } as PulseAccount;
}

function extractPositions(value: unknown): PulsePosition[] {
  if (Array.isArray(value)) return value as PulsePosition[];
  const record = asRecord(value);
  const nestedAccount = asRecord(record.account);
  const candidates = [record.positions, record.data, record.results, nestedAccount.positions, nestedAccount.data];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as PulsePosition[];
    const candidateRecord = asRecord(candidate);
    if (Array.isArray(candidateRecord.positions)) return candidateRecord.positions as PulsePosition[];
  }
  return [];
}

function extractTickers(value?: PulseTickerResponse | AnyPayload): PulseTicker[] {
  if (Array.isArray(value)) return value as PulseTicker[];
  const record = asRecord(value);
  if (Array.isArray(record.tickers)) return record.tickers as PulseTicker[];
  if (Array.isArray(record.data)) return record.data as PulseTicker[];
  if (Array.isArray(record.results)) return record.results as PulseTicker[];
  return [];
}

function positionQuantity(position: PulsePosition) {
  return numberFrom(position.qty ?? position.quantity ?? 0);
}

function priceFromPosition(position?: PulsePosition | null) {
  return numberFrom(position?.current_price ?? position?.market_price ?? position?.last_price ?? position?.entry_price ?? position?.avg_entry ?? position?.average_entry);
}

function entryFromPosition(position?: PulsePosition | null) {
  return numberFrom(position?.entry_price ?? position?.avg_entry ?? position?.average_entry);
}

function positionPnl(position: PulsePosition) {
  return numberFrom(position.pnl ?? position.unrealized_pnl ?? 0);
}

function positionPnlPct(position: PulsePosition) {
  return numberFrom(position.pnl_pct ?? position.unrealized_pnl_pct ?? 0);
}

function choosePrimaryPosition(positions: PulsePosition[]) {
  return (
    positions
      .filter((position) => positionQuantity(position) > 0)
      .sort((a, b) => Math.abs(positionPnl(b)) - Math.abs(positionPnl(a)))[0] ?? null
  );
}

function countProtected(positions: PulsePosition[], tickers: PulseTicker[]) {
  const protectedSymbols = new Set(
    tickers.filter((ticker) => ticker.trailing_enabled).map((ticker) => String(ticker.symbol || '').toUpperCase()),
  );
  return positions.filter((position) => Boolean(position.trailing_enabled) || protectedSymbols.has(String(position.symbol || '').toUpperCase())).length;
}

function decisionPrice(decision: Record<string, unknown> | null) {
  if (!decision) return Number.NaN;
  return numberFrom(decision.price ?? decision.market_price ?? decision.current_price ?? decision.last_price ?? decision.entry_price);
}

function matchingPosition(symbol: string, positions: PulsePosition[]) {
  const normalized = symbol.toUpperCase();
  return positions.find((position) => String(position.symbol || '').toUpperCase() === normalized) ?? null;
}

function priceAgreement(position: PulsePosition | null, edgePosition: PulsePosition | null, decision: Record<string, unknown> | null) {
  if (!position) return { label: 'No position', tone: 'neutral' as ServiceTone };
  const pulsePrice = priceFromPosition(position);
  const edgePrice = priceFromPosition(edgePosition) || decisionPrice(decision);
  if (!Number.isFinite(pulsePrice) || !Number.isFinite(edgePrice)) {
    return { label: 'Price pending', tone: 'warn' as ServiceTone };
  }
  const driftPct = Math.abs((pulsePrice - edgePrice) / edgePrice) * 100;
  if (driftPct <= 0.2) return { label: `${driftPct.toFixed(2)}% drift`, tone: 'good' as ServiceTone };
  if (driftPct <= 1) return { label: `${driftPct.toFixed(2)}% drift`, tone: 'warn' as ServiceTone };
  return { label: `${driftPct.toFixed(2)}% drift`, tone: 'bad' as ServiceTone };
}

function okCount(features: Feature[]) {
  return features.filter((feature) => feature.service?.ok).length;
}

function useSuiteSnapshot() {
  const [snapshot, setSnapshot] = React.useState<SuiteSnapshot | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [appError, setAppError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const next = await loadSuiteSnapshot();
      setSnapshot(next);
      setAppError(null);
    } catch (error) {
      setAppError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    const refreshMs = snapshot?.config.refreshMs;
    const intervalMs = Number.isFinite(refreshMs) && refreshMs && refreshMs > 1000 ? refreshMs : 5000;
    const id = window.setInterval(refresh, intervalMs);
    return () => window.clearInterval(id);
  }, [refresh, snapshot?.config.refreshMs]);

  return { snapshot, loading, appError, refresh };
}

export function App() {
  const { snapshot, loading, appError, refresh } = useSuiteSnapshot();
  const [activeTab, setActiveTab] = React.useState<TabKey>('matrix');
  const model = buildUiModel(snapshot);
  const config = snapshot?.config;
  const edgeOk = Boolean(snapshot?.edgeLive.ok && snapshot.edgeReady.ok);
  const pulseOk = Boolean(snapshot?.pulseHealth.ok && snapshot.pulseEdgeStatus.ok);
  const totalFeatures = model.edgeFeatures.length + model.pulseFeatures.length + model.tradeFeatures.length + model.riskFeatures.length + model.strategyFeatures.length + model.opsFeatures.length;
  const totalOnline = okCount([
    ...model.edgeFeatures,
    ...model.pulseFeatures,
    ...model.tradeFeatures,
    ...model.riskFeatures,
    ...model.strategyFeatures,
    ...model.opsFeatures,
  ]);

  const tabs: Array<{ key: TabKey; label: string; icon: React.ReactNode; count: string }> = [
    { key: 'matrix', label: 'Matrix', icon: <Table2 size={15} />, count: `${totalOnline}/${totalFeatures}` },
    { key: 'edge', label: 'Edge', icon: <RadioTower size={15} />, count: `${okCount(model.edgeFeatures)}/${model.edgeFeatures.length}` },
    { key: 'pulse', label: 'Pulse', icon: <Bot size={15} />, count: `${okCount(model.pulseFeatures)}/${model.pulseFeatures.length}` },
    { key: 'trade', label: 'Trade State', icon: <ArrowRightLeft size={15} />, count: `${model.positions.length}` },
    { key: 'risk', label: 'Risk', icon: <ShieldAlert size={15} />, count: `${okCount(model.riskFeatures)}/${model.riskFeatures.length}` },
    { key: 'strategy', label: 'Strategy Lab', icon: <LineChart size={15} />, count: `${okCount(model.strategyFeatures)}/${model.strategyFeatures.length}` },
    { key: 'ops', label: 'Ops', icon: <Activity size={15} />, count: `${okCount(model.opsFeatures)}/${model.opsFeatures.length}` },
    { key: 'general-api', label: 'General API', icon: <Network size={15} />, count: 'v1' },
  ];

  return (
    <div className="app-shell">
      <div className="grid-backdrop" />
      <header className="topbar">
        <div className="brand">
          <span className="brand-kicker">Tetradim Sentinel</span>
          <span className="brand-title">Sentinel Core</span>
        </div>

        <div className="command-strip" aria-label="Service status">
          <StatusPill label="Edge" detail={latencyWord(snapshot?.edgeLive)} tone={edgeOk ? 'good' : 'bad'} />
          <StatusPill label="Pulse" detail={latencyWord(snapshot?.pulseHealth)} tone={pulseOk ? 'good' : 'bad'} />
          <StatusPill label="Bridge" detail={model.agreement.label} tone={model.agreement.tone} />
          <StatusPill label="Refresh" detail={`${Math.round((config?.refreshMs ?? 5000) / 1000)} sec`} tone="neutral" />
        </div>

        <button className="refresh-button" type="button" onClick={refresh} title="Refresh snapshot">
          <RefreshCcw size={14} />
          <span>Refresh</span>
        </button>
      </header>

      <nav className="tabbar" aria-label="Sentinel Core sections">
        {tabs.map((tab) => (
          <button key={tab.key} className={`tab ${activeTab === tab.key ? 'active' : ''}`} type="button" onClick={() => setActiveTab(tab.key)}>
            {tab.icon}
            <span>{tab.label}</span>
            <em>{tab.count}</em>
          </button>
        ))}
      </nav>

      <main className="content-shell">
        {appError ? (
          <div className="app-error">
            <AlertTriangle size={16} />
            <span>{appError}</span>
          </div>
        ) : null}

        {activeTab === 'matrix' ? <MatrixTab model={model} loading={loading} snapshot={snapshot} /> : null}
        {activeTab === 'edge' ? <EdgeTab model={model} snapshot={snapshot} /> : null}
        {activeTab === 'pulse' ? <PulseTab model={model} snapshot={snapshot} /> : null}
        {activeTab === 'trade' ? <TradeTab model={model} snapshot={snapshot} loading={loading} /> : null}
        {activeTab === 'risk' ? <RiskTab model={model} snapshot={snapshot} /> : null}
        {activeTab === 'strategy' ? <StrategyTab model={model} snapshot={snapshot} /> : null}
        {activeTab === 'ops' ? <OpsTab model={model} snapshot={snapshot} /> : null}
        {activeTab === 'general-api' ? <GeneralApiTab /> : null}
      </main>
    </div>
  );
}

function buildUiModel(snapshot: SuiteSnapshot | null) {
  const account = normalizeAccount(snapshot?.pulseAccount.data);
  const accountPositions = extractPositions(snapshot?.pulseAccount.data);
  const directPositions = extractPositions(snapshot?.pulsePositions.data);
  const edgePositions = extractPositions(snapshot?.edgePulsePositions.data);
  const positions = accountPositions.length ? accountPositions : directPositions;
  const tickers = extractTickers(snapshot?.pulseTickers.data);
  const edgeTickers = extractTickers(snapshot?.edgeTickers.data);
  const allTickers = tickers.length ? tickers : edgeTickers;
  const primary = choosePrimaryPosition(positions);
  const decision = latestDecision(snapshot);
  const symbol = String(primary?.symbol || decision?.symbol || '');
  const edgePosition = symbol ? matchingPosition(symbol, edgePositions) : null;
  const agreement = priceAgreement(primary, edgePosition, decision);
  const protectedCount = countProtected(positions, allTickers);
  const failedChecks = snapshot?.edgeReady.data?.failing_check_details ?? [];
  const lastHandoff = snapshot?.edgeAutomation.data?.last_handoff;

  const edgeFeatures: Feature[] = [
    { name: 'Liveness', source: 'Edge', endpoint: '/api/live', service: snapshot?.edgeLive, icon: <Activity size={15} /> },
    { name: 'Readiness Gate', source: 'Edge', endpoint: '/api/ready', service: snapshot?.edgeReady, detail: snapshot?.edgeReady.data?.status, icon: <ShieldCheck size={15} /> },
    { name: 'Automation Mode', source: 'Edge', endpoint: '/api/automation', service: snapshot?.edgeAutomation, detail: snapshot?.edgeAutomation.data?.settings?.mode, icon: <Zap size={15} /> },
    { name: 'Decision Feed', source: 'Edge', endpoint: '/api/decisions', service: snapshot?.edgeDecisions, detail: `${decisionList(snapshot?.edgeDecisions.data).length} decisions`, icon: <ListChecks size={15} /> },
    { name: 'Market Queue', source: 'Edge', endpoint: '/api/queue', service: snapshot?.edgeQueue, icon: <Database size={15} /> },
    { name: 'Tickers', source: 'Edge', endpoint: '/api/tickers', service: snapshot?.edgeTickers, icon: <Table2 size={15} /> },
    { name: 'Provider Health', source: 'Edge', endpoint: '/api/providers/health', service: snapshot?.edgeProvidersHealth, icon: <Network size={15} /> },
    { name: 'Market Data Providers', source: 'Edge', endpoint: '/api/market-data/providers', service: snapshot?.edgeMarketDataProviders, icon: <RadioTower size={15} /> },
    { name: 'Markets', source: 'Edge', endpoint: '/api/markets', service: snapshot?.edgeMarkets, icon: <LineChart size={15} /> },
  ];

  const pulseFeatures: Feature[] = [
    { name: 'Health', source: 'Pulse', endpoint: '/api/health', service: snapshot?.pulseHealth, icon: <Activity size={15} /> },
    { name: 'Bot Status', source: 'Pulse', endpoint: '/api/bot/status', service: snapshot?.pulseBotStatus, icon: <Bot size={15} /> },
    { name: 'Bot Snapshot', source: 'Pulse', endpoint: '/api/bot/snapshot', service: snapshot?.pulseBotSnapshot, icon: <Database size={15} /> },
    { name: 'Edge API Status', source: 'Pulse', endpoint: '/api/edge/status', service: snapshot?.pulseEdgeStatus, icon: <ArrowRightLeft size={15} /> },
    { name: 'Account Status', source: 'Pulse', endpoint: '/api/edge/account/status', service: snapshot?.pulseAccount, icon: <CircleDollarSign size={15} /> },
    { name: 'Ticker Registry', source: 'Pulse', endpoint: '/api/edge/tickers', service: snapshot?.pulseTickers, icon: <Table2 size={15} /> },
    { name: 'Brokers', source: 'Pulse', endpoint: '/api/brokers', service: snapshot?.pulseBrokers, icon: <Network size={15} /> },
    { name: 'Broker Status', source: 'Pulse', endpoint: '/api/brokers/status', service: snapshot?.pulseBrokerStatus, icon: <CheckCircle2 size={15} /> },
    { name: 'Markets and FX', source: 'Pulse', endpoint: '/api/markets + /api/fx-rates', service: snapshot?.pulseMarkets, detail: serviceSummary(snapshot?.pulseFxRates), icon: <LineChart size={15} /> },
  ];

  const tradeFeatures: Feature[] = [
    { name: 'Pulse Positions', source: 'Pulse', endpoint: '/api/positions', service: snapshot?.pulsePositions, icon: <TrendingUp size={15} /> },
    { name: 'Edge Pulse Positions', source: 'Edge', endpoint: '/api/pulse/positions', service: snapshot?.edgePulsePositions, icon: <ArrowRightLeft size={15} /> },
    { name: 'Trades', source: 'Pulse', endpoint: '/api/trades', service: snapshot?.pulseTrades, icon: <Table2 size={15} /> },
    { name: 'Pending Sells', source: 'Pulse', endpoint: '/api/positions/pending-sells', service: snapshot?.pulsePendingSells, icon: <ShieldAlert size={15} /> },
    { name: 'Orders', source: 'Pulse', endpoint: '/api/orders', service: snapshot?.pulseOrders, icon: <ListChecks size={15} /> },
    { name: 'Order Stats', source: 'Pulse', endpoint: '/api/orders/stats', service: snapshot?.pulseOrderStats, icon: <Gauge size={15} /> },
    { name: 'Reconciliation', source: 'Pulse', endpoint: '/api/reconciliation/summary', service: snapshot?.pulseReconciliationSummary, icon: <CheckCircle2 size={15} /> },
    { name: 'Portfolio Stats', source: 'Pulse', endpoint: '/api/portfolio/stats', service: snapshot?.pulsePortfolioStats, icon: <BarChart3 size={15} /> },
  ];

  const riskFeatures: Feature[] = [
    { name: 'Edge Readiness', source: 'Edge', endpoint: '/api/ready', service: snapshot?.edgeReady, detail: `${failedChecks.length} failed checks`, icon: <ShieldCheck size={15} /> },
    { name: 'Edge Rate Limits', source: 'Edge', endpoint: '/api/rate-limit/status', service: snapshot?.edgeRateLimit, icon: <Gauge size={15} /> },
    { name: 'Edge Automation', source: 'Edge', endpoint: '/api/automation', service: snapshot?.edgeAutomation, icon: <SlidersHorizontal size={15} /> },
    { name: 'Dry Run Status', source: 'Edge', endpoint: '/api/dry-run/status', service: snapshot?.edgeDryRun, icon: <ShieldQuestion size={15} /> },
    { name: 'Pulse Risk Status', source: 'Pulse', endpoint: '/api/risk/status', service: snapshot?.pulseRiskStatus, icon: <ShieldAlert size={15} /> },
    { name: 'Pulse Risk Limits', source: 'Pulse', endpoint: '/api/risk/limits', service: snapshot?.pulseRiskLimits, icon: <ListChecks size={15} /> },
    { name: 'Pulse Rate Limits', source: 'Pulse', endpoint: '/api/rate-limits', service: snapshot?.pulseRateLimits, icon: <Gauge size={15} /> },
    { name: 'Pending Sells', source: 'Pulse', endpoint: '/api/positions/pending-sells', service: snapshot?.pulsePendingSells, icon: <ShieldAlert size={15} /> },
  ];

  const strategyFeatures: Feature[] = [
    { name: 'Edge Strategies', source: 'Edge', endpoint: '/api/strategies', service: snapshot?.edgeStrategies, icon: <GitBranch size={15} /> },
    { name: 'Puzzle Key', source: 'Edge', endpoint: '/api/strategies/puzzle-key/status', service: snapshot?.edgePuzzleKey, icon: <ShieldQuestion size={15} /> },
    { name: 'Simulation Lab', source: 'Edge', endpoint: '/api/simulation-lab/status', service: snapshot?.edgeSimulationLab, icon: <LineChart size={15} /> },
    { name: 'Backtest Runs', source: 'Edge', endpoint: '/api/backtest/runs', service: snapshot?.edgeBacktestRuns, icon: <BarChart3 size={15} /> },
    { name: 'Scanner Catalog', source: 'Edge', endpoint: '/api/scanner-workbench/catalog', service: snapshot?.edgeScannerCatalog, icon: <RadioTower size={15} /> },
    { name: 'Chart Workspace', source: 'Edge', endpoint: '/api/chart-workspace/{symbol}', detail: symbol || 'Symbol scoped', icon: <LineChart size={15} /> },
    { name: 'Pulse Strategies', source: 'Pulse', endpoint: '/api/strategies/registry', service: snapshot?.pulseStrategiesRegistry, icon: <GitBranch size={15} /> },
    { name: 'Pulse Presets', source: 'Pulse', endpoint: '/api/strategies/presets', service: snapshot?.pulseStrategiesPresets, icon: <SlidersHorizontal size={15} /> },
    { name: 'Market Replay', source: 'Pulse', endpoint: '/api/replay/status', service: snapshot?.pulseReplayStatus, icon: <RefreshCcw size={15} /> },
    { name: 'Replay Sessions', source: 'Pulse', endpoint: '/api/replay/sessions', service: snapshot?.pulseReplaySessions, icon: <Database size={15} /> },
  ];

  const opsFeatures: Feature[] = [
    { name: 'Edge Health', source: 'Edge', endpoint: '/api/health', service: snapshot?.edgeHealth, icon: <Activity size={15} /> },
    { name: 'Edge Stats', source: 'Edge', endpoint: '/api/stats', service: snapshot?.edgeStats, icon: <Gauge size={15} /> },
    { name: 'Notifications', source: 'Edge', endpoint: '/api/notifications/status', service: snapshot?.edgeNotifications, icon: <RadioTower size={15} /> },
    { name: 'Config Hash', source: 'Edge', endpoint: '/api/config/hash', service: snapshot?.edgeConfigHash, icon: <Database size={15} /> },
    { name: 'Correlation', source: 'Edge', endpoint: '/api/correlation', service: snapshot?.edgeCorrelation, icon: <Network size={15} /> },
    { name: 'Pulse Audit Logs', source: 'Pulse', endpoint: '/api/audit-logs', service: snapshot?.pulseAuditLogs, icon: <Table2 size={15} /> },
    { name: 'Pulse Traces', source: 'Pulse', endpoint: '/api/traces', service: snapshot?.pulseTraces, icon: <Activity size={15} /> },
    { name: 'Pulse Settings', source: 'Pulse', endpoint: '/api/settings', service: snapshot?.pulseSettings, icon: <SlidersHorizontal size={15} /> },
    { name: 'Pulse Ops Services', source: 'Pulse', endpoint: '/api/ops/services', service: snapshot?.pulseOpsServices, icon: <Network size={15} /> },
    { name: 'Pulse SLO Summary', source: 'Pulse', endpoint: '/api/slo/summary', service: snapshot?.pulseSloSummary, icon: <Gauge size={15} /> },
  ];

  return {
    account,
    positions,
    edgePositions,
    tickers: allTickers,
    primary,
    decision,
    symbol,
    edgePosition,
    agreement,
    protectedCount,
    failedChecks,
    lastHandoff,
    edgeFeatures,
    pulseFeatures,
    tradeFeatures,
    riskFeatures,
    strategyFeatures,
    opsFeatures,
  };
}

function MatrixTab({ model, loading, snapshot }: { model: ReturnType<typeof buildUiModel>; loading: boolean; snapshot: SuiteSnapshot | null }) {
  const account = model.account;
  const edgeReady = snapshot?.edgeReady.data?.ready;
  const pulseReady = snapshot?.pulseHealth.ok && snapshot.pulseEdgeStatus.ok;

  return (
    <div className="matrix-page">
      <section className="hero-matrix">
        <div className="hero-copy">
          <span className="section-code">DATA MATRIX 05</span>
          <h1>Sentinel Core Control Surface</h1>
          <p>Edge signal intelligence, Pulse broker execution, and the bridge state between them.</p>
        </div>
        <div className="hero-metrics">
          <Metric label="Edge Readiness" value={edgeReady ? 'Ready' : 'Blocked'} tone={healthTone(edgeReady)} note={snapshot?.edgeReady.error ?? 'Edge /api/ready'} icon={<ShieldCheck size={17} />} />
          <Metric label="Pulse Link" value={pulseReady ? 'Online' : 'Blocked'} tone={healthTone(pulseReady)} note={snapshot?.pulseEdgeStatus.error ?? 'Pulse Edge API'} icon={<ArrowRightLeft size={17} />} />
          <Metric label="Account Equity" value={formatMoney(account.total_equity ?? account.account_balance)} note="Broker-backed Pulse state" icon={<CircleDollarSign size={17} />} />
          <Metric label="Protection" value={`${model.protectedCount}/${model.positions.length}`} tone={model.protectedCount ? 'good' : 'warn'} note={`${model.tickers.length} tracked tickers`} icon={<ShieldAlert size={17} />} />
        </div>
      </section>

      <div className="matrix-grid">
        <Panel title="System Pair" caption="live service link">
          <SystemPair snapshot={snapshot} />
        </Panel>

        <Panel title="Shared Trade State" caption="Edge intent against Pulse truth" wide>
          {loading ? (
            <EmptyState title="Loading services" body="Waiting for the Sentinel Core snapshot." />
          ) : model.primary ? (
            <TradeState position={model.primary} edgePosition={model.edgePosition} decision={model.decision} lastHandoff={model.lastHandoff} />
          ) : (
            <EmptyState title="No open Pulse position" body={snapshot?.pulseAccount.error ?? 'Pulse reported no open broker-backed positions.'} />
          )}
        </Panel>

        <Panel title="Feature Coverage" caption="sampled endpoints">
          <CoverageDial edge={okCount(model.edgeFeatures)} pulse={okCount(model.pulseFeatures)} trade={okCount(model.tradeFeatures)} risk={okCount(model.riskFeatures)} />
        </Panel>

        <Panel title="Command Matrix" caption="core endpoints" wide>
          <EndpointMatrix
            rows={[
              { label: 'Edge live', route: '/api/live', service: snapshot?.edgeLive },
              { label: 'Edge ready', route: '/api/ready', service: snapshot?.edgeReady, detail: snapshot?.edgeReady.data?.status },
              { label: 'Edge decisions', route: '/api/decisions', service: snapshot?.edgeDecisions },
              { label: 'Edge automation', route: '/api/automation', service: snapshot?.edgeAutomation, detail: snapshot?.edgeAutomation.data?.settings?.mode },
              { label: 'Pulse health', route: '/api/health', service: snapshot?.pulseHealth },
              { label: 'Pulse edge status', route: '/api/edge/status', service: snapshot?.pulseEdgeStatus },
              { label: 'Pulse account', route: '/api/edge/account/status', service: snapshot?.pulseAccount },
              { label: 'Pulse tickers', route: '/api/edge/tickers', service: snapshot?.pulseTickers },
            ]}
          />
        </Panel>

        <Panel title="Event Journal" caption="latest sampled responses" wide>
          <EventJournal snapshot={snapshot} />
        </Panel>
      </div>
    </div>
  );
}

function EdgeTab({ model, snapshot }: { model: ReturnType<typeof buildUiModel>; snapshot: SuiteSnapshot | null }) {
  return (
    <TabLayout
      title="Edge Signal Plane"
      deck={[
        { label: 'Readiness', value: snapshot?.edgeReady.data?.ready ? 'Ready' : 'Blocked', tone: healthTone(snapshot?.edgeReady.data?.ready) },
        { label: 'Automation', value: snapshot?.edgeAutomation.data?.settings?.enabled ? 'Enabled' : 'Reported', tone: snapshot?.edgeAutomation.ok ? 'good' : 'bad' },
        { label: 'Decisions', value: formatNumber(decisionList(snapshot?.edgeDecisions.data).length), tone: snapshot?.edgeDecisions.ok ? 'good' : 'bad' },
        { label: 'Providers', value: statusWord(snapshot?.edgeProvidersHealth), tone: serviceTone(snapshot?.edgeProvidersHealth) },
      ]}
      aside={
        <Panel title="Edge Safety Gate" caption="blocking checks">
          {model.failedChecks.length ? (
            <div className="check-list">
              {model.failedChecks.map((check, index) => (
                <div className="check-row" key={`${check.label ?? check.name ?? index}`}>
                  <AlertTriangle size={14} />
                  <strong>{check.label ?? check.name ?? `Check ${index + 1}`}</strong>
                  <span>{check.description ?? 'No detail returned.'}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No failed checks" body={snapshot?.edgeReady.ok ? 'Edge readiness did not report blocking checks.' : snapshot?.edgeReady.error ?? 'Readiness is unavailable.'} />
          )}
        </Panel>
      }
    >
      <FeatureSection title="Signal and Automation" features={model.edgeFeatures.slice(0, 4)} />
      <FeatureSection title="Market Intelligence" features={model.edgeFeatures.slice(4)} />
      <FeatureSection
        title="Pulse Bridge"
        features={[
          { name: 'Handoff Schema', source: 'Edge', endpoint: '/api/pulse/handoff/schema', service: snapshot?.edgeHandoffSchema, icon: <ArrowRightLeft size={15} /> },
          { name: 'Pulse Status Mirror', source: 'Edge', endpoint: '/api/pulse/status', service: snapshot?.edgePulseStatus, icon: <Activity size={15} /> },
          { name: 'Pulse Account Mirror', source: 'Edge', endpoint: '/api/pulse/account', service: snapshot?.edgePulseAccount, icon: <CircleDollarSign size={15} /> },
          { name: 'Pulse Queue Mirror', source: 'Edge', endpoint: '/api/pulse/queue', service: snapshot?.edgePulseQueue, icon: <Database size={15} /> },
        ]}
      />
    </TabLayout>
  );
}

function PulseTab({ model, snapshot }: { model: ReturnType<typeof buildUiModel>; snapshot: SuiteSnapshot | null }) {
  return (
    <TabLayout
      title="Pulse Execution Plane"
      deck={[
        { label: 'Health', value: statusWord(snapshot?.pulseHealth), tone: serviceTone(snapshot?.pulseHealth) },
        { label: 'Bot', value: statusWord(snapshot?.pulseBotStatus), tone: serviceTone(snapshot?.pulseBotStatus) },
        { label: 'Brokers', value: serviceSummary(snapshot?.pulseBrokers), tone: serviceTone(snapshot?.pulseBrokers) },
        { label: 'Markets', value: serviceSummary(snapshot?.pulseMarkets), tone: serviceTone(snapshot?.pulseMarkets) },
      ]}
      aside={
        <Panel title="Broker Account" caption="Pulse-reported">
          <div className="kv-stack">
            <KeyValue label="Equity" value={formatMoney(model.account.total_equity ?? model.account.account_balance)} />
            <KeyValue label="Buying power" value={formatMoney(model.account.buying_power ?? model.account.available)} />
            <KeyValue label="Day PnL" value={formatMoney(model.account.day_pnl_dollar)} tone={numberFrom(model.account.day_pnl_dollar) >= 0 ? 'good' : 'bad'} />
            <KeyValue label="Open positions" value={formatNumber(model.account.open_positions ?? model.positions.length)} />
          </div>
        </Panel>
      }
    >
      <FeatureSection title="Execution Engine" features={model.pulseFeatures.slice(0, 6)} />
      <FeatureSection title="Broker and Market Layer" features={model.pulseFeatures.slice(6)} />
      <FeatureSection
        title="Audit and Resilience"
        features={[
          { name: 'Rate Limits', source: 'Pulse', endpoint: '/api/rate-limits', service: snapshot?.pulseRateLimits, icon: <Gauge size={15} /> },
          { name: 'Audit Logs', source: 'Pulse', endpoint: '/api/audit-logs', service: snapshot?.pulseAuditLogs, icon: <Table2 size={15} /> },
          { name: 'Traces', source: 'Pulse', endpoint: '/api/traces', service: snapshot?.pulseTraces, icon: <Activity size={15} /> },
          { name: 'Settings', source: 'Pulse', endpoint: '/api/settings', service: snapshot?.pulseSettings, icon: <SlidersHorizontal size={15} /> },
        ]}
      />
    </TabLayout>
  );
}

function TradeTab({ model, snapshot, loading }: { model: ReturnType<typeof buildUiModel>; snapshot: SuiteSnapshot | null; loading: boolean }) {
  return (
    <TabLayout
      title="Trade State"
      deck={[
        { label: 'Positions', value: formatNumber(model.positions.length), tone: model.positions.length ? 'good' : 'neutral' },
        { label: 'Protected', value: formatNumber(model.protectedCount), tone: model.protectedCount ? 'good' : 'warn' },
        { label: 'Orders', value: serviceSummary(snapshot?.pulseOrders), tone: serviceTone(snapshot?.pulseOrders) },
        { label: 'Reconcile', value: statusWord(snapshot?.pulseReconciliationSummary), tone: serviceTone(snapshot?.pulseReconciliationSummary) },
      ]}
      aside={
        <Panel title="Drift Monitor" caption="price agreement">
          <DriftMonitor position={model.primary} edgePosition={model.edgePosition} decision={model.decision} />
        </Panel>
      }
    >
      <Panel title="Shared Trade State" caption="selected position">
        {loading ? (
          <EmptyState title="Loading services" body="Waiting for the Sentinel Core snapshot." />
        ) : model.primary ? (
          <TradeState position={model.primary} edgePosition={model.edgePosition} decision={model.decision} lastHandoff={model.lastHandoff} />
        ) : (
          <EmptyState title="No open Pulse position" body={snapshot?.pulseAccount.error ?? 'Pulse reported no open broker-backed positions.'} />
        )}
      </Panel>
      <Panel title="Positions" caption="Pulse account view">
        <PositionTable positions={model.positions} />
      </Panel>
      <FeatureSection title="Orders and Portfolio" features={model.tradeFeatures} />
    </TabLayout>
  );
}

function RiskTab({ model, snapshot }: { model: ReturnType<typeof buildUiModel>; snapshot: SuiteSnapshot | null }) {
  return (
    <TabLayout
      title="Risk Control"
      deck={[
        { label: 'Failed Checks', value: formatNumber(model.failedChecks.length), tone: model.failedChecks.length ? 'warn' : 'good' },
        { label: 'Edge Limits', value: statusWord(snapshot?.edgeRateLimit), tone: serviceTone(snapshot?.edgeRateLimit) },
        { label: 'Pulse Risk', value: statusWord(snapshot?.pulseRiskStatus), tone: serviceTone(snapshot?.pulseRiskStatus) },
        { label: 'Pending Sells', value: serviceSummary(snapshot?.pulsePendingSells), tone: serviceTone(snapshot?.pulsePendingSells) },
      ]}
      aside={
        <Panel title="Risk Flags" caption="read-only state">
          <div className="kv-stack">
            <KeyValue label="Pulse key" value={snapshot?.config.pulseKeyConfigured ? 'Configured' : 'Missing'} tone={snapshot?.config.pulseKeyConfigured ? 'good' : 'bad'} />
            <KeyValue label="Dry run" value={statusWord(snapshot?.edgeDryRun)} tone={serviceTone(snapshot?.edgeDryRun)} />
            <KeyValue label="Automation mode" value={snapshot?.edgeAutomation.data?.settings?.mode ?? 'Unavailable'} />
            <KeyValue label="Min confidence" value={formatNumber(snapshot?.edgeAutomation.data?.settings?.min_confidence)} />
          </div>
        </Panel>
      }
    >
      <FeatureSection title="Guardrails" features={model.riskFeatures} />
      <Panel title="Failed Checks" caption="Edge readiness">
        {model.failedChecks.length ? (
          <div className="check-list">
            {model.failedChecks.map((check, index) => (
              <div className="check-row" key={`${check.label ?? check.name ?? index}`}>
                <AlertTriangle size={14} />
                <strong>{check.label ?? check.name ?? `Check ${index + 1}`}</strong>
                <span>{check.description ?? 'No detail returned.'}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No failed checks" body={snapshot?.edgeReady.ok ? 'Edge readiness did not report blocking checks.' : snapshot?.edgeReady.error ?? 'Readiness is unavailable.'} />
        )}
      </Panel>
    </TabLayout>
  );
}

function StrategyTab({ model, snapshot }: { model: ReturnType<typeof buildUiModel>; snapshot: SuiteSnapshot | null }) {
  return (
    <TabLayout
      title="Strategy Lab"
      deck={[
        { label: 'Edge Strategies', value: serviceSummary(snapshot?.edgeStrategies), tone: serviceTone(snapshot?.edgeStrategies) },
        { label: 'Simulation', value: statusWord(snapshot?.edgeSimulationLab), tone: serviceTone(snapshot?.edgeSimulationLab) },
        { label: 'Pulse Strategies', value: serviceSummary(snapshot?.pulseStrategiesRegistry), tone: serviceTone(snapshot?.pulseStrategiesRegistry) },
        { label: 'Replay', value: statusWord(snapshot?.pulseReplayStatus), tone: serviceTone(snapshot?.pulseReplayStatus) },
      ]}
      aside={
        <Panel title="Decision Tape" caption="Edge feed">
          <DecisionTape decisions={decisionList(snapshot?.edgeDecisions.data)} />
        </Panel>
      }
    >
      <FeatureSection title="Research and Simulation" features={model.strategyFeatures} />
      <FeatureSection
        title="Analytics"
        features={[
          { name: 'Portfolio Analytics', source: 'Pulse', endpoint: '/api/analytics/portfolio', service: snapshot?.pulseAnalyticsPortfolio, icon: <BarChart3 size={15} /> },
          { name: 'Correlation', source: 'Edge', endpoint: '/api/correlation', service: snapshot?.edgeCorrelation, icon: <Network size={15} /> },
          { name: 'Config Hash', source: 'Edge', endpoint: '/api/config/hash', service: snapshot?.edgeConfigHash, icon: <Database size={15} /> },
        ]}
      />
    </TabLayout>
  );
}

function OpsTab({ model, snapshot }: { model: ReturnType<typeof buildUiModel>; snapshot: SuiteSnapshot | null }) {
  return (
    <TabLayout
      title="Operations"
      deck={[
        { label: 'Endpoints', value: `${okCount(model.opsFeatures)}/${model.opsFeatures.length}`, tone: okCount(model.opsFeatures) ? 'good' : 'bad' },
        { label: 'Edge Base', value: snapshot?.config.edgeBaseUrl ?? 'Unavailable', tone: snapshot?.edgeLive.ok ? 'good' : 'bad' },
        { label: 'Pulse Base', value: snapshot?.config.pulseBaseUrl ?? 'Unavailable', tone: snapshot?.pulseHealth.ok ? 'good' : 'bad' },
        { label: 'Snapshot', value: latencyWord(snapshot?.edgeLive), tone: snapshot ? 'good' : 'pending' },
      ]}
      aside={
        <Panel title="Config" caption="server-side">
          <div className="kv-stack">
            <KeyValue label="Edge URL" value={snapshot?.config.edgeBaseUrl ?? 'Unavailable'} />
            <KeyValue label="Pulse URL" value={snapshot?.config.pulseBaseUrl ?? 'Unavailable'} />
            <KeyValue label="Pulse key" value={snapshot?.config.pulseKeyConfigured ? 'Configured' : 'Missing'} tone={snapshot?.config.pulseKeyConfigured ? 'good' : 'bad'} />
            <KeyValue label="Refresh" value={`${Math.round((snapshot?.config.refreshMs ?? 5000) / 1000)} sec`} />
          </div>
        </Panel>
      }
    >
      <FeatureSection title="Observability" features={model.opsFeatures} />
      <Panel title="Endpoint Matrix" caption="all sampled services">
        <EndpointMatrix
          rows={[
            ...model.edgeFeatures.map((feature) => ({ label: feature.name, route: feature.endpoint, service: feature.service, detail: feature.detail })),
            ...model.pulseFeatures.map((feature) => ({ label: feature.name, route: feature.endpoint, service: feature.service, detail: feature.detail })),
            ...model.tradeFeatures.map((feature) => ({ label: feature.name, route: feature.endpoint, service: feature.service, detail: feature.detail })),
            ...model.riskFeatures.map((feature) => ({ label: feature.name, route: feature.endpoint, service: feature.service, detail: feature.detail })),
            ...model.strategyFeatures.map((feature) => ({ label: feature.name, route: feature.endpoint, service: feature.service, detail: feature.detail })),
            ...model.opsFeatures.map((feature) => ({ label: feature.name, route: feature.endpoint, service: feature.service, detail: feature.detail })),
          ]}
        />
      </Panel>
      <Panel title="Event Journal" caption="latest sampled responses">
        <EventJournal snapshot={snapshot} />
      </Panel>
    </TabLayout>
  );
}

function GeneralApiTab() {
  const [settings, setSettings] = React.useState<GeneralApiSettings | null>(null);
  const [token, setToken] = React.useState('');
  const [result, setResult] = React.useState<Record<string, unknown> | null>(null);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    const payload = await loadGeneralApiSettings();
    setSettings(payload.settings);
  }, []);

  React.useEffect(() => {
    load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  function update<K extends keyof GeneralApiSettings>(key: K, value: GeneralApiSettings[K]) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  async function save() {
    if (!settings) return false;
    setBusy(true);
    setError('');
    try {
      const { token_configured: _hidden, ...visible } = settings;
      const payload = await saveGeneralApiSettings({ ...visible, ...(token ? { api_token: token } : {}) });
      setSettings(payload.settings);
      setToken('');
      setResult(payload as unknown as Record<string, unknown>);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function action(kind: 'test' | 'register') {
    if (!await save()) return;
    setBusy(true);
    setError('');
    try {
      const payload = kind === 'test' ? await testGeneralApi() : await registerGeneralApi();
      setResult(payload);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <TabLayout
      title="General API"
      deck={[
        { label: 'Contract', value: 'archive.general.v1', tone: 'good' },
        { label: 'Role', value: 'Observer', tone: 'neutral' },
        { label: 'Enabled', value: settings?.enabled ? 'Yes' : 'No', tone: settings?.enabled ? 'good' : 'neutral' },
        { label: 'Token', value: settings?.token_configured ? 'Saved' : 'Missing', tone: settings?.token_configured ? 'good' : 'warn' },
      ]}
      aside={
        <Panel title="Boundary" caption="decision ownership">
          <p className="general-api-boundary"><strong>Archive replays and brokers.</strong> Sentinel Core observes the shared run. It does not create trades or trading directives.</p>
          <pre className="general-api-result">{result ? JSON.stringify(result, null, 2) : 'Save, test, or register to see a result.'}</pre>
        </Panel>
      }
    >
      <Panel title="Archive Connection" caption="server-side private settings">
        {settings ? (
          <div className="general-api-form">
            <label className="general-api-check"><input type="checkbox" checked={settings.enabled} onChange={(event) => update('enabled', event.target.checked)} /> Enable General API</label>
            <label>Archive base URL<input value={settings.base_url} onChange={(event) => update('base_url', event.target.value)} /></label>
            <label>Replay run ID<input value={settings.run_id} onChange={(event) => update('run_id', event.target.value)} /></label>
            <label>Participant ID<input value={settings.participant_id} onChange={(event) => update('participant_id', event.target.value)} /></label>
            <label>Observed symbols<input value={settings.subscribed_symbols.join(', ')} onChange={(event) => update('subscribed_symbols', event.target.value.split(',').map((value) => value.trim()).filter(Boolean))} /></label>
            <label>Participant token<input type="password" value={token} placeholder="Leave blank to keep saved token" onChange={(event) => setToken(event.target.value)} /></label>
            <label>Timeout seconds<input type="number" min="0.1" step="0.1" value={settings.timeout_seconds} onChange={(event) => update('timeout_seconds', Number(event.target.value))} /></label>
            <div className="general-api-actions">
              <button type="button" disabled={busy} onClick={save}>Save</button>
              <button type="button" disabled={busy} onClick={() => action('test')}>Test Connection</button>
              <button type="button" disabled={busy || !settings.run_id} onClick={() => action('register')}>Register With Run</button>
            </div>
            {error ? <div className="app-error general-api-error"><AlertTriangle size={16} />{error}</div> : null}
          </div>
        ) : <EmptyState title="Loading General API" body="Reading server-side settings." />}
      </Panel>
    </TabLayout>
  );
}

function TabLayout({
  title,
  deck,
  aside,
  children,
}: {
  title: string;
  deck: Array<{ label: string; value: string; tone?: ServiceTone }>;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="tab-page">
      <section className="tab-hero">
        <div>
          <span className="section-code">SENTINEL CORE SURFACE</span>
          <h1>{title}</h1>
        </div>
        <div className="deck">
          {deck.map((item) => (
            <div className={`deck-card ${item.tone ?? 'neutral'}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <div className="tab-layout">
        <section className="tab-main">{children}</section>
        <aside className="tab-aside">{aside}</aside>
      </div>
    </div>
  );
}

function StatusPill({ label, detail, tone }: { label: string; detail: string; tone: ServiceTone }) {
  return (
    <span className={`status-pill ${tone}`}>
      <span className="status-dot" />
      <strong>{label}</strong>
      <em>{detail}</em>
    </span>
  );
}

function Panel({ title, caption, children, wide = false }: { title: string; caption?: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={`panel ${wide ? 'wide' : ''}`}>
      <div className="panel-header">
        <h2>{title}</h2>
        {caption ? <span>{caption}</span> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

function Metric({ label, value, note, icon, tone = 'neutral' }: { label: string; value: string; note?: string; icon?: React.ReactNode; tone?: ServiceTone }) {
  return (
    <div className={`metric ${tone}`}>
      <div className="metric-top">
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      {note ? <p>{note}</p> : null}
    </div>
  );
}

function KeyValue({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: ServiceTone }) {
  return (
    <div className="key-value">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

function EmptyState({ title, body, compact = false }: { title: string; body: string; compact?: boolean }) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <ShieldQuestion size={compact ? 18 : 28} />
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function SystemPair({ snapshot }: { snapshot: SuiteSnapshot | null }) {
  return (
    <div className="kv-stack">
      <KeyValue label="Edge API" value={snapshot?.config.edgeBaseUrl ?? 'Unavailable'} tone={snapshot?.edgeLive.ok ? 'good' : 'bad'} />
      <KeyValue label="Pulse API" value={snapshot?.config.pulseBaseUrl ?? 'Unavailable'} tone={snapshot?.pulseHealth.ok ? 'good' : 'bad'} />
      <KeyValue label="Edge ready" value={snapshot?.edgeReady.data?.status ?? statusWord(snapshot?.edgeReady)} tone={healthTone(snapshot?.edgeReady.data?.ready)} />
      <KeyValue label="Pulse key" value={snapshot?.config.pulseKeyConfigured ? 'Configured' : 'Missing'} tone={snapshot?.config.pulseKeyConfigured ? 'good' : 'bad'} />
      <KeyValue label="Pulse bridge" value={statusWord(snapshot?.pulseEdgeStatus)} tone={serviceTone(snapshot?.pulseEdgeStatus)} />
    </div>
  );
}

function CoverageDial({ edge, pulse, trade, risk }: { edge: number; pulse: number; trade: number; risk: number }) {
  const rows = [
    { label: 'Edge', value: edge, max: 9 },
    { label: 'Pulse', value: pulse, max: 9 },
    { label: 'Trade', value: trade, max: 8 },
    { label: 'Risk', value: risk, max: 8 },
  ];

  return (
    <div className="coverage">
      {rows.map((row) => (
        <div className="coverage-row" key={row.label}>
          <span>{row.label}</span>
          <div className="coverage-bar">
            <i style={{ width: `${Math.max(4, (row.value / row.max) * 100)}%` }} />
          </div>
          <strong>
            {row.value}/{row.max}
          </strong>
        </div>
      ))}
    </div>
  );
}

function FeatureSection({ title, features }: { title: string; features: Feature[] }) {
  return (
    <Panel title={title} caption={`${okCount(features)}/${features.length} online`}>
      <div className="feature-grid">
        {features.map((feature) => (
          <FeatureRow feature={feature} key={`${feature.source}-${feature.endpoint}-${feature.name}`} />
        ))}
      </div>
    </Panel>
  );
}

function FeatureRow({ feature }: { feature: Feature }) {
  const tone = serviceTone(feature.service);
  return (
    <div className={`feature-row ${tone}`}>
      <div className="feature-icon">{feature.icon ?? <Activity size={15} />}</div>
      <div className="feature-main">
        <div className="feature-title">
          <strong>{feature.name}</strong>
          <span>{feature.source}</span>
        </div>
        <code>{feature.endpoint}</code>
      </div>
      <div className="feature-status">
        <strong>{statusWord(feature.service)}</strong>
        <span>{serviceSummary(feature.service, feature.detail)}</span>
      </div>
    </div>
  );
}

function EndpointMatrix({ rows }: { rows: MatrixRow[] }) {
  return (
    <div className="endpoint-table">
      {rows.map((row) => (
        <div className={`endpoint-row ${serviceTone(row.service)}`} key={`${row.route}-${row.label}`}>
          <span className="endpoint-light" />
          <strong>{row.label}</strong>
          <code>{row.route}</code>
          <span>{statusWord(row.service)}</span>
          <em>{row.detail ?? responseDetail(row.service)}</em>
        </div>
      ))}
    </div>
  );
}

function TradeState({
  position,
  edgePosition,
  decision,
  lastHandoff,
}: {
  position: PulsePosition;
  edgePosition: PulsePosition | null;
  decision: Record<string, unknown> | null;
  lastHandoff?: Record<string, unknown>;
}) {
  const symbol = String(position.symbol || decision?.symbol || 'Position');
  const price = priceFromPosition(position);
  const pnl = positionPnl(position);
  const pnlPct = positionPnlPct(position);
  const entry = entryFromPosition(position);
  const quantity = positionQuantity(position);
  const agreement = priceAgreement(position, edgePosition, decision);
  const lifecycle = normalizeExecutionLifecycle(lastHandoff);

  return (
    <div className="trade-state">
      <div className="trade-main">
        <div className="trade-head">
          <div>
            <div className="ticker">{symbol}</div>
            <div className="trade-sub">Pulse broker-backed open position</div>
          </div>
          <div className="trade-price">
            <strong>{formatMoney(price)}</strong>
            <span className={pnl >= 0 ? 'good' : 'bad'}>
              {formatMoney(pnl)} / {formatPct(pnlPct)}
            </span>
          </div>
        </div>

        <div className="timeline">
          <TimelineItem icon={<Activity size={14} />} title="Edge Signal" note={decision ? `Latest decision: ${String(decision.decision ?? decision.action ?? 'recorded')}` : 'No Edge decision feed entry available.'} tone={decision ? 'good' : 'warn'} />
          <TimelineItem icon={<ArrowRightLeft size={14} />} title={lifecycle.title} note={lifecycle.note} tone={lifecycle.tone} />
          <TimelineItem icon={<Bot size={14} />} title="Pulse Position" note={`${formatNumber(quantity)} units at ${formatMoney(entry)}`} tone="good" />
          <TimelineItem icon={<ShieldCheck size={14} />} title="Protection" note={position.trailing_enabled ? `Trailing stop active at ${formatPct(position.trailing_percent)}` : 'No trailing stop flag reported for this position.'} tone={position.trailing_enabled ? 'good' : 'warn'} />
        </div>
      </div>

      <div className="trade-side">
        <KeyValue label="Quantity" value={formatNumber(quantity)} />
        <KeyValue label="Average entry" value={formatMoney(entry)} />
        <KeyValue label="Current price" value={formatMoney(price)} />
        <KeyValue label="Agreement" value={agreement.label} tone={agreement.tone} />
        <KeyValue label="Lifecycle" value={`${lifecycle.owner}: ${lifecycle.phase}`} tone={lifecycle.tone} />
        <KeyValue label="Trailing stop" value={position.trailing_enabled ? 'Active' : 'Not reported'} tone={position.trailing_enabled ? 'good' : 'warn'} />
      </div>
    </div>
  );
}

function TimelineItem({ icon, title, note, tone }: { icon: React.ReactNode; title: string; note: string; tone: ServiceTone }) {
  return (
    <div className={`timeline-item ${tone}`}>
      <span className="timeline-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{note}</p>
      </div>
    </div>
  );
}

function DriftMonitor({
  position,
  edgePosition,
  decision,
}: {
  position: PulsePosition | null;
  edgePosition: PulsePosition | null;
  decision: Record<string, unknown> | null;
}) {
  if (!position) {
    return <EmptyState title="No drift target" body="Pulse has not reported an open position to compare." compact />;
  }

  const pulsePrice = priceFromPosition(position);
  const edgePrice = priceFromPosition(edgePosition) || decisionPrice(decision);
  const drift = Number.isFinite(pulsePrice) && Number.isFinite(edgePrice) ? Math.abs((pulsePrice - edgePrice) / edgePrice) * 100 : Number.NaN;

  return (
    <div className="kv-stack">
      <KeyValue label="Symbol" value={String(position.symbol ?? 'Unavailable')} />
      <KeyValue label="Pulse price" value={formatMoney(pulsePrice)} />
      <KeyValue label="Edge price" value={formatMoney(edgePrice)} />
      <KeyValue label="Drift" value={formatPct(drift)} tone={Number.isFinite(drift) && drift <= 0.2 ? 'good' : 'warn'} />
    </div>
  );
}

function PositionTable({ positions }: { positions: PulsePosition[] }) {
  if (!positions.length) {
    return <EmptyState title="No positions" body="Pulse did not return open positions." />;
  }

  return (
    <div className="position-table">
      <div className="position-row heading">
        <span>Symbol</span>
        <span>Qty</span>
        <span>Entry</span>
        <span>Price</span>
        <span>PnL</span>
        <span>Trail</span>
      </div>
      {positions.slice(0, 12).map((position, index) => (
        <div className="position-row" key={`${position.symbol ?? 'row'}-${index}`}>
          <strong>{position.symbol ?? 'Unknown'}</strong>
          <span>{formatNumber(positionQuantity(position))}</span>
          <span>{formatMoney(entryFromPosition(position))}</span>
          <span>{formatMoney(priceFromPosition(position))}</span>
          <span className={positionPnl(position) >= 0 ? 'good' : 'bad'}>{formatMoney(positionPnl(position))}</span>
          <span className={position.trailing_enabled ? 'good' : 'warn'}>{position.trailing_enabled ? formatPct(position.trailing_percent) : 'None'}</span>
        </div>
      ))}
    </div>
  );
}

function DecisionTape({ decisions }: { decisions: Array<Record<string, unknown>> }) {
  if (!decisions.length) {
    return <EmptyState compact title="No decisions" body="Edge decision feed did not return entries." />;
  }

  return (
    <div className="decision-tape">
      {decisions.slice(0, 6).map((decision, index) => (
        <div className="decision-row" key={`${String(decision.symbol ?? 'decision')}-${index}`}>
          <strong>{compactValue(decision.symbol)}</strong>
          <span>{compactValue(decision.decision ?? decision.action)}</span>
          <em>{formatNumber(decision.confidence)}</em>
        </div>
      ))}
    </div>
  );
}

function EventJournal({ snapshot }: { snapshot: SuiteSnapshot | null }) {
  const rows = [
    {
      time: snapshot?.edgeLive.updatedAt,
      source: 'EDGE_LIVE',
      message: snapshot?.edgeLive.ok ? 'Liveness endpoint responded.' : snapshot?.edgeLive.error,
      tone: serviceTone(snapshot?.edgeLive),
    },
    {
      time: snapshot?.edgeReady.updatedAt,
      source: 'EDGE_READY',
      message: snapshot?.edgeReady.ok ? `Readiness: ${snapshot.edgeReady.data?.status ?? 'reported'}` : snapshot?.edgeReady.error,
      tone: serviceTone(snapshot?.edgeReady),
    },
    {
      time: snapshot?.edgeDecisions.updatedAt,
      source: 'EDGE_DECISIONS',
      message: snapshot?.edgeDecisions.ok ? `${decisionList(snapshot.edgeDecisions.data).length} decisions returned.` : snapshot?.edgeDecisions.error,
      tone: serviceTone(snapshot?.edgeDecisions),
    },
    {
      time: snapshot?.pulseHealth.updatedAt,
      source: 'PULSE_HEALTH',
      message: snapshot?.pulseHealth.ok ? 'Health endpoint responded.' : snapshot?.pulseHealth.error,
      tone: serviceTone(snapshot?.pulseHealth),
    },
    {
      time: snapshot?.pulseAccount.updatedAt,
      source: 'PULSE_ACCOUNT',
      message: snapshot?.pulseAccount.ok ? `Positions: ${extractPositions(snapshot.pulseAccount.data).length}` : snapshot?.pulseAccount.error,
      tone: serviceTone(snapshot?.pulseAccount),
    },
    {
      time: snapshot?.pulseBotStatus.updatedAt,
      source: 'PULSE_BOT',
      message: snapshot?.pulseBotStatus.ok ? responseDetail(snapshot.pulseBotStatus) : snapshot?.pulseBotStatus.error,
      tone: serviceTone(snapshot?.pulseBotStatus),
    },
  ];

  return (
    <div className="journal">
      {rows.map((row) => (
        <div className="journal-row" key={row.source}>
          <span>{row.time ? new Date(row.time).toLocaleTimeString() : '--:--:--'}</span>
          <strong>{row.source}</strong>
          <span>{row.message || 'No response recorded.'}</span>
          <em className={row.tone}>{row.tone}</em>
        </div>
      ))}
    </div>
  );
}
