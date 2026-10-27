(function () {
  "use strict";

  var cfg = window.SALES_HUB_CONFIG;
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  var state = { user: null, lines: [], rawBoxes: [], boxes: [], products: [], employees: [], geo: null, mapLoaded: false, prodLoaded: false, empLoaded: false, lineId: null, open: {}, popen: {}, q: "", pq: "", eq: "", eLine: "all", eShow: "active", asOf: "" };

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

  function nextMonthStart() {
    var d = new Date();
    var y = d.getFullYear(), m = d.getMonth() + 2;
    if (m > 12) { m = 1; y++; }
    return y + "-" + String(m).padStart(2, "0") + "-01";
  }

  function normalizeBoxes(boxes, asOf) {
    var today = asOf || todayStr();
    return boxes.map(function (b) {
      var a = pickCurrent(b.box_assignments, today);
      var items = (b.brick_box_map || [])
        .filter(function (r) { return isCurrent(r, today) && r.bricks; })
        .map(function (r) { return { id: r.bricks.id, name: r.bricks.name }; })
        .sort(function (x, y) { return natural(x.name, y.name); });
      var bricks = items.map(function (x) { return x.name; });
      return {
        id: b.id,
        name: b.name,
        lineId: b.line_id,
        district: b.districts ? b.districts.name : "",
        region: b.districts && b.districts.regions ? b.districts.regions.name : "",
        districtId: b.district_id || null,
        rep: a && a.rep ? a.rep : null,
        manager: a && a.manager ? a.manager : null,
        bricks: bricks,
        brickItems: items
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

  /* ---------- forms, toast, errors ---------- */
  function toast(msg) {
    var old = document.getElementById("toast");
    if (old) old.remove();
    var t = el("div", { id: "toast", class: "toast", role: "status", text: msg });
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 3500);
  }

  function friendly(e, dupMsg) {
    var code = e && e.code;
    if (code === "23505") return dupMsg || "That already exists.";
    if (code === "23503") return "This refers to something that no longer exists. Reload the page and try again.";
    if (code === "42501") return "You do not have permission to make this change.";
    return (e && e.message) ? e.message : String(e);
  }

  function openForm(cfg) {
    var lastFocus = document.activeElement;
    var backdrop = el("div", { class: "modal-backdrop" });
    var form = el("form", { class: "modal", role: "dialog", "aria-modal": "true", "aria-labelledby": "modal-title", novalidate: "novalidate" });
    form.appendChild(el("h2", { id: "modal-title", text: cfg.title }));
    if (cfg.intro) form.appendChild(el("p", { class: "muted intro", text: cfg.intro }));
    var inputs = {};
    cfg.fields.forEach(function (f) {
      var id = "f-" + f.name;
      var wrap = el("div", { class: "field" });
      wrap.appendChild(f.type === "checks"
        ? el("div", { class: "lbl", text: f.label })
        : el("label", { "for": id, text: f.label + (f.required ? "" : " (optional)") }));
      var input;
      if (f.type === "checks") {
        input = el("div", { id: id, class: "checks", role: "group" });
        f.options.forEach(function (o) {
          var cb = el("input", { type: "checkbox", value: String(o.value) });
          input.appendChild(el("label", {}, [cb, document.createTextNode(o.label)]));
        });
      } else if (f.type === "textarea") {
        input = el("textarea", { id: id, name: f.name, rows: "6" });
      } else if (f.type === "select") {
        input = el("select", { id: id, name: f.name });
        f.options.forEach(function (o) { input.appendChild(el("option", { value: String(o.value), text: o.label })); });
      } else {
        input = el("input", { id: id, name: f.name, type: f.type || "text", autocomplete: "off" });
        if (f.type === "number") { input.setAttribute("step", "0.01"); input.setAttribute("min", "0"); input.setAttribute("inputmode", "decimal"); }
        if (f.type === "date") input.setAttribute("min", "2000-01-01");
      }
      if (f.dir) input.setAttribute("dir", f.dir);
      if (f.readonly) input.readOnly = true;
      if (f.required) input.setAttribute("aria-required", "true");
      if (f.type === "select") { if (f.value !== undefined && f.value !== null) input.value = String(f.value); else input.selectedIndex = 0; }
      else if (f.type !== "checks") input.value = f.value === undefined || f.value === null ? "" : String(f.value);
      wrap.appendChild(input);
      if (f.hint) wrap.appendChild(el("p", { class: "hint", text: f.hint }));
      form.appendChild(wrap);
      inputs[f.name] = input;
    });
    var err = el("p", { class: "error", role: "alert" });
    form.appendChild(err);
    var cancel = el("button", { type: "button", class: "btn", text: "Cancel" });
    var save = el("button", { type: "submit", class: "btn accent", text: cfg.submitLabel || "Save" });
    form.appendChild(el("div", { class: "modal-actions" }, [cancel, save]));
    backdrop.appendChild(form);
    document.body.appendChild(backdrop);

    function close() {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
      if (lastFocus && lastFocus.focus && document.body.contains(lastFocus)) lastFocus.focus();
    }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.stopPropagation(); close(); return; }
      if (ev.key !== "Tab") return;
      var f = Array.prototype.slice.call(form.querySelectorAll("input:not([readonly]), select, textarea, button:not(:disabled)"));
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    cancel.addEventListener("click", close);
    backdrop.addEventListener("mousedown", function (ev) { if (ev.target === backdrop) close(); });

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      err.textContent = "";
      var values = {};
      for (var i = 0; i < cfg.fields.length; i++) {
        var f = cfg.fields[i];
        if (f.type === "checks") {
          var picked = Array.prototype.slice.call(inputs[f.name].querySelectorAll("input:checked")).map(function (c) { return c.value; });
          if (f.required && !picked.length) { err.textContent = f.requiredMsg || (f.label + " is required."); return; }
          values[f.name] = picked;
          continue;
        }
        var v = inputs[f.name].value.trim();
        if (f.required && !v) {
          err.textContent = f.label + " is required.";
          inputs[f.name].focus();
          return;
        }
        if (f.type === "number" && v !== "" && !(Number(v) >= 0)) {
          err.textContent = f.label + " must be a number, zero or more.";
          inputs[f.name].focus();
          return;
        }
        values[f.name] = v;
      }
      save.disabled = true;
      cancel.disabled = true;
      try {
        await cfg.onSubmit(values);
        close();
      } catch (e) {
        err.textContent = friendly(e, cfg.dupMsg);
        save.disabled = false;
        cancel.disabled = false;
      }
    });

    var firstEditable = cfg.fields.length ? inputs[cfg.fields.filter(function (f) { return !f.readonly; }).map(function (f) { return f.name; })[0]] : null;
    if (firstEditable) {
      var fe = firstEditable.tagName === "DIV" ? firstEditable.querySelector("input") : firstEditable;
      if (fe) fe.focus();
    }
    return { close: close, inputs: inputs };
  }

  /* ---------- mapping view ---------- */
  function boxMatches(b, q) {
    if (!q) return true;
    var hay = [b.name, b.district, b.region, b.rep ? b.rep.full_name : "", b.manager ? b.manager.full_name : ""].join(" ").toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderMapping() {
    if ($("as-of").value !== state.asOf) $("as-of").value = state.asOf;
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
        body.appendChild(el("tr", { class: "detail" }, [el("td", { colspan: "6" }, [boxActions(b), content])]));
      }
    });
  }

  /* ---------- mapping: edit actions ---------- */
  function boxActions(b) {
    function btn(label, act, fn) {
      var x = el("button", { type: "button", class: "btn sm", "data-act": act, text: label });
      x.addEventListener("click", fn);
      return x;
    }
    return el("div", { class: "actions" }, [
      btn("Change rep / manager", "assign", function () { changeAssignment(b); }),
      btn("Move bricks out", "move-bricks", function () { moveBricksOut(b); }),
      btn("Add bricks", "add-bricks", function () { addBricks(b); })
    ]);
  }

  function dateField(label) {
    return { name: "date", label: label || "Effective from", type: "date", required: true, value: nextMonthStart(), hint: "Earlier months keep the old mapping." };
  }

  function peopleOptions(lineId, current, opts) {
    var list = state.employees.filter(function (e) {
      return e.status !== "In Active" || (current && e.id === current);
    }).sort(function (a, b) {
      var am = a.line_id === lineId ? 0 : 1, bm = b.line_id === lineId ? 0 : 1;
      return am - bm || natural(a.full_name, b.full_name);
    });
    var out = (opts && opts.none) ? [{ value: "", label: opts.none }] : [];
    return out.concat(list.map(function (e) {
      return { value: e.id, label: e.full_name + (e.title ? " (" + e.title + ")" : "") };
    }));
  }

  async function withRefs(fn) {
    try { await loadEmployees(); await loadGeo(); fn(); }
    catch (e) { $("app-error").textContent = "Could not load the list of people: " + friendly(e); }
  }

  function effectiveNote(date) {
    return date <= todayStr() ? "" : " It takes effect on " + date + ".";
  }

  function changeAssignment(b) {
    withRefs(function () {
      openForm({
        title: "Change rep / manager for " + b.name,
        submitLabel: "Save change",
        fields: [
          { name: "rep", label: "Rep", type: "select", required: true, value: b.rep ? b.rep.id : undefined, options: peopleOptions(b.lineId, b.rep && b.rep.id) },
          { name: "manager", label: "Manager", type: "select", value: b.manager ? b.manager.id : "", options: peopleOptions(b.lineId, b.manager && b.manager.id, { none: "No manager" }) },
          dateField()
        ],
        onSubmit: async function (v) {
          var r = await sb.rpc("change_box_assignment", { p_box_id: b.id, p_rep_id: Number(v.rep), p_manager_id: v.manager ? Number(v.manager) : null, p_date: v.date });
          if (r.error) throw r.error;
          await refreshMapping();
          toast("Saved." + effectiveNote(v.date));
        }
      });
    });
  }

  function moveBricksOut(b) {
    if (!b.brickItems.length) { $("app-error").textContent = b.name + " has no bricks to move on the date being shown."; return; }
    var targets = state.boxes.filter(function (x) { return x.lineId === b.lineId && x.id !== b.id; }).sort(function (a, c) { return natural(a.name, c.name); });
    var opts = targets.map(function (x) { return { value: x.id, label: x.name }; });
    opts.push({ value: "", label: "No box (take out of this line)" });
    openForm({
      title: "Move bricks out of " + b.name,
      submitLabel: "Move bricks",
      fields: [
        { name: "bricks", label: "Bricks to move", type: "checks", required: true, requiredMsg: "Select at least one brick.", options: b.brickItems.map(function (x) { return { value: x.id, label: x.name }; }) },
        { name: "target", label: "Move to box", type: "select", options: opts },
        dateField()
      ],
      onSubmit: async function (v) {
        var r = await sb.rpc("move_bricks", { p_brick_ids: v.bricks.map(Number), p_line_id: b.lineId, p_box_id: v.target ? Number(v.target) : null, p_date: v.date });
        if (r.error) throw r.error;
        await refreshMapping();
        toast(v.bricks.length + (v.bricks.length === 1 ? " brick moved." : " bricks moved.") + effectiveNote(v.date));
      }
    });
  }

  function addBricks(b) {
    openForm({
      title: "Add bricks to " + b.name,
      intro: "A brick that belongs to another box in this line moves here from the date. A new brick name is created.",
      submitLabel: "Add bricks",
      fields: [
        { name: "names", label: "Brick names", type: "textarea", required: true, hint: "One per line." },
        dateField()
      ],
      onSubmit: async function (v) {
        var names = [];
        v.names.split(/\r?\n|,/).forEach(function (n) { n = n.trim(); if (n && names.indexOf(n) === -1) names.push(n); });
        if (!names.length) throw new Error("Enter at least one brick name.");
        var ex = await sb.from("bricks").select("id, name").in("name", names);
        if (ex.error) throw ex.error;
        var have = {};
        ex.data.forEach(function (x) { have[x.name] = x.id; });
        var missing = names.filter(function (n) { return !(n in have); });
        var created = 0;
        if (missing.length) {
          var ins = await sb.from("bricks").insert(missing.map(function (n) { return { name: n }; })).select("id, name");
          if (ins.error) throw ins.error;
          ins.data.forEach(function (x) { have[x.name] = x.id; });
          created = ins.data.length;
        }
        var ids = names.map(function (n) { return have[n]; });
        var r = await sb.rpc("move_bricks", { p_brick_ids: ids, p_line_id: b.lineId, p_box_id: b.id, p_date: v.date });
        if (r.error) throw r.error;
        await refreshMapping();
        toast(ids.length + (ids.length === 1 ? " brick added" : " bricks added") + (created ? " (" + created + " new)." : ".") + effectiveNote(v.date));
      }
    });
  }

  function addBox() {
    withRefs(function () {
      var line = state.lineId;
      var districts = state.geo.districts.slice().sort(function (a, c) { return natural(a.name, c.name); });
      openForm({
        title: "Add box to " + lineName(line),
        submitLabel: "Add box",
        dupMsg: "This line already has a box with that name.",
        fields: [
          { name: "name", label: "Box name", required: true },
          { name: "district", label: "District", type: "select", options: districts.map(function (d) { return { value: d.id, label: d.name + (d.regions ? " - " + d.regions.name : "") }; }).concat([{ value: "", label: "A new district (fill in below)" }]) },
          { name: "new_district", label: "New district name", hint: "Only if the district is not in the list above." },
          { name: "region", label: "Region of the new district", type: "select", options: state.geo.regions.map(function (r) { return { value: r.id, label: r.name }; }) },
          { name: "rep", label: "Rep", type: "select", options: peopleOptions(line, null, { none: "Not assigned yet" }) },
          { name: "manager", label: "Manager", type: "select", options: peopleOptions(line, null, { none: "No manager" }) },
          dateField("Starts on")
        ],
        onSubmit: async function (v) {
          var districtId = v.district ? Number(v.district) : null;
          if (v.new_district) {
            var d = await sb.from("districts").insert({ region_id: Number(v.region), name: v.new_district }).select("id").single();
            if (d.error) throw d.error;
            districtId = d.data.id;
            state.geo = null;
          }
          if (!districtId) throw new Error("Choose a district, or type the name of a new one.");
          var r = await sb.rpc("add_box", { p_line_id: line, p_district_id: districtId, p_name: v.name, p_box_code: v.name + " " + lineName(line), p_rep_id: v.rep ? Number(v.rep) : null, p_manager_id: v.manager ? Number(v.manager) : null, p_date: v.date });
          if (r.error) throw r.error;
          await refreshMapping();
          toast("Box added.");
        }
      });
    });
  }

  /* ---------- people view ---------- */
  function personBoxes(id) {
    var n = 0;
    state.boxes.forEach(function (b) {
      if ((b.rep && b.rep.id === id) || (b.manager && b.manager.id === id)) n++;
    });
    return n;
  }

  function renderPeople() {
    var box = $("e-tabs");
    box.textContent = "";
    [{ id: "all", code: "All" }].concat(state.lines).forEach(function (l) {
      var btn = el("button", { type: "button", role: "tab", text: l.code, "aria-selected": String(l.id === state.eLine) });
      btn.addEventListener("click", function () { state.eLine = l.id; renderPeople(); });
      box.appendChild(btn);
    });
    var q = state.eq.trim().toLowerCase();
    var rows = state.employees.filter(function (e) {
      if (state.eLine !== "all" && e.line_id !== state.eLine) return false;
      if (state.eShow === "active" && e.status === "In Active") return false;
      if (state.eShow === "resigned" && e.status !== "In Active") return false;
      if (!q) return true;
      return [e.full_name, e.arabic_name || "", e.title || ""].join(" ").toLowerCase().indexOf(q) !== -1;
    });
    var real = rows.filter(function (e) { return !e.is_vacant; });
    renderStats("e-stats", [["People shown", real.length], ["Vacant placeholders", rows.length - real.length], ["Resigned", rows.filter(function (e) { return e.status === "In Active"; }).length]]);
    var body = $("people-body");
    body.textContent = "";
    $("e-empty").hidden = rows.length > 0;
    rows.forEach(function (e) {
      var tr = el("tr", { class: "row static" });
      var nm = el("td", { class: "name" }, [document.createTextNode(e.full_name)]);
      if (e.is_vacant) nm.appendChild(el("span", { class: "badge", text: "Vacant" }));
      tr.appendChild(nm);
      tr.appendChild(el("td", { "data-label": "Title", text: e.title || "-" }));
      tr.appendChild(el("td", { "data-label": "Line", text: e.line_id ? lineName(e.line_id) : "-" }));
      var resigned = e.status === "In Active";
      tr.appendChild(el("td", { "data-label": "Status" }, [el("span", { class: "badge " + (resigned ? "off" : "ok"), text: resigned ? "Resigned " + (e.resignation_date || "") : "Active" })]));
      tr.appendChild(el("td", { class: "num", "data-label": "Boxes now", text: String(personBoxes(e.id)) }));
      var act = el("td", { class: "act" });
      if (!e.is_vacant) {
        var b = el("button", { type: "button", class: "btn sm", "data-act": resigned ? "reactivate" : "resign", text: resigned ? "Reactivate" : "Mark resigned" });
        b.addEventListener("click", function () { resigned ? reactivatePerson(e) : resignPerson(e); });
        act.appendChild(b);
      }
      tr.appendChild(act);
      body.appendChild(tr);
    });
  }

  async function refreshPeople() {
    state.empLoaded = false;
    await loadEmployees();
    renderPeople();
  }

  function addPerson() {
    openForm({
      title: "Add person",
      submitLabel: "Add person",
      dupMsg: "Someone with this name already exists.",
      fields: [
        { name: "full_name", label: "Full name", required: true },
        { name: "arabic_name", label: "Arabic name", dir: "rtl" },
        { name: "title", label: "Title", hint: "For example: Medical Rep, Line Manager." },
        { name: "line_id", label: "Line", type: "select", options: [{ value: "", label: "No line" }].concat(state.lines.map(function (l) { return { value: l.id, label: l.code }; })) },
        { name: "hire_date", label: "Hire date", type: "date" }
      ],
      onSubmit: async function (v) {
        var r = await sb.from("employees").insert({
          full_name: v.full_name, arabic_name: v.arabic_name || null, title: v.title || null,
          line_id: v.line_id ? Number(v.line_id) : null, hire_date: v.hire_date || null,
          status: "Active", is_vacant: false
        });
        if (r.error) throw r.error;
        await refreshPeople();
        toast("Person added. Assign them to a box in Mapping.");
      }
    });
  }

  function resignPerson(e) {
    var n = personBoxes(e.id);
    openForm({
      title: "Mark " + e.full_name + " as resigned",
      intro: n ? e.full_name + " covers " + n + (n === 1 ? " box" : " boxes") + " today. Their boxes are not reassigned automatically; change them in Mapping." : "",
      submitLabel: "Mark resigned",
      fields: [{ name: "date", label: "Last working day", type: "date", required: true, value: todayStr() }],
      onSubmit: async function (v) {
        var r = await sb.from("employees").update({ status: "In Active", resignation_date: v.date }).eq("id", e.id);
        if (r.error) throw r.error;
        await refreshPeople();
        toast("Marked as resigned.");
      }
    });
  }

  function reactivatePerson(e) {
    openForm({
      title: "Reactivate " + e.full_name,
      intro: "They will be listed as active again and can be assigned to boxes.",
      submitLabel: "Reactivate",
      fields: [],
      onSubmit: async function () {
        var r = await sb.from("employees").update({ status: "Active", resignation_date: null }).eq("id", e.id);
        if (r.error) throw r.error;
        await refreshPeople();
        toast("Person reactivated.");
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
      el("th", { class: "num", text: "Approved price" }), el("th", { class: "num", text: "Public price" }),
      el("th", { class: "act", text: "" })
    ]);
    var body = el("tbody", {}, p.codes.map(function (c) {
      var edit = el("button", { type: "button", class: "btn sm", "data-act": "edit-code", "aria-label": "Edit item code " + c.item_id, text: "Edit" });
      edit.addEventListener("click", function () { editCode(p, c); });
      return el("tr", {}, [
        el("td", { text: String(c.item_id) }),
        el("td", { dir: "rtl", text: c.arabic_name || "-" }),
        el("td", { class: "num", text: money(c.approved_price) }),
        el("td", { class: "num", text: money(c.public_price) }),
        el("td", { class: "act" }, [edit])
      ]);
    }));
    return el("div", { class: "scroll" }, [el("table", { class: "codes" }, [el("thead", {}, [head]), body])]);
  }

  function productActions(p) {
    function btn(label, act, fn) {
      var b = el("button", { type: "button", class: "btn sm", "data-act": act, text: label });
      b.addEventListener("click", fn);
      return b;
    }
    return el("div", { class: "actions" }, [
      btn("Rename", "rename", function () { renameProduct(p); }),
      btn("Add item code", "add-code", function () { addCode(p); }),
      btn("Add to another line", "copy-line", function () { copyToLine(p); }),
      btn(p.active ? "Mark discontinued" : "Reactivate", "toggle", function () { toggleProduct(p); })
    ]);
  }

  /* ---------- products: edit actions ---------- */
  async function refreshProducts() {
    state.prodLoaded = false;
    await loadProducts();
    renderProducts();
  }

  function lineName(id) {
    var l = state.lines.filter(function (x) { return x.id === id; })[0];
    return l ? l.code : "";
  }

  function numOrNull(v) { return v === "" ? null : Number(v); }

  function codeFields(opts) {
    var req = !!opts.required;
    return [
      { name: "item_id", label: "Item ID", required: req, value: opts.item_id, readonly: !!opts.lockId, hint: opts.lockId ? "The item ID cannot be changed because sales are matched by it." : "Each item ID can belong to only one product." },
      { name: "arabic_name", label: "Arabic name", dir: "rtl", value: opts.arabic_name },
      { name: "approved_price", label: "Approved price", type: "number", value: opts.approved_price },
      { name: "public_price", label: "Public price", type: "number", value: opts.public_price }
    ];
  }

  function codeRow(productId, v) {
    return {
      item_id: v.item_id, product_id: productId,
      arabic_name: v.arabic_name || null,
      approved_price: numOrNull(v.approved_price), public_price: numOrNull(v.public_price)
    };
  }

  function addProduct() {
    var line = state.lineId;
    openForm({
      title: "Add product to " + lineName(line),
      submitLabel: "Add product",
      dupMsg: "This line already has a product with that name, or the item ID is already used.",
      fields: [{ name: "name", label: "Product name", required: true }].concat(codeFields({ required: false })),
      onSubmit: async function (v) {
        var r = await sb.from("products").insert({ line_id: line, name: v.name, is_active: true }).select("id").single();
        if (r.error) throw r.error;
        if (v.item_id) {
          var c = await sb.from("product_codes").insert(codeRow(r.data.id, v));
          if (c.error) {
            await refreshProducts();
            $("app-error").textContent = "The product was added, but its item code was not: " + friendly(c.error, "that item ID is already used by another product.");
            return;
          }
        }
        await refreshProducts();
        toast("Product added.");
      }
    });
  }

  function renameProduct(p) {
    openForm({
      title: "Rename product", submitLabel: "Save name",
      dupMsg: "This line already has a product with that name.",
      fields: [{ name: "name", label: "Product name", required: true, value: p.name }],
      onSubmit: async function (v) {
        var r = await sb.from("products").update({ name: v.name }).eq("id", p.id);
        if (r.error) throw r.error;
        await refreshProducts();
        toast("Name saved.");
      }
    });
  }

  function toggleProduct(p) {
    var to = !p.active;
    openForm({
      title: to ? "Reactivate " + p.name : "Mark " + p.name + " as discontinued",
      intro: to ? "The product will count as active again." : "The product and its item codes stay in the system so old sales keep their names. Nothing is deleted.",
      submitLabel: to ? "Reactivate" : "Mark discontinued",
      fields: [],
      onSubmit: async function () {
        var r = await sb.from("products").update({ is_active: to }).eq("id", p.id);
        if (r.error) throw r.error;
        await refreshProducts();
        toast(to ? "Product reactivated." : "Product marked discontinued.");
      }
    });
  }

  function addCode(p) {
    openForm({
      title: "Add item code to " + p.name, submitLabel: "Add item code",
      dupMsg: "This item ID is already used by a product.",
      fields: codeFields({ required: true }),
      onSubmit: async function (v) {
        var r = await sb.from("product_codes").insert(codeRow(p.id, v));
        if (r.error) throw r.error;
        state.popen[p.id] = true;
        await refreshProducts();
        toast("Item code added.");
      }
    });
  }

  function editCode(p, c) {
    openForm({
      title: "Edit item code " + c.item_id, submitLabel: "Save changes",
      fields: codeFields({ lockId: true, required: true, item_id: c.item_id, arabic_name: c.arabic_name, approved_price: c.approved_price, public_price: c.public_price }),
      onSubmit: async function (v) {
        var r = await sb.from("product_codes").update({
          arabic_name: v.arabic_name || null,
          approved_price: numOrNull(v.approved_price), public_price: numOrNull(v.public_price)
        }).eq("item_id", c.item_id);
        if (r.error) throw r.error;
        await refreshProducts();
        toast("Item code saved.");
      }
    });
  }

  function copyToLine(p) {
    var others = state.lines.filter(function (l) { return l.id !== p.lineId; });
    if (!others.length) { $("app-error").textContent = "There is no other line to add this product to. Add a line first."; return; }
    openForm({
      title: "Add " + p.name + " to another line",
      intro: "This creates a separate product in the other line, with its own sales and reports. Item IDs cannot be shared, so add the new line's own item ID if it has one.",
      submitLabel: "Add to line",
      dupMsg: "That line already has a product with this name, or the item ID is already used.",
      fields: [
        { name: "line_id", label: "Line", type: "select", required: true, options: others.map(function (l) { return { value: l.id, label: l.code }; }) },
        { name: "name", label: "Product name", required: true, value: p.name }
      ].concat(codeFields({ required: false })),
      onSubmit: async function (v) {
        var target = Number(v.line_id);
        var r = await sb.from("products").insert({ line_id: target, name: v.name, is_active: true }).select("id").single();
        if (r.error) throw r.error;
        if (v.item_id) {
          var c = await sb.from("product_codes").insert(codeRow(r.data.id, v));
          if (c.error) {
            await refreshProducts();
            $("app-error").textContent = "The product was added to " + lineName(target) + ", but its item code was not: " + friendly(c.error, "that item ID is already used by another product.");
            return;
          }
        }
        await refreshProducts();
        toast("Added to " + lineName(target) + ".");
      }
    });
  }

  function addLine() {
    var next = state.lines.reduce(function (m, l) { return Math.max(m, l.sort_order || 0); }, 0) + 1;
    openForm({
      title: "Add line", submitLabel: "Add line",
      intro: "Then add its products in Products and its reps in Mapping.",
      dupMsg: "A line with this name already exists.",
      fields: [
        { name: "code", label: "Line name", required: true, hint: "For example: CIRA 4" },
        { name: "copy", label: "Start from the boxes and bricks of", type: "select", options: [{ value: "", label: "Nothing (empty line)" }].concat(state.lines.map(function (l) { return { value: l.id, label: l.code }; })), hint: "Copies the boxes and brick distribution only, not reps or managers." },
        { name: "date", label: "Copied mapping starts on", type: "date", value: nextMonthStart() }
      ],
      onSubmit: async function (v) {
        if (v.copy && !v.date) throw new Error("Choose the date the copied mapping starts on.");
        var r = await sb.from("lines").insert({ code: v.code, sort_order: next, is_active: true }).select("id").single();
        if (r.error) throw r.error;
        var failed = "";
        if (v.copy) {
          var c = await sb.rpc("copy_line_structure", { p_src_line: Number(v.copy), p_dst_line: r.data.id, p_date: v.date });
          if (c.error) failed = friendly(c.error);
        }
        state.lines = [];
        await loadLines();
        state.lineId = r.data.id;
        state.mapLoaded = false;
        state.prodLoaded = false;
        await route();
        if (failed) $("app-error").textContent = "The line was added, but its boxes were not copied: " + failed;
        else toast(v.copy ? "Line added with its boxes and bricks." : "Line added.");
      }
    });
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
      if (state.popen[p.id]) body.appendChild(el("tr", { class: "detail" }, [el("td", { colspan: "3" }, [productActions(p), codesTable(p)])]));
    });
  }

  /* ---------- import from Excel ---------- */
  function str(v) { return v === null || v === undefined ? "" : String(v).trim(); }
  function key(v) { return str(v).toLowerCase(); }
  function numOrNaN(v) { var t = str(v); return t === "" ? null : Number(t.replace(/,/g, "")); }
  function toISO(v) {
    if (v instanceof Date && !isNaN(v)) return new Date(v.getTime() + 12 * 3600e3).toISOString().slice(0, 10);
    if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400e3) + 12 * 3600e3).toISOString().slice(0, 10);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(v));
    return m ? m[1] + "-" + m[2] + "-" + m[3] : "";
  }

  async function fetchAll(table, cols) {
    var out = [], from = 0, step = 1000;
    for (;;) {
      var r = await sb.from(table).select(cols).order("id").range(from, from + step - 1);
      if (r.error) throw r.error;
      out = out.concat(r.data);
      if (r.data.length < step) break;
      from += step;
    }
    return out;
  }

  function parseSheet(wb, spec) {
    for (var i = 0; i < wb.SheetNames.length; i++) {
      var ws = wb.Sheets[wb.SheetNames[i]];
      var aoa = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true, blankrows: false });
      if (!aoa.length) continue;
      var hdr = aoa[0].map(function (h) { return key(h); });
      var idx = {}, good = true;
      Object.keys(spec).forEach(function (k) {
        var pos = -1;
        spec[k].names.forEach(function (n) { if (pos < 0) pos = hdr.indexOf(n); });
        idx[k] = pos;
        if (pos < 0 && spec[k].req) good = false;
      });
      if (!good) continue;
      var rows = aoa.slice(1).filter(function (r) { return r.some(function (c) { return str(c) !== ""; }); }).map(function (r) {
        var o = {};
        Object.keys(spec).forEach(function (k) { o[k] = idx[k] >= 0 ? r[idx[k]] : ""; });
        return o;
      });
      return { rows: rows, sheet: wb.SheetNames[i] };
    }
    return null;
  }

  function readFile(file, spec) {
    return new Promise(function (resolve, reject) {
      if (!window.XLSX) { reject(new Error("The Excel reader did not load. Check your connection and reload the page.")); return; }
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error("Could not read this file.")); };
      fr.onload = function () {
        try {
          var wb = window.XLSX.read(fr.result, { type: "array", cellDates: true });
          var res = parseSheet(wb, spec);
          if (!res) {
            var need = Object.keys(spec).filter(function (k) { return spec[k].req; }).map(function (k) { return spec[k].names[0]; });
            reject(new Error("No sheet in this file has the columns: " + need.join(", ") + "."));
          } else resolve(res);
        } catch (e) { reject(new Error("This file could not be opened as an Excel file.")); }
      };
      fr.readAsArrayBuffer(file);
    });
  }

  function chunk(list, n) {
    var out = [];
    for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
  }

  function skippedWarnings(skipped) {
    return Object.keys(skipped).map(function (k) {
      return "Skipped " + skipped[k].n + " row" + (skipped[k].n === 1 ? "" : "s") + " for line \"" + skipped[k].name + "\", which is not in the system.";
    });
  }
  function skipLine(skipped, name) {
    var k = key(name);
    if (!skipped[k]) skipped[k] = { name: name, n: 0 };
    skipped[k].n++;
  }

  /* -- bricks: columns System Brick, Line, Box -- */
  var BRICK_SPEC = {
    brick: { names: ["system brick", "brick"], req: true },
    line: { names: ["line"], req: true },
    box: { names: ["box"], req: true }
  };

  function planBricks(rows, ctx) {
    var lineByCode = {};
    ctx.lines.forEach(function (l) { lineByCode[key(l.code)] = l; });
    var boxKey = {};
    ctx.boxes.forEach(function (b) { boxKey[b.lineId + "|" + key(b.name)] = b; });
    var errors = [], desired = {}, inFile = {}, seen = {}, skipped = {};
    rows.forEach(function (r, i) {
      var n = i + 2, brick = str(r.brick), lc = str(r.line), bx = str(r.box);
      if (!brick || !lc || !bx) { errors.push("Row " + n + ": brick, line and box are all required."); return; }
      var line = lineByCode[key(lc)];
      if (!line) { skipLine(skipped, lc); return; }
      var box = boxKey[line.id + "|" + key(bx)];
      if (!box) { errors.push("Row " + n + ": " + line.code + " has no box named \"" + bx + "\". Add the box first."); return; }
      var k = line.id + "|" + key(brick);
      if (seen[k] && seen[k] !== box.id) { errors.push("Row " + n + ": brick \"" + brick + "\" is listed under two different boxes in " + line.code + "."); return; }
      seen[k] = box.id;
      inFile[line.id] = line;
      (desired[line.id] = desired[line.id] || {})[key(brick)] = { name: brick, boxId: box.id, boxName: box.name };
    });
    var cur = {};
    ctx.boxes.forEach(function (b) {
      cur[b.lineId] = cur[b.lineId] || {};
      b.brickItems.forEach(function (it) { cur[b.lineId][key(it.name)] = { id: it.id, name: it.name, boxId: b.id, boxName: b.name }; });
    });
    var moves = [], adds = [], removals = [], unchanged = 0, newNames = {};
    Object.keys(inFile).forEach(function (lid) {
      var line = inFile[lid], d = desired[lid], c = cur[lid] || {};
      Object.keys(d).forEach(function (k) {
        var x = d[k], cx = c[k];
        if (cx) {
          if (cx.boxId === x.boxId) unchanged++;
          else moves.push({ lineId: line.id, line: line.code, brick: x.name, id: cx.id, from: cx.boxName, toId: x.boxId, to: x.boxName });
        } else {
          var id = ctx.brickIds[k] || null;
          if (!id) newNames[k] = x.name;
          adds.push({ lineId: line.id, line: line.code, brick: x.name, key: k, id: id, from: "(not mapped)", toId: x.boxId, to: x.boxName });
        }
      });
      if (ctx.removeMissing) {
        Object.keys(c).forEach(function (k) {
          if (!d[k]) removals.push({ lineId: line.id, line: line.code, brick: c[k].name, id: c[k].id, from: c[k].boxName, to: "(taken out)" });
        });
      }
    });
    var newCount = Object.keys(newNames).length;
    return {
      errors: errors,
      warnings: skippedWarnings(skipped),
      summary: [["Already correct", unchanged], ["Moves", moves.length], ["Bricks to map", adds.length], ["New bricks", newCount], ["Taken out", removals.length]],
      changes: moves.length + adds.length + removals.length,
      details: [
        { title: "Moves between boxes", rows: moves },
        { title: "Bricks to map", rows: adds },
        { title: "Taken out of the line", rows: removals }
      ],
      apply: async function (date) {
        var ids = {};
        var names = Object.keys(newNames).map(function (k) { return newNames[k]; });
        for (var c1 = 0, parts = chunk(names, 200); c1 < parts.length; c1++) {
          var ins = await sb.from("bricks").insert(parts[c1].map(function (n) { return { name: n }; })).select("id, name");
          if (ins.error) throw ins.error;
          ins.data.forEach(function (x) { ids[key(x.name)] = x.id; });
        }
        var groups = {};
        moves.concat(adds).forEach(function (m) {
          var id = m.id || ids[m.key || key(m.brick)];
          var g = m.lineId + "|" + m.toId;
          (groups[g] = groups[g] || { lineId: m.lineId, boxId: m.toId, ids: [] }).ids.push(id);
        });
        var gk = Object.keys(groups);
        for (var i = 0; i < gk.length; i++) {
          var g = groups[gk[i]];
          var r = await sb.rpc("move_bricks", { p_brick_ids: g.ids, p_line_id: g.lineId, p_box_id: g.boxId, p_date: date });
          if (r.error) throw r.error;
        }
        var out = {};
        removals.forEach(function (m) { (out[m.lineId] = out[m.lineId] || []).push(m.id); });
        var ok = Object.keys(out);
        for (var j = 0; j < ok.length; j++) {
          var r2 = await sb.rpc("move_bricks", { p_brick_ids: out[ok[j]], p_line_id: Number(ok[j]), p_box_id: null, p_date: date });
          if (r2.error) throw r2.error;
        }
      }
    };
  }

  /* -- reps allocation: Line, Box, Medical Rep, Direct Manager (+ Region, District, Box ID for new boxes) -- */
  var ALLOC_SPEC = {
    line: { names: ["line"], req: true },
    box: { names: ["box"], req: true },
    rep: { names: ["medical rep", "rep"], req: true },
    manager: { names: ["direct manager", "manager"], req: true },
    region: { names: ["region"], req: false },
    district: { names: ["district"], req: false },
    code: { names: ["box id", "box code"], req: false },
    rep_hire: { names: ["rep hiring date"], req: false },
    mgr_hire: { names: ["manager hiring date"], req: false }
  };

  function planAllocation(rows, ctx) {
    var lineByCode = {};
    ctx.lines.forEach(function (l) { lineByCode[key(l.code)] = l; });
    var boxKey = {};
    ctx.boxes.forEach(function (b) { boxKey[b.lineId + "|" + key(b.name)] = b; });
    var emp = {};
    ctx.employees.forEach(function (e) { emp[key(e.full_name)] = e; });
    var errors = [], warnings = [], newPeople = {}, newBoxes = [], changes = [], unchanged = 0, seen = {}, warned = {}, skipped = {};
    function person(name, role, line, hire) {
      var k = key(name);
      if (emp[k]) {
        if (emp[k].status === "In Active" && !warned[k]) { warned[k] = 1; warnings.push(name + " is marked as resigned but is listed in this file."); }
        return { key: k, id: emp[k].id };
      }
      if (!newPeople[k]) {
        var vac = k.indexOf("vacant") === 0;
        newPeople[k] = { name: name, lineId: line.id, line: line.code, title: role, hire: hire || null, vacant: vac };
      }
      return { key: k, id: null };
    }
    rows.forEach(function (r, i) {
      var n = i + 2, lc = str(r.line), bn = str(r.box), rn = str(r.rep), mn = str(r.manager);
      if (!lc || !bn || !rn) { errors.push("Row " + n + ": line, box and medical rep are required."); return; }
      var line = lineByCode[key(lc)];
      if (!line) { skipLine(skipped, lc); return; }
      var sk = line.id + "|" + key(bn);
      if (seen[sk]) { errors.push("Row " + n + ": box \"" + bn + "\" appears twice in " + line.code + "."); return; }
      seen[sk] = 1;
      var box = boxKey[sk];
      var region = str(r.region), district = str(r.district);
      if (!box && !(region && district)) { errors.push("Row " + n + ": " + line.code + " has no box named \"" + bn + "\". To create it, fill in Region and District."); return; }
      var rp = person(rn, "Medical Rep", line, toISO(r.rep_hire));
      var mg = mn ? person(mn, "FLM", line, toISO(r.mgr_hire)) : null;
      if (!box) {
        newBoxes.push({ line: line, lineId: line.id, name: bn, code: str(r.code) || (bn + " " + line.code), region: region, district: district, rep: rp, mgr: mg, repName: rn, mgrName: mn });
        return;
      }
      var cr = box.rep ? box.rep.id : null, cm = box.manager ? box.manager.id : null;
      var sameRep = rp.id !== null && rp.id === cr;
      var sameMgr = mg ? (mg.id !== null && mg.id === cm) : cm === null;
      if (sameRep && sameMgr) { unchanged++; return; }
      changes.push({ line: line.code, box: bn, boxId: box.id, rep: rp, mgr: mg,
        from: (box.rep ? box.rep.full_name : "-") + " / " + (box.manager ? box.manager.full_name : "-"),
        to: rn + " / " + (mn || "-") });
    });
    var people = Object.keys(newPeople).map(function (k) { return newPeople[k]; });
    return {
      errors: errors,
      warnings: skippedWarnings(skipped).concat(warnings),
      summary: [["Already correct", unchanged], ["Boxes changed", changes.length], ["New boxes", newBoxes.length], ["New people", people.length]],
      changes: changes.length + newBoxes.length,
      details: [
        { title: "Rep / manager changes", rows: changes.map(function (c) { return { line: c.line, brick: c.box, from: c.from, to: c.to }; }) },
        { title: "New boxes", rows: newBoxes.map(function (b) { return { line: b.line.code, brick: b.name, from: b.region + " / " + b.district, to: b.repName + " / " + (b.mgrName || "-") }; }) },
        { title: "People to create", rows: people.map(function (p) { return { line: p.line, brick: p.name, from: p.title, to: p.vacant ? "Vacant placeholder" : "Active" }; }) }
      ],
      detailHeads: ["Line", "Box", "Now", "After"],
      apply: async function (date) {
        var ids = {};
        for (var c1 = 0, parts = chunk(people, 100); c1 < parts.length; c1++) {
          var ins = await sb.from("employees").insert(parts[c1].map(function (p) {
            return { full_name: p.name, title: p.title, line_id: p.lineId, hire_date: p.hire, status: p.vacant ? null : "Active", is_vacant: p.vacant };
          })).select("id, full_name");
          if (ins.error) throw ins.error;
          ins.data.forEach(function (x) { ids[key(x.full_name)] = x.id; });
        }
        function pid(p) { return p ? (p.id !== null ? p.id : ids[p.key]) : null; }
        if (newBoxes.length) { await loadGeo(); }
        for (var i = 0; i < newBoxes.length; i++) {
          var b = newBoxes[i];
          var region = state.geo.regions.filter(function (x) { return key(x.name) === key(b.region); })[0];
          if (!region) {
            var rr = await sb.from("regions").insert({ name: b.region }).select("id, name").single();
            if (rr.error) throw rr.error;
            region = { id: rr.data.id, name: b.region };
            state.geo.regions.push(region);
          }
          var dist = state.geo.districts.filter(function (x) { return x.region_id === region.id && key(x.name) === key(b.district); })[0];
          if (!dist) {
            var dd = await sb.from("districts").insert({ region_id: region.id, name: b.district }).select("id").single();
            if (dd.error) throw dd.error;
            dist = { id: dd.data.id, name: b.district, region_id: region.id };
            state.geo.districts.push(dist);
          }
          var rb = await sb.rpc("add_box", { p_line_id: b.lineId, p_district_id: dist.id, p_name: b.name, p_box_code: b.code, p_rep_id: pid(b.rep), p_manager_id: pid(b.mgr), p_date: date });
          if (rb.error) throw rb.error;
        }
        for (var j = 0; j < changes.length; j++) {
          var c = changes[j];
          var rc = await sb.rpc("change_box_assignment", { p_box_id: c.boxId, p_rep_id: pid(c.rep), p_manager_id: pid(c.mgr), p_date: date });
          if (rc.error) throw rc.error;
        }
      }
    };
  }

  /* -- products: Item ID, Item Arabic Name, Item English Name, Line, Approved Price, Public Price -- */
  var PRODUCT_SPEC = {
    item_id: { names: ["item id"], req: true },
    ar: { names: ["item arabic name", "arabic name"], req: false },
    en: { names: ["item english name", "product", "english name"], req: true },
    line: { names: ["line"], req: true },
    approved: { names: ["approved price"], req: false },
    pub: { names: ["public price"], req: false }
  };

  function planProducts(rows, ctx) {
    var lineByCode = {};
    ctx.lines.forEach(function (l) { lineByCode[key(l.code)] = l; });
    var prod = {};
    ctx.products.forEach(function (p) { prod[p.lineId + "|" + key(p.name)] = p; });
    var codes = {};
    ctx.products.forEach(function (p) { p.codes.forEach(function (c) { codes[String(c.item_id)] = { code: c, product: p }; }); });
    var errors = [], newProducts = {}, newCodes = [], updates = [], unchanged = 0, seen = {}, skipped = {};
    function same(a, b) { return (a === null || a === undefined || a === "") ? (b === null || b === undefined || b === "") : Number(a) === Number(b); }
    rows.forEach(function (r, i) {
      var n = i + 2, id = str(r.item_id), en = str(r.en), lc = str(r.line);
      if (!id || !en || !lc) { errors.push("Row " + n + ": item ID, English name and line are required."); return; }
      var line = lineByCode[key(lc)];
      if (!line) { skipLine(skipped, lc); return; }
      if (seen[id]) { errors.push("Row " + n + ": item ID " + id + " appears twice in the file."); return; }
      seen[id] = 1;
      var ap = numOrNaN(r.approved), pu = numOrNaN(r.pub);
      if (ap !== null && isNaN(ap) || pu !== null && isNaN(pu)) { errors.push("Row " + n + ": prices must be numbers."); return; }
      var ar = str(r.ar);
      var pk = line.id + "|" + key(en);
      var p = prod[pk];
      var ex = codes[id];
      if (ex) {
        if (!p || ex.product.id !== p.id) { errors.push("Row " + n + ": item ID " + id + " already belongs to \"" + ex.product.name + "\" (" + lineName(ex.product.lineId) + ")."); return; }
        var patch = {};
        if (ar && ar !== (ex.code.arabic_name || "")) patch.arabic_name = ar;
        if (ap !== null && !same(ex.code.approved_price, ap)) patch.approved_price = ap;
        if (pu !== null && !same(ex.code.public_price, pu)) patch.public_price = pu;
        if (Object.keys(patch).length) updates.push({ id: id, patch: patch, line: line.code, name: en });
        else unchanged++;
        return;
      }
      if (!p && !newProducts[pk]) newProducts[pk] = { lineId: line.id, line: line.code, name: en };
      newCodes.push({ item_id: id, pk: pk, productId: p ? p.id : null, arabic_name: ar || null, approved_price: ap, public_price: pu, line: line.code, name: en });
    });
    var np = Object.keys(newProducts).map(function (k) { return newProducts[k]; });
    return {
      errors: errors,
      warnings: skippedWarnings(skipped),
      summary: [["Already correct", unchanged], ["New products", np.length], ["New item codes", newCodes.length], ["Codes updated", updates.length]],
      changes: np.length + newCodes.length + updates.length,
      details: [
        { title: "New products", rows: np.map(function (p) { return { line: p.line, brick: p.name, from: "", to: "" }; }) },
        { title: "New item codes", rows: newCodes.map(function (c) { return { line: c.line, brick: c.name, from: c.item_id, to: money(c.approved_price) + " / " + money(c.public_price) }; }) },
        { title: "Codes updated", rows: updates.map(function (u) { return { line: u.line, brick: u.name, from: u.id, to: Object.keys(u.patch).join(", ") }; }) }
      ],
      detailHeads: ["Line", "Product", "Item ID", "Prices / change"],
      apply: async function () {
        var ids = {};
        for (var c1 = 0, parts = chunk(np, 100); c1 < parts.length; c1++) {
          var ins = await sb.from("products").insert(parts[c1].map(function (p) { return { line_id: p.lineId, name: p.name, is_active: true }; })).select("id, name, line_id");
          if (ins.error) throw ins.error;
          ins.data.forEach(function (x) { ids[x.line_id + "|" + key(x.name)] = x.id; });
        }
        var rowsOut = newCodes.map(function (c) {
          return { item_id: c.item_id, product_id: c.productId !== null ? c.productId : ids[c.pk], arabic_name: c.arabic_name, approved_price: c.approved_price, public_price: c.public_price };
        });
        for (var c2 = 0, p2 = chunk(rowsOut, 200); c2 < p2.length; c2++) {
          var r = await sb.from("product_codes").insert(p2[c2]);
          if (r.error) throw r.error;
        }
        for (var i = 0; i < updates.length; i++) {
          var u = await sb.from("product_codes").update(updates[i].patch).eq("item_id", updates[i].id);
          if (u.error) throw u.error;
        }
      }
    };
  }

  /* -- import screen -- */
  var IMPORTERS = [
    {
      id: "bricks", title: "Brick mapping", spec: BRICK_SPEC, needsDate: true,
      desc: "Columns: System Brick, Line, Box. Boxes must already exist. Each line in the file is compared with the current mapping, and only the differences are saved.",
      options: [{ id: "remove", label: "Take out bricks that are not in the file (for the lines in the file)", on: false }],
      context: async function (date, opts) {
        await loadLines();
        state.mapLoaded = false; await loadMapping();
        var all = await fetchAll("bricks", "id, name");
        var ids = {};
        all.forEach(function (b) { ids[key(b.name)] = b.id; });
        return { lines: state.lines, boxes: normalizeBoxes(state.rawBoxes, date), brickIds: ids, removeMissing: !!opts.remove };
      },
      plan: planBricks
    },
    {
      id: "alloc", title: "Reps and managers", spec: ALLOC_SPEC, needsDate: true,
      desc: "Columns: Line, Box, Medical Rep, Direct Manager. Add Region and District (and Box ID) to create boxes that do not exist yet. People that are not in the system are created.",
      options: [],
      context: async function (date) {
        await loadLines();
        state.mapLoaded = false; await loadMapping();
        state.empLoaded = false; await loadEmployees();
        state.geo = null; await loadGeo();
        return { lines: state.lines, boxes: normalizeBoxes(state.rawBoxes, date), employees: state.employees };
      },
      plan: planAllocation
    },
    {
      id: "products", title: "Products and item codes", spec: PRODUCT_SPEC, needsDate: false,
      desc: "Columns: Item ID, Item Arabic Name, Item English Name, Line, Approved Price, Public Price. New products and codes are added, and changed prices are updated. An item ID that belongs to another product is reported.",
      options: [],
      context: async function () {
        await loadLines();
        state.prodLoaded = false; await loadProducts();
        return { lines: state.lines, products: state.products };
      },
      plan: planProducts
    }
  ];

  function detailTable(d, heads) {
    var shown = d.rows.slice(0, 200);
    var h = heads || ["Line", "Brick", "From", "To"];
    var table = el("table", { class: "codes" }, [
      el("thead", {}, [el("tr", {}, h.map(function (x) { return el("th", { text: x }); }))]),
      el("tbody", {}, shown.map(function (r) {
        return el("tr", {}, [el("td", { text: r.line }), el("td", { text: r.brick }), el("td", { text: r.from }), el("td", { text: r.to })]);
      }))
    ]);
    var box = el("details", { class: "dt" }, [el("summary", { text: d.title + " (" + d.rows.length + ")" }), el("div", { class: "scroll" }, [table])]);
    if (d.rows.length > shown.length) box.appendChild(el("p", { class: "muted", text: "Showing the first " + shown.length + " of " + d.rows.length + "." }));
    return box;
  }

  function buildImportCard(imp) {
    var card = el("div", { class: "panel wide", id: "imp-" + imp.id });
    card.appendChild(el("h2", { text: imp.title }));
    card.appendChild(el("p", { class: "muted", text: imp.desc }));
    var row = el("div", { class: "imp-row" });
    var file = el("input", { type: "file", accept: ".xlsx,.xls,.csv", "aria-label": "Choose a file for " + imp.title, "data-imp": "file" });
    row.appendChild(file);
    var date = null;
    if (imp.needsDate) {
      date = el("input", { type: "date", value: nextMonthStart(), "aria-label": "Effective from", "data-imp": "date" });
      row.appendChild(el("label", { class: "inline", text: "Effective from" }));
      row.appendChild(date);
    }
    card.appendChild(row);
    var opts = {};
    imp.options.forEach(function (o) {
      var cb = el("input", { type: "checkbox", "data-imp": "opt-" + o.id });
      cb.checked = !!o.on;
      opts[o.id] = cb;
      card.appendChild(el("label", { class: "optline" }, [cb, document.createTextNode(o.label)]));
    });
    var go = el("button", { type: "button", class: "btn accent", text: "Preview changes", "data-imp": "preview" });
    var msg = el("p", { class: "error", role: "alert" });
    var out = el("div", { class: "result" });
    card.appendChild(el("div", { class: "imp-row" }, [go]));
    card.appendChild(msg);
    card.appendChild(out);

    go.addEventListener("click", async function () {
      msg.textContent = ""; out.textContent = "";
      if (!file.files || !file.files[0]) { msg.textContent = "Choose an Excel file first."; return; }
      var d = date ? date.value : "";
      if (imp.needsDate && !d) { msg.textContent = "Choose the effective date."; return; }
      go.disabled = true; go.textContent = "Reading...";
      try {
        var parsed = await readFile(file.files[0], imp.spec);
        var o = {};
        Object.keys(opts).forEach(function (k) { o[k] = opts[k].checked; });
        var ctx = await imp.context(d, o);
        var plan = imp.plan(parsed.rows, ctx);
        renderPlan(out, imp, plan, d, parsed);
      } catch (e) {
        msg.textContent = friendly(e);
      }
      go.disabled = false; go.textContent = "Preview changes";
    });
    return card;
  }

  function renderPlan(out, imp, plan, date, parsed) {
    out.textContent = "";
    out.appendChild(el("p", { class: "muted", text: "Read " + parsed.rows.length + " rows from the sheet \"" + parsed.sheet + "\"." }));
    var stats = el("div", { class: "stats", style: "grid-template-columns: repeat(" + plan.summary.length + ", minmax(0, 1fr))" });
    plan.summary.forEach(function (s) {
      stats.appendChild(el("div", { class: "stat" }, [el("div", { class: "n", text: String(s[1]) }), el("div", { class: "l", text: s[0] })]));
    });
    out.appendChild(stats);
    if (plan.errors.length) {
      var shownErr = plan.errors.slice(0, 50);
      out.appendChild(el("p", { class: "error", text: plan.errors.length + " problem" + (plan.errors.length === 1 ? "" : "s") + " found. Fix the file and preview again." }));
      out.appendChild(el("ul", { class: "problems" }, shownErr.map(function (t) { return el("li", { text: t }); })));
      if (plan.errors.length > shownErr.length) out.appendChild(el("p", { class: "muted", text: "Showing the first " + shownErr.length + "." }));
    }
    if (plan.warnings.length) {
      out.appendChild(el("ul", { class: "problems warn" }, plan.warnings.slice(0, 20).map(function (t) { return el("li", { text: t }); })));
    }
    plan.details.forEach(function (d) { if (d.rows.length) out.appendChild(detailTable(d, plan.detailHeads)); });
    if (!plan.errors.length) {
      if (!plan.changes) { out.appendChild(el("p", { class: "muted", text: "Nothing to change. The system already matches this file." })); return; }
      var ap = el("button", { type: "button", class: "btn accent", text: "Apply changes", "data-imp": "apply" });
      ap.addEventListener("click", function () {
        openForm({
          title: "Apply " + imp.title.toLowerCase(),
          intro: plan.summary.filter(function (s) { return s[1] && s[0] !== "Already correct"; }).map(function (s) { return s[1] + " " + s[0].toLowerCase(); }).join(", ") + (imp.needsDate ? ". Takes effect on " + date + "; earlier months keep the old mapping." : "."),
          submitLabel: "Apply changes",
          fields: [],
          onSubmit: async function () {
            await plan.apply(date);
            state.mapLoaded = false; state.prodLoaded = false; state.empLoaded = false; state.geo = null;
            out.textContent = "";
            toast("Changes applied." + (imp.needsDate ? effectiveNote(date) : ""));
          }
        });
      });
      out.appendChild(el("div", { class: "imp-row" }, [ap]));
    }
  }

  var importBuilt = false;
  function renderImport() {
    if (importBuilt) return;
    importBuilt = true;
    var root = $("import-root");
    IMPORTERS.forEach(function (imp) { root.appendChild(buildImportCard(imp)); });
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
      "id, name, line_id, district_id, districts(name, regions(name)), " +
      "box_assignments(valid_from, valid_to, " +
      "rep:employees!box_assignments_rep_id_fkey(id, full_name, is_vacant), " +
      "manager:employees!box_assignments_manager_id_fkey(id, full_name, is_vacant)), " +
      "brick_box_map(valid_from, valid_to, bricks(id, name))"
    );
    if (b.error) throw b.error;
    state.rawBoxes = b.data;
    state.boxes = normalizeBoxes(state.rawBoxes, state.asOf);
    state.mapLoaded = true;
  }

  async function loadEmployees() {
    if (state.empLoaded) return;
    var e = await sb.from("employees").select("id, full_name, arabic_name, title, line_id, hire_date, resignation_date, status, is_vacant").order("full_name");
    if (e.error) throw e.error;
    state.employees = e.data;
    state.empLoaded = true;
  }

  async function loadGeo() {
    if (state.geo) return;
    var d = await sb.from("districts").select("id, name, region_id, regions(id, name)").order("name");
    if (d.error) throw d.error;
    var r = await sb.from("regions").select("id, name").order("name");
    if (r.error) throw r.error;
    state.geo = { districts: d.data, regions: r.data };
  }

  async function refreshMapping() {
    state.mapLoaded = false;
    await loadMapping();
    renderMapping();
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
    import: { title: "Import", load: null, render: renderImport },
    people: { title: "People", load: async function () { await loadLines(); await loadMapping(); await loadEmployees(); }, render: renderPeople },
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
    state.user = null; state.lines = []; state.boxes = []; state.rawBoxes = []; state.products = []; state.employees = []; state.geo = null;
    state.empLoaded = false; state.asOf = "";
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
  $("add-product").addEventListener("click", addProduct);
  $("add-box").addEventListener("click", addBox);
  $("add-line-m").addEventListener("click", addLine);
  $("add-person").addEventListener("click", addPerson);
  $("e-search").addEventListener("input", function (ev) { state.eq = ev.target.value; renderPeople(); });
  $("e-show").addEventListener("change", function (ev) { state.eShow = ev.target.value; renderPeople(); });
  $("as-of").addEventListener("change", function (ev) {
    state.asOf = ev.target.value;
    state.boxes = normalizeBoxes(state.rawBoxes, state.asOf);
    renderMapping();
  });
  $("add-line").addEventListener("click", addLine);

  (async function init() {
    try {
      var s = await sb.auth.getSession();
      if (s.data && s.data.session) await enter(s.data.session.user);
      else show("login-view");
    } catch (e) {
      show("login-view");
    }
  })();

  window.__salesHub = { normalizeBoxes: normalizeBoxes, isCurrent: isCurrent, planBricks: planBricks, planAllocation: planAllocation, planProducts: planProducts, toISO: toISO };
})();
