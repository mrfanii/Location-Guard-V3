// main script
// Here we only handle the install/update events
// Browser-specific functionality for the main script, if needed, is added by browser/*.js
//

(function () {
  const { Browser, Util, PlanarLaplace } = globalThis.LocationGuard;

  Browser.log('starting');

  Util.events.addListener('browser.install', function () {
    // show demo on first install
    Browser.gui.showPage('demo.html');
  });

  Browser.init('main');

  Browser.rpc.register('apiCalledInFrame', async function (url, tabId) {
    return await Browser.rpc.call(tabId, 'apiCalledInFrame', [url]);
  });

  let storageMutationQueue = Promise.resolve();

  function mutateStorage(mutator) {
    const mutation = storageMutationQueue.then(async function () {
      const st = await Browser.storage.get();
      const result = await mutator(st);
      await Browser.storage.set(st);
      return result;
    });
    storageMutationQueue = mutation.catch(function () {});
    return mutation;
  }

  Browser.rpc.register('saveOptions', function (values) {
    return mutateStorage(function (st) {
      if (st.updateAccuracy != values.updateAccuracy) {
        for (const level in st.cachedPos) {
          if (!st.levels[level] || !st.cachedPos[level].position.coords || !st.cachedPos[level].position.coords.accuracy) continue;
          const epsilon = st.epsilon / st.levels[level].radius;
          const delta = Math.round(new PlanarLaplace().alphaDeltaAccuracy(epsilon, 0.9));
          st.cachedPos[level].position.coords.accuracy += (values.updateAccuracy ? 1 : -1) * delta;
        }
      }

      st.defaultLevel = values.defaultLevel;
      st.paused = values.paused;
      st.hideIcon = values.hideIcon;
      st.updateAccuracy = values.updateAccuracy;
    });
  });

  Browser.rpc.register('setFixedPosNoAPI', function (value) {
    return mutateStorage(function (st) {
      st.fixedPosNoAPI = value;
    });
  });

  Browser.rpc.register('saveLevel', function (level, radius, cacheTime) {
    return mutateStorage(function (st) {
      if (st.levels[level].radius != radius) delete st.cachedPos[level];
      st.levels[level] = { radius: radius, cacheTime: cacheTime };
    });
  });

  Browser.rpc.register('saveFixedPos', function (position) {
    return mutateStorage(function (st) {
      st.fixedPos = position;
    });
  });

  Browser.rpc.register('clearCache', function () {
    return mutateStorage(function (st) {
      st.cachedPos = {};
    });
  });

  Browser.rpc.register('setHideIcon', function (value) {
    return mutateStorage(function (st) {
      st.hideIcon = value;
    });
  });

  Browser.rpc.register('togglePaused', function () {
    return mutateStorage(function (st) {
      st.paused = !st.paused;
      return st.paused;
    });
  });

  Browser.rpc.register('setDomainLevel', function (domain, level) {
    return mutateStorage(function (st) {
      if (level == st.defaultLevel) delete st.domainLevel[domain];
      else st.domainLevel[domain] = level;
    });
  });

  Browser.rpc.register('cachePosition', function (level, candidate, sourceUpdateAccuracy, sourceRadius) {
    return mutateStorage(function (st) {
      const config = st.levels[level];
      if (!config) return candidate.position;

      const cached = st.cachedPos[level];
      if (cached && (Date.now() - cached.epoch) / 60000 < config.cacheTime) return cached.position;

      if (config.radius != sourceRadius || config.cacheTime <= 0) return candidate.position;

      if (st.updateAccuracy != sourceUpdateAccuracy && candidate.position.coords.accuracy) {
        const epsilon = st.epsilon / config.radius;
        const delta = Math.round(new PlanarLaplace().alphaDeltaAccuracy(epsilon, 0.9));
        candidate.position.coords.accuracy += (st.updateAccuracy ? 1 : -1) * delta;
      }

      st.cachedPos[level] = candidate;
      return candidate.position;
    });
  });

  Browser.rpc.register('restoreDefaults', function () {
    const reset = storageMutationQueue.then(async function () {
      await Browser.storage.clear();
      return await Browser.storage.get();
    });
    storageMutationQueue = reset.catch(function () {});
    return reset;
  });

  if (Browser.testing) {
    // test for nested calls, and for correct passing of tabId
    //
    Browser.rpc.register('nestedTestMain', async function (tabId) {
      Browser.log('in nestedTestMain, call from ', tabId, 'calling back nestedTestTab');

      const res = await Browser.rpc.call(tabId, 'nestedTestTab', []);
      Browser.log('got from nestedTestTab', res, "adding '_foo' and sending back");
      return res + '_foo';
    });
  }
})();
