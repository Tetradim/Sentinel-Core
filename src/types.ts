export type ServiceTone = 'good' | 'warn' | 'bad' | 'neutral' | 'pending';

export type GeneralApiSettings = {
  enabled: boolean;
  base_url: string;
  run_id: string;
  participant_id: string;
  bot_id: string;
  display_name: string;
  roles: string[];
  subscribed_symbols: string[];
  timeout_seconds: number;
  starting_cash: number;
  commission_per_order: number;
  slippage_bps: number;
  token_configured: boolean;
};

export type ServiceResult<T> = {
  ok: boolean;
  data?: T;
  error?: string;
  latencyMs?: number;
  status?: number;
  updatedAt?: string;
};

export type AnyPayload = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type EdgeReadiness = {
  ready?: boolean;
  status?: string;
  failing_checks?: string[];
  failing_check_details?: Array<{ label?: string; name?: string; description?: string }>;
};

export type EdgeAutomation = {
  settings?: {
    enabled?: boolean;
    mode?: string;
    min_confidence?: number;
    per_ticker_enabled?: Record<string, boolean>;
  };
  last_handoff?: Record<string, unknown>;
};

export type EdgeDecisionFeed = {
  decisions?: Array<Record<string, unknown>>;
  entries?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>> | Record<string, unknown>;
};

export type PulseEdgeStatus = {
  api_key_configured?: boolean;
  signals_cached?: number;
  max_retry_attempts?: number;
  timestamp?: string;
  mongo?: Record<string, unknown>;
};

export type PulseAccount = {
  account?: Record<string, unknown>;
  account_balance?: number;
  total_equity?: number;
  available?: number;
  buying_power?: number;
  day_pnl_dollar?: number;
  day_pnl_pct?: number;
  open_positions?: number;
  positions?: PulsePosition[];
};

export type PulsePosition = {
  symbol?: string;
  qty?: number;
  quantity?: number;
  avg_entry?: number;
  average_entry?: number;
  entry_price?: number;
  current_price?: number;
  market_price?: number;
  last_price?: number;
  pnl?: number;
  pnl_pct?: number;
  unrealized_pnl?: number;
  unrealized_pnl_pct?: number;
  trailing_enabled?: boolean;
  trailing_percent?: number;
};

export type PulseTicker = {
  symbol?: string;
  enabled?: boolean;
  trailing_enabled?: boolean;
  trailing_percent?: number;
  auto_stop_reason?: string;
};

export type PulseTickerResponse =
  | PulseTicker[]
  | {
      tickers?: PulseTicker[];
      data?: PulseTicker[];
      results?: PulseTicker[];
    };

export type SuiteConfig = {
  edgeBaseUrl: string;
  pulseBaseUrl: string;
  pulseKeyConfigured: boolean;
  refreshMs: number;
};

export type SuiteSnapshot = {
  config: SuiteConfig;
  edgeLive: ServiceResult<Record<string, unknown>>;
  edgeHealth: ServiceResult<AnyPayload>;
  edgeReady: ServiceResult<EdgeReadiness>;
  edgeRateLimit: ServiceResult<AnyPayload>;
  edgeStats: ServiceResult<AnyPayload>;
  edgeNotifications: ServiceResult<AnyPayload>;
  edgeMarkets: ServiceResult<AnyPayload>;
  edgeQueue: ServiceResult<AnyPayload>;
  edgeTickers: ServiceResult<AnyPayload>;
  edgeProvidersHealth: ServiceResult<AnyPayload>;
  edgeMarketDataProviders: ServiceResult<AnyPayload>;
  edgeAutomation: ServiceResult<EdgeAutomation>;
  edgeDecisions: ServiceResult<EdgeDecisionFeed>;
  edgeStrategies: ServiceResult<AnyPayload>;
  edgePuzzleKey: ServiceResult<AnyPayload>;
  edgeDryRun: ServiceResult<AnyPayload>;
  edgeSimulationLab: ServiceResult<AnyPayload>;
  edgeBacktestRuns: ServiceResult<AnyPayload>;
  edgeScannerCatalog: ServiceResult<AnyPayload>;
  edgeConfigHash: ServiceResult<AnyPayload>;
  edgeCorrelation: ServiceResult<AnyPayload>;
  edgeHandoffSchema: ServiceResult<Record<string, unknown>>;
  edgePulseStatus: ServiceResult<AnyPayload>;
  edgePulseAccount: ServiceResult<Record<string, unknown>>;
  edgePulsePositions: ServiceResult<Record<string, unknown>>;
  edgePulseQueue: ServiceResult<AnyPayload>;
  pulseHealth: ServiceResult<Record<string, unknown>>;
  pulseEdgeStatus: ServiceResult<PulseEdgeStatus>;
  pulseAccount: ServiceResult<PulseAccount>;
  pulseTickers: ServiceResult<PulseTickerResponse>;
  pulseBotStatus: ServiceResult<AnyPayload>;
  pulseBotSnapshot: ServiceResult<AnyPayload>;
  pulseStrategiesRegistry: ServiceResult<AnyPayload>;
  pulseStrategiesPresets: ServiceResult<AnyPayload>;
  pulseTrades: ServiceResult<AnyPayload>;
  pulsePositions: ServiceResult<AnyPayload>;
  pulsePendingSells: ServiceResult<AnyPayload>;
  pulseBrokers: ServiceResult<AnyPayload>;
  pulseBrokerStatus: ServiceResult<AnyPayload>;
  pulseMarkets: ServiceResult<AnyPayload>;
  pulseFxRates: ServiceResult<AnyPayload>;
  pulseReplayStatus: ServiceResult<AnyPayload>;
  pulseReplaySessions: ServiceResult<AnyPayload>;
  pulseRateLimits: ServiceResult<AnyPayload>;
  pulseAuditLogs: ServiceResult<AnyPayload>;
  pulseTraces: ServiceResult<AnyPayload>;
  pulseSettings: ServiceResult<AnyPayload>;
  pulseRiskStatus: ServiceResult<AnyPayload>;
  pulseRiskLimits: ServiceResult<AnyPayload>;
  pulseReconciliationSummary: ServiceResult<AnyPayload>;
  pulsePortfolioStats: ServiceResult<AnyPayload>;
  pulseOrders: ServiceResult<AnyPayload>;
  pulseOrderStats: ServiceResult<AnyPayload>;
  pulseAnalyticsPortfolio: ServiceResult<AnyPayload>;
  pulseOpsServices: ServiceResult<AnyPayload>;
  pulseSloSummary: ServiceResult<AnyPayload>;
};
