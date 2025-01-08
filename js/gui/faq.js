(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
const Browser = require('../common/browser');

Browser.log("faq loading");

// send an empty reply to getState (see options.js)
Browser.init('options');
Browser.rpc.register('getState', function(tabId) {
	return null;
});

const $ = require('jquery');
$.mobile.ajaxEnabled = false;
$.mobile.linkBindingEnabled = false;

function openHash() {
	$("#faq-" + location.hash.substr(1)).collapsible("expand");
}

$(document).ready(function() {
	$("#left-panel").panel().enhanceWithin();			// initialize panel

	// open panel on swipe
	$(document).on("swiperight", function(e) {
		if($("#left-panel").css("visibility") !== "visible" )		// check if already open (manually or due to large screen)
			$("#left-panel").panel("open");
	});

	// animate collapsibles in the faq
	$("#faq [data-role='collapsible']").collapsible({
		collapse: function( event, ui ) {
			$(this).children().next().slideUp(150);
		},
		expand: function( event, ui ) {
			location.hash = "#" + $(this).attr("id").substr(4);

			$(this).children().next().hide();
			$(this).children().next().slideDown(150);
		}
	});

	$("#lgIcon").addClass(Browser.capabilities.permanentIcon() ? 'lg-icon-browseraction' : 'lg-icon-pageaction');

	$(window).on("hashchange", openHash);

	if(location.hash)
		openHash();
	else
		location.hash = "#general";
});

},{"../common/browser":"/src/js/common/browser.js","jquery":"jquery"}]},{},[1]);
