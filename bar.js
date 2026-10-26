// Views race: accounts ranked by cumulative (or trailing-window) views, likes, comments or posts, each bar
// split into rhetoric-genre segments as in bar_race.py. Ranks glide; a followed account stays on screen.
(function () {
  const { R, U, C } = App;
  const P = R.posts;
  const A = R.accounts.length, NG = R.genres.length;
  const days = Float64Array.from(P.day);
  const METRICS = { views: ["Views", P.views], likes: ["Likes", P.likes], comments: ["Comments", P.comments], posts: ["Posts", null] };
  const st = { metric: "views", win: 0, top: 15, filter: "all", pinned: -1 };
  const pos = new Float64Array(A).fill(NaN); // displayed rank per account (eased)
  let scaleMax = 0, moving = false, frame = null;

  const allowed = (a) => {
    const acc = R.accounts[a];
    if (st.filter === "all") return true;
    if (st.filter === "other") return acc.blocIdx < 0;
    if (st.filter.startsWith("bloc:")) return acc.bloc === st.filter.slice(5);
    return acc.list === st.filter.slice(5);
  };

  // per-account genre sums and post counts over (lo, t]
  function compute(t) {
    const lo = st.win > 0 ? U.lowerBound(days, t - st.win + 1e-9) : 0;
    const hi = U.lowerBound(days, t + 1e-9);
    const seg = new Float64Array(A * NG), cnt = new Int32Array(A);
    const arr = METRICS[st.metric][1];
    for (let k = lo; k < hi; k++) {
      const a = P.acc[k];
      seg[a * NG + P.genre[k]] += arr ? arr[k] : 1;
      cnt[a]++;
    }
    const tot = new Float64Array(A);
    for (let a = 0; a < A; a++) for (let g = 0; g < NG; g++) tot[a] += seg[a * NG + g];
    return { seg, cnt, tot };
  }

  function niceStep(vmax, n = 5) {
    const raw = vmax / n, mag = 10 ** Math.floor(Math.log10(raw || 1));
    return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  }

  function draw(ctx, w, h, day, dt) {
    const c = compute(day);
    const order = [...Array(A).keys()].filter((a) => allowed(a) && c.tot[a] > 0).sort((p, q) => c.tot[q] - c.tot[p]);
    const shown = order.slice(0, st.top);
    const pinRank = st.pinned >= 0 ? order.indexOf(st.pinned) : -1;
    const extra = pinRank >= st.top ? st.pinned : -1;
    const rows = st.top + (extra >= 0 ? 1 : 0);

    const top = 34, bottom = 10;
    const rowH = (h - top - bottom) / rows;
    const barH = Math.min(30, rowH * 0.72);
    const nameW = U.clamp(w * 0.2, 90, 200);
    const x0 = nameW + 12;
    const x1 = w - U.clamp(w * 0.12, 70, 130) - barH; // room for avatar + value
    // eased axis maximum and ranks
    const target = Math.max(1, c.tot[shown[0]] || 1);
    const k = Math.min(1, dt * 6);
    scaleMax = scaleMax ? scaleMax + (target - scaleMax) * k : target;
    moving = Math.abs(target - scaleMax) / target > 0.002;
    const want = new Float64Array(A).fill(rows + 1);
    shown.forEach((a, i) => { want[a] = i; });
    if (extra >= 0) want[extra] = st.top;
    for (let a = 0; a < A; a++) {
      if (isNaN(pos[a])) pos[a] = rows + 1;
      const d = want[a] - pos[a];
      pos[a] += Math.abs(d) < 0.002 ? d : d * Math.min(1, dt * 7);
      if (Math.abs(d) > 0.002) moving = true;
    }

    // gridlines
    const step = niceStep(scaleMax);
    ctx.font = `12px ${C.font}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    for (let v = 0; v <= scaleMax * 1.001; v += step) {
      const x = x0 + (x1 - x0) * v / scaleMax;
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, top - 6); ctx.lineTo(x, h - bottom); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.fillText(U.fmtNum(v), x, top - 10);
    }

    frame = { rows: [], c, order };
    const draws = [...shown, ...(extra >= 0 ? [extra] : [])];
    // also draw accounts leaving the chart until they slide out
    for (let a = 0; a < A; a++) if (!draws.includes(a) && pos[a] < rows + 0.5) draws.push(a);
    for (const a of draws) {
      const y = top + (pos[a] + 0.5) * rowH;
      if (y - barH / 2 > h) continue;
      const acc = R.accounts[a];
      const isPin = a === st.pinned;
      const fadeOut = U.clamp(rows + 0.5 - pos[a], 0, 1);
      ctx.globalAlpha = fadeOut * (st.pinned >= 0 && !isPin ? 0.55 : 1);
      // genre segments
      let x = x0;
      for (let g = 0; g < NG; g++) {
        const v = c.seg[a * NG + g];
        if (v <= 0) continue;
        const sw = (x1 - x0) * v / scaleMax;
        ctx.fillStyle = U.rgba(R.genreColors[g]);
        ctx.fillRect(x, y - barH / 2, sw, barH);
        x += sw;
      }
      if (isPin) { ctx.strokeStyle = C.ink; ctx.lineWidth = 2; ctx.strokeRect(x0 - 1, y - barH / 2 - 1, x - x0 + 2, barH + 2); }
      // name, avatar, value
      ctx.textBaseline = "middle"; ctx.textAlign = "right";
      ctx.font = `${isPin ? 800 : 700} ${Math.min(15, barH * 0.55)}px ${C.font}`;
      ctx.fillStyle = C.ink;
      const rank = order.indexOf(a) + 1;
      let name = acc.name;
      while (ctx.measureText(name).width > nameW - 26 && name.length > 3) name = name.slice(0, -2) + "…";
      ctx.fillText(name, nameW, y);
      ctx.font = `11px ${C.font}`; ctx.fillStyle = C.muted; ctx.textAlign = "left";
      ctx.fillText(rank ? String(rank) : "", 2, y);
      const ar = barH / 2 + 2;
      U.drawAvatar(ctx, acc, x + ar + 4, y, ar, acc.blocIdx >= 0 ? U.blocColor(acc.blocIdx) : [150, 150, 150], ctx.globalAlpha, 2);
      ctx.font = `600 ${Math.min(14, barH * 0.5)}px ${C.font}`; ctx.fillStyle = C.ink; ctx.textAlign = "left";
      ctx.fillText(U.fmtNum(c.tot[a]), x + 2 * ar + 10, y);
      ctx.globalAlpha = 1;
      frame.rows.push({ a, y0: y - rowH / 2, y1: y + rowH / 2 });
    }
  }

  function rowAt(x, y) {
    if (!frame) return -1;
    const r = frame.rows.find((r) => y >= r.y0 && y < r.y1);
    return r ? r.a : -1;
  }

  function hit(x, y) {
    const a = rowAt(x, y);
    if (a < 0) return null;
    const acc = R.accounts[a], c = frame.c;
    const [label] = METRICS[st.metric];
    const segs = R.genres.map((g, i) => {
      const v = c.seg[a * NG + i];
      if (!v) return "";
      return `<div class="row"><span class="bar" style="width:10px;background:${U.rgba(R.genreColors[i])}"></span>` +
        `<span style="flex:1">${g}</span><span class="m">${U.fmtNum(v)} · ${Math.round(100 * v / c.tot[a])}%</span></div>`;
    }).join("");
    return {
      html: `<b><bdi>${U.esc(acc.name)}</bdi></b> <span class="m">#${frame.order.indexOf(a) + 1}</span>` +
        `<div class="m"><bdi>${U.esc(acc.list || acc.faction || "")}</bdi>${acc.bloc ? ` · <bdi>${U.esc(acc.bloc)}</bdi>` : ""}</div>` +
        `<div style="margin-top:6px"><b>${U.fmtNum(c.tot[a])}</b> ${label.toLowerCase()} from ${c.cnt[a]} posts</div>` +
        `<div style="margin-top:4px">${segs}</div><div class="hint">Segments: rhetoric genre. Click to ${a === st.pinned ? "unfollow" : "follow"}.</div>`,
    };
  }

  function setPin(a) {
    st.pinned = st.pinned === a ? -1 : a;
    if (pinSel) pinSel.value = String(st.pinned);
    App.redraw();
  }

  let pinSel;
  function mount(rail) {
    const c1 = U.card(rail, "Rank accounts by");
    U.seg(c1, { label: "Metric", value: st.metric, options: Object.entries(METRICS).map(([k, [l]]) => [k, l]),
      onChange: (v) => { st.metric = v; App.redraw(); } });
    U.seg(c1, { label: "Period", value: st.win, options: [[0, "All time"], [30, "Last 30 days"], [90, "Last 90 days"]],
      onChange: (v) => { st.win = v; App.redraw(); } });
    U.slider(c1, { id: "bar-top", label: "Bars", min: 5, max: 30, value: st.top, onInput: (v) => { st.top = v; App.redraw(); } });

    const c2 = U.card(rail, "Accounts");
    const f = U.el("select", { class: "ctl", id: "bar-filter", "aria-label": "Which accounts" });
    const lists = [...new Set(R.accounts.map((a) => a.list).filter(Boolean))].sort((p, q) => p.localeCompare(q, "he"));
    f.innerHTML = `<option value="all">All accounts</option>` +
      R.blocs.concat([...new Set(R.accounts.map((a) => a.bloc).filter((b) => b && !R.blocs.includes(b)))])
        .map((b) => `<option value="bloc:${U.esc(b)}">${U.esc(b)}</option>`).join("") +
      `<option value="other">No bloc</option><optgroup label="2026 list">` +
      lists.map((l) => `<option value="list:${U.esc(l)}">${U.esc(l)}</option>`).join("") + `</optgroup>`;
    f.value = st.filter;
    f.addEventListener("change", () => { st.filter = f.value; App.redraw(); });
    pinSel = U.el("select", { class: "ctl", id: "bar-pin", "aria-label": "Follow an account" });
    pinSel.innerHTML = `<option value="-1">Follow an account…</option>` +
      [...R.accounts].sort((p, q) => p.name.localeCompare(q.name, "he")).map((a) => `<option value="${a.i}">${U.esc(a.name)}</option>`).join("");
    pinSel.value = String(st.pinned);
    pinSel.addEventListener("change", () => { st.pinned = +pinSel.value; App.redraw(); });
    c2.append(f, pinSel, U.el("p", { class: "small" }, "A followed account stays on the chart below the top bars, with its rank."));

    const c3 = U.card(rail, "Rhetoric genre");
    c3.append(U.el("div", { class: "legend" }, R.genres.map((g, i) =>
      `<div style="display:flex;align-items:center;gap:8px;padding:2px 6px"><span class="sw" style="border-radius:3px;background:${U.rgba(R.genreColors[i])}"></span>${g}</div>`).join("")));
    c3.append(U.el("p", { class: "small" }, "Each bar is split by the rhetoric genre of the posts behind it. Avatar rings show the bloc."));
  }

  App.view({
    id: "views", title: "Views race",
    range: () => [0, R.T],
    defaultDay: () => R.T,
    mount, draw, hit,
    click(x, y) { const a = rowAt(x, y); if (a >= 0) setPin(a); return a >= 0; },
    animating: () => moving,
    sub(day) {
      const [label] = METRICS[st.metric];
      const period = st.win ? `last ${st.win} days` : "cumulative";
      if (!frame) return label;
      let t = 0, n = 0;
      for (let a = 0; a < A; a++) if (allowed(a)) { t += frame.c.tot[a]; n += frame.c.cnt[a]; }
      return `${label} per account, ${period} · ${U.fmtNum(t)} ${label.toLowerCase()} from ${n.toLocaleString("en-US")} posts`;
    },
    aspect: 0.66,
  });
})();
