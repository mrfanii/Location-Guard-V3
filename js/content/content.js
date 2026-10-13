(function () {
  const { Browser, Util, PostRPC, PlanarLaplace } = globalThis.LocationGuard;

  // Production uses main-world.js; the demo calls this equivalent implementation directly.
  function injectedCode(PostRPC) {
    if (navigator.geolocation) {
      var prpc;
      function getPostRPC() {
        if (!prpc) prpc = new PostRPC('page-content', window, window, window.origin);
        return prpc;
      }

      async function protectedGetCurrentPosition(cb1, cb2, options) {
        const res = await getPostRPC().call('getNoisyPosition', [options]);
        const callback = res.success ? cb1 : cb2;
        if (callback) callback(res.position);
      }

      const schedule = window.setTimeout.bind(window);
      const cancelSchedule = window.clearTimeout.bind(window);
      const handlers = {};
      let nextHandler = 1;

      function requestWatchPosition(handler, cb1, cb2, options) {
        if (!(handler in handlers)) return;

        protectedGetCurrentPosition(
          (position) => {
            if (!(handler in handlers)) return;
            handlers[handler].timer = schedule(() => requestWatchPosition(handler, cb1, cb2, options), 1000);
            if (cb1) cb1(position);
          },
          (error) => {
            if (!(handler in handlers)) return;
            handlers[handler].timer = schedule(() => requestWatchPosition(handler, cb1, cb2, options), 1000);
            if (cb2) cb2(error);
          },
          options,
        );
      }

      function protectedWatchPosition(cb1, cb2, options) {
        const handler = nextHandler++;
        handlers[handler] = { timer: null };
        requestWatchPosition(handler, cb1, cb2, options);
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
    }

    var s = document.getElementById('__lg_script');
    if (s) s.remove();
  }

  // Keep the native method before the demo replaces it in the same JavaScript realm.
  var getCurrentPosition = navigator.geolocation.getCurrentPosition;

  if (Browser.inDemo) {
    injectedCode(PostRPC);
  }

  var inFrame = window != window.top;
  var apiCalls = 0;
  var myUrl = Browser.inDemo ? 'http://demo-page/' : window.location.href;
  var callUrl = myUrl;

  var rpc = new PostRPC('page-content', window, window, window.origin);
  rpc.register('getNoisyPosition', async function (options) {
    callUrl = myUrl;
    if (inFrame) {
      // we're in a frame, we need to notify the top window, and get back the *url used in the permission dialog*
      // (which might be either the iframe url, or the top window url, depending on how the browser handles permissions).
      // To avoid cross-origin issues, we call apiCalledInFrame in the main script, which echoes the
      // call back to this tab to be answered by the top window
      if (!Browser.capabilities.iframeGeoFromOwnDomain()) callUrl = await Browser.rpc.call(null, 'apiCalledInFrame', [myUrl]);
    } else {
      apiCalls++;
      Browser.gui.refreshIcon('self');
    }

    return await getNoisyPosition(options);
  });

  async function getNoisyPosition(options) {
    const st = await Browser.storage.get();

    // if level == 'fixed' and fixedPosNoAPI == true, then we return the
    // fixed position without calling the geolocation API at all.
    //
    var domain = Util.extractDomain(callUrl);
    var level = st.domainLevel[domain] || st.defaultLevel;

    if (!st.paused && level == 'fixed' && st.fixedPosNoAPI) {
      var noisy = {
        coords: {
          latitude: st.fixedPos.latitude,
          longitude: st.fixedPos.longitude,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: new Date().getTime(),
      };
      Browser.log('returning fixed', noisy);
      return { success: true, position: noisy };
    }

    return new Promise((resolve) => {
      // Obtain the real position in the isolated world; only the protected result crosses PostRPC.
      getCurrentPosition.apply(navigator.geolocation, [
        async function (position) {
          const noisy = await addNoise(Util.clone(position));
          resolve({ success: true, position: noisy });
        },
        function (error) {
          resolve({ success: false, position: Util.clone(error) }); // clone, sending the native object returns error
        },
        options,
      ]);
    });
  }

  async function addNoise(position) {
    const st = await Browser.storage.get();
    var domain = Util.extractDomain(callUrl);
    var level = st.domainLevel[domain] || st.defaultLevel;

    if (st.paused || level == 'real') return position;

    if (level == 'fixed') {
      position.coords = {
        latitude: st.fixedPos.latitude,
        longitude: st.fixedPos.longitude,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      };
    } else if (st.cachedPos[level] && (new Date().getTime() - st.cachedPos[level].epoch) / 60000 < st.levels[level].cacheTime) {
      position = st.cachedPos[level].position;
      Browser.log('using cached', position);
    } else {
      var epsilon = st.epsilon / st.levels[level].radius;

      var pl = new PlanarLaplace();
      var noisy = pl.addNoise(epsilon, position.coords);

      position.coords.latitude = noisy.latitude;
      position.coords.longitude = noisy.longitude;

      if (position.coords.accuracy && st.updateAccuracy) position.coords.accuracy += Math.round(pl.alphaDeltaAccuracy(epsilon, 0.9));

      // The noise model does not produce these values.
      position.coords.altitude = null;
      position.coords.altitudeAccuracy = null;
      position.coords.heading = null;
      position.coords.speed = null;

      // Serialize cache creation in the background so concurrent calls reuse one noisy position
      // and cannot overwrite settings changed by the popup/options page.
      position = await Browser.rpc.call(null, 'cachePosition', [level, { epoch: new Date().getTime(), position: position }, st.updateAccuracy, st.levels[level].radius]);

      Browser.log('noisy coords', position.coords);
    }

    return position;
  }

  (async function () {
    Browser.init('content');

    // Avoid waking the service worker unless this tab's icon differs from the default.
    if (Browser.capabilities.permanentIcon() && !inFrame) {
      const info = await Util.getIconInfo({ callUrl: myUrl, apiCalls: 0 });
      if (info.private != info.defaultPrivate) Browser.gui.refreshIcon('self');
    }

    // Only the top frame owns the tab-level URL and API call count.
    if (!inFrame) {
      Browser.rpc.register('getState', function (tabId) {
        return {
          callUrl: callUrl,
          apiCalls: apiCalls,
        };
      });

      Browser.rpc.register('apiCalledInFrame', function (iframeUrl, tabId) {
        apiCalls++;
        if (Browser.capabilities.iframeGeoFromOwnDomain()) callUrl = iframeUrl;
        Browser.gui.refreshIcon('self');

        return myUrl;
      });
    }

    if (Browser.testing) {
      Browser.rpc.register('nestedTestTab', function (tabId) {
        Browser.log("in nestedTestTab, returning 'content'");
        return 'content';
      });

      Browser.log('calling nestedTestMain');
      const res = await Browser.rpc.call(null, 'nestedTestMain', []);
      Browser.log('got from nestedTestMain', res);
    }
  })();
})();
