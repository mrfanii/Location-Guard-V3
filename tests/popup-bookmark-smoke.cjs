const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function renderPopup(overrides = {}) {
  const elements = new Map();
  const document = {};
  let readyHandler;
  let initialized = false;
  let closed = false;
  const rpcCalls = [];

  function elementState(selector) {
    if (!elements.has(selector)) {
      elements.set(selector, {
        attributes: {},
        children: [],
        handlers: {},
        value: '',
        visible: true,
      });
    }
    return elements.get(selector);
  }

  function chain(selector, suppliedState) {
    const state = suppliedState || elementState(selector);
    return {
      _state: state,
      append(option) {
        state.children.push(option._state);
        return this;
      },
      attr(name, value) {
        if (value === undefined) {
          if (name === 'id' && state.attributes[name] === undefined && selector.startsWith('#')) return selector.slice(1);
          return state.attributes[name];
        }
        state.attributes[name] = value;
        return this;
      },
      css() {
        return this;
      },
      height() {
        return 400;
      },
      hide() {
        state.visible = false;
        return this;
      },
      on(event, handler) {
        state.handlers[event] = handler;
        return this;
      },
      parent() {
        return chain(selector + ':parent');
      },
      popup(action) {
        state.popupAction = action;
        return this;
      },
      ready(handler) {
        readyHandler = handler;
        return this;
      },
      show() {
        state.visible = true;
        return this;
      },
      text(value) {
        if (value === undefined) return state.text;
        state.text = value;
        return this;
      },
      toggle(value) {
        state.visible = !!value;
        return this;
      },
      val(value) {
        if (value === undefined) return state.value;
        state.value = value;
        return this;
      },
      width() {
        return 320;
      },
    };
  }

  function $(selector) {
    if (selector === document) return chain('document');
    if (selector && selector.__selector) return chain(selector.__selector);
    if (/^<[^>]+>$/.test(selector)) {
      const state = {
        attributes: {},
        children: [],
        handlers: {},
        tag: selector.slice(1, -1),
        value: '',
        visible: true,
      };
      return chain(selector, state);
    }
    return chain(selector);
  }

  $.mobile = {
    initializePage() {
      initialized = true;
    },
  };

  const storage = {
    paused: false,
    hideIcon: false,
    defaultLevel: 'medium',
    domainLevel: { 'example.com': 'fixed' },
    fixedPos: { latitude: 52.52, longitude: 13.405 },
    savedFixedPositions: [
      { id: 'home', name: 'Home', latitude: 35.7219, longitude: 51.3347 },
      { id: 'office', name: 'Office', latitude: 52.52, longitude: 13.405 },
    ],
    ...overrides.storage,
  };

  const Browser = {
    testing: false,
    capabilities: {
      permanentIcon: () => true,
      popupAsTab: () => false,
    },
    gui: {
      closePopup() {
        closed = true;
      },
      getCallUrl: async () => (Object.hasOwn(overrides, 'callUrl') ? overrides.callUrl : 'https://example.com/page'),
      refreshAllIcons: async () => {},
    },
    init() {},
    log() {},
    rpc: {
      async call(tabId, method, args) {
        rpcCalls.push({ tabId, method, args });
        return { bookmark: storage.savedFixedPositions.find((bookmark) => bookmark.id === args[0]) };
      },
    },
    storage: {
      get: async () => storage,
    },
  };

  const context = vm.createContext({
    console,
    document,
    LocationGuard: {
      Browser,
      Util: {
        extractDomain: (url) => new URL(url).hostname,
      },
    },
    window: {
      alert() {},
      location: { href: 'chrome-extension://test/popup.html' },
    },
    jQuery: $,
    URL,
  });

  vm.runInContext(fs.readFileSync('js/gui/popup.js', 'utf8'), context, { filename: 'popup.js' });
  await readyHandler();

  return {
    activate: async (id) => {
      const selector = 'input[name="savedFixedPosition"]';
      elementState(selector).value = id;
      await elementState(selector).handlers.click.call({ __selector: selector });
    },
    closed: () => closed,
    element: elementState,
    initialized: () => initialized,
    openPicker: async () => {
      const selector = 'a, input[name="level"]';
      await elementState(selector).handlers.click.call({ __selector: '#setFixedPosition' });
    },
    rpcCalls,
  };
}

(async () => {
  const fixed = await renderPopup();
  assert.equal(fixed.initialized(), true);
  assert.equal(fixed.element('#savedFixedPositionItem').visible, true);
  assert.equal(fixed.element('#setFixedPosition b').text, 'Office');
  assert.deepEqual(
    fixed
      .element('#savedFixedPositionChoices')
      .children.filter((choice) => choice.tag === 'label')
      .map((choice) => choice.text),
    ['Home', 'Office'],
  );
  const checked = fixed.element('#savedFixedPositionChoices').children.find((choice) => choice.tag === 'input' && choice.attributes.checked);
  assert.equal(checked.value, 'office', 'the active saved position must be selected');

  await fixed.openPicker();
  assert.equal(fixed.element('#savedFixedPositionsPopup').popupAction, 'open');

  await fixed.activate('home');
  assert.deepEqual(JSON.parse(JSON.stringify(fixed.rpcCalls.at(-1))), {
    tabId: null,
    method: 'activateFixedPositionBookmark',
    args: ['home'],
  });
  assert.equal(fixed.closed(), true);

  const nonFixed = await renderPopup({ storage: { domainLevel: { 'example.com': 'medium' } } });
  assert.equal(nonFixed.element('#savedFixedPositionItem').visible, false);

  const noBookmarks = await renderPopup({ storage: { savedFixedPositions: [] } });
  assert.equal(noBookmarks.element('#savedFixedPositionItem').visible, false);

  const paused = await renderPopup({ storage: { paused: true } });
  assert.equal(paused.element('#savedFixedPositionItem').visible, false);

  const defaultFixed = await renderPopup({ storage: { defaultLevel: 'fixed', domainLevel: {} } });
  assert.equal(defaultFixed.element('#savedFixedPositionItem').visible, true);

  const noSite = await renderPopup({ callUrl: null });
  assert.equal(noSite.element('#savedFixedPositionItem').visible, false);

  console.log('popup bookmark smoke ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
