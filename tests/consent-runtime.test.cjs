const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Execute the repository's actual consent and GA modules in independent realms.
// The shared cookie jar models the .evhconsult.eu preference; each document has
// its own event loop, Google queue and enabled/disabled state.
const root = path.join(__dirname, '..');
const consentPath = fs.existsSync(path.join(root, 'public/consent.js')) ? 'public/consent.js'
  : fs.existsSync(path.join(root, 'script.js')) ? 'script.js' : 'js/site.js';
const gaPath = fs.existsSync(path.join(root, 'public/ga4.js')) ? 'public/ga4.js'
  : fs.existsSync(path.join(root, 'ga4.js')) ? 'ga4.js' : 'js/ga4.js';
const consentSource = fs.readFileSync(path.join(root, consentPath), 'utf8');
const gaSource = fs.readFileSync(path.join(root, gaPath), 'utf8');
const hosts = ['evhconsult.eu', 'ai.evhconsult.eu', 'ada.evhconsult.eu', 'erwin.evhconsult.eu'];
const id = 'ga-disable-G-QJKQTTXSF3';

function realm(jar, host = hosts[0]) {
  const listeners = {}, documentListeners = {}, timers = [], tags = [], writes = [], dispatches = [];
  const listen = (map, name, fn) => (map[name] ||= []).push(fn);
  const emit = (map, event) => (map[event.type] || []).forEach(fn => fn(event));
  const elements = [];
  const element = () => {
    const children = new Map(), handlers = {};
    const e = {dataset: {}, hidden: false, classList: {remove() {}, toggle() {}}, querySelectorAll: () => [],
      querySelector: s => {if (!children.has(s)) children.set(s, element()); return children.get(s);},
      setAttribute() {}, removeAttribute() {}, focus() {},
      addEventListener: (n, f) => {handlers[n] = f;}, click: () => handlers.click?.()};
    elements.push(e); return e;
  };
  const document = {
    readyState: 'loading', querySelector: () => null, querySelectorAll: () => [], createElement: element,
    addEventListener: (n, f) => listen(documentListeners, n, f),
    head: {appendChild: tag => tags.push(tag)}, body: {appendChild() {}, classList: {remove() {}}}
  };
  Object.defineProperty(document, 'cookie', {
    get: () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; '),
    set: value => {
      writes.push(value);
      const [name, val] = value.split(';')[0].split('=');
      if (value.includes('Max-Age=0')) delete jar[name]; else jar[name] = val;
    }
  });
  class ImageElement {
    get src() { return this.value; }
    set src(value) { this.value = value; dispatches.push({ transport: 'image', url: value }); }
  }
  class Xhr {
    open(method, url) { this.url = url; }
    send(body) { dispatches.push({ transport: 'xhr', url: this.url, body }); }
    abort() { this.aborted = true; }
  }
  const window = {
    navigator: {sendBeacon(url, data) {dispatches.push({transport: 'beacon', url, data}); return true;}},
    fetch(input, options) {dispatches.push({transport: 'fetch', input, options}); return Promise.resolve(new Response(null, {status: 204}));},
    HTMLImageElement: ImageElement, XMLHttpRequest: Xhr,
    location: {hostname: host, pathname: '/', href: `https://${host}/`}, innerWidth: 1200,
    addEventListener: (n, f) => listen(listeners, n, f), dispatchEvent: e => emit(listeners, e),
    setInterval: f => {timers.push(f); return timers.length;},
    cookieStore: {addEventListener: (n, f) => listen(listeners, 'cookie-' + n, f)}
  };
  const context = vm.createContext({window, document, location: window.location,
    CustomEvent: class {constructor(type, options) {this.type = type; this.detail = options.detail;}},
    HTMLElement: class {}, Date, Set, URL, Response, encodeURIComponent, decodeURIComponent});
  vm.runInContext(consentSource, context);
  vm.runInContext(gaSource, context);
  const fire = type => emit(listeners, {type});
  const commands = name => [...window.dataLayer].filter(args => args[0] === name);
  const latestConsent = () => commands('consent').at(-1)[2];
  return {window, tags, writes, timers, fire, commands, latestConsent, dispatches,
    visible: () => emit(documentListeners, {type: 'visibilitychange'}),
    initUi: () => {emit(documentListeners, {type: 'DOMContentLoaded'}); return elements.find(e => e.className === 'evh-consent');}};
}

for (const host of hosts) {
  test(`shared withdrawal closes immediate collection gate on ${host}`, () => {
    const jar = {evh_analytics_consent: 'granted', _ga: 'synthetic', _ga_QJKQTTXSF3: 'synthetic'};
    const a = realm(jar, host), b = realm(jar, hosts.find(h => h !== host));
    a.fire('evh:analytics-consent-changed'); b.fire('evh:analytics-consent-changed');
    assert.equal(a.tags.length, 1); assert.equal(a.window[id], false);
    assert.equal(a.window.EVHAnalytics.track('fixture_before', {}), true);
    // No callback in a has run yet: Google sees immediate event opt-out.
    jar.evh_analytics_consent = 'denied'; b.window.EVHConsent.synchronize();
    assert.equal(a.window[id], true);
    const eventCount = a.commands('event').length;
    assert.equal(a.window.EVHAnalytics.track('fixture_after', {}), false);
    assert.equal(a.commands('event').length, eventCount);
    assert.equal(a.latestConsent().analytics_storage, 'denied');
    assert.equal(a.window.EVHAnalytics.isLoaded(), false);
    assert.ok(!('_ga' in jar)); assert.ok(!('_ga_QJKQTTXSF3' in jar));
    for (const key of ['ad_storage', 'ad_user_data', 'ad_personalization']) assert.equal(a.latestConsent()[key], 'denied');
    jar.evh_analytics_consent = 'granted'; a.fire('focus');
    assert.equal(a.window[id], false); assert.equal(a.window.EVHAnalytics.track('fixture_regrant', {}), true);
    assert.equal(a.tags.length, 1); assert.equal(a.commands('config').length, 1);
  });
}

for (const signal of ['focus', 'pageshow', 'visibilitychange', 'cookie-change', 'poll']) {
  test(`${signal} synchronizes withdrawal and expiry without renewing preference`, () => {
    for (const next of ['denied', null, '%broken']) {
      const jar = {evh_analytics_consent: 'granted'};
      const r = realm(jar); r.fire('evh:analytics-consent-changed');
      if (next === null) delete jar.evh_analytics_consent; else jar.evh_analytics_consent = next;
      assert.equal(r.window[id], true);
      if (signal === 'poll') r.timers.forEach(f => f());
      else if (signal === 'visibilitychange') r.visible(); else r.fire(signal);
      assert.equal(r.latestConsent().analytics_storage, 'denied');
      assert.equal(r.window.EVHConsent.getAnalyticsConsent(), false);
      assert.ok(!r.writes.some(v => v.startsWith('evh_analytics_consent=')));
    }
  });
}

test('grant/refuse/regrant and reload configure once per document', () => {
  const jar = {};
  const r = realm(jar); r.fire('evh:analytics-consent-changed');
  assert.equal(r.tags.length, 0); assert.equal(r.window[id], true);
  jar.evh_analytics_consent = 'denied'; r.window.EVHConsent.synchronize();
  assert.equal(r.tags.length, 0);
  for (const choice of ['granted', 'denied', 'granted', 'granted']) {
    jar.evh_analytics_consent = choice; r.window.EVHConsent.synchronize(); r.fire('pageshow');
  }
  assert.equal(r.tags.length, 1); assert.equal(r.commands('config').length, 1);
  const reload = realm(jar); reload.fire('evh:analytics-consent-changed');
  assert.equal(reload.tags.length, 1); assert.equal(reload.commands('config').length, 1);
});

test('preview and lookalike hostnames never load or emit', () => {
  for (const host of ['localhost', 'preview.azurestaticapps.net', 'evhconsult.eu.attacker.test', 'extra.evhconsult.eu']) {
    const r = realm({evh_analytics_consent: 'granted'}, host);
    r.fire('evh:analytics-consent-changed');
    assert.equal(r.tags.length, 0);
    assert.equal(r.window.EVHAnalytics.track('fixture', {}), false);
    assert.equal(r.commands('event').length, 0);
    assert.equal(r.commands('config').length, 0);
  }
});

test('real native controls reverse and persist choice; expiry prompts again', () => {
  const jar = {}, r = realm(jar), panel = r.initUi();
  const accept = panel.querySelector('[data-consent-accept]');
  const refuse = panel.querySelector('[data-consent-refuse]');
  assert.equal(panel.hidden, false);
  assert.equal(accept.disabled, false); assert.equal(refuse.disabled, false);
  accept.click();
  assert.equal(jar.evh_analytics_consent, 'granted'); assert.equal(r.window[id], false);
  assert.ok(r.writes.some(v => /Max-Age=15552000/.test(v) && /Domain=.evhconsult.eu/.test(v) && /Secure/.test(v)));
  refuse.click();
  assert.equal(jar.evh_analytics_consent, 'denied'); assert.equal(r.window[id], true);
  accept.click(); assert.equal(r.commands('config').length, 1);
  delete jar.evh_analytics_consent; r.fire('pageshow');
  assert.equal(panel.hidden, false); assert.equal(accept.disabled, false); assert.equal(refuse.disabled, false);
  assert.equal(r.latestConsent().analytics_storage, 'denied');
});


test('buffered collection dispatch is blocked before synchronization callbacks', async () => {
  for (const next of ['denied', null, '%broken']) {
    const jar = {evh_analytics_consent: 'granted'}, r = realm(jar);
    const endpoint = 'https://region1.google-analytics.com/g/collect?tid=G-QJKQTTXSF3';
    const pending = new r.window.XMLHttpRequest(); pending.open('POST', endpoint);
    if (next === null) delete jar.evh_analytics_consent; else jar.evh_analytics_consent = next;
    assert.equal(r.window.navigator.sendBeacon(endpoint, 'queued'), true);
    assert.equal((await r.window.fetch(new URL(endpoint), {method: 'POST', body: 'queued'})).status, 204);
    assert.equal((await r.window.fetch({url: endpoint}, {method: 'POST'})).status, 204);
    const image = new r.window.HTMLImageElement(); image.src = endpoint;
    pending.send('queued'); assert.equal(pending.aborted, true);
    assert.deepEqual(r.dispatches, []);
  }
});

test('granted and regranted collection retains native transports', async () => {
  const jar = {evh_analytics_consent: 'granted'}, r = realm(jar);
  for (let cycle = 0; cycle < 2; cycle++) {
    if (cycle) {jar.evh_analytics_consent = 'denied'; r.window.EVHConsent.synchronize(); jar.evh_analytics_consent = 'granted';}
    const url = 'https://www.google-analytics.com/g/collect', options = {method: 'POST', body: 'sample'};
    const count = r.dispatches.length;
    assert.equal(r.window.navigator.sendBeacon(url, 'sample'), true);
    await r.window.fetch(url, options);
    const image = new r.window.HTMLImageElement(); image.src = url; assert.equal(image.src, url);
    const xhr = new r.window.XMLHttpRequest(); xhr.open('POST', url); xhr.send('sample');
    assert.deepEqual(r.dispatches.slice(count).map(d => d.transport), ['beacon', 'fetch', 'image', 'xhr']);
    assert.equal(r.dispatches[count + 1].options, options);
  }
});

test('denial leaves contact, reporting, assets and lookalike hosts native', async () => {
  const r = realm({evh_analytics_consent: 'denied'});
  for (const url of ['/api/contact', '/api/analytics-report?view=pages&days=7', '/images/logo.svg',
    'https://google-analytics.com.attacker.test/g/collect', 'https://other.example/g/collect',
    'https://www.googletagmanager.com/gtag/js?id=G-QJKQTTXSF3', 'https://www.google-analytics.com/other']) {
    const count = r.dispatches.length;
    r.window.navigator.sendBeacon(url, 'sample'); await r.window.fetch(url);
    const image = new r.window.HTMLImageElement(); image.src = url;
    const xhr = new r.window.XMLHttpRequest(); xhr.open('POST', url); xhr.send('sample');
    assert.equal(r.dispatches.length - count, 4, url);
  }
});

for (const host of hosts) {
  test(`late GA cookies are removed while preference remains denied on ${host}`, () => {
    for (const next of ['denied', null, '%broken']) {
      const jar = {evh_analytics_consent: 'granted'};
      const r = realm(jar, host);
      if (next === null) delete jar.evh_analytics_consent; else jar.evh_analytics_consent = next;
      r.window.EVHConsent.synchronize();
      // A delayed Google task can recreate a cookie after the first cleanup.
      jar._ga = 'late'; jar._ga_QJKQTTXSF3 = 'late'; jar.functional = 'keep';
      const preferenceWrites = r.writes.filter(x => x.startsWith('evh_analytics_consent=')).length;
      r.timers.forEach(fn => fn());
      assert.ok(!('_ga' in jar)); assert.ok(!('_ga_QJKQTTXSF3' in jar));
      assert.equal(jar.functional, 'keep');
      assert.equal(r.writes.filter(x => x.startsWith('evh_analytics_consent=')).length, preferenceWrites);
      assert.equal(r.window[id], true);
    }
  });
}
