(function () {
  const $ = globalThis.jQuery;
  const L = globalThis.L;

  const Browser = globalThis.LocationGuard.Browser;
  const PlanarLaplace = globalThis.LocationGuard.PlanarLaplace;

  const geocoderKey = '5b3ce3597851110001cf6248dc55f0492abe4923aa33f4ca1722acb8';
  const geocoderUrl = 'https://api.openrouteservice.org/geocode';

  var levelMap, fixedPosMap;
  var savedFixedPositions = [];
  var selectedFixedPositionBookmarkId = '';
  var epsilon;
  var activeLevel = 'medium';
  var inited = {};
  var sliderRadius, sliderCacheTime;

  var currentPos = {
    latitude: 48.86014106672441,
    longitude: 2.3569107055664062,
  };

  Browser.init('options');

  function Slider(opt) {
    this.opt = opt;
    this.value = opt.min;

    var obj = this;
    $('#' + opt.id).sGlide({
      totalRange: [opt.min, opt.max],
      drag: function (e) {
        var value = Math.round(e.custom);
        value -= value % opt.step;
        opt.slide(value);
      },
      drop: function (e) {
        obj.value = Math.round(e.custom);
        obj.value -= obj.value % opt.step;
        opt.change(obj.value);
      },
    });

    this.set = function (value) {
      this.value = value;
      var pct = (100 * (value - opt.min)) / (opt.max - opt.min);
      $('#' + opt.id).sGlide('startAt', pct);
    };
  }

  async function saveOptions() {
    await Browser.rpc.call(null, 'saveOptions', [
      {
        defaultLevel: $('#defaultLevel').val(),
        paused: $('#paused').prop('checked'),
        hideIcon: $('#hideIcon').prop('checked'),
        updateAccuracy: $('#updateAccuracy').prop('checked'),
      },
    ]);
    Browser.gui.refreshAllIcons();
  }

  async function saveFixedPosNoAPI() {
    await Browser.rpc.call(null, 'setFixedPosNoAPI', [$('#fixedPosNoAPI').prop('checked')]);
  }

  async function saveLevel() {
    var radius = sliderRadius.value;
    var ct = sliderCacheTime.value;
    var cacheTime = ct <= 59 ? ct : 60 * (ct - 59);

    updateRadius(radius, true);
    await Browser.rpc.call(null, 'saveLevel', [activeLevel, radius, cacheTime]);
  }

  function initLevelMap() {
    var latlng = [currentPos.latitude, currentPos.longitude];

    levelMap = L.map('levelMap')
      .addLayer(new L.TileLayer(Browser.gui.mapTiles().url, Browser.gui.mapTiles().info))
      .setView(latlng, 13)
      .on('dragstart', function () {
        levelMap.closePopup();
      })
      .on('click', function (e) {
        if (levelMap.popup._isOpen) {
          levelMap.closePopup();
          return;
        }
        handleChangePosEvent(e);
      });

    levelMap.marker = new L.marker(latlng, { draggable: true })
      .addTo(levelMap)
      .on('click', function () {
        showPopup(levelMap);
      })
      .on('drag', handleChangePosEvent);

    var popupHtml =
      '<div class="map-popup">' +
      '<p><b>Protection area (red)</b> and <b>accuracy (blue)</b> around some (hypothetical) location.</p>' +
      '<p>Click on the map or drag the marker to change the location. Click on' +
      '<a href="#" id="levelMapCurrentPos" class="popup-location-btn ui-btn ui-btn-inline ui-icon-location ui-btn-icon-notext"></a>' +
      'to show your current location.</p>' +
      '</div>';

    levelMap.popup = L.popup({
      autoPan: false,
      closeOnClick: false, // we'll close it ourselves
      maxWidth: Math.min($('#levelMap').width() - 50, 300),
    }).setContent(popupHtml);

    // Add the accuracy circle first so it stays below the protection circle.
    levelMap.accuracy = new L.Circle(latlng, 1500, {
      color: null,
      fillColor: 'blue',
      fillOpacity: 0.4,
      clickable: false,
    }).addTo(levelMap);

    levelMap.protection = new L.Circle(latlng, 500, {
      color: null,
      fillColor: '#f03',
      fillOpacity: 0.4,
      clickable: false,
    }).addTo(levelMap);

    // Override LocateControl so it updates the example instead of moving the map itself.
    var myLocate = L.Control.Locate.extend({
      start: showCurrentPosition,
    });
    new myLocate({
      icon: 'icon-trans ui-btn-icon-notext ui-icon-location',
      iconLoading: 'icon-trans ui-btn-icon-notext ui-icon-location',
    }).addTo(levelMap);

    if (!Browser.capabilities.isAndroid())
      L.control
        .geocoder(geocoderKey, {
          url: geocoderUrl,
          markers: false,
          autocomplete: false,
        })
        .on('highlight', handleChangePosEvent)
        .on('select', handleChangePosEvent)
        .addTo(levelMap);
  }

  async function initFixedPosMap() {
    const st = await Browser.storage.get();
    var latlng = [st.fixedPos.latitude, st.fixedPos.longitude];

    fixedPosMap = new L.map('fixedPosMap')
      .addLayer(new L.TileLayer(Browser.gui.mapTiles().url, Browser.gui.mapTiles().info))
      .setView(latlng, 14)
      .on('dragstart', function () {
        fixedPosMap.closePopup();
      })
      .on('click', function (e) {
        if (fixedPosMap.popup._isOpen) {
          fixedPosMap.closePopup();
          return;
        }
        saveFixedPos(e.latlng);
      });

    fixedPosMap.marker = new L.marker(latlng, { draggable: true })
      .addTo(fixedPosMap)
      .on('click', function () {
        showPopup(fixedPosMap);
      })
      .on('dragend', function (e) {
        saveFixedPos(e.target._latlng);
      });

    var popupHtml =
      '<div class="map-popup">' +
      '<p>This is the location reported when the privacy level is set to <b>"Use fixed location"</b>.</p>' +
      '<p>Click on the map or drag the marker to set a new fixed location.</p>' +
      '</div>';

    fixedPosMap.popup = L.popup({
      autoPan: false,
      closeOnClick: false, // we'll close it ourselves
      maxWidth: Math.min($('#fixedPosMap').width() - 50, 300),
    }).setContent(popupHtml);

    showPopup(fixedPosMap);

    L.control
      .locate({
        drawCircle: false,
        follow: false,
        icon: 'icon-trans ui-btn-icon-notext ui-icon-location',
        iconLoading: 'icon-trans ui-btn-icon-notext ui-icon-location',
      })
      .addTo(fixedPosMap);

    if (!Browser.capabilities.isAndroid())
      L.control
        .geocoder(geocoderKey, {
          url: geocoderUrl,
          markers: false,
          autocomplete: false,
        })
        .on('results', function (e) {
          var res = e.params.text.match(/^([-+]?[0-9]+\.[0-9]+)\s*,?\s*([-+]?[0-9]+\.[0-9]+)$/);
          if (!res) return;

          var latlng = L.latLng(parseFloat(res[1]), parseFloat(res[2]));
          saveFixedPos(latlng);
          fixedPosMap.setView(latlng, 14);
          this.collapse();
        })
        .addTo(fixedPosMap);

    renderFixedPositionBookmarks(st.savedFixedPositions);
  }

  async function saveFixedPos(latlng) {
    var wrapped = latlng.wrap();
    var position = { latitude: wrapped.lat, longitude: wrapped.lng };

    fixedPosMap.marker.setLatLng(latlng);

    Browser.log('saving fixed position', position);
    await Browser.rpc.call(null, 'saveFixedPos', [position]);
  }

  function setFixedPositionBookmarkMessage(message, isError) {
    $('#fixedPosBookmarkMessage')
      .text(message || '')
      .toggleClass('error', !!isError);
  }

  function setFixedPositionBookmarkButtons(enabled) {
    $('#updateFixedPosBookmark, #deleteFixedPosBookmark').prop('disabled', !enabled).attr('aria-disabled', String(!enabled)).toggleClass('ui-state-disabled', !enabled);
  }

  function renderFixedPositionBookmarks(bookmarks, selectedId) {
    savedFixedPositions = Array.isArray(bookmarks) ? bookmarks : [];
    selectedId = selectedId || selectedFixedPositionBookmarkId;

    const selected = savedFixedPositions.find(function (bookmark) {
      return bookmark.id == selectedId;
    });
    selectedFixedPositionBookmarkId = selected ? selected.id : '';

    const select = $('#savedFixedPositions');
    select.find('option:not(:first)').remove();
    savedFixedPositions
      .slice()
      .sort(function (left, right) {
        return left.name.localeCompare(right.name);
      })
      .forEach(function (bookmark) {
        select.append($('<option>').val(bookmark.id).text(bookmark.name));
      });

    select.val(selectedFixedPositionBookmarkId).selectmenu('refresh');
    $('#fixedPosBookmarkName').val(selected ? selected.name : '');
    setFixedPositionBookmarkButtons(!!selected);
  }

  function currentFixedPosition() {
    const latlng = fixedPosMap.marker.getLatLng().wrap();
    return { latitude: latlng.lat, longitude: latlng.lng };
  }

  function showFixedPositionOnMap(position) {
    const latlng = L.latLng(position.latitude, position.longitude);
    fixedPosMap.closePopup();
    fixedPosMap.invalidateSize();
    fixedPosMap.marker.setLatLng(latlng);
    fixedPosMap.setView(latlng, fixedPosMap.getZoom(), { animate: false });
  }

  async function upsertFixedPositionBookmark(updateSelected) {
    const id = updateSelected ? selectedFixedPositionBookmarkId : null;
    if (updateSelected && !id) return;

    const result = await Browser.rpc.call(null, 'upsertFixedPositionBookmark', [id, $('#fixedPosBookmarkName').val(), currentFixedPosition()]);
    if (result.error) {
      setFixedPositionBookmarkMessage(result.error, true);
      return;
    }

    renderFixedPositionBookmarks(result.bookmarks, result.bookmark.id);
    setFixedPositionBookmarkMessage(updateSelected ? 'Saved location updated.' : 'Location saved.');
  }

  async function activateFixedPositionBookmark() {
    const id = $('#savedFixedPositions').val();
    setFixedPositionBookmarkMessage('');

    if (!id) {
      selectedFixedPositionBookmarkId = '';
      $('#fixedPosBookmarkName').val('');
      setFixedPositionBookmarkButtons(false);
      return;
    }

    const selected = savedFixedPositions.find(function (bookmark) {
      return bookmark.id == id;
    });
    if (!selected) {
      const st = await Browser.storage.get();
      renderFixedPositionBookmarks(st.savedFixedPositions);
      setFixedPositionBookmarkMessage('The selected saved location no longer exists.', true);
      return;
    }

    const activation = Browser.rpc.call(null, 'activateFixedPositionBookmark', [id]);
    selectedFixedPositionBookmarkId = selected.id;
    $('#fixedPosBookmarkName').val(selected.name);
    setFixedPositionBookmarkButtons(true);
    showFixedPositionOnMap(selected);

    const result = await activation;
    if (!result || result.error) {
      const st = await Browser.storage.get();
      renderFixedPositionBookmarks(st.savedFixedPositions);
      showFixedPositionOnMap(st.fixedPos);
      setFixedPositionBookmarkMessage(result ? result.error : 'Could not activate the saved location.', true);
      return;
    }

    showFixedPositionOnMap(result.position);
    setFixedPositionBookmarkMessage('Using saved location: ' + result.bookmark.name);
  }

  async function deleteFixedPositionBookmark() {
    if (!selectedFixedPositionBookmarkId) return;

    const selected = savedFixedPositions.find(function (bookmark) {
      return bookmark.id == selectedFixedPositionBookmarkId;
    });
    if (!selected || !window.confirm('Delete the saved location "' + selected.name + '"?')) return;

    const result = await Browser.rpc.call(null, 'deleteFixedPositionBookmark', [selectedFixedPositionBookmarkId]);
    if (result.error) {
      setFixedPositionBookmarkMessage(result.error, true);
      return;
    }

    selectedFixedPositionBookmarkId = '';
    renderFixedPositionBookmarks(result.bookmarks);
    setFixedPositionBookmarkMessage('Saved location deleted.');
  }

  async function showLevelInfo() {
    const st = await Browser.storage.get();
    var radius = st.levels[activeLevel].radius;
    var cacheTime = st.levels[activeLevel].cacheTime;
    var ct =
      cacheTime <= 59 // 0-59 are mins, 60 and higher are hours
        ? cacheTime
        : 59 + Math.floor(cacheTime / 59);

    sliderRadius.set(radius);
    sliderCacheTime.set(ct);

    updateRadius(radius, true);
    updateCache(ct);
  }

  function handleChangePosEvent(e) {
    currentPos = { latitude: e.latlng.lat, longitude: e.latlng.lng };
    moveCircles();
  }

  function moveCircles() {
    var latlng = [currentPos.latitude, currentPos.longitude];

    levelMap.marker.setLatLng(latlng);
    levelMap.protection.setLatLng(latlng);
    levelMap.accuracy.setLatLng(latlng);
  }

  function showPopup(map) {
    var smallSize = $(map._container).width() < 500 || $(map._container).height() < 450;

    // on small screens we center the popup at the bottom of the map
    // on large screens we open at the marker
    //
    var latlng;
    if (smallSize) {
      var bounds = map.getBounds();
      latlng = bounds.getCenter();
      latlng.lat = bounds.getSouth();
    } else {
      // get pos 30 pixes above the marker
      var pos = map.latLngToLayerPoint(map.marker._latlng);
      pos.y -= 30;
      latlng = map.layerPointToLatLng(pos);
    }

    map.popup.setLatLng(latlng).openOn(map);

    $('.leaflet-popup-tip-container').css({ visibility: smallSize ? 'hidden' : 'visible' });
  }

  function updateRadius(radius, fit) {
    var acc = Math.round(new PlanarLaplace().alphaDeltaAccuracy(epsilon / radius, 0.95));

    moveCircles();

    levelMap.protection.setRadius(radius);
    levelMap.accuracy.setRadius(acc);

    var first_view = !inited.radius;
    inited.radius = true;

    if (fit) levelMap.fitBounds(levelMap.accuracy.getBounds(), { animate: !first_view });

    if (first_view) showPopup(levelMap);

    $('#radius').text(radius);
    $('#accuracy').text(acc);
  }

  function updateCache(ct) {
    var h = ct - 59;

    $('#cacheTime').text(ct == 0 ? "don't cache" : ct < 60 ? ct + ' minute' + (ct > 1 ? 's' : '') : h + ' hour' + (h > 1 ? 's' : ''));
  }

  function initPages() {
    $.mobile.ajaxEnabled = false;

    $(document).ready(function () {
      $('#hideIcon').parent().toggle(!Browser.capabilities.permanentIcon()); // hiding the icon only works with page action (not browser action)
    });

    $(document).on('pagecontainershow', async function (e, ui) {
      var page = ui.toPage[0].id;

      if (inited[page]) {
        if (page == 'levels') levelMap.invalidateSize();
        if (page == 'fixedPos') fixedPosMap.invalidateSize();
        return;
      }
      inited[page] = true;

      if (page == 'options') {
        const st = await Browser.storage.get();
        $('#defaultLevel').val(st.defaultLevel).selectmenu('refresh');
        $('#paused').prop('checked', st.paused).checkboxradio('refresh');
        $('#hideIcon').prop('checked', st.hideIcon).checkboxradio('refresh');
        $('#updateAccuracy').prop('checked', st.updateAccuracy).checkboxradio('refresh');
      } else if (page == 'levels') {
        const st = await Browser.storage.get();
        epsilon = st.epsilon;

        sliderRadius = new Slider({
          id: 'setRadius',
          min: 40,
          max: 3000,
          step: 20,
          slide: function (value) {
            levelMap.closePopup();
            updateRadius(value, false);
          },
          change: saveLevel,
        });
        sliderCacheTime = new Slider({
          id: 'setCacheTime',
          min: 0,
          max: 69,
          step: 1,
          slide: updateCache,
          change: saveLevel,
        });

        initLevelMap();
        await showLevelInfo();
      } else if (page == 'fixedPos') {
        const st = await Browser.storage.get();
        $('#fixedPosNoAPI').prop('checked', st.fixedPosNoAPI).checkboxradio('refresh');

        await initFixedPosMap();
      }
    });
  }

  function showCurrentPosition() {
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        levelMap.closePopup();
        currentPos = pos.coords;
        showLevelInfo(); // moves circles and also centers map
      },
      function (err) {
        Browser.log('cannot get location', err);
      },
    );
  }

  async function restoreDefaults() {
    if (window.confirm('Are you sure you want to restore the default options?')) {
      await Browser.rpc.call(null, 'restoreDefaults', []);
      await Browser.gui.refreshAllIcons();
      location.reload();
    }
  }

  async function deleteCache() {
    await Browser.rpc.call(null, 'clearCache', []);
    window.alert('Location cache was deleted');
  }

  initPages();

  $(document).ready(function () {
    $('#left-panel').panel().enhanceWithin();

    $(document).on('swiperight', function (e) {
      if ($('#left-panel').css('visibility') !== 'visible') $('#left-panel').panel('open');
    });

    $('#options input, #options select').change(saveOptions);
    $('#fixedPosNoAPI').change(saveFixedPosNoAPI);
    $('#savedFixedPositions').change(activateFixedPositionBookmark);
    $('#saveFixedPosBookmark').click(function () {
      upsertFixedPositionBookmark(false);
    });
    $('#updateFixedPosBookmark').click(function () {
      upsertFixedPositionBookmark(true);
    });
    $('#deleteFixedPosBookmark').click(deleteFixedPositionBookmark);

    $('#restoreDefaults').click(restoreDefaults);
    $('#deleteCache').click(deleteCache);

    $('#activeLevel a').click(function (e) {
      levelMap.closePopup();

      activeLevel = $(e.target).attr('level');
      showLevelInfo();
    });

    $('.showFAQ').click(function (e) {
      location.href = 'faq.html#' + $(e.target).attr('faq');
    });
    $('.reportIssue').click(function (e) {
      window.open('https://github.com/chatziko/location-guard/issues', '_blank');
    });

    $(document).on('click', '#levelMapCurrentPos', showCurrentPosition);
  });

  (async function () {
    if (!Browser.testing) return;

    Browser.rpc.register('nestedTestTab', function (tabId) {
      Browser.log("in nestedTestTab, returning 'options'");
      return 'options';
    });

    Browser.log('calling nestedTestMain');
    const res = await Browser.rpc.call(null, 'nestedTestMain', []);
    Browser.log('got from nestedTestMain', res);
  })();
})();
