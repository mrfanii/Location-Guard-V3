(function () {
  function PostRPC(name, sendObj, receiveObj, targetOrigin) {
    this._id = Math.floor(Math.random() * 1000000);
    this._ns = '__PostRPC_' + name;
    this._sendObj = sendObj;
    this._calls = {};
    this._methods = {};
    this._targetOrigin = targetOrigin;

    if (receiveObj) receiveObj.addEventListener('message', this._receiveMessage.bind(this), false);
  }

  PostRPC.prototype.register = function (name, fun) {
    this._methods[name] = fun;
  };

  PostRPC.prototype.call = function (method, args) {
    return new Promise((resolve) => {
      var callId = Math.floor(Math.random() * 1000000);
      this._calls[callId] = resolve;
      this._sendMessage({ method: method, args: args || [], callId: callId, from: this._id });
    });
  };

  PostRPC.prototype._sendMessage = function (message) {
    var envelope = {};
    envelope[this._ns] = message;
    this._sendObj.postMessage(envelope, this._targetOrigin);
  };

  PostRPC.prototype._receiveMessage = async function (event) {
    var data = event.data && event.data[this._ns];
    if (!data) return;

    if (data.method) {
      if (data.from == this._id || !this._methods[data.method]) return;
      const result = await this._methods[data.method].apply(null, data.args);
      this._sendMessage({ callId: data.callId, value: [result] });
      return;
    }

    var callback = this._calls[data.callId];
    delete this._calls[data.callId];
    if (callback) callback.apply(null, data.value);
  };

  if (!navigator.geolocation) return;

  var rpc;
  function getRPC() {
    if (!rpc) rpc = new PostRPC('page-content', window, window, window.origin);
    return rpc;
  }

  async function protectedGetCurrentPosition(success, error, options) {
    const result = await getRPC().call('getNoisyPosition', [options]);
    const callback = result.success ? success : error;
    if (callback) callback(result.position);
  }

  const schedule = window.setTimeout.bind(window);
  const cancelSchedule = window.clearTimeout.bind(window);
  const handlers = {};
  let nextHandler = 1;

  function requestWatchPosition(handler, success, error, options) {
    if (!(handler in handlers)) return;

    protectedGetCurrentPosition(
      (position) => {
        if (!(handler in handlers)) return;
        handlers[handler].timer = schedule(() => requestWatchPosition(handler, success, error, options), 1000);
        if (success) success(position);
      },
      (positionError) => {
        if (!(handler in handlers)) return;
        handlers[handler].timer = schedule(() => requestWatchPosition(handler, success, error, options), 1000);
        if (error) error(positionError);
      },
      options,
    );
  }

  function protectedWatchPosition(success, error, options) {
    const handler = nextHandler++;
    handlers[handler] = { timer: null };
    requestWatchPosition(handler, success, error, options);
    return handler;
  }

  function protectedClearWatch(handler) {
    if (!(handler in handlers)) return;

    const timer = handlers[handler].timer;
    delete handlers[handler];
    if (timer != null) cancelSchedule(timer);
  }

  const protectedMethods = {
    getCurrentPosition: protectedGetCurrentPosition,
    watchPosition: protectedWatchPosition,
    clearWatch: protectedClearWatch,
  };
  const geolocationPrototype = Object.getPrototypeOf(navigator.geolocation);

  Object.keys(protectedMethods).forEach((name) => {
    const descriptor = { value: protectedMethods[name], configurable: true, writable: true };
    Object.defineProperty(geolocationPrototype, name, descriptor);
    Object.defineProperty(navigator.geolocation, name, descriptor);
  });
})();
