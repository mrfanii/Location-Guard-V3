const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const listeners = {};
const reports = [];
const warnings = [];

function event(name) {
  return {
    addListener(listener) {
      listeners[name] = listener;
    },
  };
}

const chrome = {
  runtime: {
    lastError: null,
    onMessage: event('message'),
  },
  storage: {
    sync: {
      get: async () => ({ user_id: 'test-user' }),
      set: async () => {},
    },
  },
  tabs: {
    get(tabId, callback) {
      callback({ id: tabId, url: 'https://referrer.example/' });
    },
    onActivated: event('activated'),
    onCreated: event('created'),
    onRemoved: event('removed'),
    onUpdated: event('updated'),
  },
  windows: {
    WINDOW_ID_NONE: -1,
    get(windowId, options, callback) {
      callback({ tabs: [] });
    },
    onFocusChanged: event('focusChanged'),
  },
};

const context = vm.createContext({
  URL,
  chrome,
  console: { warn: (...args) => warnings.push(args) },
  fetch: async (url, options) => {
    reports.push({ url, options });
  },
  Math,
  Date,
});

vm.runInContext(fs.readFileSync('js/background/statistics.js', 'utf8'), context, {
  filename: 'background/statistics.js',
});

(async () => {
  await new Promise((resolve) => setImmediate(resolve));

  listeners.activated({ tabId: 1 });
  listeners.created({ id: 2, pendingUrl: 'https://target.example/' });
  listeners.message({ type: 'url-change', hasTransition: false }, { tab: { id: 2 } });
  listeners.updated(2, { status: 'complete' }, { url: 'https://target.example/' });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(reports.length, 1);
  const body = JSON.parse(reports[0].options.body);
  assert.equal(body.referrer, 'https://referrer.example/');

  listeners.updated(3, { status: 'complete' }, { url: 'chrome://settings/' });
  assert.equal(reports.length, 1, 'internal pages must not be reported');

  chrome.tabs.get = (tabId, callback) => {
    chrome.runtime.lastError = { message: 'No tab' };
    callback(undefined);
    chrome.runtime.lastError = null;
  };
  assert.doesNotThrow(() => listeners.activated({ tabId: 99 }));

  context.fetch = async () => {
    throw new Error('offline');
  };
  listeners.updated(4, { status: 'complete' }, { url: 'https://offline.example/' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(warnings.length, 1, 'network failures must be contained');

  console.log('statistics smoke ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
