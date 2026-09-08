const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const messageListeners = [];
const installListeners = [];
let stored = {
  global: {
    paused: false,
    hideIcon: false,
    cachedPos: {},
    fixedPos: { latitude: 0, longitude: 0 },
    fixedPosNoAPI: true,
    updateAccuracy: true,
    epsilon: 2,
    levels: {
      low: { radius: 200, cacheTime: 10 },
      medium: { radius: 500, cacheTime: 30 },
      high: { radius: 2000, cacheTime: 60 },
    },
    defaultLevel: 'medium',
    domainLevel: {},
  },
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const chrome = {
  runtime: {
    getManifest: () => ({ action: {}, update_url: 'https://updates.invalid' }),
    getURL: (path) => 'chrome-extension://test/' + path,
    onInstalled: { addListener: (listener) => installListeners.push(listener) },
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    sendMessage(message, callback) { callback(); },
  },
  storage: {
    local: {
      get(key, callback) {
        setTimeout(() => callback({ [key]: clone(stored[key]) }), Math.floor(Math.random() * 3));
      },
      set(items, callback) {
        setTimeout(() => {
          stored = Object.assign(stored, clone(items));
          callback();
        }, Math.floor(Math.random() * 3));
      },
      clear(callback) {
        setTimeout(() => {
          stored = {};
          callback();
        }, 0);
      },
    },
  },
  tabs: {
    query(options, callback) { callback([]); },
    sendMessage(tabId, message, callback) { callback(); },
    create() {},
    remove() {},
  },
  action: {
    setTitle: async () => {},
    setBadgeText: async () => {},
    setBadgeBackgroundColor: async () => {},
    setPopup: async () => {},
    setIcon: async () => {},
  },
};

vm.runInNewContext(fs.readFileSync('js/background.js', 'utf8'), {
  chrome,
  console,
  navigator: { userAgent: '' },
  setTimeout,
});

assert.equal(messageListeners.length, 1);

function send(method, args = []) {
  return new Promise((resolve) => {
    const asynchronous = messageListeners[0]({ method, args }, { tab: { id: 7 } }, resolve);
    assert.equal(asynchronous, true);
  });
}

(async () => {
  const candidateA = { epoch: Date.now(), position: { coords: { latitude: 1, longitude: 1, accuracy: 10 } } };
  const candidateB = { epoch: Date.now(), position: { coords: { latitude: 2, longitude: 2, accuracy: 10 } } };

  await Promise.all([
    send('saveOptions', [{ defaultLevel: 'high', paused: true, hideIcon: false, updateAccuracy: true }]),
    send('cachePosition', ['medium', candidateA, true, 500]),
  ]);
  assert.equal(stored.global.paused, true, 'cache writes must not revert settings');
  assert.equal(stored.global.defaultLevel, 'high');
  assert.equal(stored.global.cachedPos.medium.position.coords.latitude, 1);

  await send('clearCache');
  const results = await Promise.all([
    send('cachePosition', ['medium', candidateA, true, 500]),
    send('cachePosition', ['medium', candidateB, true, 500]),
  ]);

  assert.deepEqual(results[0], results[1], 'concurrent callers must receive the same cached position');
  assert.equal(stored.global.cachedPos.medium.position.coords.latitude, 1);
  console.log('storage mutation smoke ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
