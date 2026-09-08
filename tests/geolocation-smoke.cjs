const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const namespace = '__PostRPC_page-content';
const listeners = [];
const timers = new Map();
const rpcMethods = [];
let nextTimer = 1;
let nativeCalls = 0;
let positionNumber = 0;

const nativeGetCurrentPosition = () => { nativeCalls++; };
const nativeWatchPosition = () => { nativeCalls++; };
const nativeClearWatch = () => { nativeCalls++; };
const geolocationPrototype = {
  getCurrentPosition: nativeGetCurrentPosition,
  watchPosition: nativeWatchPosition,
  clearWatch: nativeClearWatch,
};
const geolocation = Object.create(geolocationPrototype);

function dispatch(data, testWindow) {
  const event = { data, source: testWindow, origin: testWindow.origin };
  listeners.forEach((listener) => listener(event));
}

const testWindow = {
  origin: 'https://test.invalid',
  addEventListener(type, listener) {
    if (type === 'message') listeners.push(listener);
  },
  postMessage(data) {
    queueMicrotask(() => dispatch(data, testWindow));

    const message = data[namespace];
    if (!message || !message.method) return;
    rpcMethods.push(message.method);

    if (message.method === 'getNoisyPosition') {
      queueMicrotask(() => {
        const envelope = {};
        envelope[namespace] = {
          callId: message.callId,
          value: [{ success: true, position: { sequence: ++positionNumber } }],
        };
        dispatch(envelope, testWindow);
      });
    }
  },
  setTimeout(callback) {
    const id = nextTimer++;
    timers.set(id, callback);
    return id;
  },
  clearTimeout(id) {
    timers.delete(id);
  },
};

vm.runInNewContext(fs.readFileSync('js/content/main-world.js', 'utf8'), {
  window: testWindow,
  navigator: { geolocation },
  console,
  queueMicrotask,
});

async function flushMessages() {
  await new Promise((resolve) => setImmediate(resolve));
}

(async () => {
  assert.notEqual(geolocationPrototype.getCurrentPosition, nativeGetCurrentPosition);
  delete geolocation.getCurrentPosition;

  const directPosition = await new Promise((resolve) => geolocation.getCurrentPosition(resolve));
  assert.equal(directPosition.sequence, 1, 'prototype calls must use the protected implementation');

  let cancelledCallbacks = 0;
  const cancelledHandle = geolocation.watchPosition(() => cancelledCallbacks++);
  geolocation.clearWatch(cancelledHandle);
  await flushMessages();
  assert.equal(cancelledCallbacks, 0, 'a pending watch must be cancellable');

  let callbacks = 0;
  const activeHandle = geolocation.watchPosition(() => callbacks++);
  assert.notEqual(activeHandle, cancelledHandle, 'watch handles must be unique');
  await flushMessages();
  assert.equal(callbacks, 1);
  assert.equal(timers.size, 1);

  const repeat = timers.values().next().value;
  timers.clear();
  repeat();
  await flushMessages();
  assert.equal(callbacks, 2, 'watchPosition must request repeated protected positions');

  geolocation.clearWatch(activeHandle);
  assert.equal(timers.size, 0);
  assert.equal(nativeCalls, 0, 'page-world native geolocation must never be called');
  assert.equal(rpcMethods.includes('watchAllowed'), false, 'watchAllowed must not be exposed');

  console.log('geolocation smoke ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
