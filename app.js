(function () {
  "use strict";

  var cfg = window.SALES_HUB_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var state = { lines: [], boxes: [], lineId: null, open: {}, q: "" };

  function $(id) { return document.getElementById(id); }

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

  function normalize(boxes) {
    var today = todayStr();
    return boxes.map(function (b) {
      var a = pickCurrent(b.box_assignments, today);
      var bricks = (b.brick_box_map || [])
        .filter(function (r) { return isCurrent(r, today) && r.bricks; })
        .map(function (r) { return r.bricks.name; })
        .sort(function (x, y) { return x.localeCompare(y, "en", { numeric: true }); });
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

  function personCell(p) {
    var td = el("td");
    if (!p) { td.textContent = "-"; return td; }
    td.appendChild(document.createTextNode(p.full_name));
    if (p.is_vacant) td.appendChild(el("span", { class: "badge", text: "Vacant" }));
    return td;
  }

  function matches(b, q) {
    if (!q) return true;
    var hay = [b.name, b.district, b.region, b.rep ? b.rep.full_name : "", b.manager ? b.manager.full_name : ""]
      .join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderTabs() {
    var box = $("tabs");
    box.textContent = "";
    state.lines.forEach(function (l) {
      var btn = el("button", { type: "button", role: "tab", text: l.code, "aria-selected": String(l.id === state.lineId) });
      btn.addEventListener("click", function () {
        state.lineId = l.id;
        state.open = {};
        render();
      });
      box.appendChild(btn);
    });
  }

  function renderStats(rows) {
    var vacant = rows.filter(function (b) { return b.rep && b.rep.is_vacant; }).length;
    var bricks = rows.reduce(function (s, b) { return s + b.bricks.length; }, 0);
    var stats = [
      ["Boxes", rows.length],
      ["Bricks", bricks],
      ["Vacant reps", vacant]
    ];
    var box = $("stats");
    box.textContent = "";
    stats.forEach(function (s) {
      box.appendChild(el("div", { class: "stat" }, [
        el("div", { class: "n", text: String(s[1]) }),
        el("div", { class: "l", text: s[0] })
      ]));
    });
  }

  function renderRows(rows) {
    var q = state.q.trim().toLowerCase();
    var body = $("boxes-body");
    body.textContent = "";
    var shown = rows.filter(function (b) { return matches(b, q); });
    $("empty").hidden = shown.length > 0;
    shown.forEach(function (b) {
      var tr = el("tr", { class: "box-row" + (state.open[b.id] ? " open" : "") });
      tr.appendChild(el("td", { text: b.name }));
      tr.appendChild(el("td", { text: b.district }));
      tr.appendChild(el("td", { text: b.region }));
      tr.appendChild(personCell(b.rep));
      tr.appendChild(personCell(b.manager));
      tr.appendChild(el("td", { class: "num", text: String(b.bricks.length) }));
      tr.addEventListener("click", function () {
        state.open[b.id] = !state.open[b.id];
        renderRows(rows);
      });
      body.appendChild(tr);
      if (state.open[b.id]) {
        var chips = el("div", { class: "chips" }, b.bricks.map(function (n) { return el("span", { class: "chip", text: n }); }));
        var td = el("td", { colspan: "6" }, [chips]);
        body.appendChild(el("tr", { class: "detail" }, [td]));
      }
    });
  }

  function render() {
    renderTabs();
    var rows = state.boxes
      .filter(function (b) { return b.lineId === state.lineId; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "en", { numeric: true }); });
    renderStats(rows);
    renderRows(rows);
  }

  async function loadData() {
    var l = await sb.from("lines").select("id, code, sort_order, is_active").order("sort_order");
    if (l.error) throw l.error;
    var b = await sb.from("boxes").select(
      "id, name, line_id, districts(name, regions(name)), " +
      "box_assignments(valid_from, valid_to, " +
      "rep:employees!box_assignments_rep_id_fkey(full_name, is_vacant), " +
      "manager:employees!box_assignments_manager_id_fkey(full_name, is_vacant)), " +
      "brick_box_map(valid_from, valid_to, bricks(name))"
    );
    if (b.error) throw b.error;
    state.lines = l.data.filter(function (x) { return x.is_active; });
    state.boxes = normalize(b.data);
    state.lineId = state.lines.length ? state.lines[0].id : null;
  }

  async function enter(user) {
    show("boot");
    $("app-error").textContent = "";
    try {
      var r = await sb.from("app_users").select("role").maybeSingle();
      if (r.error) throw r.error;
      if (!r.data || r.data.role !== "admin") {
        await sb.auth.signOut();
        $("login-error").textContent = "This account does not have access.";
        show("login-view");
        return;
      }
      $("who").textContent = user.email;
      show("app-view");
      await loadData();
      render();
    } catch (e) {
      show("app-view");
      $("app-error").textContent = "Could not load data: " + (e && e.message ? e.message : e);
    }
  }

  $("login-form").addEventListener("submit", async function (ev) {
    ev.preventDefault();
    var btn = $("login-btn");
    btn.disabled = true;
    $("login-error").textContent = "";
    try {
      var res = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
      if (res.error) {
        $("login-error").textContent = "Wrong email or password.";
      } else {
        $("password").value = "";
        await enter(res.data.user);
      }
    } catch (e) {
      $("login-error").textContent = "Could not reach the server. Try again.";
    }
    btn.disabled = false;
  });

  $("signout").addEventListener("click", async function () {
    await sb.auth.signOut();
    show("login-view");
  });

  $("search").addEventListener("input", function (ev) {
    state.q = ev.target.value;
    render();
  });

  (async function init() {
    try {
      var s = await sb.auth.getSession();
      if (s.data && s.data.session) await enter(s.data.session.user);
      else show("login-view");
    } catch (e) {
      show("login-view");
    }
  })();

  window.__salesHub = { normalize: normalize, isCurrent: isCurrent };
})();
