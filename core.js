// Shared player, canvas, theme and helpers for the race views. Each view registers itself with
// App.view({id, title, range(), mount(rail), draw(ctx, w, h, day, dt), hit(x, y), click(x, y), sub(day)}).
(function () {
  const R = window.RACE;
  const P = R.posts;
  P.n = P.day.length;
  R.T = P.day[P.n - 1];
  const T0 = Date.parse(R.t0 + "T00:00:00Z");
  const DAY = 86400000;

  // ---------------------------------------------------------------- helpers
  const U = {
    date: (day) => new Date(T0 + day * DAY),
    fmtDate(day, o = { day: "2-digit", month: "long", year: "numeric" }) {
      return U.date(day).toLocaleDateString("en-GB", { timeZone: "UTC", ...o });
    },
    fmtNum(n) {
      n = Math.round(n);
      if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M";
      if (Math.abs(n) >= 1e4) return Math.round(n / 1e3) + "K";
      return n.toLocaleString("en-US");
    },
    lowerBound(a, x) { // first index with a[i] >= x
      let lo = 0, hi = a.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; }
      return lo;
    },
    clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    rgba: (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`,
    // weight of a post of age `age` in a trailing window of `w` days whose edges fade over `t` days (sin² ramps)
    taper(age, w, t) {
      if (age < 0 || age > w) return 0;
      const e = Math.min(age, w - age);
      if (t <= 0 || e >= t) return 1;
      const s = Math.sin(Math.PI / 2 * e / t);
      return s * s;
    },
    esc: (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]),
    el(tag, attrs = {}, html) {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "on") for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn);
        else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
      }
      if (html !== undefined) e.innerHTML = html;
      return e;
    },
    // a labelled range slider; calls onInput(value) while dragging
    slider(parent, { id, label, min, max, step = 1, value, unit = "", onInput }) {
      const f = U.el("div", { class: "field" });
      const out = U.el("output", { for: id }, value + unit);
      const lab = U.el("label", { for: id }, label);
      const inp = U.el("input", { type: "range", id, min, max, step, value });
      inp.addEventListener("input", () => { out.textContent = inp.value + unit; onInput(+inp.value); });
      f.append(lab, out, inp);
      parent.append(f);
      return inp;
    },
    // segmented buttons; returns {set(v)}
    seg(parent, { label, options, value, onChange }) {
      const wrap = U.el("div", { role: "group", "aria-label": label, class: "seg" });
      const btns = options.map(([v, text]) => {
        const b = U.el("button", { type: "button", "aria-pressed": String(v === value) }, text);
        b.addEventListener("click", () => { set(v); onChange(v); });
        wrap.append(b);
        return [v, b];
      });
      const set = (v) => btns.forEach(([bv, b]) => b.setAttribute("aria-pressed", String(bv === v)));
      parent.append(wrap);
      return { set };
    },
    card(parent, title) {
      const c = U.el("div", { class: "card" });
      if (title) c.append(U.el("h2", {}, title));
      parent.append(c);
      return c;
    },
  };

  // accounts: derived fields
  R.accounts.forEach((a, i) => {
    a.i = i;
    a.blocIdx = R.blocs.indexOf(a.bloc);
    a.img = null;
  });
  const avatarCache = {};
  U.avatar = (a) => {
    if (!a.av) return null;
    if (!avatarCache[a.u]) {
      const im = new Image();
      im.onload = () => App.redraw();
      im.src = `avatars/${a.u}.jpg`;
      avatarCache[a.u] = im;
    }
    const im = avatarCache[a.u];
    return im.complete && im.naturalWidth ? im : null;
  };
  U.avatarSrc = (a) => (a.av ? `avatars/${a.u}.jpg` : null);
  U.blocColor = (i) => R.blocColors[i] || [150, 150, 150];

  // circular avatar with a coloured ring; falls back to a filled circle
  U.drawAvatar = (ctx, a, x, y, r, ring, alpha = 1, ringW = 3) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const im = U.avatar(a);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (im) {
      ctx.save();
      ctx.clip();
      ctx.drawImage(im, x - r, y - r, 2 * r, 2 * r);
      ctx.restore();
    } else {
      ctx.fillStyle = U.rgba(ring);
      ctx.fill();
    }
    ctx.lineWidth = ringW;
    ctx.strokeStyle = U.rgba(ring);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  };

  // theme colours for the canvas, read from the CSS tokens
  const C = {};
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of ["bg", "surface", "ink", "muted", "line", "grid", "arrow", "accent"]) C[k] = cs.getPropertyValue("--" + k).trim();
    C.font = cs.getPropertyValue("--font").trim();
    C.dark = cs.colorScheme === "dark" || matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light";
  }

  // ---------------------------------------------------------------- app
  const views = [];
  let cur = null;
  const S = { day: 0, playing: false, speed: 6, dirty: true };
  let cv, ctx, W = 0, H = 0, dpr = 1, tip, scrub, playBtn;

  const App = {
    R, U, C, S,
    view(v) { views.push(v); },
    redraw() { S.dirty = true; },
    get current() { return cur; },
    setDay(d) {
      const [a, b] = cur.range();
      S.day = U.clamp(d, a, b);
      scrub.value = S.day;
      S.dirty = true;
    },
    // re-read the view's timeline range (after a change of window length, say)
    rangeChanged() {
      const [a, b] = cur.range();
      scrub.min = a; scrub.max = b;
      App.setDay(S.day);
      drawTicks();
    },
    start() {
      readTheme();
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { readTheme(); App.redraw(); });
      new MutationObserver(() => { readTheme(); App.redraw(); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      if (document.fonts) document.fonts.ready.then(() => App.redraw());

      cv = document.getElementById("cv");
      ctx = cv.getContext("2d");
      tip = document.getElementById("tip");
      scrub = document.getElementById("scrub");
      playBtn = document.getElementById("play");
      document.getElementById("meta").textContent =
        `TikTok posts by Israeli politicians · ${P.n.toLocaleString("en-US")} posts, ${R.accounts.length} accounts · ` +
        `${U.fmtDate(0, { month: "short", year: "numeric" })} – ${U.fmtDate(R.T, { month: "short", year: "numeric" })}`;

      const tabs = document.getElementById("tabs");
      for (const v of views) {
        const b = U.el("button", { role: "tab", id: "tab-" + v.id, "aria-selected": "false" }, v.title);
        b.addEventListener("click", () => select(v.id, true));
        tabs.append(b);
      }
      scrub.addEventListener("input", () => { S.day = +scrub.value; S.dirty = true; });
      playBtn.addEventListener("click", toggle);
      document.getElementById("speed").addEventListener("change", (e) => { S.speed = +e.target.value; });
      document.addEventListener("keydown", (e) => {
        if (e.target.closest("input, select, textarea")) return;
        if (e.code === "Space") { e.preventDefault(); toggle(); }
        else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          App.setDay(S.day + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 7 : 1));
        }
      });
      cv.addEventListener("pointermove", (e) => hover(e));
      cv.addEventListener("pointerleave", () => { tip.hidden = true; if (cur.leave) cur.leave(); });
      cv.addEventListener("click", (e) => {
        const [x, y] = local(e);
        if (cur.click && cur.click(x, y)) App.redraw();
      });
      new ResizeObserver(resize).observe(cv.parentElement);
      window.addEventListener("resize", resize);

      const want = (location.hash || "").slice(1);
      select(views.some((v) => v.id === want) ? want : views[0].id, false);
      S.day = cur.range()[1] * 0.5 + cur.range()[0] * 0.5;
      App.setDay(cur.defaultDay ? cur.defaultDay() : S.day);
      resize();
      requestAnimationFrame(loop);
    },
  };
  window.App = App;

  function local(e) {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function hover(e) {
    const [x, y] = local(e);
    const h = cur.hit ? cur.hit(x, y) : null;
    if (!h) { tip.hidden = true; cv.style.cursor = ""; return; }
    tip.innerHTML = h.html;
    tip.hidden = false;
    cv.style.cursor = h.cursor || "pointer";
    const bw = cv.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = x + 16, ty = y + 12;
    if (tx + tw > bw - 4) tx = x - tw - 16;
    if (ty + th > cv.clientHeight - 4) ty = Math.max(4, y - th - 12);
    tip.style.left = Math.max(4, tx) + "px";
    tip.style.top = ty + "px";
  }

  function select(id, user) {
    if (cur && cur.id === id) return;
    if (cur && cur.unmount) cur.unmount();
    cur = views.find((v) => v.id === id);
    for (const v of views) document.getElementById("tab-" + v.id).setAttribute("aria-selected", String(v === cur));
    const rail = document.getElementById("rail");
    rail.innerHTML = "";
    cur.mount(rail);
    tip.hidden = true;
    if (user) try { history.replaceState(null, "", "#" + id); } catch (e) { /* sandboxed */ }
    App.rangeChanged();
    resize();
  }

  function toggle() {
    const [a, b] = cur.range();
    if (!S.playing && S.day >= b - 1e-6) App.setDay(a);
    S.playing = !S.playing;
    playBtn.setAttribute("aria-label", S.playing ? "Pause" : "Play");
    playBtn.innerHTML = S.playing
      ? '<svg viewBox="0 0 16 16"><path d="M3 1.5h3.5v13H3zM9.5 1.5H13v13H9.5z"/></svg>'
      : '<svg viewBox="0 0 16 16"><path d="M3 1.5v13l11-6.5z"/></svg>';
  }

  function resize() {
    const box = cv.parentElement;
    const w = box.clientWidth;
    const ideal = cur && cur.aspect ? w * cur.aspect : w * 0.62;
    const h = Math.round(U.clamp(ideal, 340, Math.max(380, window.innerHeight - 250)));
    dpr = window.devicePixelRatio || 1;
    if (w === W && h === H && cv.width === Math.round(w * dpr)) return;
    W = w; H = h;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + "px";
    S.dirty = true;
  }

  // month labels and event ticks under the scrubber
  function drawTicks() {
    const [a, b] = cur.range();
    const ticks = document.getElementById("ticks");
    ticks.innerHTML = "";
    for (const ev of R.events) {
      const d = Math.max(ev.day, a);
      if (ev.day > b) continue;
      const t = U.el("i", { title: `${ev.label} · ${U.fmtDate(ev.day)}` });
      t.style.left = (100 * (d - a) / (b - a)) + "%";
      t.addEventListener("click", () => App.setDay(d));
      ticks.append(t);
    }
    const months = document.getElementById("months");
    months.innerHTML = "";
    const n = W < 600 ? 3 : 6;
    for (let k = 0; k <= n; k++) months.append(U.el("span", {}, U.fmtDate(a + (b - a) * k / n, { month: "short", year: "2-digit" })));
  }

  // events: shown from their date for EVENT_DAYS of timeline, fading out
  const EVENT_DAYS = 18;
  let evKey = "";
  function drawEvents(day) {
    const box = document.getElementById("events");
    const [a] = cur.range();
    const vis = R.events.map((ev) => {
      const age = day - Math.max(ev.day, a);
      if (age < 0 || age >= EVENT_DAYS) return null;
      const x = age / EVENT_DAYS;
      return { ev, alpha: 1 - x * x * (3 - 2 * x) };
    }).filter(Boolean).reverse();
    const key = vis.map((v) => v.ev.date).join();
    if (key !== evKey) {
      evKey = key;
      box.innerHTML = vis.map((v) => `<div class="ev" data-d="${v.ev.date}"><b>${U.esc(v.ev.label)}</b><span>${U.fmtDate(v.ev.day)}</span></div>`).join("");
    }
    box.querySelectorAll(".ev").forEach((e, i) => { e.style.opacity = vis[i] ? vis[i].alpha.toFixed(2) : 0; });
  }

  let last = performance.now();
  let lastSub = 0;
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (S.playing) {
      const [, b] = cur.range();
      S.day = Math.min(b, S.day + dt * S.speed);
      scrub.value = S.day;
      if (S.day >= b) toggle();
      S.dirty = true;
    }
    const animating = cur.animating && cur.animating();
    if (S.dirty || animating) {
      S.dirty = false;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = C.surface;
      ctx.fillRect(0, 0, W, H);
      cur.draw(ctx, W, H, S.day, dt);
      document.getElementById("date").textContent = U.fmtDate(S.day);
      if (now - lastSub > 150 || !S.playing) {
        lastSub = now;
        document.getElementById("sub").textContent = cur.sub ? cur.sub(S.day) : "";
        if (cur.panel) cur.panel(S.day);
      }
      drawEvents(S.day);
    }
    requestAnimationFrame(loop);
  }
})();
