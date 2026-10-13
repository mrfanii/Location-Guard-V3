const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const messageListeners = [];
const installListeners = [];
const importedScripts = [];
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
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

const chrome = {
  runtime: {
    getManifest: () => ({ action: {}, update_url: 'https://updates.invalid' }),
    getURL: (path) => 'chrome-extension://test/' + path,
    onInstalled: { addListener: (listener) => installListeners.push(listener) },
    onMessage: { addListener: (listener) => messageListeners.push(listener) },
    sendMessage(message, callback) {
      callback();
    },
  },
  storage: {
    local: {
      get(key, callback) {
        setTimeout(() => callback({ [key]: clone(stored[key]) }), Math.floor(Math.random() * 3));
      },
      set(items, callback) {
        setTimeout(
          () => {
            stored = Object.assign(stored, clone(items));
            callback();
          },
          Math.floor(Math.random() * 3),
        );
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
    query(options, callback) {
      callback([]);
    },
    sendMessage(tabId, message, callback) {
      callback();
    },
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

const context = vm.createContext({
  chrome,
  console,
  navigator: { userAgent: '' },
  setTimeout,
});

context.importScripts = (...paths) => {
  importedScripts.push(...paths);

  for (const scriptPath of paths) {
    if (scriptPath === 'background/statistics.js') continue;

    vm.runInContext(fs.readFileSync(path.join('js', scriptPath), 'utf8'), context, { filename: scriptPath });
  }
};

vm.runInContext(fs.readFileSync('js/background.js', 'utf8'), context, {
  filename: 'background.js',
});

assert.deepEqual(importedScripts, ['background/statistics.js', 'common.js', 'background/main.js']);
assert.equal(messageListeners.length, 1);

function send(method, args = []) {
  return new Promise((resolve) => {
    const asynchronous = messageListeners[0]({ method, args }, { tab: { id: 7 } }, resolve);
    assert.equal(asynchronous, true);
  });
}

(async () => {
  chrome.tabs.sendMessage = (tabId, message, callback) => {
    chrome.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' };
    callback();
    delete chrome.runtime.lastError;
  };
  assert.equal(await send('apiCalledInFrame', ['https://frame.invalid']), undefined, 'tabs without a content-script receiver must be ignored');

  chrome.tabs.sendMessage = (tabId, message, callback) => callback();

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
  const results = await Promise.all([send('cachePosition', ['medium', candidateA, true, 500]), send('cachePosition', ['medium', candidateB, true, 500])]);

  assert.deepEqual(results[0], results[1], 'concurrent callers must receive the same cached position');
  assert.equal(stored.global.cachedPos.medium.position.coords.latitude, 1);

  const invalid = await send('upsertFixedPositionBookmark', [null, 'Invalid', { latitude: 91, longitude: 0 }]);
  assert.match(invalid.error, /invalid/);

  const home = await send('upsertFixedPositionBookmark', [null, 'Home', { latitude: 35.7219, longitude: 51.3347 }]);
  assert.equal(home.error, undefined);
  assert.equal(stored.global.savedFixedPositions.length, 1, 'old storage must gain a bookmark list on first save');
  assert.equal(stored.global.fixedPos.latitude, 35.7219);

  const duplicate = await send('upsertFixedPositionBookmark', [null, 'home', { latitude: 1, longitude: 2 }]);
  assert.match(duplicate.error, /already exists/);
  assert.equal(stored.global.savedFixedPositions.length, 1);

  const office = await send('upsertFixedPositionBookmark', [home.bookmark.id, 'Office', { latitude: 52.52, longitude: 13.405 }]);
  assert.equal(office.bookmark.name, 'Office');
  assert.equal(stored.global.savedFixedPositions[0].latitude, 52.52);

  const activated = await send('activateFixedPositionBookmark', [home.bookmark.id]);
  assert.deepEqual(clone(activated.position), { latitude: 52.52, longitude: 13.405 });
  assert.deepEqual(stored.global.fixedPos, clone(activated.position));

  stored.global.savedFixedPositions[0].latitude = 91;
  const corrupted = await send('activateFixedPositionBookmark', [home.bookmark.id]);
  assert.match(corrupted.error, /invalid/);
  stored.global.savedFixedPositions[0].latitude = 52.52;

  const deleted = await send('deleteFixedPositionBookmark', [home.bookmark.id]);
  assert.deepEqual(deleted.bookmarks, []);
  assert.deepEqual(stored.global.fixedPos, clone(activated.position), 'deleting a bookmark must not change the active fixed position');

  const restored = await send('restoreDefaults');
  assert.deepEqual(clone(restored.savedFixedPositions), []);

  assert.equal(await context.LocationGuard.Browser.gui.getCallUrl(), null, 'no active tab must return no call URL');

  chrome.tabs.query = (options, callback) => {
    chrome.runtime.lastError = { message: 'window closed' };
    callback();
    delete chrome.runtime.lastError;
  };
  assert.equal(await context.LocationGuard.Browser.gui.getCallUrl(), null, 'a closed window must return no call URL');

  chrome.tabs.query = (options, callback) => callback([{ id: 1 }, { id: 2 }]);
  const refreshedTabs = [];
  chrome.action.setTitle = async ({ tabId }) => {
    refreshedTabs.push(tabId);
    if (tabId === 1) throw new Error('tab closed');
  };
  await context.LocationGuard.Browser.gui.refreshAllIcons();
  assert.deepEqual(refreshedTabs.slice(0, 2), [1, 2], 'a closed tab must not prevent the remaining icons from refreshing');

  chrome.tabs.query = (options, callback) => {
    chrome.runtime.lastError = { message: 'window closed' };
    callback();
    delete chrome.runtime.lastError;
  };
  await context.LocationGuard.Browser.gui.refreshAllIcons();

  console.log('storage mutation smoke ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
