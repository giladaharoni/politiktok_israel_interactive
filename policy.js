// Policy shares: for each bloc, the share of its posts in a trailing window that address each of the five
// policy dimensions (port of policy_race.py). Bars re-rank as shares change; below, one small time series per
// dimension over the whole timeline, with a cursor at the current day.
(function () {
  const { R, U, C } = App;
  const P = R.posts;
  const ND = R.dims.length;

  // blocs: the two main ones first (their colours are the videos'), then the others by post count
  const EXTRA_COLORS = { "מפלגות ערביות": [86, 178, 124], "הנדל וזליכה": [170, 128, 214] };
  const count = {};
  for (let i = 0; i < P.n; i++) {
    const b = R.accounts[P.acc[i]].bloc;
    if (b && P.dims[i] >= 0) count[b] = (count[b] || 0) + 1;
  }
  const others = Object.keys(count).filter((b) => !R.blocs.includes(b)).sort((a, b) => count[b] - count[a]);
  const BLOCS = [...R.blocs, ...others].map((name, i) => ({
    name,
    color: i < R.blocs.length ? R.blocColors[i] : (EXTRA_COLORS[name] || [150, 150, 150]),
  }));
  // labelled posts per bloc, in day order
  for (const b of BLOCS) {
    const ix = [];
    for (let i = 0; i < P.n; i++) if (P.dims[i] >= 0 && R.accounts[P.acc[i]].bloc === b.name) ix.push(i);
    b.day = Float64Array.from(ix, (i) => P.day[i]);
    b.dims = Int32Array.from(ix, (i) => P.dims[i]);
  }

  const st = { win: 30, taper: 0, all: false };
  const shown = () => (st.all ? BLOCS : BLOCS.slice(0, R.blocs.length));
  let series = null; // per bloc: Float32Array(nt * ND) of shares, NaN when the window is empty
  let sT0 = 0;
  const pos = BLOCS.map(() => Array.from({ length: ND }, (_, d) => d)); // displayed rank per bloc and dimension
  let moving = false;
  let frame = null; // what was drawn last, for hit-testing

  // weighted posts n, weighted hits per dimension, plain counts, at day t
  function stats(b, t) {
    const lo = U.lowerBound(b.day, t - st.win);
    const hi = U.lowerBound(b.day, t + 1e-9);
    let n = 0, cnt = 0;
    const hits = new Float64Array(ND), raw = new Int32Array(ND);
    for (let k = lo; k < hi; k++) {
      const w = U.taper(t - b.day[k], st.win, st.taper);
      cnt++;
      for (let d = 0; d < ND; d++) if (b.dims[k] >> d & 1) { raw[d]++; hits[d] += w; }
      n += w;
    }
    const share = Array.from(hits, (h) => (n > 0 ? h / n : 0));
    return { n, cnt, hits, raw, share };
  }

  function buildSeries() {
    sT0 = st.win;
    const nt = Math.max(1, Math.floor(R.T - sT0) + 1);
    series = BLOCS.map((b) => {
      const s = new Float32Array(nt * ND);
      for (let j = 0; j < nt; j++) {
        const r = stats(b, sT0 + j);
        for (let d = 0; d < ND; d++) s[j * ND + d] = r.n >= 1 ? r.share[d] : NaN;
      }
      return s;
    });
  }

  const dimColor = (d) => {
    const c = R.dims[d].color;
    return C.dark ? c.map((v) => Math.round(v + (255 - v) * 0.35)) : c;
  };

  // vertical layout, compressed to fit the canvas height
  function layout(w, h) {
    const pad = 20;
    const bs = shown();
    const pCols = w < 640 ? 1 : 2;
    const pRows = Math.ceil(bs.length / pCols);
    const sCols = w < 640 ? 2 : 5;
    const sRows = Math.ceil(ND / sCols);
    const base = { head: 44, row: 30, axis: 22, gap: 18, sTitle: 20, sH: w < 640 ? 80 : 104, sAxis: 18 };
    const need = 28 + pRows * (base.head + ND * base.row + base.axis + base.gap) + 10 + sRows * (base.sTitle + base.sH + base.sAxis + 8);
    // head and chart titles keep their size; the rest shrinks to fit
    const fixed = 28 + pRows * base.head + sRows * base.sTitle;
    const f = Math.min(1, Math.max(0.3, (h - fixed) / (need - fixed)));
    return { pad, bs, pCols, sCols, sRows, f, need, ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, k === "head" || k === "sTitle" ? v : v * f])) };
  }

  function draw(ctx, w, h, day, dt) {
    const L = layout(w, h);
    const panelW = (w - 2 * L.pad - (L.pCols - 1) * 28) / L.pCols;
    frame = { bars: [], charts: [], day };
    moving = false;
    let y = 8;
    ctx.textBaseline = "middle";

    // ---- bar panels
    L.bs.forEach((b, p) => {
      const bi = BLOCS.indexOf(b);
      const col = p % L.pCols, row = Math.floor(p / L.pCols);
      const x0 = L.pad + col * (panelW + 28);
      const y0 = y + row * (L.head + ND * L.row + L.axis + L.gap);
      const s = stats(b, day);
      // header
      ctx.textAlign = "left";
      ctx.fillStyle = U.rgba(b.color);
      ctx.beginPath(); ctx.arc(x0 + 7, y0 + 13, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.ink; ctx.font = `800 17px ${C.font}`;
      ctx.fillText(b.name, x0 + 22, y0 + 13);
      ctx.fillStyle = C.muted; ctx.font = `12px ${C.font}`;
      ctx.fillText(`${s.cnt.toLocaleString("en-US")} labelled posts in the last ${st.win} days`, x0, y0 + 33);

      const labW = Math.min(150, panelW * 0.36);
      const bx0 = x0 + labW + 8, bx1 = x0 + panelW - 44;
      const top = y0 + L.head, bot = top + ND * L.row;
      // 0-100% grid, fixed so panels and moments compare
      ctx.font = `11px ${C.font}`; ctx.textAlign = "center";
      for (const pct of [0, 25, 50, 75, 100]) {
        const x = bx0 + (bx1 - bx0) * pct / 100;
        ctx.strokeStyle = pct === 0 ? C.arrow : C.grid; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, top - 2); ctx.lineTo(x, bot); ctx.stroke();
        ctx.fillStyle = C.muted; ctx.fillText(pct + "%", x, bot + 10);
      }
      // ranks: ease displayed position toward the target order
      const order = [...Array(ND).keys()].sort((a, c) => s.share[c] - s.share[a] || a - c);
      const k = Math.min(1, (dt || 0.016) * 7);
      order.forEach((d, r) => {
        const cur = pos[bi][d];
        const nx = Math.abs(r - cur) < 0.002 ? r : cur + (r - cur) * k;
        if (nx !== r) moving = true;
        pos[bi][d] = nx;
      });
      const barH = Math.max(8, L.row * 0.62);
      for (let d = 0; d < ND; d++) {
        const yy = top + pos[bi][d] * L.row + L.row / 2;
        const v = s.share[d];
        ctx.font = `700 13px ${C.font}`; ctx.textAlign = "right"; ctx.fillStyle = C.ink;
        ctx.fillText(R.dims[d].label, bx0 - 8, yy);
        const bx = bx0 + (bx1 - bx0) * v;
        ctx.fillStyle = U.rgba(dimColor(d));
        ctx.fillRect(bx0, yy - barH / 2, Math.max(2, bx - bx0), barH);
        ctx.font = `700 13px ${C.font}`; ctx.textAlign = "left"; ctx.fillStyle = C.ink;
        ctx.fillText(Math.round(100 * v) + "%", bx + 6, yy);
        frame.bars.push({ x0: x0, x1: x0 + panelW, y0: yy - L.row / 2, y1: yy + L.row / 2, b, d, s });
      }
    });
    const pRows = Math.ceil(L.bs.length / L.pCols);
    y += pRows * (L.head + ND * L.row + L.axis + L.gap) + 4;
    ctx.strokeStyle = C.line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L.pad, y); ctx.lineTo(w - L.pad, y); ctx.stroke();
    y += 10;

    // ---- time series, one per dimension
    const gapX = 16;
    const cw = (w - 2 * L.pad - (L.sCols - 1) * gapX) / L.sCols;
    const t1 = R.T, t0 = sT0;
    for (let d = 0; d < ND; d++) {
      const col = d % L.sCols, row = Math.floor(d / L.sCols);
      const x0 = L.pad + col * (cw + gapX);
      const yT = y + row * (L.sTitle + L.sH + L.sAxis + 8);
      const cy0 = yT + L.sTitle, cy1 = cy0 + L.sH;
      // y range: 0 .. max over shown blocs, rounded up to 10%
      let mx = 0;
      for (const b of L.bs) {
        const s = series[BLOCS.indexOf(b)];
        for (let j = d; j < s.length; j += ND) if (s[j] > mx) mx = s[j];
      }
      const ymax = Math.max(0.1, Math.ceil(mx * 10) / 10);
      const X = (t) => x0 + (cw * (t - t0)) / Math.max(1e-9, t1 - t0);
      const Y = (v) => cy1 - (L.sH * v) / ymax;
      ctx.fillStyle = U.rgba(dimColor(d)); ctx.fillRect(x0, yT + 4, 10, 10);
      ctx.fillStyle = C.ink; ctx.font = `700 12px ${C.font}`; ctx.textAlign = "left";
      ctx.fillText(R.dims[d].label, x0 + 15, yT + 9);
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, cy1); ctx.lineTo(x0 + cw, cy1);
      ctx.moveTo(x0, Y(ymax / 2)); ctx.lineTo(x0 + cw, Y(ymax / 2));
      ctx.moveTo(x0, cy0); ctx.lineTo(x0 + cw, cy0);
      ctx.stroke();
      ctx.fillStyle = C.muted; ctx.font = `10px ${C.font}`; ctx.textAlign = "right";
      ctx.fillText(Math.round(100 * ymax) + "%", x0 + cw, cy0 - 6);
      // event ticks
      ctx.strokeStyle = C.muted; ctx.globalAlpha = 0.35;
      for (const ev of R.events) {
        if (ev.day < t0 || ev.day > t1) continue;
        ctx.beginPath(); ctx.moveTo(X(ev.day), cy1); ctx.lineTo(X(ev.day), cy1 + 5); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // lines
      for (const b of L.bs) {
        const s = series[BLOCS.indexOf(b)];
        ctx.strokeStyle = U.rgba(b.color); ctx.lineWidth = 1.6; ctx.lineJoin = "round";
        ctx.beginPath();
        let pen = false;
        for (let j = 0; j * ND + d < s.length; j++) {
          const v = s[j * ND + d];
          if (Number.isNaN(v)) { pen = false; continue; }
          const px = X(t0 + j), py = Y(v);
          if (pen) ctx.lineTo(px, py); else ctx.moveTo(px, py);
          pen = true;
        }
        ctx.stroke();
      }
      // axis dates
      ctx.fillStyle = C.muted; ctx.font = `10px ${C.font}`;
      ctx.textAlign = "left"; ctx.fillText(U.fmtDate(t0, { month: "short", year: "2-digit" }), x0, cy1 + 11);
      ctx.textAlign = "right"; ctx.fillText(U.fmtDate(t1, { month: "short", year: "2-digit" }), x0 + cw, cy1 + 11);
      // cursor at the current day, and the hover line
      const cx = X(day);
      ctx.strokeStyle = C.ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, cy0); ctx.lineTo(cx, cy1); ctx.stroke();
      for (const b of L.bs) {
        const s = series[BLOCS.indexOf(b)];
        const v = s[Math.round(day - t0) * ND + d];
        if (!Number.isNaN(v) && v !== undefined) {
          ctx.fillStyle = U.rgba(b.color);
          ctx.beginPath(); ctx.arc(cx, Y(v), 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (hoverDay !== null && hoverChart === d) {
        const hx = X(hoverDay);
        ctx.strokeStyle = C.muted; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(hx, cy0); ctx.lineTo(hx, cy1); ctx.stroke();
        ctx.setLineDash([]);
      }
      frame.charts.push({ d, x0, x1: x0 + cw, y0: cy0, y1: cy1, t0, t1 });
    }
  }

  let hoverDay = null, hoverChart = -1;
  const inR = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  function chartAt(x, y) {
    if (!frame) return null;
    const c = frame.charts.find((r) => inR({ ...r, y0: r.y0 - 4, y1: r.y1 + 4 }, x, y));
    if (!c) return null;
    return { c, day: U.clamp(c.t0 + (c.t1 - c.t0) * (x - c.x0) / (c.x1 - c.x0), c.t0, c.t1) };
  }

  function hit(x, y) {
    if (!frame) return null;
    const bar = frame.bars.find((r) => inR(r, x, y));
    if (bar) {
      hoverDay = null; hoverChart = -1;
      const { b, d, s } = bar;
      return {
        cursor: "default",
        html: `<b>${U.esc(R.dims[d].label)}</b> <span class="m">· ${U.esc(b.name)}</span>` +
          `<div style="font-size:20px;font-weight:800;color:${U.rgba(b.color)}">${(100 * s.share[d]).toFixed(1)}%</div>` +
          `<div class="m">${s.raw[d]} of ${s.cnt} labelled posts in the ${st.win}-day window address it` +
          `${st.taper > 0 ? " (shares weight posts by the fade at the window edges)" : ""}.</div>`,
      };
    }
    const ch = chartAt(x, y);
    if (!ch) { if (hoverDay !== null) { hoverDay = null; hoverChart = -1; App.redraw(); } return null; }
    hoverDay = ch.day; hoverChart = ch.c.d;
    App.redraw();
    const j = Math.round(ch.day - sT0);
    const rows = shown().map((b) => {
      const v = series[BLOCS.indexOf(b)][j * ND + ch.c.d];
      return `<div class="row"><span class="bar" style="width:10px;background:${U.rgba(b.color)}"></span><span style="flex:1">${U.esc(b.name)}</span>` +
        `<span style="font-family:var(--mono)">${Number.isNaN(v) ? "–" : Math.round(100 * v) + "%"}</span></div>`;
    }).join("");
    return {
      html: `<b>${U.esc(R.dims[ch.c.d].label)}</b><div class="m">${U.fmtDate(ch.day)}</div><div style="margin-top:4px">${rows}</div>` +
        `<div class="hint">Click to jump to this date.</div>`,
    };
  }

  function mount(rail) {
    const c1 = U.card(rail, "Window");
    U.slider(c1, { id: "pol-win", label: "Trailing window", min: 7, max: 120, value: st.win, unit: " days",
      onInput: (v) => { st.win = v; st.taper = Math.min(st.taper, v / 2); buildSeries(); App.rangeChanged(); App.redraw(); } });
    U.slider(c1, { id: "pol-taper", label: "Fade in/out at window edges", min: 0, max: 30, value: st.taper, unit: " days",
      onInput: (v) => { st.taper = Math.min(v, st.win / 2); buildSeries(); App.redraw(); } });
    c1.append(U.el("p", { class: "small" }, "0 days is a hard-edged window, as in the video."));

    const c2 = U.card(rail, "Blocs");
    U.seg(c2, { label: "Blocs shown", value: st.all, options: [[false, "Two blocs"], [true, "All four"]],
      onChange: (v) => { st.all = v; window.dispatchEvent(new Event("resize")); App.redraw(); } });
    const leg = U.el("div", { class: "legend" });
    for (const b of BLOCS) {
      leg.append(U.el("div", { style: "display:flex;align-items:center;gap:8px;padding:2px 6px;font-size:14px" },
        `<span class="sw" style="background:${U.rgba(b.color)};flex:none"></span><span>${U.esc(b.name)}</span>` +
        `<span class="v" style="margin-left:auto">${count[b.name].toLocaleString("en-US")} posts</span>`));
    }
    c2.append(leg);

    const c3 = U.card(rail, "How to read it");
    c3.append(U.el("ul", { class: "notes" },
      `<li>Each bar is the share of the bloc's labelled posts in the trailing window that address that dimension.</li>` +
      `<li>A post can address several dimensions, so a bloc's bars don't add up to 100%.</li>` +
      `<li>The small charts show each share over the whole period. Hover for values; click to jump there.</li>` +
      `<li>Ticks under the small charts mark the events on the timeline.</li>`));
  }

  buildSeries();

  App.view({
    id: "policy", title: "Policy shares",
    range: () => [st.win, R.T],
    defaultDay: () => R.T * 0.85,
    mount, draw, hit,
    leave() { if (hoverDay !== null) { hoverDay = null; hoverChart = -1; App.redraw(); } },
    click(x, y) { const ch = chartAt(x, y); if (ch) { App.setDay(ch.day); return true; } return false; },
    animating: () => moving,
    sub: (day) => `Share of each bloc's posts addressing each policy dimension · ${U.fmtDate(day - st.win, { day: "2-digit", month: "short" })} – ${U.fmtDate(day, { day: "2-digit", month: "short", year: "numeric" })}`,
    get aspect() {
      const w = document.getElementById("cv").parentElement.clientWidth || 1000;
      return (layout(w, 1e9).need + 4) / w;
    },
  });
})();
