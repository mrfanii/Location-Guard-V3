# Location Guard (V3)

**Location Guard** is a browser extension that allows to protect your location
while using location-aware websites, by adding controlled noise to it.
It supports the followng browsers:

* Google Chrome / Chromium ([install](https://chrome.google.com/webstore/detail/location-guard/cfohepagpmnodfdmjliccbbigdkfcgia))
* Mozilla Firefox ([install](https://addons.mozilla.org/firefox/addon/location-guard/))
* Microsoft Edge ([install](https://microsoftedge.microsoft.com/addons/detail/location-guard/hbgdpjpeeodeojjbeenfnpnldhahleoo))
* Opera ([install](https://chrome.google.com/webstore/detail/location-guard/cfohepagpmnodfdmjliccbbigdkfcgia))

Location Guard is available under either the [MIT/X11](https://opensource.org/licenses/mit-license.php)
or the [CeCILL-B](http://www.cecill.info/licences.fr.html) license.

## Frequently Asked Questions

### What is Location Guard?

Websites can ask the browser for your location (via JavaScript). When they do
so, the browser first asks your permission, and if you accept, it detects your
location (typically by transmitting a list of available wifi access points to a
geolocation provider such as Google Location Services, or via GPS if available)
and gives it to the website.

Location Guard is a browser extension that intercepts this procedure. The
permission dialog appears as usual, and you can still choose to deny. If you
give permission, then Location Guard obtains your location and adds "random
noise" to it, creating a fake location. Only the fake location is then given to
the website.

To see Location Guard in action use [this demo](https://browserleaks.com/geo), a
[geolocalized weather forecast](https://darksky.net/), or go to [Google
Maps](https://www.google.com/maps) and press the ![](src/images/gmaps_dot.png)
button. When the website asks for your location you will see the the
![](src/images/pin_19.png) icon in the address bar (which also provides
configuration options).

### What kind of privacy does Location Guard provide?

Location Guard provides privacy within a certain _protection area_ by ensuring
that all locations within this area look _plausible_ for being the real one.
This is achieved by adding random noise in a way such that all locations within
the protection area can produce the same fake location with similar probability.
As a consequence, the fake location provides no information to the website for
distinguishing between locations within the protection area.

**Warning:** _background knowledge_ can still be used by websites to guess the
real location within the protection area. For instance, if the protection area
is in the middle of a lake containing only a small island, it will be easy to
infer that the real location is on the island. In scenarios like this you should
choose a higher privacy level or deny disclosing your location at all.

### What are "privacy levels"?

The privacy level determines the amount of noise added to your real location. A
higher level adds more noise, so the fake location will be further away from the
real one. This offers protection within a larger area, but it might make the
service provided by the website less useful.

By default all websites use the "medium" level (this can be changed from the
extension's options). You can select a different level for a specific website
using the ![](src/images/pin_19.png) icon. For instance, you could select
a lower privacy level for websites that need an accurate location (eg. maps),
and a higher one for websites that only need approximate information (eg.
weather forecast).

For more flexibility, each level can be configured from the _Privacy Levels_
tab. The red circle is the _protection area_: locations in this area look
plausible to be the real one (see "What kind of privacy does Location Guard
provide?" above). The blue circle is the _accuracy_: the fake location will be
inside this circle with high probability (note that the noise is random). Use
the slider to adapt the two areas to your needs.

### What is a "fixed location"?

The privacy level can be set to "Use fixed location". In this case Location
Guard always reports to the website a predefined fixed location that never
changes (instead of generating a fake location by adding noise to the real one).
This offers the highest privacy, since the reported location is completely
independent from the real one, at the cost of very low accuracy.

You can modify the fixed location from the extension's options (Fixed Location
tab).

When using a fixed location, the browser's geolocation is not performed at all.
This offers better privacy, since the list of wifi access points is not
transmitted to Google's servers. However, it has the side effect that the
_permission dialog is not displayed at all_. This behaviour is usually
acceptable when the fixed location is dummy, but it can be modified if you wish.

### Why some websites detect my location although I use Location Guard?

Some websites detect your location based on your [IP
address](https://en.wikipedia.org/wiki/IP_address) (a numerical label associated
with every device on the Internet), which is visible to all websites you visit.
However, most of the time this type of geolocation is _not accurate_ and is
limited to the city or postal/zip code level. Examples of such websites are
[iplocation.net](https://www.iplocation.net/) and
[tracemyip.org](https://www.tracemyip.org/).

Location Guard does not protect your IP address; it hides the location revealed
by the browser through the JavaScript API, which is usually _very accurate_.
More information about how the browser obtains your location can be found
[here](https://www.mozilla.org/firefox/geolocation/).

To hide your IP address you need to use some anonymous communication system such
as [Tor](https://www.torproject.org/). Note, however, that even if your IP
address is hidden, your browser can still reveal your location through
JavaScript, so you need to also use Location Guard.

### How Location Guard uses my information?

Location Guard takes your privacy seriously! First, the extension itself has no
"special permission" to access your location, it can obtain it only when a
website asks for it and only if you allow access in the permission dialog.

Location Guard runs locally in your browser and _sends no information_
whatsoever to the network. It only communicates your fake location to the
website that asks for it.

Location Guard also never stores your real location. The _fake_ location is
cached for a small period of time; if a website asks for your location during
this time the cached fake location will be returned. This improves privacy by
avoiding to generate too many fake locations which would be centered around the
real one. The cache period can be configured from the extension's options
(Privacy Levels tab) and there is also a button to delete the cache.

### What is the technology behind Location Guard?

Location Guard is a product of research carried out at the Ecole Polytechnique of Paris,
CNRS and Inria. It is based on work by [Miguel Andrés](http://www.lix.polytechnique.fr/~mandres),
[Nicolás Bordenabe](http://http://www.nbordenabe.me//),
[Kostas Chatzikokolakis](https://www.chatzi.org/),
[Catuscia Palamidessi](http://www.lix.polytechnique.fr/~catuscia/) and
[Marco Stronati](http://www.stronati.org/).

Location Guard implements a [location obfuscation](https://en.wikipedia.org/wiki/Location_obfuscation)
technique based on adding noise from a 2-dimensional
[Laplace distribution](https://en.wikipedia.org/wiki/Laplace_distribution).
This method can be formally shown to provide a privacy guarantee which is a variant
of [Differential Privacy](https://en.wikipedia.org/wiki/Differential_privacy).
More details can be found in the [CCS'13 paper](http://arxiv.org/abs/1212.1984),
or in the [PhD thesis](https://pastel.archives-ouvertes.fr/tel-01098088/document)
of Nicolas Bordenabe.

#### Complete list of publications related to Location Guard

##### Theses

* **Measuring Privacy with Distinguishability Metrics: Definitions, Mechanisms and Application to Location Privacy**.  
  N. Bordenabe.
  _PhD dissertation_, École Polytechnique, Paris, 2014.
  [SIGSAC Doctoral Dissertation Award 2015](http://www.sigsac.org/award/diss-awards.html).
  [[pdf](https://pastel.archives-ouvertes.fr/tel-01098088/document)]

* **Designing Location Privacy Mechanisms for flexibility over time and space**.
  M. Stronati.
  _PhD dissertation_, École Polytechnique, Paris, 2015. [[pdf](https://pastel.archives-ouvertes.fr/tel-01243295/document)]

##### Papers

* **Geo-Indistinguishability: Differential Privacy for Location-Based Systems**.  
  M. Andres, N. Bordenabe, K. Chatzikokolakis and C. Palamidessi.  
  _Proc. of CCS '13_, ACM, pp. 901-914, 2013. [[report](http://arxiv.org/abs/1212.1984)]
* **Broadening the Scope of Differential Privacy Using Metrics**.  
  K. Chatzikokolakis, M. Andres, N. Bordenabe and C. Palamidessi.  
  _Proc. of PETS '13_, Springer, LNCS 7981, pp. 82-102, 2013. [[report](http://hal.inria.fr/hal-00767210)]
* **A Predictive Differentially-Private Mechanism for Mobility Traces**.  
  K. Chatzikokolakis, C. Palamidessi and M. Stronati.  
  _Proc. of PETS '14_, Springer, LNCS 8555, pp. 21-41, 2014. [[report](http://arxiv.org/abs/1311.4008)]
* **Optimal Geo-Indistinguishable Mechanisms for Location Privacy**.  
  N. Bordenabe, K. Chatzikokolakis and C. Palamidessi.  
  _Proc. of CCS '14_, ACM, pp. 251-262, 2014. [[report](http://arxiv.org/abs/1402.5029)]
* **Geo-indistinguishability: A Principled Approach to Location Privacy**.  
  K. Chatzikokolakis, C. Palamidessi and M. Stronati.  
  _Proc. of ICDCIT '15_, Springer, LNCS 8956, pp. 49-72, 2015. [[report](http://hal.inria.fr/hal-01114241)]
* **Constructing elastic distinguishability metrics for location privacy**.  
  K. Chatzikokolakis, C. Palamidessi and M. Stronati.  
  _PETS'15 / PoPETs_, De Gruyter Open, 2015(2): 156-170, 2015. [[report](http://arxiv.org/abs/1503.00756)]

