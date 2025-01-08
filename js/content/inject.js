(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
// PostRPC provides RPC functionality through message passing (postMessage)
//
// sendObj: object for sending messages (window or port)
// receiveObj: object for receiving messages
//
// The case when sendObj == receiveObj == window is supported. In this
// case sent messages will be also received by us, and ignored.
//
function _code() {		// include all code here to inject easily

	var PostRPC = function(name, sendObj, receiveObj, targetOrigin) {
		this._id = Math.floor(Math.random()*1000000);
		this._ns = '__PostRPC_' + name;
		this._sendObj = sendObj;
		this._calls = {};
		this._methods = {};
		this._targetOrigin = targetOrigin;

		if(receiveObj)
			receiveObj.addEventListener("message", this._receiveMessage.bind(this), false);
	};

	// public methods
	PostRPC.prototype.register = function(name, fun) {
		this._methods[name] = fun;
	};
	PostRPC.prototype.call = function(method, args) {
	 	return new Promise(resolve => {
			var callId = Math.floor(Math.random()*1000000);
			this._calls[callId] = resolve;
			if(!args) args = [];

			this._sendMessage({ method: method, args: args, callId: callId, from: this._id });
		});
	};

	// private methods for sending/receiving messages
	PostRPC.prototype._sendMessage = function(message) {
		// everything is inside ns, to minimize conflicts with other messages
		var temp = {};
		temp[this._ns] = message;
		this._sendObj.postMessage(temp, this._targetOrigin);
	}

	PostRPC.prototype._receiveMessage = async function(event) {
		var data = event.data && event.data[this._ns];		// everything is inside ns, to minimize conflicts with other message
		if(!data) return;

		if(data.method) {
			// message call
			if(data.from == this._id) return;						// we made this call, the other side should reply
			if(!this._methods[data.method]) {						// not registered
				if(console)
					console.log('PostRPC: no handler for '+data.method);
				return;
			}

			// call the handler, send back the result
			const res = await this._methods[data.method].apply(null, data.args);
			this._sendMessage({ callId: data.callId, value: [res] });

		} else {
			// return value
			var c = this._calls[data.callId];
			delete this._calls[data.callId];
			if(!c) return;											// return value for the other side, or no return handler
			c.apply(null, data.value);
		}
	}

	return PostRPC;
}

module.exports = _code();
module.exports._code = _code;

},{}],2:[function(require,module,exports){
// This is loaded as an external script if the inline <script>...</script> is prevented by a CSP.
// It simply runs the injectedCode function.
//
const PostRPC = require('../common/post-rpc');
const injectedCode = require('./injected');

injectedCode(PostRPC);
},{"../common/post-rpc":1,"./injected":3}],3:[function(require,module,exports){
// This will be injected to the page by content.js. Either inline, by copying the code of the injectedCode function
// in a <script>...</script>, or by inserting inject.js as an external script.
//
module.exports = function(PostRPC) {
	if(navigator.geolocation) {		// the geolocation API exists
		var prpc;
		function getPostRPC() {
			// create a PostRPC object only when getCurrentPosition is called. This
			// avoids having our own postMessage handler on every page
			if(!prpc)
				prpc = new PostRPC('page-content', window, window, window.origin);	// This PostRPC is created by the injected code!
			return prpc;
		}
		async function callCb(cb, pos, checkAllowed) {
			if(cb && (!checkAllowed || await getPostRPC().call('watchAllowed', [false])))
				cb(pos);
		}

		// We replace geolocation methods with our own.
		// getCurrentPosition will be called by the content script (not by the page)
		// so we dont need to keep it at all.

		navigator.geolocation.getCurrentPosition = async function(cb1, cb2, options) {
			// call getNoisyPosition on the content-script
			// call cb1 on success, cb2 on failure
			const res = await getPostRPC().call('getNoisyPosition', [options]);
			callCb(res.success ? cb1 : cb2, res.position, false);
		};

		const watchPosition = navigator.geolocation.watchPosition;
		const handlers = {};
		navigator.geolocation.watchPosition = function(cb1, cb2, options) {
			// We need to return a handler synchronously, but decide whether we'll use the real watchPosition or not
			// asynchronously. So we create our own handler, and we'll associate it with the real one later.
			const handler = Math.floor(Math.random()*10000);

			(async () => {
				if(await getPostRPC().call('watchAllowed', [true]))
					// We're allowed to call the real watchPosition (note: remember the handler)
					handlers[handler] = watchPosition.apply(navigator.geolocation, [
						position => callCb(cb1, position, true),	// ignore the call if privacy protection
						error    => callCb(cb2, error, true),		// becomes active later!
						options
					]);
				else
					// Not allowed, we don't install a real watch, just return the position once
					this.getCurrentPosition(cb1, cb2, options);
			})();
			return handler;
		};

		const clearWatch = navigator.geolocation.clearWatch;
		navigator.geolocation.clearWatch = function (handler) {
			if(handler in handlers) {
				clearWatch.apply(navigator.geolocation, [handlers[handler]]);
				delete handlers[handler];
			}
		};
	}

	// remove script
	var s = document.getElementById('__lg_script');
	if(s) s.remove();	// DEMO: in demo injectCode is run directly so there's no script
};

},{}]},{},[2]);
