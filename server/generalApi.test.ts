import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { GeneralApiStore } from './generalApi.js';

test('General API settings redact the participant token and use a private file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-core-general-api-'));
  try {
    const filePath = path.join(directory, 'general_api.json');
    const store = new GeneralApiStore(filePath);
    const saved = store.save({
      run_id: 'recorded-replay-1',
      api_token: 'archive-participant-secret',
      subscribed_symbols: ['spy', 'SPY', 'tsla'],
    });
    const visible = store.public(saved);

    assert.equal(saved.api_token, 'archive-participant-secret');
    assert.equal('api_token' in visible, false);
    assert.equal(visible.token_configured, true);
    assert.deepEqual(visible.subscribed_symbols, ['SPY', 'TSLA']);
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

