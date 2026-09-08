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

  async function callCallback(callback, position, checkAllowed) {
    if (callback && (!checkAllowed || (await getRPC().call('watchAllowed', [false])))) callback(position);
  }

  navigator.geolocation.getCurrentPosition = async function (success, error, options) {
    const result = await getRPC().call('getNoisyPosition', [options]);
    callCallback(result.success ? success : error, result.position, false);
  };

  const nativeWatchPosition = navigator.geolocation.watchPosition;
  const nativeClearWatch = navigator.geolocation.clearWatch;
  const handlers = {};
  let nextHandler = 1;

  navigator.geolocation.watchPosition = function (success, error, options) {
    const handler = nextHandler++;
    handlers[handler] = { nativeId: null };

    (async () => {
      if (await getRPC().call('watchAllowed', [true])) {
        if (!(handler in handlers)) return;

        const nativeId = nativeWatchPosition.apply(navigator.geolocation, [
          (position) => callCallback(success, position, true),
          (watchError) => callCallback(error, watchError, true),
          options,
        ]);
        handlers[handler].nativeId = nativeId;
      } else {
        if (!(handler in handlers)) return;

        navigator.geolocation.getCurrentPosition(
          (position) => {
            if (handler in handlers && success) success(position);
          },
          (positionError) => {
            if (handler in handlers && error) error(positionError);
          },
          options,
        );
      }
    })();

    return handler;
  };

  navigator.geolocation.clearWatch = function (handler) {
    if (!(handler in handlers)) return;

    const nativeId = handlers[handler].nativeId;
    delete handlers[handler];
    if (nativeId != null) nativeClearWatch.call(navigator.geolocation, nativeId);
  };
})();
