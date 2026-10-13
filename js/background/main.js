(function () {
  const { Browser, Util, PlanarLaplace } = globalThis.LocationGuard;

  Browser.log('starting');

  Util.events.addListener('browser.install', function () {
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

  function normalizeFixedPosition(position) {
    if (!position) return null;

    const latitude = Number(position.latitude);
    const longitude = Number(position.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

    return { latitude, longitude };
  }

  function newFixedPositionBookmarkId(bookmarks) {
    var id;
    do {
      id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    } while (
      bookmarks.some(function (bookmark) {
        return bookmark.id == id;
      })
    );
    return id;
  }

  Browser.rpc.register('upsertFixedPositionBookmark', function (id, name, position) {
    return mutateStorage(function (st) {
      const normalizedName = String(name || '')
        .trim()
        .slice(0, 80);
      const normalizedPosition = normalizeFixedPosition(position);
      st.savedFixedPositions = Array.isArray(st.savedFixedPositions) ? st.savedFixedPositions : [];

      if (!normalizedName) return { error: 'Enter a name for this location.' };
      if (!normalizedPosition) return { error: 'The selected location is invalid.' };

      const duplicate = st.savedFixedPositions.find(function (bookmark) {
        return bookmark.id != id && String(bookmark.name || '').toLowerCase() == normalizedName.toLowerCase();
      });
      if (duplicate) return { error: 'A saved location with this name already exists.' };

      var bookmark;
      if (id) {
        bookmark = st.savedFixedPositions.find(function (item) {
          return item.id == id;
        });
        if (!bookmark) return { error: 'The selected saved location no longer exists.' };
        bookmark.name = normalizedName;
        bookmark.latitude = normalizedPosition.latitude;
        bookmark.longitude = normalizedPosition.longitude;
      } else {
        bookmark = {
          id: newFixedPositionBookmarkId(st.savedFixedPositions),
          name: normalizedName,
          latitude: normalizedPosition.latitude,
          longitude: normalizedPosition.longitude,
        };
        st.savedFixedPositions.push(bookmark);
      }

      st.fixedPos = normalizedPosition;
      return { bookmark, bookmarks: st.savedFixedPositions };
    });
  });

  Browser.rpc.register('activateFixedPositionBookmark', function (id) {
    return mutateStorage(function (st) {
      st.savedFixedPositions = Array.isArray(st.savedFixedPositions) ? st.savedFixedPositions : [];
      const bookmark = st.savedFixedPositions.find(function (item) {
        return item.id == id;
      });
      if (!bookmark) return { error: 'The selected saved location no longer exists.' };

      const position = normalizeFixedPosition(bookmark);
      if (!position) return { error: 'The selected saved location is invalid.' };

      st.fixedPos = position;
      return { bookmark, position: st.fixedPos };
    });
  });

  Browser.rpc.register('deleteFixedPositionBookmark', function (id) {
    return mutateStorage(function (st) {
      st.savedFixedPositions = Array.isArray(st.savedFixedPositions) ? st.savedFixedPositions : [];
      const index = st.savedFixedPositions.findIndex(function (bookmark) {
        return bookmark.id == id;
      });
      if (index < 0) return { error: 'The selected saved location no longer exists.' };

      st.savedFixedPositions.splice(index, 1);
      return { bookmarks: st.savedFixedPositions };
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
    Browser.rpc.register('nestedTestMain', async function (tabId) {
      Browser.log('in nestedTestMain, call from ', tabId, 'calling back nestedTestTab');

      const res = await Browser.rpc.call(tabId, 'nestedTestTab', []);
      Browser.log('got from nestedTestTab', res, "adding '_foo' and sending back");
      return res + '_foo';
    });
  }
})();
