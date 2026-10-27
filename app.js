(function () {
  "use strict";

  var cfg = window.SALES_HUB_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var state = { user: null, lines: [], boxes: [], products: [], mapLoaded: false, prodLoaded: false, lineId: null, open: {}, popen: {}, q: "", pq: "" };

  function $(id) { return document.getElementById(id); }
  function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function show(view) {
    ["boot", "login-view", "app-view"].forEach(function (id) { $(id).hidden = id !== view; });
  }

  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === "text") n.textContent = props[k];
      else if (k === "class") n.className = props[k];
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { n.appendChild(c); });
    return n;
  }

  /* ---------- theme ---------- */
  function getPref() {
    try { return localStorage.getItem("sh-theme") || "system"; } catch (e) { return "system"; }
  }
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  function isDark(pref) { return pref === "dark" || (pref === "system" && systemDark()); }
  function applyTheme(pref) {
    var dark = isDark(pref);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    var label = dark ? "Switch to light theme" : "Switch to dark theme";
    all("[data-theme-toggle], #theme-btn").forEach(function (b) { b.setAttribute("aria-label", label); });
    all('input[name="theme"]').forEach(function (r) { r.checked = r.value === pref; });
  }
  function setPref(pref) {
    try { localStorage.setItem("sh-theme", pref); } catch (e) {}
    applyTheme(pref);
  }
  all("[data-theme-toggle], #theme-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      setPref(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
    });
  });
  all('input[name="theme"]').forEach(function (r) {
    r.addEventListener("change", function () { if (r.checked) setPref(r.value); });
  });
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onSys = function () { if (getPref() === "system") applyTheme("system"); };
    if (mq.addEventListener) mq.addEventListener("change", onSys);
  }
  applyTheme(getPref());

  /* ---------- helpers ---------- */
  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function isCurrent(row, today) {
    return row.valid_from <= today && (!row.valid_to || row.valid_to > today);
  }
  function pickCurrent(rows, today) {
    var cur = (rows || []).filter(function (r) { return isCurrent(r, today); });
    cur.sort(function (a, b) { return a.valid_from < b.valid_from ? 1 : -1; });
    return cur[0] || null;
  }
  function natural(a, b) { return a.localeCompare(b, "en", { numeric: true }); }
  function money(v) {
    if (v === null || v === undefined || v === "") return "-";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function normalizeBoxes(boxes) {
    var today = todayStr();
    return boxes.map(function (b) {
      var a = pickCurrent(b.box_assignments, today);
      var bricks = (b.brick_box_map || [])
        .filter(function (r) { return isCurrent(r, today) && r.bricks; })
        .map(function (r) { return r.bricks.name; })
        .sort(natural);
      return {
        id: b.id,
        name: b.name,
        lineId: b.line_id,
        district: b.districts ? b.districts.name : "",
        region: b.districts && b.districts.regions ? b.districts.regions.name : "",
        rep: a && a.rep ? a.rep : null,
        manager: a && a.manager ? a.manager : null,
        bricks: bricks
      };
    });
  }

  function normalizeProducts(rows) {
    return rows.map(function (p) {
      var codes = (p.product_codes || []).slice().sort(function (a, b) { return natural(String(a.item_id), String(b.item_id)); });
      return { id: p.id, name: p.name, lineId: p.line_id, active: !!p.is_active, codes: codes };
    });
  }

  /* ---------- shared UI ---------- */
  function renderTabs(containerId) {
    var box = $(containerId);
    box.textContent = "";
    state.lines.forEach(function (l) {
      var btn = el("button", { type: "button", role: "tab", text: l.code, "aria-selected": String(l.id === state.lineId) });
      btn.addEventListener("click", function () {
        state.lineId = l.id;
        state.open = {};
        state.popen = {};
        renderCurrent();
      });
      box.appendChild(btn);
    });
  }

  function renderStats(containerId, items) {
    var box = $(containerId);
    box.textContent = "";
    items.forEach(function (s) {
      box.appendChild(el("div", { class: "stat" }, [
        el("div", { class: "n", text: String(s[1]) }),
        el("div", { class: "l", text: s[0] })
      ]));
    });
  }

  function makeRow(isOpen, onToggle) {
    var tr = el("tr", { class: "row" + (isOpen ? " open" : ""), tabindex: "0", "aria-expanded": String(isOpen) });
    tr.addEventListener("click", onToggle);
    tr.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onToggle(); }
    });
    return tr;
  }

  function nameCell(text) {
    return el("td", { class: "name" }, [el("span", { class: "chev", "aria-hidden": "true" }), document.createTextNode(text)]);
  }

  function personCell(label, p) {
    var td = el("td", { "data-label": label });
    if (!p) { td.textContent = "-"; return td; }
    td.appendChild(document.createTextNode(p.full_name));
    if (p.is_vacant) td.appendChild(el("span", { class: "badge", text: "Vacant" }));
    return td;
  }

  /* ---------- mapping view ---------- */
  function boxMatches(b, q) {
    if (!q) return true;
    var hay = [b.name, b.district, b.region, b.rep ? b.rep.full_name : "", b.manager ? b.manager.full_name : ""].join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderMapping() {
    renderTabs("tabs");
    var rows = state.boxes.filter(function (b) { return b.lineId === state.lineId; }).sort(function (a, b) { return natural(a.name, b.name); });
    var vacant = rows.filter(function (b) { return b.rep && b.rep.is_vacant; }).length;
    var bricks = rows.reduce(function (s, b) { return s + b.bricks.length; }, 0);
    renderStats("stats", [["Boxes", rows.length], ["Bricks", bricks], ["Vacant reps", vacant]]);
    renderBoxRows(rows);
  }

  function renderBoxRows(rows) {
    var q = state.q.trim().toLowerCase();
    var body = $("boxes-body");
    body.textContent = "";
    var shown = rows.filter(function (b) { return boxMatches(b, q); });
    $("empty").hidden = shown.length > 0;
    shown.forEach(function (b) {
      var tr = makeRow(!!state.open[b.id], function () {
        state.open[b.id] = !state.open[b.id];
        renderBoxRows(rows);
      });
      tr.appendChild(nameCell(b.name));
      tr.appendChild(el("td", { "data-label": "District", text: b.district }));
      tr.appendChild(el("td", { "data-label": "Region", text: b.region }));
      tr.appendChild(personCell("Rep", b.rep));
      tr.appendChild(personCell("Manager", b.manager));
      tr.appendChild(el("td", { class: "num", "data-label": "Bricks", text: String(b.bricks.length) }));
      body.appendChild(tr);
      if (state.open[b.id]) {
        var content = b.bricks.length
          ? el("div", { class: "chips" }, b.bricks.map(function (n) { return el("span", { class: "chip", text: n }); }))
          : el("p", { class: "muted", text: "No bricks assigned to this box." });
        body.appendChild(el("tr", { class: "detail" }, [el("td", { colspan: "6" }, [content])]));
      }
    });
  }

  /* ---------- products view ---------- */
  function productMatches(p, q) {
    if (!q) return true;
    if (p.name.toLowerCase().indexOf(q) !== -1) return true;
    return p.codes.some(function (c) { return String(c.item_id).toLowerCase().indexOf(q) !== -1; });
  }

  function renderProducts() {
    renderTabs("p-tabs");
    var rows = state.products.filter(function (p) { return p.lineId === state.lineId; }).sort(function (a, b) { return natural(a.name, b.name); });
    var active = rows.filter(function (p) { return p.active; }).length;
    var codes = rows.reduce(function (s, p) { return s + p.codes.length; }, 0);
    renderStats("p-stats", [["Active products", active], ["Item codes", codes], ["Discontinued", rows.length - active]]);
    renderProductRows(rows);
  }

  function codesTable(p) {
    if (!p.codes.length) return el("p", { class: "muted", text: "No item codes for this product." });
    var head = el("tr", {}, [
      el("th", { text: "Item ID" }), el("th", { text: "Arabic name" }),
      el("th", { class: "num", text: "Approved price" }), el("th", { class: "num", text: "Public price" })
    ]);
    var body = el("tbody", {}, p.codes.map(function (c) {
      return el("tr", {}, [
        el("td", { text: String(c.item_id) }),
        el("td", { dir: "rtl", text: c.arabic_name || "-" }),
        el("td", { class: "num", text: money(c.approved_price) }),
        el("td", { class: "num", text: money(c.public_price) })
      ]);
    }));
    return el("div", { class: "scroll" }, [el("table", { class: "codes" }, [el("thead", {}, [head]), body])]);
  }

  function renderProductRows(rows) {
    var q = state.pq.trim().toLowerCase();
    var body = $("products-body");
    body.textContent = "";
    var shown = rows.filter(function (p) { return productMatches(p, q); });
    $("p-empty").hidden = shown.length > 0;
    shown.forEach(function (p) {
      var tr = makeRow(!!state.popen[p.id], function () {
        state.popen[p.id] = !state.popen[p.id];
        renderProductRows(rows);
      });
      tr.appendChild(nameCell(p.name));
      tr.appendChild(el("td", { "data-label": "Status" }, [el("span", { class: "badge " + (p.active ? "ok" : "off"), text: p.active ? "Active" : "Discontinued" })]));
      tr.appendChild(el("td", { class: "num", "data-label": "Codes", text: String(p.codes.length) }));
      body.appendChild(tr);
      if (state.popen[p.id]) body.appendChild(el("tr", { class: "detail" }, [el("td", { colspan: "3" }, [codesTable(p)])]));
    });
  }

  /* ---------- data ---------- */
  async function loadLines() {
    if (state.lines.length) return;
    var l = await sb.from("lines").select("id, code, sort_order, is_active").order("sort_order");
    if (l.error) throw l.error;
    state.lines = l.data.filter(function (x) { return x.is_active; });
    if (state.lineId === null && state.lines.length) state.lineId = state.lines[0].id;
  }

  async function loadMapping() {
    if (state.mapLoaded) return;
    await loadLines();
    var b = await sb.from("boxes").select(
      "id, name, line_id, districts(name, regions(name)), " +
      "box_assignments(valid_from, valid_to, " +
      "rep:employees!box_assignments_rep_id_fkey(full_name, is_vacant), " +
      "manager:employees!box_assignments_manager_id_fkey(full_name, is_vacant)), " +
      "brick_box_map(valid_from, valid_to, bricks(name))"
    );
    if (b.error) throw b.error;
    state.boxes = normalizeBoxes(b.data);
    state.mapLoaded = true;
  }

  async function loadProducts() {
    if (state.prodLoaded) return;
    await loadLines();
    var p = await sb.from("products").select("id, name, is_active, line_id, product_codes(item_id, arabic_name, approved_price, public_price)");
    if (p.error) throw p.error;
    state.products = normalizeProducts(p.data);
    state.prodLoaded = true;
  }

  /* ---------- routing ---------- */
  var ROUTES = {
    mapping: { title: "Mapping", load: loadMapping, render: renderMapping },
    products: { title: "Products", load: loadProducts, render: renderProducts },
    settings: { title: "Settings", load: null, render: function () { $("settings-email").textContent = state.user ? state.user.email : ""; } }
  };

  function routeName() {
    var h = (window.location.hash || "").replace(/^#\/?/, "");
    return ROUTES[h] ? h : "mapping";
  }

  function renderCurrent() {
    ROUTES[routeName()].render();
  }

  async function route() {
    if (!state.user) return;
    var name = routeName();
    var r = ROUTES[name];
    Object.keys(ROUTES).forEach(function (k) { $("view-" + k).hidden = k !== name; });
    all("[data-route]").forEach(function (a) {
      if (a.getAttribute("data-route") === name) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    document.title = r.title + " - Sales Hub";
    closeMenu();
    $("app-error").textContent = "";
    try {
      if (r.load) await r.load();
      r.render();
    } catch (e) {
      $("app-error").textContent = "Could not load data: " + (e && e.message ? e.message : e);
    }
  }
  window.addEventListener("hashchange", route);

  /* ---------- mobile menu ---------- */
  function openMenu() {
    $("sidebar").classList.add("open");
    $("backdrop").hidden = false;
    $("menu-btn").setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    $("sidebar").classList.remove("open");
    $("backdrop").hidden = true;
    $("menu-btn").setAttribute("aria-expanded", "false");
  }
  $("menu-btn").addEventListener("click", function () {
    if ($("sidebar").classList.contains("open")) closeMenu(); else openMenu();
  });
  $("backdrop").addEventListener("click", closeMenu);
  document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") closeMenu(); });

  /* ---------- auth ---------- */
  async function enter(user) {
    show("boot");
    try {
      var r = await sb.from("app_users").select("role").maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || r.data.role !== "admin") {
        await sb.auth.signOut();
        $("login-error").textContent = "This account does not have access. Ask the administrator to add you.";
        show("login-view");
        return;
      }
      state.user = user;
      $("who").textContent = user.email;
      $("who").setAttribute("title", user.email);
      show("app-view");
      await route();
    } catch (e) {
      show("login-view");
      $("login-error").textContent = "Could not load your account: " + (e && e.message ? e.message : e);
    }
  }

  function resetState() {
    state.user = null; state.lines = []; state.boxes = []; state.products = [];
    state.mapLoaded = false; state.prodLoaded = false; state.lineId = null; state.open = {}; state.popen = {};
  }

  $("login-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var btn = $("login-btn");
    btn.disabled = true;
    $("login-error").textContent = "";
    try {
      var res = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
      if (res.error) {
        $("login-error").textContent = "Wrong email or password. Check them and try again.";
      } else {
        $("password").value = "";
        await enter(res.data.user);
      }
    } catch (e) {
      $("login-error").textContent = "Could not reach the server. Check your connection and try again.";
    }
    btn.disabled = false;
  });

  $("signout").addEventListener("click", async function () {
    await sb.auth.signOut();
    resetState();
    show("login-view");
  });

  $("search").addEventListener("input", function (ev) { state.q = ev.target.value; renderMapping(); });
  $("p-search").addEventListener("input", function (ev) { state.pq = ev.target.value; renderProducts(); });

  (async function init() {
    try {
      var s = await sb.auth.getSession();
      if (s.data && s.data.session) await enter(s.data.session.user);
      else show("login-view");
    } catch (e) {
      show("login-view");
    }
  })();

  window.__salesHub = { normalizeBoxes: normalizeBoxes, isCurrent: isCurrent };
})();
