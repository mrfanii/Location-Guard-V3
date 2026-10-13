(function () {
  const Browser = globalThis.LocationGuard.Browser;
  const Util = globalThis.LocationGuard.Util;

  Browser.log('popup loading');

  Browser.init('popup');

  const $ = globalThis.jQuery;
  $.mobile.hashListeningEnabled = false; // disabling state changing is needed in firefox,
  $.mobile.pushStateEnabled = false; // it breaks when executed in the popup cause there's no history
  $.mobile.ajaxEnabled = false; // doesn't hurt but not needed
  $.mobile.autoInitializePage = false; // don't initialize until we set all values, avoids a quick but visible refresh

  $(document).ready(drawUI);

  var url;

  function samePosition(left, right) {
    return left && right && Number(left.latitude) === Number(right.latitude) && Number(left.longitude) === Number(right.longitude);
  }

  function showSavedFixedPositions(st, level, callUrl) {
    const bookmarks = Array.isArray(st.savedFixedPositions) ? st.savedFixedPositions : [];
    const show = !!callUrl && !st.paused && level == 'fixed' && bookmarks.length > 0;
    $('#savedFixedPositionItem').toggle(show);
    if (!show) return;

    const active = bookmarks.find(function (bookmark) {
      return samePosition(bookmark, st.fixedPos);
    });
    $('#setFixedPosition b').text(active ? active.name : 'Choose saved location');

    const choices = $('#savedFixedPositionChoices');
    bookmarks
      .slice()
      .sort(function (left, right) {
        return left.name.localeCompare(right.name);
      })
      .forEach(function (bookmark, index) {
        const radioId = 'savedFixedPosition-' + index;
        const input = $('<input>').attr('type', 'radio').attr('name', 'savedFixedPosition').attr('id', radioId).val(bookmark.id);
        if (active && bookmark.id == active.id) input.attr('checked', true);

        choices.append(input).append($('<label>').attr('for', radioId).text(bookmark.name));
      });
  }

  async function activateSavedFixedPosition() {
    const id = $(this).val();
    if (!id) return;

    const result = await Browser.rpc.call(null, 'activateFixedPositionBookmark', [id]);
    if (!result || result.error) {
      window.alert(result ? result.error : 'Could not activate the saved location.');
      return;
    }

    await Browser.gui.refreshAllIcons();
    Browser.gui.closePopup();
  }

  async function doAction() {
    var action = $(this).attr('id');

    switch (action) {
      case 'options':
      case 'faq':
        var page = action == 'options' ? 'options.html' : 'faq.html#general';

        if (Browser.capabilities.popupAsTab()) {
          // we're in a normal tab, just navigate to the page
          window.location.href = page;
        } else {
          Browser.gui.showPage(page);
          Browser.gui.closePopup();
        }
        break;

      case 'hideIcon':
        await Browser.rpc.call(null, 'setHideIcon', [true]);
        await Browser.gui.refreshAllIcons();
        Browser.gui.closePopup();
        break;

      case 'pause':
        await Browser.rpc.call(null, 'togglePaused', []);
        await Browser.gui.refreshAllIcons();
        Browser.gui.closePopup();
        break;

      case 'setLevel':
        $('#levels').popup('open');
        break;

      case 'setFixedPosition':
        $('#savedFixedPositionsPopup').popup('open');
        break;

      default: // set level
        if (!url) throw 'no url'; // just to be sure

        var domain = Util.extractDomain(url);
        var level = action;
        await Browser.rpc.call(null, 'setDomainLevel', [domain, level]);
        await Browser.gui.refreshAllIcons();
        Browser.gui.closePopup();
        break;
    }
  }

  async function drawUI() {
    var res = window.location.href.match(/tabId=(\d+)/);
    var tabId = res ? parseInt(res[1]) : null;

    // we need storage and url
    const callUrl = await Browser.gui.getCallUrl(tabId);
    const st = await Browser.storage.get();
    Browser.log('popup: callUrl', callUrl, 'settings', st);

    var level;

    // we don't have a url if we are in chrome (browser action, visible in
    // all tabs), and the active tab has no content-script running (eg. new
    // tab page)
    //
    if (callUrl) {
      url = callUrl;
      var domain = Util.extractDomain(url);
      level = st.domainLevel[domain] || st.defaultLevel;

      $('#title').text(
        st.paused ? 'Location Guard is paused' : level == 'real' ? 'Using your real location' : level == 'fixed' ? 'Using a fixed location' : 'Privacy level: ' + level,
      );
      $('#setLevel b').text(domain);
      $('#' + level).attr('checked', true);
    } else {
      $('#title').parent().hide();
    }

    $('#pause').text((st.paused ? 'Resume' : 'Pause') + ' Location Guard');
    $('#pause')
      .parent()
      .attr('data-icon', st.paused ? 'play' : 'pause');

    $('#setLevel').toggle(callUrl && !st.paused);
    $('#hideIcon').toggle(callUrl && !st.paused && !Browser.capabilities.permanentIcon()); // hiding the icon only works with page action (not browser action)
    showSavedFixedPositions(st, level, callUrl);

    $('a, input[name="level"]').on('click', doAction);
    $('input[name="savedFixedPosition"]').on('click', activateSavedFixedPosition);

    // we're ready, init
    $.mobile.initializePage();

    if (Browser.capabilities.popupAsTab()) {
      // the popup is displayed as a normal tab
      // set 100% width/height
      $('html, body, #container').css({
        width: '100%',
        height: '100%',
      });
      // show the close button
      $('#close').css({ display: 'block' }).on('click', Browser.gui.closePopup);
    } else {
      // normal popup, resize body to match #container
      var width = $('#container').width();
      var height = $('#container').height();

      $('html, body').css({
        width: width,
        height: height,
      });
    }
  }

  (async function () {
    if (!Browser.testing) return;

    // test for nested calls, and for correct passing of tabId
    //
    Browser.rpc.register('nestedTestTab', function (tabId) {
      Browser.log("in nestedTestTab, returning 'popup'");
      return 'popup';
    });

    Browser.log('calling nestedTestMain');
    const res = await Browser.rpc.call(null, 'nestedTestMain', []);
    Browser.log('got from nestedTestMain', res);
  })();
})();
