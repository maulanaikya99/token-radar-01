// Token Radar's page: one static renderer over window.RADAR (written by main.ts) and
// window.PLAYBOOK (the per-protocol venue and risk). No fetch, no framework, no network.
(function () {
  'use strict';

  var D = window.RADAR;
  var PB = window.PLAYBOOK || {};
  if (!D) return;

  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };
  var tableSlot = null;
  var countEl = null;
  var resetEl = null;
  var dialog = null;

  var usdFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFull.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'n/a';
    if (days < 60) return Math.max(0, Math.round(days)) + 'd';
    if (days < 700) return Math.round(days / 30.4) + 'mo';
    return (days / 365).toFixed(1) + 'y';
  }
  function fmtMultiple(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(n >= 1 ? 2 : 3) + 'x';
  }
  function chainList(r, limit) {
    var c = r.chains || [];
    if (c.length === 0) return 'unnamed chain';
    var head = c.slice(0, limit || 2).join(', ');
    return c.length > (limit || 2) ? head + ' +' + (c.length - (limit || 2)) : head;
  }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---------------------------------------------------------------- hash state

  function readHash() {
    var raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    var p = new URLSearchParams(raw);
    if (p.get('q')) state.q = p.get('q');
    if (p.get('category')) state.category = p.get('category');
    if (p.get('chain')) state.chain = p.get('chain');
    if (p.get('tab') === 'live') state.tab = 'live';
    if (p.get('sort')) state.sort = p.get('sort');
    if (p.get('dir') === '1') state.dir = 1;
    if (p.get('dir') === '-1') state.dir = -1;
    if (p.get('p')) state.selected = p.get('p');
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tab !== 'pre') p.set('tab', state.tab);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir !== -1) p.set('dir', String(state.dir));
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }

  // ---------------------------------------------------------------- chrome

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }, el('b'), el('i')),
        el('div', { class: 'word' },
          el('strong', { text: 'TOKEN RADAR' }),
          el('span', { text: 'PRE-LAUNCH SIGNAL DESK' })
        )
      ),
      el('div', { class: 'rail' },
        el('span', { class: 'stamp', text: 'sealed snapshot' }),
        el('span', { class: 'mono', text: D.as_of + ' / defillama' }),
        el('span', { class: 'mono', text: D.model_version })
      )
    );
  }

  function hero() {
    var top = D.rows[0];
    var watch = D.rows.filter(function (r) { return r.watchlist; }).length;
    var meter = el('div', { class: 'meter', 'aria-hidden': 'true' });
    for (var i = 0; i < 10; i++) meter.appendChild(el('i', { class: i < Math.round((watch / D.watchlist_size) * 10) ? 'on' : '' }));
    return el('section', { class: 'hero' },
      el('div', { class: 'hero-copy' },
        el('div', { class: 'eyebrow', text: D.watchlist_size + ' watchlist protocols / ' + D.board_size + ' ranked rows' }),
        el('h1', null, D.watchlist_size + ' protocols.', el('br'), el('em', null, 'No token yet.')),
        el('p', { class: 'dek' },
          'Ranked by an implied launch value built from ', el('b', null, 'TVL'), ', ',
          el('b', null, 'seven-day growth'), ' and ', el('b', null, 'time without a token'),
          '. The watchlist is the floor, not the ceiling: ' + D.early_size + ' pre-token protocols below $' +
          Math.round(D.floor_usd / 1e6) + 'M of TVL join the board.'
        ),
        el('div', { class: 'hero-tags' },
          el('span', null, el('b', null, watch + ' / ' + D.watchlist_size), ' covered'),
          el('span', null, el('b', null, fmtUsd(D.watchlist_tvl_usd)), ' watchlist TVL'),
          el('span', null, el('b', null, D.model_version), ' model'),
          el('span', null, el('b', null, D.live_size + ' live'), ' set aside')
        )
      ),
      el('div', { class: 'kpis' },
        el('article', { class: 'kpi' },
          el('span', { class: 'kpi-label', text: 'Watchlist covered' }),
          el('strong', { text: watch + ' / ' + D.watchlist_size }),
          el('small', { text: 'every slug the snapshot names' }),
          meter
        ),
        el('article', { class: 'kpi' },
          el('span', { class: 'kpi-label', text: 'Watchlist TVL' }),
          el('strong', { text: fmtUsd(D.watchlist_tvl_usd) }),
          el('small', { text: 'pre-token protocols at or above the floor' })
        ),
        el('article', { class: 'kpi' },
          el('span', { class: 'kpi-label', text: 'Median implied value' }),
          el('strong', { text: fmtUsd(D.median_implied_usd) }),
          el('small', { text: 'watchlist rows, middle of the board' })
        ),
        el('article', { class: 'kpi hero-kpi' },
          el('span', { class: 'kpi-label', text: 'Rank 1 signal' }),
          el('strong', { text: fmtUsd(top.implied_value_usd) }),
          el('small', { text: top.name + ' / ' + (top.category || 'Other') })
        )
      )
    );
  }


  function methodStrip() {
    var m = D.model;
    return el('section', { class: 'method' },
      el('div', { class: 'method-formula' },
        el('span', { class: 'kicker', text: 'The valuation, stated' }),
        el('code', null, 'implied = TVL x ', el('b', null, 'peer(category)'), ' x growth x maturity')
      ),
      el('div', { class: 'method-facts' },
        el('span', null, el('b', null, fmtMultiple(D.global_median)), ' all-live median'),
        el('span', null, el('b', null, 'k=' + m.peer_shrink_k), ' shrinkage'),
        el('span', null, el('b', null, m.growth_floor + ' to ' + m.growth_cap + '%'), ' growth clamp'),
        el('button', { class: 'ghost small', type: 'button', text: 'Full model', onclick: function () { var t = document.getElementById('model'); if (t) t.scrollIntoView(); } })
      )
    );
  }

  function chainOptions() {
    var counts = {};
    D.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; }); });
    return Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
  }

  function controls() {
    var cats = Array.from(new Set(D.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = chainOptions();
    var search = el('input', { type: 'search', id: 'q', value: state.q, placeholder: 'Search protocol, category or chain', 'aria-label': 'Search the board', autocomplete: 'off' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); renderTable(); });
    var chain = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chain.addEventListener('change', function () { state.chain = chain.value; writeHash(); renderTable(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre'; writeHash(); syncTabs(); renderTable(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); syncTabs(); renderTable(); } });
    countEl = el('div', { class: 'count' });
    resetEl = el('button', { class: 'ghost', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; search.value = ''; cat.value = 'all'; chain.value = 'all'; writeHash(); renderTable(); } });
    return el('section', { class: 'controls', 'aria-label': 'Board filters' },
      el('div', { class: 'field search' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chain),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      resetEl,
      countEl
    );
  }

  function syncTabs() {
    var tabs = document.querySelectorAll('.tabs button');
    if (tabs[0]) tabs[0].setAttribute('aria-pressed', state.tab === 'pre' ? 'true' : 'false');
    if (tabs[1]) tabs[1].setAttribute('aria-pressed', state.tab === 'live' ? 'true' : 'false');
  }

  function boardHead() {
    return el('div', { class: 'board-head' },
      el('div', null,
        el('h2', { text: 'Ranked board' }),
        el('p', { text: 'Implied value, strongest first. Select a row for its valuation ledger and farm plan.' })
      ),
      el('div', { class: 'legend' },
        el('span', null, el('i'), 'watchlist'),
        el('span', null, el('i', { class: 'early' }), 'below floor'),
        el('span', null, el('i', { class: 'live' }), 'live token')
      )
    );
  }

  // ---------------------------------------------------------------- filtering and sorting

  function matches(r) {
    if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }

  function sortRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function sortHeader(key, label) {
    var on = state.sort === key;
    return el('th', { scope: 'col' },
      el('button', { type: 'button', 'data-on': on ? 'true' : 'false', onclick: function () {
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
        writeHash();
        renderTable();
      } },
        label,
        on ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir < 0 ? '↓' : '↑' }) : null
      )
    );
  }

  // ---------------------------------------------------------------- tables

  function renderTable() {
    if (!tableSlot) return;
    tableSlot.textContent = '';
    if (resetEl) resetEl.hidden = !(state.q || state.category !== 'all' || state.chain !== 'all');
    if (state.tab === 'live') {
      tableSlot.appendChild(liveTable());
      if (countEl) countEl.textContent = D.live.length + ' live-token protocols';
      return;
    }
    var list = sortRows(D.rows.filter(matches));
    if (countEl) {
      var total = D.rows.length;
      countEl.innerHTML = '';
      countEl.appendChild(el('b', { text: String(list.length) }));
      countEl.appendChild(document.createTextNode(' / ' + total + ' rows'));
    }
    tableSlot.appendChild(boardTable(list));
  }

  function growthEl(n) {
    var cls = n === null || n === undefined ? 'pct flat' : n > 0 ? 'pct pos' : n < 0 ? 'pct neg' : 'pct flat';
    return el('span', { class: cls, text: fmtPct(n) });
  }

  function boardTable(list) {
    if (list.length === 0) {
      return el('div', { class: 'panel' },
        el('div', { class: 'empty' },
          el('h3', { text: 'No protocol matches those filters' }),
          el('p', { text: 'Clear the search or pick another category or chain.' }),
          el('button', { class: 'btn', type: 'button', text: 'Clear filters', onclick: function () {
            state.q = ''; state.category = 'all'; state.chain = 'all';
            var q = document.getElementById('q'); if (q) q.value = '';
            var c = document.getElementById('category'); if (c) c.value = 'all';
            var ch = document.getElementById('chain'); if (ch) ch.value = 'all';
            writeHash(); renderTable();
          } })
        )
      );
    }
    var max = D.top_implied_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var pct = Math.max(2, Math.round((r.implied_value_usd / max) * 100));
      var tier = r.watchlist ? el('span', { class: 'tag watch', text: 'watch' }) : el('span', { class: 'tag', text: 'below floor' });
      var row = el('tr', {
        'data-slug': r.slug,
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', null, el('span', { class: r.rank <= 3 ? 'rank top' : 'rank', text: String(r.rank) })),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }, tier),
          el('span', { text: (r.category || 'Other') + ' / ' + chainList(r) })
        )),
        el('td', { class: 'num muted', text: fmtUsd(r.tvl_usd) }),
        el('td', null, growthEl(r.change_7d)),
        el('td', { class: 'num muted', text: fmtAge(r.age_days) }),
        el('td', null, el('span', {
          class: 'mult',
          text: fmtMultiple(r.peer_multiple),
          title: (r.peer_count > 0 ? r.peer_count + ' live peer' + (r.peer_count === 1 ? '' : 's') + ' at a ' + fmtMultiple(r.category_median) + ' median' : 'no live peer in this category') + ', shrunk to the board multiple'
        })),
        el('td', null, el('div', { class: 'value' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + pct + '%' })),
          el('b', { text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(row);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'scroll' },
        el('table', null,
          el('caption', { text: 'Every row records no token and is ranked by one function of the snapshot. The bar is relative to rank 1.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('peer', 'Peer multiple'),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      ),
      el('p', { class: 'note', text: 'Age is days since DefiLlama first listed the protocol, the snapshot\'s best record of how long it has run without a token. Peer multiple is the category\'s live-token mcap/TVL, shrunk toward the all-live median so one token cannot set it alone.' })
    );
  }

  function liveTable() {
    var max = 1;
    D.live.forEach(function (r) { if ((r.mcap_usd || 0) > max) max = r.mcap_usd; });
    var tbody = el('tbody');
    D.live.forEach(function (r) {
      var ratio = r.mcap_usd !== null && r.tvl_usd > 0 ? r.mcap_usd / r.tvl_usd : null;
      var used = ratio === null ? null : Math.max(D.model.ratio_floor, Math.min(D.model.ratio_cap, ratio));
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'tag', text: 'live' })),
        el('td', null, el('div', { class: 'proto' },
          el('b', { text: r.name }),
          el('span', { text: (r.category || 'Other') + ' / ' + chainList(r) })
        )),
        el('td', { class: 'num muted', text: fmtUsd(r.tvl_usd) }),
        el('td', null, growthEl(r.change_7d)),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num muted', text: used === null ? 'n/a' : fmtMultiple(used), title: ratio === null ? null : 'raw ' + fmtMultiple(ratio) + ', winsorised for the model' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'scroll' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. Their mcap/TVL sets the comparables the pre-token board reads, winsorised to a 0.02 to 4x window for the model.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }),
            el('th', { scope: 'col', text: 'MCap / TVL' })
          )),
          tbody
        )
      ),
      el('p', { class: 'note', text: 'The top ' + D.live_size + ' live-token protocols by market cap, exchanges excluded. They never enter the ranked board.' })
    );
  }

  // ---------------------------------------------------------------- model panel

  function modelPanel() {
    var m = D.model;
    var peers = D.peers.slice(0, 8);
    var rows = peers.map(function (p) {
      return el('tr', null,
        el('td', { text: p.category }),
        el('td', { class: 'num', text: String(p.n) }),
        el('td', { class: 'num', text: fmtMultiple(p.median) }),
        el('td', { class: 'num', text: fmtMultiple(p.multiple) })
      );
    });
    return el('section', { class: 'model', id: 'model' },
      el('div', { class: 'card' },
        el('h2', { text: 'The value model, in one line' }),
        el('p', { text: 'Every input is a snapshot field; no protocol name sets a value.' }),
        el('div', { class: 'formula' },
          'implied = ',
          el('b', { text: 'tvl_usd' }),
          ' x ',
          el('b', { text: 'peer(category)' }),
          ' x (1 + clamp(',
          el('span', { class: 'amber', text: 'change_7d' }),
          ', ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ')',
          el('br'),
          '          x (' + m.maturity_floor + ' + min(',
          el('span', { class: 'amber', text: 'age_days' }),
          ', ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ')',
          el('br'),
          'peer = shrink(median(',
          el('b', { text: 'mcap_usd / tvl_usd' }),
          ' of live peers), toward ' + m.global_median + ', k = ' + m.peer_shrink_k + ')',
          el('br'),
          '       clamped ' + m.multiple_floor + ' to ' + m.multiple_cap + ', ratios winsorised ' + m.ratio_floor + ' to ' + m.ratio_cap
        ),
        el('h3', { text: 'Why borrow the multiple instead of inventing one' }),
        el('p', { text: 'A live token in the same category shows what a dollar of TVL is worth there. Shrinking toward the all-live ' + m.global_median + 'x median keeps a one-token category from pricing itself.' }),
        el('h3', { text: 'What is set aside' }),
        el('p', { text: 'The ' + D.live_size + ' live-token protocols are comparables, never board rows: their market cap is a fact, a pre-token value is an estimate.' })
      ),
      el('div', { class: 'card' },
        el('h2', { text: 'Peer multiple by category' }),
        el('p', { text: 'The eight most used categories. n is the live peers behind the median.' }),
        el('table', { class: 'mini' },
          el('thead', null, el('tr', null, el('th', { text: 'Category' }), el('th', { class: 'num', text: 'n' }), el('th', { class: 'num', text: 'Median' }), el('th', { class: 'num', text: 'Used' }))),
          el('tbody', null, rows)
        ),
      )
    );
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + D.as_of + ', sealed from ' + D.source.replace(/^DefiLlama\s+/, 'DefiLlama ') + '. Every figure is read from data.js at load; the page makes no network request.' }),
      el('span', { text: 'Implied value is the entry\'s own estimate, not a promise or a price. Farm plans are operational steps, not financial advice.' })
    );
  }

  // ---------------------------------------------------------------- detail

  function parseStep(s) {
    var at = s.indexOf(' Cost: ');
    if (at < 0) return { text: s, cost: '', time: '' };
    var text = s.slice(0, at);
    var rest = s.slice(at + 7);
    var tt = rest.indexOf('. Time: ');
    if (tt < 0) return { text: text, cost: rest.replace(/\.$/, ''), time: '' };
    return { text: text, cost: rest.slice(0, tt), time: rest.slice(tt + 8).replace(/\.$/, '') };
  }

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { row = D.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    syncSelected();
    if (!dialog) {
      dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
      dialog.addEventListener('close', function () { state.selected = null; writeHash(); syncSelected(); });
      dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });
      document.body.appendChild(dialog);
    }
    dialog.textContent = '';
    var steps = row.farm_steps.map(parseStep);
    var ledger = el('div', { class: 'ledger' },
      el('div', null, el('span', { text: 'TVL, the snapshot' }), el('b', { text: usdFull.format(row.tvl_usd) })),
      el('div', null,
        el('span', { text: 'Peer multiple / ' + (row.category || 'Other') }),
        el('b', { text: fmtMultiple(row.peer_multiple) + ' (' + (row.peer_count > 0 ? 'n=' + row.peer_count + ', median ' + fmtMultiple(row.category_median) : 'all-live median') + ')' })
      ),
      el('div', null, el('span', { text: 'Growth multiplier / ' + fmtPct(row.change_7d) + ' 7d' }), el('b', { text: fmtMultiple(row.growth_multiplier) })),
      el('div', null, el('span', { text: 'Maturity multiplier / ' + fmtAge(row.age_days) + ' without a token' }), el('b', { text: fmtMultiple(row.maturity_multiplier) })),
      el('div', { class: 'total' }, el('span', { text: 'Implied launch value' }), el('b', { text: usdFull.format(row.implied_value_usd) }))
    );
    var peerText = row.peer_count > 0
      ? row.peer_count + ' live-token peer' + (row.peer_count === 1 ? '' : 's') + ' in ' + (row.category || 'Other') + ' at a ' + fmtMultiple(row.category_median) + ' median, shrunk toward the all-live ' + fmtMultiple(D.global_median) + ' with k=' + D.model.peer_shrink_k + '.'
      : 'No live-token peer in this category, so the row reads the all-live median of ' + fmtMultiple(D.global_median) + '.';
    var main = el('div', { class: 'detail-main' },
      el('div', { class: 'd-head' },
        el('div', null,
          el('div', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + D.board_size + ' / pre-token' }),
          el('h2', { id: 'detail-title', text: row.name }),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' / ' + chainList(row, 4) + (row.watchlist ? ' / watchlist' : ' / below the floor') })
        ),
        el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '×', onclick: function () { dialog.close(); } })
      ),
      el('div', { class: 'big-value' },
        el('span', { text: 'Implied launch value' }),
        el('strong', { text: fmtUsd(row.implied_value_usd) }),
        el('small', { text: fmtUsd(row.tvl_usd) + ' TVL x ' + fmtMultiple(row.peer_multiple) + ' peer x ' + fmtMultiple(row.growth_multiplier) + ' growth x ' + fmtMultiple(row.maturity_multiplier) + ' maturity' })
      ),
      ledger,
      el('div', { class: 'callout' },
        el('b', { text: 'Comparable basis' }),
        el('p', { text: peerText })
      ),
      el('div', { class: 'risk' },
        el('b', { text: 'Position risk' }),
        row.risk || 'Smart-contract and liquidity risk: read the protocol own terms before depositing.'
      ),
      el('p', { class: 'd-foot', text: 'Model ' + D.model_version + '. The page recomputes nothing: board.json and data.js come from the same function in lib/model.ts, and the dossier is built from this page.' })
    );
    var list = el('ol', { class: 'steps' });
    steps.forEach(function (s) {
      list.appendChild(el('li', null,
        el('p', { text: s.text }),
        el('div', { class: 'chips' },
          s.cost ? el('span', { class: 'chip cost', text: s.cost }) : null,
          s.time ? el('span', { class: 'chip time', text: s.time }) : null
        )
      ));
    });
    var side = el('div', { class: 'detail-side' },
      el('div', { class: 'side-head' }, el('h3', { text: 'Farm plan' }), el('span', { text: steps.length + ' steps' })),
      el('div', { class: 'venue' },
        el('span', { text: 'Venue' }),
        el('b', { text: row.venue || (row.category || 'Protocol') + ' on ' + chainList(row, 1) })
      ),
      list,
      el('p', { class: 'd-foot', text: 'Costs are estimates in US dollars at the snapshot date. Never claim from a link sent to the wallet; use the protocol\'s own page.' })
    );
    dialog.appendChild(el('div', { class: 'detail-grid' }, main, side));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function syncSelected() {
    document.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.setAttribute('data-selected', tr.getAttribute('data-slug') === state.selected ? 'true' : 'false');
    });
  }

  // ---------------------------------------------------------------- boot

  function boot() {
    readHash();
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(hero());
    shell.appendChild(methodStrip());
    shell.appendChild(controls());
    shell.appendChild(boardHead());
    tableSlot = el('div', { id: 'table-slot' });
    shell.appendChild(tableSlot);
    shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    renderTable();
    if (state.selected) openDetail(state.selected);
    window.addEventListener('keydown', function (e) {
      if (e.key === '/' && !dialog?.open) {
        var box = document.getElementById('q');
        if (box && document.activeElement !== box) { e.preventDefault(); box.focus(); }
      }
    });
  }

  boot();
})();
