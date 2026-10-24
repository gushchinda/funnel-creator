// Funnel bridge: session, attribution, Meta Pixel events and checkout start. Load it on every page, after the
// pixel base code and before the app. Configure with window.FUNNEL = { slug: "acme-sleep-men" } before this file.
//
//   FunnelBridge.registration(email)       email step submitted  -> CompleteRegistration (pixel + server)
//   FunnelBridge.checkout(plan, email)     paywall CTA pressed   -> InitiateCheckout, then go to /pay/<token>
//   (automatic) ?paid=… on the thank-you step                    -> Purchase (pixel; the server sends its twin)
//   FunnelBridge.appLink(deepLink)         deep link carrying the access token for the app
//   FunnelBridge.track('step_view', { step, index })   funnel analytics: call on every step render
//   FunnelBridge.state / save(patch)       answers and funnel state in sessionStorage
(function () {
  var cfg = window.FUNNEL || {};
  var KEY = (cfg.slug || 'funnel') + '.state';
  var params = new URLSearchParams(location.search);

  function load() {
    try { return JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  var state = load();
  function save(patch) {
    for (var k in patch) state[k] = patch[k];
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    return state;
  }

  function cookie(name) {
    var hit = document.cookie.split('; ').find(function (c) { return c.indexOf(name + '=') === 0; });
    return hit ? decodeURIComponent(hit.slice(name.length + 1)) : '';
  }

  // Session id and attribution from the landing URL, once.
  if (!state.session) save({ session: 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10) });
  if (params.get('uid')) save({ uid: params.get('uid') });
  ['source', 'medium', 'campaign', 'content', 'term'].forEach(function (k) {
    var v = params.get('utm_' + k);
    if (v) { var utm = state.utm || {}; utm[k] = v; save({ utm: utm }); }
  });
  if (params.get('fbclid') && !cookie('_fbc')) {
    var fbc = 'fb.1.' + Date.now() + '.' + params.get('fbclid');
    document.cookie = '_fbc=' + fbc + '; path=/; max-age=7776000; SameSite=Lax';
  }

  // fbq may load after us or be blocked; queue for ~10 s, then give up (the server event still goes out).
  function pixel(name, data, eventId) {
    var tries = 0;
    (function go() {
      if (window.fbq) return window.fbq('track', name, data || {}, { eventID: eventId });
      if (++tries < 50) setTimeout(go, 200);
    })();
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify(body),
    }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }

  function common() {
    return {
      session_id: state.session, uid: state.uid || '', fbp: cookie('_fbp'), fbc: cookie('_fbc'),
      page_url: location.origin + location.pathname, utm: state.utm || {}, locale: document.documentElement.lang || 'en',
    };
  }

  function registration(email) {
    save({ email: email });
    if (!email || state.regSent) return;
    var eventId = 'reg_' + state.session;
    save({ regSent: eventId });
    pixel('CompleteRegistration', {}, eventId);
    var body = common();
    body.email = email;
    body.event_id = eventId;
    body.answers = state.answers || {};
    post('/api/registration', body).catch(function () {});
  }

  function checkout(plan, email) {
    var body = common();
    body.plan = plan;
    body.email = email || state.email;
    save({ plan: plan });
    return post('/api/checkout', body).then(function (r) {
      pixel('InitiateCheckout', { value: r.value, currency: r.currency, content_ids: [plan] }, 'ic_' + state.session + '_' + plan);
      setTimeout(function () { location.href = r.url; }, 150);
      return r;
    });
  }

  // Thank-you step after payment: browser twin of the server Purchase (same event_id), once per order.
  var paid = params.get('paid');
  if (paid && state.purchaseSent !== paid) {
    save({ purchaseSent: paid, paid: paid, access: params.get('access') || state.access });
    pixel('Purchase', {
      value: Number(params.get('value')) || 0, currency: params.get('currency') || 'USD',
      content_ids: [params.get('plan') || state.plan], order_id: paid,
    }, 'purchase_' + paid);
  } else if (params.get('access')) {
    save({ access: params.get('access') });
  }

  // Funnel analytics (server logs -> BigQuery -> /analytics). QA sessions opened with demo answers are skipped.
  function track(event, data) {
    if (state.demo) return;
    var body = { event: event, session_id: state.session, utm: state.utm || {} };
    for (var k in data) body[k] = data[k];
    post('/api/events', body).catch(function () {});
  }

  function appLink(deepLink) {
    if (!deepLink || !state.access) return deepLink || '';
    return deepLink + (deepLink.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(state.access);
  }

  window.FunnelBridge = { state: state, save: save, registration: registration, checkout: checkout, appLink: appLink, track: track };
})();
