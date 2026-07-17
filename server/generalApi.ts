import fs from 'node:fs';
import path from 'node:path';

export type GeneralApiSettings = {
  enabled: boolean;
  base_url: string;
  run_id: string;
  participant_id: string;
  bot_id: string;
  display_name: string;
  roles: string[];
  subscribed_symbols: string[];
  api_token: string;
  timeout_seconds: number;
  starting_cash: number;
  commission_per_order: number;
  slippage_bps: number;
};

const defaults: GeneralApiSettings = {
  enabled: false,
  base_url: 'http://127.0.0.1:9200/api/general',
  run_id: '',
  participant_id: 'sentinel-core',
  bot_id: 'sentinel-core',
  display_name: 'Sentinel Core',
  roles: ['observer'],
  subscribed_symbols: [],
  api_token: '',
  timeout_seconds: 5,
  starting_cash: 100000,
  commission_per_order: 0,
  slippage_bps: 0,
};

const allowed = new Set<keyof GeneralApiSettings>(Object.keys(defaults) as Array<keyof GeneralApiSettings>);

export class GeneralApiStore {
  constructor(readonly filePath = process.env.GENERAL_API_CONFIG_PATH || path.resolve(process.cwd(), 'data/general_api.json')) {}

  load(): GeneralApiSettings {
    let saved: Partial<GeneralApiSettings> = {};
    if (fs.existsSync(this.filePath)) saved = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<GeneralApiSettings>;
    const merged = { ...defaults, ...saved };
    if (process.env.SENTINEL_ARCHIVE_BASE_URL) merged.base_url = process.env.SENTINEL_ARCHIVE_BASE_URL;
    if (process.env.SENTINEL_CORE_ARCHIVE_RUN_ID) merged.run_id = process.env.SENTINEL_CORE_ARCHIVE_RUN_ID;
    if (process.env.SENTINEL_CORE_ARCHIVE_API_TOKEN) merged.api_token = process.env.SENTINEL_CORE_ARCHIVE_API_TOKEN;
    return validate(merged);
  }

  save(input: Record<string, unknown>): GeneralApiSettings {
    const unknown = Object.keys(input).filter((key) => !allowed.has(key as keyof GeneralApiSettings));
    if (unknown.length) throw new Error(`Unsupported General API settings: ${unknown.join(', ')}`);
    const update = { ...input };
    if (!update.api_token) delete update.api_token;
    const settings = validate({ ...this.load(), ...update });
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
    return settings;
  }

  public(settings = this.load()) {
    const { api_token: token, ...visible } = settings;
    return { ...visible, token_configured: Boolean(token) };
  }
}

export class ArchiveGeneralApiClient {
  constructor(readonly store: GeneralApiStore) {}

  private async request(method: string, endpoint: string, body?: unknown, authenticated = false) {
    const settings = this.store.load();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.timeout_seconds * 1000);
    try {
      const response = await fetch(`${settings.base_url}/${endpoint.replace(/^\/+/, '')}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(authenticated ? { 'X-Archive-Bot-Token': settings.api_token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(String(payload.detail || `${response.status} ${response.statusText}`));
      return payload;
    } finally {
      clearTimeout(timeout);
    }
  }

  spec() { return this.request('GET', 'spec'); }

  async register() {
    const settings = this.store.load();
    if (!settings.run_id) throw new Error('run_id is required before registration');
    const registration = await this.request('POST', `runs/${encodeURIComponent(settings.run_id)}/participants`, {
      participant_id: settings.participant_id,
      bot_id: settings.bot_id,
      display_name: settings.display_name,
      roles: settings.roles,
      subscribed_symbols: settings.subscribed_symbols,
      starting_cash: settings.starting_cash,
      commission_per_order: settings.commission_per_order,
      slippage_bps: settings.slippage_bps,
    });
    const participant = registration.participant as Record<string, unknown> | undefined;
    this.store.save({ enabled: true, participant_id: participant?.participant_id || settings.participant_id, api_token: registration.api_token });
    return { participant, token_header: registration.token_header, token_saved: Boolean(registration.api_token) };
  }

  async test() {
    const settings = this.store.load();
    const spec = await this.spec();
    const result: Record<string, unknown> = { ok: true, archive_reachable: true, contract: spec.contract_version, participant_authenticated: false };
    if (settings.run_id && settings.api_token) {
      result.account = await this.account();
      result.participant_authenticated = true;
    }
    return result;
  }

  account() {
    const settings = this.store.load();
    if (!settings.run_id || !settings.api_token) throw new Error('A registered run and participant token are required');
    return this.request('GET', `runs/${encodeURIComponent(settings.run_id)}/participants/${encodeURIComponent(settings.participant_id)}/account`, undefined, true);
  }
}

function validate(input: GeneralApiSettings): GeneralApiSettings {
  const baseUrl = String(input.base_url || '').trim().replace(/\/+$/, '');
  const parsed = new URL(baseUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('base_url must use http or https');
  const roles = [...new Set((input.roles || []).map((role) => String(role).trim().toLowerCase()).filter(Boolean))];
  if (!roles.length || roles.some((role) => !['trader', 'observer', 'risk_controller'].includes(role))) throw new Error('roles contain an unsupported value');
  const positive = (value: unknown, name: string, minimum: number) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < minimum) throw new Error(`${name} must be at least ${minimum}`);
    return number;
  };
  return {
    ...input,
    enabled: Boolean(input.enabled),
    base_url: baseUrl,
    run_id: String(input.run_id || '').trim(),
    participant_id: String(input.participant_id || '').trim() || defaults.participant_id,
    bot_id: String(input.bot_id || '').trim() || defaults.bot_id,
    display_name: String(input.display_name || '').trim() || defaults.display_name,
    roles,
    subscribed_symbols: [...new Set((input.subscribed_symbols || []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))],
    api_token: String(input.api_token || '').trim(),
    timeout_seconds: positive(input.timeout_seconds, 'timeout_seconds', 0.1),
    starting_cash: positive(input.starting_cash, 'starting_cash', 0.01),
    commission_per_order: positive(input.commission_per_order, 'commission_per_order', 0),
    slippage_bps: positive(input.slippage_bps, 'slippage_bps', 0),
  };
}
