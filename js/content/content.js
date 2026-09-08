(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
//
// content.js
//
// This script runs as a _content script_ (in a separate js environment) on all pages.
//
// HOWEVER:
// Chrome does not allow content scripts in internal pages, so in the _demo page_ we just
// include content.js as a normal <script>. This mostly works (we don't need the
// separate js environment anyway), apart from a few things marked as DEMO below.
//
//
// PostRPC is being used for communication between the content script and the code
// injected in the page (they both share the same window object).
// NOTE: this communication is not secure and could be intercepted by the page.
//       so only a noisy location should be transmitted over PostRPC
//
// The following run in the content script

const Browser = require('../common/browser');
const Util = require('../common/util');
const PostRPC = require('../common/post-rpc');
const injectedCode = require('./injected');

// DEMO: save the getCurrentPosition function, cause in the demo page it gets replaced (no separate js environment)
var getCurrentPosition = navigator.geolocation.getCurrentPosition;

if(Browser.inDemo) {	// DEMO: this is set in demo.js
	// DEMO: we are inside the page, just run injectedCode()
	injectedCode(PostRPC);
}

var inFrame = (window != window.top);	// are we in a frame?
var apiCalls = 0;						// how many times the API has been called here or in an iframe
var myUrl = Browser.inDemo ? 'http://demo-page/' : window.location.href;	// DEMO: user-friendly url
var callUrl = myUrl;					// the url from which the last call is _shown_ to be made (it could be a nested frame if the last call was made there and Browser.capabilities.iframeGeoFromOwnDomain() is true)

// methods called by the page
//
var rpc = new PostRPC('page-content', window, window, window.origin);
rpc.register('getNoisyPosition', async function(options) {
	callUrl = myUrl;	// last call happened here
	if(inFrame) {
		// we're in a frame, we need to notify the top window, and get back the *url used in the permission dialog*
		// (which might be either the iframe url, or the top window url, depending on how the browser handles permissions).
		// To avoid cross-origin issues, we call apiCalledInFrame in the main script, which echoes the
		// call back to this tab to be answered by the top window
		if(!Browser.capabilities.iframeGeoFromOwnDomain())
			callUrl = await Browser.rpc.call(null, 'apiCalledInFrame', [myUrl]);
	} else {
		// refresh icon before fetching the location
		apiCalls++;
		Browser.gui.refreshIcon('self');
	}

	return await getNoisyPosition(options);
});
// gets the options passed to the fake navigator.geolocation.getCurrentPosition.
// Either returns fixed pos directly, or calls the real one, then calls addNoise.
//
async function getNoisyPosition(options) {
	const st = await Browser.storage.get();

	// if level == 'fixed' and fixedPosNoAPI == true, then we return the
	// fixed position without calling the geolocation API at all.
	//
	var domain = Util.extractDomain(callUrl);
	var level = st.domainLevel[domain] || st.defaultLevel;

	if(!st.paused && level == 'fixed' && st.fixedPosNoAPI) {
		var noisy = {
			coords: {
				latitude: st.fixedPos.latitude,
				longitude: st.fixedPos.longitude,
				accuracy: 10,
				altitude: null,
				altitudeAccuracy: null,
				heading: null,
				speed: null
			},
			timestamp: new Date().getTime()
		};
		Browser.log("returning fixed", noisy);
		return { success: true, position: noisy };
	}

	return new Promise(resolve => {
		// we call getCurrentPosition here in the content script, instead of
		// inside the page, because the content-script/page communication is not secure
		//
		getCurrentPosition.apply(navigator.geolocation, [
			async function(position) {
				// clone, modifying/sending the native object returns error
				const noisy = await addNoise(Util.clone(position));
				resolve({ success: true, position: noisy });
			},
			function(error) {
				resolve({ success: false, position: Util.clone(error) });		// clone, sending the native object returns error
			},
			options
		]);
	});
}

// gets position, returs noisy version based on the privacy options
//
async function addNoise(position) {
	const st = await Browser.storage.get();
	var domain = Util.extractDomain(callUrl);
	var level = st.domainLevel[domain] || st.defaultLevel;

	if(st.paused || level == 'real') {
		// do nothing, use real location

	} else if(level == 'fixed') {
		position.coords = {
			latitude: st.fixedPos.latitude,
			longitude: st.fixedPos.longitude,
			accuracy: 10,
			altitude: null,
			altitudeAccuracy: null,
			heading: null,
			speed: null
		};

	} else if(st.cachedPos[level] && ((new Date).getTime() - st.cachedPos[level].epoch)/60000 < st.levels[level].cacheTime) {
		position = st.cachedPos[level].position;
		Browser.log('using cached', position);

	} else {
		// add noise
		var epsilon = st.epsilon / st.levels[level].radius;

		const PlanarLaplace = require('../common/laplace');
		var pl = new PlanarLaplace();
		var noisy = pl.addNoise(epsilon, position.coords);

		position.coords.latitude = noisy.latitude;
		position.coords.longitude = noisy.longitude;

		// update accuracy
		if(position.coords.accuracy && st.updateAccuracy)
			position.coords.accuracy += Math.round(pl.alphaDeltaAccuracy(epsilon, .9));

		// don't know how to add noise to those, so we set to null (they're most likely null anyway)
		position.coords.altitude = null;
		position.coords.altitudeAccuracy = null;
		position.coords.heading = null;
		position.coords.speed = null;

		// Serialize cache creation in the background so concurrent calls reuse one noisy position
		// and cannot overwrite settings changed by the popup/options page.
		position = await Browser.rpc.call(null, 'cachePosition', [
			level,
			{ epoch: (new Date).getTime(), position: position },
			st.updateAccuracy,
			st.levels[level].radius
		]);

		Browser.log('noisy coords', position.coords);
	}

	// return noisy position
	return position;
}

(async function() {
	Browser.init('content');

	// if a browser action (always visible button) is used, we need to refresh the
	// icon immediately (before the API is called). HOWEVER: Browser.gui.refreshIcon
	// causes the background script to be awaken. To avoid doing this on every page,
	// we only call it if the icon is different than the default icon!
	//
	if(Browser.capabilities.permanentIcon() && !inFrame) {
		const info = await Util.getIconInfo({ callUrl: myUrl, apiCalls: 0 });
		if(info.private != info.defaultPrivate) // the icon for myUrl is different than the default
			Browser.gui.refreshIcon('self');
	}

	// only the top frame handles getState and apiCalledInFrame requests
	if(!inFrame) {
		Browser.rpc.register('getState', function(tabId) {
			return {
				callUrl: callUrl,
				apiCalls: apiCalls
			};
		});

		Browser.rpc.register('apiCalledInFrame', function(iframeUrl, tabId) {
			apiCalls++;
			if(Browser.capabilities.iframeGeoFromOwnDomain())
				callUrl = iframeUrl;
			Browser.gui.refreshIcon('self');

			return myUrl;
		});
	}

	if(Browser.testing) {
		// test for nested calls, and for correct passing of tabId
		//
		Browser.rpc.register('nestedTestTab', function(tabId) {
			Browser.log("in nestedTestTab, returning 'content'");
			return "content";
		});

		Browser.log("calling nestedTestMain");
		const res = await Browser.rpc.call(null, 'nestedTestMain', []);
		Browser.log('got from nestedTestMain', res);
	}
}())
},{"../common/browser":"/src/js/common/browser.js","../common/laplace":"/src/js/common/laplace.js","../common/post-rpc":"/src/js/common/post-rpc.js","../common/util":"/src/js/common/util.js","./injected":2}],2:[function(require,module,exports){
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
		// We replace geolocation methods with our own.
		// getCurrentPosition will be called by the content script (not by the page)
		// so we dont need to keep it at all.

		async function protectedGetCurrentPosition(cb1, cb2, options) {
			// call getNoisyPosition on the content-script
			// call cb1 on success, cb2 on failure
			const res = await getPostRPC().call('getNoisyPosition', [options]);
			const callback = res.success ? cb1 : cb2;
			if(callback) callback(res.position);
		}

		const schedule = window.setTimeout.bind(window);
		const cancelSchedule = window.clearTimeout.bind(window);
		const handlers = {};
		let nextHandler = 1;

		function requestWatchPosition(handler, cb1, cb2, options) {
			if(!(handler in handlers)) return;

			protectedGetCurrentPosition(
				position => {
					if(!(handler in handlers)) return;
					handlers[handler].timer = schedule(() => requestWatchPosition(handler, cb1, cb2, options), 1000);
					if(cb1) cb1(position);
				},
				error => {
					if(!(handler in handlers)) return;
					handlers[handler].timer = schedule(() => requestWatchPosition(handler, cb1, cb2, options), 1000);
					if(cb2) cb2(error);
				},
				options
			);
		}

		function protectedWatchPosition(cb1, cb2, options) {
			const handler = nextHandler++;
			handlers[handler] = { timer: null };
			requestWatchPosition(handler, cb1, cb2, options);
			return handler;
		}

		function protectedClearWatch(handler) {
			if(!(handler in handlers)) return;

			const timer = handlers[handler].timer;
			delete handlers[handler];
			if(timer != null) cancelSchedule(timer);
		}

		const protectedMethods = {
			getCurrentPosition: protectedGetCurrentPosition,
			watchPosition: protectedWatchPosition,
			clearWatch: protectedClearWatch
		};
		const geolocationPrototype = Object.getPrototypeOf(navigator.geolocation);

		Object.keys(protectedMethods).forEach(name => {
			const descriptor = { value: protectedMethods[name], configurable: true, writable: true };
			Object.defineProperty(geolocationPrototype, name, descriptor);
			Object.defineProperty(navigator.geolocation, name, descriptor);
		});
	}

	// remove script
	var s = document.getElementById('__lg_script');
	if(s) s.remove();	// DEMO: in demo injectCode is run directly so there's no script
};

},{}]},{},[1]);
