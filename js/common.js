require=(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({"/src/js/common/browser.js":[function(require,module,exports){
// Browser class for the WebExtensions API.
// After Firefox moved to WebExtensions this is the only API we use. Still as a
// good practice we keep all API-specific code here.
// For documentation of the various methods, see browser_base.js
//
const Browser = require('./browser_base');
const Util = require('./util');

Browser.init = function(script) {
	Browser._script = script;

	switch(script) {
		case 'main':
			this._main_script();
			break;

		case 'content':
			break;
	}
};

// all browser-specific code that runs in the main script goes here
//
Browser._main_script = function() {
	// fire browser.install/update events
	//
	browser.runtime.onInstalled.addListener(function(details) {
		if(details.reason == "install")
			Util.events.fire('browser.install');

		else if(details.reason == "update")
			Util.events.fire('browser.update');
	});

	// some operations cannot be done by other scripts, so we set
	// handlers to do them in the main script
	//
	Browser.rpc.register('refreshIcon', async function(tabId, callerTabId) {
		// 'self' tabId in the content script means refresh its own tab
		await Browser.gui.refreshIcon(tabId == 'self' ?  callerTabId : tabId);
	});

	Browser.rpc.register('closeTab', function(tabId) {
		browser.tabs.remove(tabId);
	});

	// Workaroud some Firefox page-action 'bugs' (different behaviour than chrome)
	// - the icon is _not_ hidden automatically on refresh
	// - [android-only] the icon is _not_ hidden when navigating away from a page
	// - the icon _is_ hidden on history.pushstate (eg on google maps when
	//   clicking on some label) although the same page remains loaded
	//
	if(!Browser.capabilities.needsPAManualHide()) {
		Browser.gui.iconShown = {};

		browser.tabs.onUpdated.addListener(function(tabId, info) {
			// minimize overhead: only act if we have shown an icon in this tab before
			if(!Browser.gui.iconShown[tabId]) return;

			if(info.status == 'loading')
				// tab is loading, make sure the icon is hidden
				browser.pageAction.hide(tabId);
			else if(info.status == 'complete')
				// this fires after history.pushState. Call refreshIcon to reset
				// the icon if it was incorrectly hidden
				Browser.gui.refreshIcon(tabId);
		});
	}

	// set default icon (for browser action)
	//
	Browser.gui.refreshAllIcons();
}


//////////////////// rpc ///////////////////////////
//
//
Browser.rpc.register = function(name, handler) {
	// set onMessage listener if called for first time
	if(!this._methods) {
		this._methods = {};
		browser.runtime.onMessage.addListener(this._listener);
	}
	this._methods[name] = handler;
}

// onMessage listener. Received messages are of the form
// { method: ..., args: ... }
//
Browser.rpc._listener = function(message, sender, replyHandler) {
	Browser.log("RPC: got message", [message, sender, replyHandler]);

	var handler = Browser.rpc._methods[message.method];
	if(!handler) return;

	// add tabId and replyHandler to the arguments
	var args = message.args || [];
	var tabId = sender.tab ? sender.tab.id : null;
	args.push(tabId);

	const res = handler.apply(null, args);
	if(res instanceof Promise) {
		// handler returned a Promise. We return true here, to indicate that the response will come later.
		res.then(replyHandler);
		return true;
	} else {
		// We have a response right now
		replyHandler(res);
		return false;
	}
};

Browser.rpc.call = async function(tabId, name, args) {
	return new Promise(resolve => {
		var message = { method: name, args: args };
		if(tabId)
			browser.tabs.sendMessage(tabId, message, resolve);
		else
			browser.runtime.sendMessage(null, message, resolve);
	});
}


//////////////////// storage ///////////////////////////
//
// implemented using browser.storage.local
//
// Note: browser.storage.local can be used from any script (main, content,
//       popup, ...) and it always accesses the same storage, so no rpc
//       is needed for storage!
//
Browser.storage._key = "global";	// store everything under this key

Browser.storage.get = async function() {
	return new Promise(resolve => {
		browser.storage.local.get(Browser.storage._key, function(items) {
			var st = items[Browser.storage._key];

			// default values
			if(!st) {
				st = Browser.storage._default;
				Browser.storage.set(st);
			}
			resolve(st);
		});
	});
};

Browser.storage.set = async function(st) {
	return new Promise(resolve => {
		Browser.log('saving st', st);
		var items = {};
		items[Browser.storage._key] = st;
		browser.storage.local.set(items, resolve);
	});
};

Browser.storage.clear = async function() {
	return new Promise(resolve => {
		browser.storage.local.clear(resolve);
	});
};


//////////////////// gui ///////////////////////////
//
//
Browser.gui.refreshIcon = async function(tabId) {
	// delegate the call to the 'main' script if:
	// - we're in 'content': browser.pageAction/browserAction is not available there
	// - we use the FF pageAction workaround: we need to update Browser.gui.iconShown in 'main'
	//
	if(Browser._script == 'content' ||
	   (Browser._script != 'main' && Browser.capabilities.needsPAManualHide())
	) {
		await Browser.rpc.call(null, 'refreshIcon', [tabId]);
		return;
	}

	const info = await Util.getIconInfo(tabId);
	if(Browser.capabilities.permanentIcon())
		await Browser.gui._refreshBrowserAction(tabId, info);
	else
		await Browser.gui._refreshPageAction(tabId, info);
};

Browser.gui._icons = function(private) {
	var sizes = Browser.capabilities.supportedIconSizes();
	var ret = {};
	for(var i = 0; i < sizes.length; i++)
		ret[sizes[i]] = '/images/pin_' + (private ? '' : 'disabled_') + sizes[i] + '.png';
	return ret;
}

Browser.gui._refreshPageAction = function(tabId, info) {
	if(info.hidden || info.apiCalls == 0) {
		browser.pageAction.hide(tabId);
		return;
	}

	return new Promise(resolve => {
		if(Browser.gui.iconShown)
			Browser.gui.iconShown[tabId] = 1;

		browser.pageAction.setPopup({
			tabId: tabId,
			popup: "popup.html?tabId=" + tabId		// pass tabId in the url
		});
		browser.pageAction.show(tabId);

		browser.pageAction.setTitle({
			tabId: tabId,
			title: info.title
		});
		browser.pageAction.setIcon({
			tabId: tabId,
			path: Browser.gui._icons(info.private)
		}, resolve);		// setIcon is the only pageAction.set* method with a callback
	});
}

Browser.gui._refreshBrowserAction = function(tabId, info) {
	return new Promise(resolve => {
		browser.browserAction.setTitle({
			tabId: tabId,
			title: info.title
		});
		browser.browserAction.setBadgeText({
			tabId: tabId,
			text: (info.apiCalls || "").toString()
		});
		browser.browserAction.setBadgeBackgroundColor({
			tabId: tabId,
			color: "#b12222"
		});
		browser.browserAction.setPopup({
			tabId: tabId,
			popup: "popup.html" + (tabId ? "?tabId="+tabId : "")	// pass tabId in the url
		});
		browser.browserAction.setIcon({
			tabId: tabId,
			path: Browser.gui._icons(info.private)
		}, resolve);		// setIcon is the only browserAction.set* method with a callback
	});
}

Browser.gui.refreshAllIcons = async function() {
	return new Promise(resolve => {
		browser.tabs.query({}, async function(tabs) {
			// for browser action, also refresh default state (null tabId)
			if(Browser.capabilities.permanentIcon())
				tabs.push({ id: null });

			for(var i = 0; i < tabs.length; i++)
				await Browser.gui.refreshIcon(tabs[i].id);

			resolve();
		});
	});
};

Browser.gui.showPage = function(name) {
	browser.tabs.create({ url: browser.runtime.getURL(name) });
};

Browser.gui.getCallUrl = async function(tabId) {
	async function getActiveTabId() {
		return new Promise(resolve => {
			browser.tabs.query({
				active: true,               // Select active tabs
				lastFocusedWindow: true     // In the current window
			}, async function(tabs) {
				resolve(tabs[0].id);
			});
		})
	}

	if(!tabId)
		tabId = await getActiveTabId();

	// we call getState from the content script
	const state = await Browser.rpc.call(tabId, 'getState', []);
	return state && state.callUrl;		// state might be null if no content script runs in the tab
};

Browser.gui.closePopup = function() {
	if(Browser._script != 'popup') throw "only called from popup";

	if(Browser.capabilities.popupAsTab())
		// popup is shown as a normal tab so window.close() doesn't work. Call closeTab in the main script
		Browser.rpc.call(null, 'closeTab', []);
	else
		// normal popup closes with window.close()
		window.close();
}

Browser.gui.getURL = function(url) {
	return browser.runtime.getURL(url);
}

Browser.gui.mapTiles = function() {
	return {
		url: Browser.capabilities.isBrave()
			? 'https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png'
			: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
		info: { attribution: 'Map data © OpenStreetMap contributors' }
	};
}


//////////////////// capabilities ///////////////////////////
//
//
Browser.capabilities.isDebugging = function() {
	// update_url is only present if the extensioned is installed via the web store
	if(Browser.debugging == null)
		Browser.debugging = !('update_url' in browser.runtime.getManifest());
	return Browser.debugging;
}

Browser.capabilities.popupAsTab = function() {
	// Firefox@Android shows popup as normal tab
	return this._build == 'firefox' && this.isAndroid();
}

Browser.capabilities.needsPAManualHide = function() {
	// Workaroud some Firefox page-action 'bugs'
	return this._build == 'firefox';
}

Browser.capabilities.logInBackgroundPage = function() {
	return this._build == 'chrome';
}

// True: a geolocation call in an iframe appears (eg in the permission dialog) to come from the iframe's domain
// False: a geolocation call in an iframe appears to come from the top page's domain
//
Browser.capabilities.iframeGeoFromOwnDomain = function() {
	return this._build == 'firefox';
}

Browser.capabilities.permanentIcon = function() {
	// we use browserAction in browsers where pageAction is not properly supported (eg Chrome)
	return !!browser.runtime.getManifest().browser_action;
}

Browser.capabilities.supportedIconSizes = function() {
	return [16, 19, 32, 38, 128];
}


Browser.log = function() {
	if(!Browser.capabilities.isDebugging()) return;

	console.log.apply(console, arguments);

	// in chrome, apart from the current console, we also log to the background page, if possible and loaded
	//
	if(Browser.capabilities.logInBackgroundPage()) {
		var bp;
		if(browser.extension && browser.extension.getBackgroundPage)
			bp = browser.extension.getBackgroundPage();

		if(bp && bp.console != console)		// avoid logging twice
			bp.console.log.apply(bp.console, arguments);
	}
}

module.exports = Browser;

},{"./browser_base":"/src/js/common/browser_base.js","./util":"/src/js/common/util.js"}],"/src/js/common/browser_base.js":[function(require,module,exports){
// Base class for browser-specific functionality
// Subclasses should implement the API defined here
//
if(typeof(browser) === 'undefined')
	window.browser = chrome;

const Browser = {
	debugging: null,				// null: auto set to true if running locally
	testing: false,					// set to true to run tests on load

	// Browser.init(script)
	//
	// Initializes the Browser library. 'script' is the type of scrpit loading the
	// library, it can be one of:
	//   main
	//   content
	//   popup
	//   options
	//
	init: function(script) {},

	// Browser.rpc
	//
	// Class implementing rpc calls between the main script and content script
	// running in tabs. It is used both internally in the Browser library
	// and externally in the extension's scripts.
	//
	rpc: {
		// Browser.rpc.register(name, handler)
		//
		// Registers a method to be callable from other scripts.
		// handler should be a function
		//    async function(...args..., tabId)
		//
		// The function receives any arguments passed during the call (see Browser.rpc.call)
		// Moreover, one extra arguments are automatically added:
		//   tabId:         the tabId of the caller, or null if the call is made from the main script
		//
		register: function(name, handler) {},

		// Browser.rpc.call(tabId, name, args)
		//
		// Calls a remote method.
		//   tabId:    tab id of the script to call, or null to call the main script
		//   name:     method name
		//   args:     array of arguments to pass
		//
		// If the call cannot be made to the specific tabId, null is returned.
		//
		call: async function(tabId, name, args) {}
	},

	// Browser.storage
	//
	// Class implementing the extensions persistent storage.
	// The storage is a single object containing options, cache and everything
	// else that needs to be stored. It is fetched and stored as a whole.
	//
	storage: {
		// browser.storage.get()
		//
		// fetches the storage object.
		// The default object is returned if the storage is empty.
		//
		get: async function() {},

		// browser.storage.set(st)
		//
		// Stores the give storage object.
		//
		set: async function(st) {},

		// browser.storage.clear()
		//
		// Clears the storage.
		//
		clear: async function() {},

		// default storage object
		//
		_default: {
			paused: false,
			hideIcon: false,
			cachedPos: {},
			fixedPos: {
				latitude: -4.448784,
				longitude: -171.24832
			},
			fixedPosNoAPI: true,
			updateAccuracy: true,
			epsilon: 2,
			levels: {
				low: {
					radius: 200,
					cacheTime: 10,
				},
				medium: {
					radius: 500,
					cacheTime: 30,
				},
				high: {
					radius: 2000,
					cacheTime: 60,
				}
			},
			defaultLevel: "medium",
			domainLevel: {}
		}
	},

	// Browser.gui
	//
	// Class controlling the browser's GUI. The main GUI element is the extension's icon. Each tab has
	// a possibly different icon, whose information can be obtained by calling the rpc method 'getIconInfo'
	// of the content script. The method should return an object:
	//   { hidden:          true if the icon should be hidden,
	//     private:         true if the current tab is in a private mode,
	//     defaultPrivate:  true if the default settings are in a private mode,
	//     apiCalls:        no of times the API has been called in the current tab
	//     title:           icon's title }
	//
	// The GUI is free to render the icon in any way based on the above info. It can also render it
	// at any moment, by calling getIconInfo to get the info object.
	// When refreshIcon or refreshAllIcons are called the icons should be refreshed.
	//
	gui: {
		// Browser.gui.refreshIcon(tabId)
		//
		// Refreshes the icon of the tab with the given 'tabId'.
		// If called from a content script and tabId = 'self' it refreshes the icon of the content script's tab.
		// getIconInfo should be called to get the icon's info
		//
		refreshIcon: async function(tabId) {},

		// Browser.gui.refreshAllIcons()
		//
		// Refreshes the icons of all tabs.
		// getIconInfo should be called to get the icon's info
		//
		refreshAllIcons: async function() {},

		// Browser.gui.showPage(name)
		//
		// Shows an internal html page by opening a new tab, or focusing an old tab if it's already open
		// (at most one internal page should be open)
		//
		showPage: function(name) {},

		// Browser.gui.getCallUrl(tabId)
		//
		// Gets the callUrl of given tab.
		//
		getCallUrl: async function(tabId) {},

		// Browser.gui.closePopup()
		//
		// Closes the popup.
		//
		closePopup: function() {},

		// Browser.gui.getURL()
		//
		// Coverts a relative URL to a fully-qualified one.
		//
		getURL: function() {},
	},

	// Browser.capabilities
	//
	capabilities: {
		_build: 'chrome',		// this is replaced by "make build-foo"

		isDebugging: function() { return Browser.debugging },
		popupAsTab: function() { return false },
		permanentIcon: function() { return false },
		isAndroid: function() { return navigator.userAgent.toLowerCase().indexOf('android') > -1 },
		isBrave: function() { return 'brave' in navigator }
	},

	// Browser.log(text, value)
	//
	// Logs the given text/value pair
	//
	log: function(text, value) {
		if(!Browser.capabilities.isDebugging()) return;

		console.log(text, value);
	}
};
module.exports = Browser;


},{}],"/src/js/common/laplace.js":[function(require,module,exports){
// Planar Laplace mechanism, based on Marco's demo
//
// This class just implements the mechanism, does no budget management or
// selection of epsilon
//


// constructor
function PlanarLaplace() {
}


PlanarLaplace.earth_radius = 6378137; //const, in meters

// convert an angle in radians to degrees and viceversa
PlanarLaplace.prototype.rad_of_deg = function(ang){return ang * Math.PI / 180};;
PlanarLaplace.prototype.deg_of_rad = function(ang){return ang * 180 / Math.PI};;

// Mercator projection 
// https://wiki.openstreetmap.org/wiki/Mercator
// https://en.wikipedia.org/wiki/Mercator_projection

//getLatLon and getCartesianPosition are inverse functions
//They are used to transfer { x: ..., y: ... } and { latitude: ..., longitude: ... } into one another
PlanarLaplace.prototype.getLatLon = function(cart) {
	var rLon = cart.x / PlanarLaplace.earth_radius;
	var rLat = 2 * (Math.atan(Math.exp(cart.y / PlanarLaplace.earth_radius))) - Math.PI/2;
	//convert to degrees
	return {
		latitude: this.deg_of_rad(rLat),
		longitude: this.deg_of_rad(rLon)
	};
}

PlanarLaplace.prototype.getCartesian = function(ll){
	// latitude and longitude are converted in radiants
	return {
		x: PlanarLaplace.earth_radius * this.rad_of_deg(ll.longitude),
		y: PlanarLaplace.earth_radius * Math.log( Math.tan(Math.PI / 4 + this.rad_of_deg(ll.latitude) / 2))
	};
}


// LamberW function on branch -1 (http://en.wikipedia.org/wiki/Lambert_W_function)
PlanarLaplace.prototype.LambertW = function(x){
	//min_diff decides when the while loop should stop
	var min_diff = 1e-10;
	if (x == -1/Math.E){
		return -1;
	}

	else if (x<0 && x>-1/Math.E) {
		var q = Math.log(-x);
		var p = 1;
		while (Math.abs(p-q) > min_diff) {
			p=(q*q+x/Math.exp(q))/(q+1);
			q=(p*p+x/Math.exp(p))/(p+1);
		}
		//This line decides the precision of the float number that would be returned
		return (Math.round(1000000*q)/1000000);
	}
	else if (x==0) {return 0;}
	//TODO why do you need this if branch? 
	else{
		return 0;
	}
}

// This is the inverse cumulative polar laplacian distribution function. 
PlanarLaplace.prototype.inverseCumulativeGamma = function(epsilon, z){
	var x = (z-1) / Math.E;
	return - (this.LambertW(x) + 1) / epsilon;
}

// returns alpha such that the noisy pos is within alpha from the real pos with
// probability at least delta
// (comes directly from the inverse cumulative of the gamma distribution)
//
PlanarLaplace.prototype.alphaDeltaAccuracy = function(epsilon, delta) {
	return this.inverseCumulativeGamma(epsilon, delta);
}

// returns the average distance between the real and the noisy pos
//
PlanarLaplace.prototype.expectedError = function(epsilon) {
	return 2 / epsilon;
}


PlanarLaplace.prototype.addPolarNoise = function(epsilon, pos) {
	//random number in [0, 2*PI)
	var theta = Math.random() * Math.PI * 2;
	//random variable in [0,1)
	var z = Math.random();
	var r = this.inverseCumulativeGamma(epsilon, z);

	return this.addVectorToPos(pos, r, theta);
}

PlanarLaplace.prototype.addPolarNoiseCartesian = function(epsilon, pos) {
	if('latitude' in pos)
		pos = this.getCartesian(pos);

	//random number in [0, 2*PI)
	var theta = Math.random() * Math.PI * 2;
	//random variable in [0,1)
	var z = Math.random();
	var r = this.inverseCumulativeGamma(epsilon, z);

	return this.getLatLon({
		x: pos.x + r * Math.cos(theta),
		y: pos.y + r * Math.sin(theta)
	});
}

// http://www.movable-type.co.uk/scripts/latlong.html
PlanarLaplace.prototype.addVectorToPos = function(pos, distance, angle) {
	var ang_distance = distance / PlanarLaplace.earth_radius;
	var lat1 = this.rad_of_deg(pos.latitude);
	var lon1 = this.rad_of_deg(pos.longitude);

	var	lat2 =	Math.asin(
					Math.sin(lat1) * Math.cos(ang_distance) + 
					Math.cos(lat1) * Math.sin(ang_distance) * Math.cos(angle)
			  	);
	var lon2 =	lon1 +
			   	Math.atan2(
					Math.sin(angle) * Math.sin(ang_distance) * Math.cos(lat1), 
					Math.cos(ang_distance) - Math.sin(lat1) * Math.sin(lat2)
				);
	lon2 = (lon2 + 3 * Math.PI) % (2 * Math.PI) - Math.PI;		// normalise to -180..+180
	return { 
		latitude: this.deg_of_rad(lat2),
		longitude: this.deg_of_rad(lon2)
	};
}


//This function generates the position of a point with Laplacian noise
//
PlanarLaplace.prototype.addNoise = function(epsilon, pos) {
	// TODO: use latlon.js
	return this.addPolarNoise(epsilon, pos);
}

module.exports = PlanarLaplace;
},{}],"/src/js/common/post-rpc.js":[function(require,module,exports){
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

},{}],"/src/js/common/util.js":[function(require,module,exports){
// utility class, loaded in various places
//
// It should contain only browser-independent functions, browser-specific
// functionality should go to browser/*.js
//

var Util = {
	extractDomain: function(url) {
		var match = /\/\/([^\/]+)/.exec(url);
		return match ? match[1] : "";
	},
	extractAnchor: function(url) {
		var match = /#(.+)/.exec(url);
		return match ? match[1] : "";
	},
	clone: function(obj) {
		// Note: JSON stringify/parse doesn't work for cloning native objects such as Position and PositionError
		//
		var t = typeof obj;
		if(obj === null || t === 'undefined' || t === 'boolean' || t === 'string' || t === 'number')
			return obj;
		if(t !== 'object')
			return null;

		var o = {};
		for (var k in obj)
			o[k] = Util.clone(obj[k]);
		return o;
	},

	// Get icon information. 'about' can be:
	//   tabId
	//   null (get info for the default icon)
	//   state object { callUrl: ..., apiCalls: ... }
	//
	// Returns:
	//   { hidden:          true if the icon should be hidden,
	//     private:         true if the current tab is in a private mode,
	//     defaultPrivate:  true if the default settings are in a private mode,
	//     apiCalls:        no of times the API has been called in the current tab
	//     title:           icon's title }
	//
	//
	getIconInfo: async function(about) {
		if(typeof(about) != 'object') {	// tabId
			const Browser = require('./browser');
			about = await Browser.rpc.call(about, 'getState', []);
		}

		return await Util._getStateIconInfo(about);
	},

	_getStateIconInfo: async function(state) {
		// return info for the default icon if state is null
		state = state || { callUrl: '', apiCalls: 0 };

		const Browser = require('./browser');
		const st = await Browser.storage.get();
		var domain = Util.extractDomain(state.callUrl);
		var level = st.domainLevel[domain] || st.defaultLevel;

		var info = {
			hidden:  st.hideIcon,
			private: !st.paused && level != 'real',
			defaultPrivate: !st.paused && st.defaultLevel != 'real',
			apiCalls: state.apiCalls,
			title:
				"Location Guard\n" +
				(st.paused		? "Paused" :
				level == 'real'	? "Using your real location" :
				level == 'fixed'? "Using a fixed location" :
				"Privacy level: " + level)
		};
		return info;
	},

	events: {
		_listeners: {},

		addListener: function(name, fun) {
			if(!this._listeners[name])
				this._listeners[name] = [];
			this._listeners[name].push(fun);
		},

		fire: function(name) {
			var list = this._listeners[name];
			if(!list) return;

			for(var i = 0; i < list.length; i++)
				list[i]();
		}
	}
};

module.exports = Util;
},{"./browser":"/src/js/common/browser.js"}]},{},[]);
