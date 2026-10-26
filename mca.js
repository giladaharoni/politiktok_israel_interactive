// Policy map: the MCA of the five policy dimensions (fitted in build_data.py exactly as in mca_race.py),
// with one dot per bloc, 2026 list, party chairman or account. Each dot is the centroid of the group's posts
// in a trailing window whose edges fade over --taper days, computed here per frame from the posts.
(function () {
  const { R, U, C } = App;
  const P = R.posts;

  // MCA posts (both blocs, all dimensions labelled), in day order
  const idx = [];
  for (let i = 0; i < P.n; i++) if (P.mx[i] !== null) idx.push(i);
  const M = {
    n: idx.length,
    day: Float64Array.from(idx, (i) => P.day[i]),
    x: Float64Array.from(idx, (i) => P.mx[i]),
    y: Float64Array.from(idx, (i) => P.my[i]),
    acc: Int32Array.from(idx, (i) => P.acc[i]),
    dims: Int32Array.from(idx, (i) => P.dims[i]),
  };
  const ND = R.dims.length;

  const MODES = {
    blocs: { label: "Blocs", trail: 90 },
    lists: { label: "Lists", trail: 30 },
    chairmen: { label: "Chairmen", trail: 10 },
    accounts: { label: "Accounts", trail: 14 },
  };
  const st = { mode: "blocs", win: 30, taper: 7, trail: 90, minPosts: 3, sel: new Set() };
  let groups = [], gOf = null, vr = 1, tips = [], kArrow = 1;
  let lastFrame = null; // positions drawn last frame, for hit-testing

  // groups for the current mode: [{name, sub, bloc, acc?}] and each MCA post's group (-1 = not shown)
  function buildGroups() {
    const accs = R.accounts;
    gOf = new Int32Array(M.n).fill(-1);
    if (st.mode === "blocs") {
      groups = R.blocs.map((b, i) => ({ name: b, sub: "", bloc: i }));
      for (let k = 0; k < M.n; k++) gOf[k] = accs[M.acc[k]].blocIdx;
    } else if (st.mode === "lists") {
      const count = {};
      for (let k = 0; k < M.n; k++) {
        const a = accs[M.acc[k]];
        const key = a.list || "בלי רשימה";
        count[key] = count[key] || { n: 0, bloc: a.blocIdx };
        count[key].n++;
      }
      const names = Object.keys(count).sort((p, q) => count[p].bloc - count[q].bloc || count[q].n - count[p].n);
      groups = names.map((nm) => ({ name: nm, sub: R.blocs[count[nm].bloc], bloc: count[nm].bloc }));
      const gi = Object.fromEntries(names.map((nm, i) => [nm, i]));
      for (let k = 0; k < M.n; k++) gOf[k] = gi[accs[M.acc[k]].list || "בלי רשימה"];
    } else {
      const chosen = accs.filter((a) => a.blocIdx >= 0 && (st.mode === "accounts" || a.chair));
      const n = new Map(chosen.map((a) => [a.i, 0]));
      for (let k = 0; k < M.n; k++) if (n.has(M.acc[k])) n.set(M.acc[k], n.get(M.acc[k]) + 1);
      chosen.sort((p, q) => p.blocIdx - q.blocIdx || n.get(q.i) - n.get(p.i));
      groups = chosen.map((a) => ({ name: a.name, sub: a.list || a.faction || "", bloc: a.blocIdx, acc: a }));
      const gi = new Map(chosen.map((a, i) => [a.i, i]));
      for (let k = 0; k < M.n; k++) gOf[k] = gi.has(M.acc[k]) ? gi.get(M.acc[k]) : -1;
    }
    st.sel.clear();
  }

  // window sums at `t`: weight n, centroid (cx, cy), weighted dimension hits, plain post count
  function compute(t, withDims) {
    const G = groups.length;
    const n = new Float64Array(G), cx = new Float64Array(G), cy = new Float64Array(G), cnt = new Int32Array(G);
    const dm = withDims ? new Float64Array(G * ND) : null;
    const lo = U.lowerBound(M.day, t - st.win);
    const hi = U.lowerBound(M.day, t + 1e-9);
    for (let k = lo; k < hi; k++) {
      const g = gOf[k];
      if (g < 0) continue;
      const w = U.taper(t - M.day[k], st.win, st.taper);
      cnt[g]++;
      if (w <= 0) continue;
      n[g] += w; cx[g] += w * M.x[k]; cy[g] += w * M.y[k];
      if (dm) for (let d = 0; d < ND; d++) if (M.dims[k] >> d & 1) dm[g * ND + d] += w;
    }
    for (let g = 0; g < G; g++) if (n[g] > 0) { cx[g] /= n[g]; cy[g] /= n[g]; }
    return { n, cx, cy, cnt, dm };
  }
  const vis = (n) => st.mode === "blocs" ? (n > 0 ? 1 : 0) : U.clamp((n - st.minPosts / 2) / (st.minPosts / 2), 0, 1);

  // view range: fit the shown centroids over the whole timeline (99.5th percentile outside bloc mode)
  function fit() {
    const vals = [];
    for (let t = st.win; t <= R.T; t += 1) {
      const c = compute(t);
      for (let g = 0; g < groups.length; g++) {
        if (st.mode === "blocs" ? c.n[g] > 0 : c.n[g] >= st.minPosts) vals.push(Math.abs(c.cx[g]), Math.abs(c.cy[g]));
      }
    }
    vals.sort((a, b) => a - b);
    const q = st.mode === "blocs" ? vals[vals.length - 1] : vals[Math.floor(0.995 * (vals.length - 1))];
    vr = (q || 1) * (st.mode === "blocs" ? 1.25 : 1.15);
    const raw = R.mca.tips;
    const len = Math.max(...raw.map(([a, b]) => Math.hypot(a, b)));
    kArrow = 0.85 * vr / len;
    tips = raw.map(([a, b]) => [a * kArrow, b * kArrow]);
  }

  let box; // plot box in css px
  function toPx(x, y) {
    const s = Math.min(box.w, box.h) / (2 * vr);
    return [box.x + box.w / 2 + x * s, box.y + box.h / 2 - y * s];
  }
  const clampPt = ([x, y]) => [U.clamp(x, box.x, box.x + box.w), U.clamp(y, box.y, box.y + box.h)];

  function arrow(ctx, x0, y0, x1, y1, col, w) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, h = 5 * w;
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1 - ux * h * 0.6, y1 - uy * h * 0.6); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 - ux * h - uy * h * 0.45, y1 - uy * h + ux * h * 0.45);
    ctx.lineTo(x1 - ux * h + uy * h * 0.45, y1 - uy * h - ux * h * 0.45);
    ctx.closePath(); ctx.fill();
  }

  function radius(g, n) {
    if (st.mode === "blocs") return 14;
    if (st.mode === "lists") return 11;
    if (st.mode === "chairmen") return 21;
    return 3.5 + 1.9 * Math.sqrt(n);
  }

  // labels beside dots on the side away from the origin, pushed apart vertically where they collide
  function placeLabels(ctx, items, ox) {
    const h = 18, gap = 3;
    const L = items.map((it) => {
      const right = it.x >= ox;
      const w = ctx.measureText(it.text).width;
      const lx = right ? it.x + it.r + 6 : it.x - it.r - 6;
      return { ...it, right, w, lx, ly: it.y, left: right ? lx : lx - w };
    });
    for (let iter = 0; iter < 60; iter++) {
      let moved = false;
      for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
        const A = L[a], B = L[b];
        if (A.left > B.left + B.w || B.left > A.left + A.w) continue;
        const over = h + gap - Math.abs(A.ly - B.ly);
        if (over > 0) {
          const s = A.ly > B.ly || (A.ly === B.ly && a > b) ? 1 : -1;
          A.ly += s * over / 2; B.ly -= s * over / 2; moved = true;
        }
      }
      if (!moved) break;
    }
    return L;
  }

  function draw(ctx, w, h, day) {
    const pad = 28;
    box = { x: pad, y: 8, w: w - 2 * pad, h: h - 30 };
    const [ox, oy] = toPx(0, 0);
    ctx.lineCap = "round";
    // axes
    ctx.strokeStyle = C.grid; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(box.x, oy); ctx.lineTo(box.x + box.w, oy); ctx.moveTo(ox, box.y); ctx.lineTo(ox, box.y + box.h); ctx.stroke();
    ctx.font = `12px ${C.font}`; ctx.fillStyle = C.muted;
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillText(`Dim 1 (${R.mca.inertia[0]}%)`, box.x + box.w, oy - 6);
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.fillText(`Dim 2 (${R.mca.inertia[1]}%)`, ox + 8, box.y);
    // arrows
    const arrowEnds = tips.map(([a, b]) => toPx(a, b));
    for (const [x, y] of arrowEnds) arrow(ctx, ox, oy, x, y, C.arrow, 2);

    // trails (butt caps: round caps double the alpha at every joint)
    ctx.lineCap = "butt";
    const t0 = st.win;
    const step = Math.max(0.5, st.trail / 80);
    const hist = [];
    for (let s = 0; s <= st.trail + 1e-9 && day - s >= t0; s += step) hist.push([s, compute(day - s)]);
    const cur = compute(day, true);
    const anySel = st.sel.size > 0;
    const dim = (g) => (anySel && !st.sel.has(g) ? 0.18 : 1);
    for (let g = 0; g < groups.length; g++) {
      const col = U.blocColor(groups[g].bloc);
      const wmax = st.mode === "blocs" ? 8 : st.mode === "accounts" ? 3.5 : 5;
      for (let j = hist.length - 1; j > 0; j--) {
        const [s0, c0] = hist[j], [, c1] = hist[j - 1];
        const v = Math.min(vis(c0.n[g]), vis(c1.n[g]));
        if (v <= 0) continue;
        const fade = 1 - s0 / Math.max(st.trail, 1e-9);
        ctx.strokeStyle = U.rgba(col, 0.8 * v * fade ** 1.5 * dim(g));
        ctx.lineWidth = Math.max(1, 1 + (wmax - 1) * fade);
        const [x0, y0] = clampPt(toPx(c0.cx[g], c0.cy[g]));
        const [x1, y1] = clampPt(toPx(c1.cx[g], c1.cy[g]));
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      }
    }

    ctx.lineCap = "round";
    // dots (biggest first so small ones stay on top; selected last)
    const order = [...groups.keys()].filter((g) => vis(cur.n[g]) > 0)
      .sort((a, b) => (st.sel.has(a) - st.sel.has(b)) || cur.n[b] - cur.n[a]);
    lastFrame = { pos: [], cur, day };
    for (const g of order) {
      const v = vis(cur.n[g]) * dim(g);
      const [x, y] = clampPt(toPx(cur.cx[g], cur.cy[g]));
      const r = radius(g, cur.n[g]);
      const col = U.blocColor(groups[g].bloc);
      if (st.mode === "chairmen") U.drawAvatar(ctx, groups[g].acc, x, y, r, col, v, 3);
      else {
        ctx.globalAlpha = v;
        ctx.fillStyle = U.rgba(col, st.mode === "accounts" ? 0.8 : 1);
        ctx.strokeStyle = C.surface; ctx.lineWidth = st.mode === "accounts" ? 1.5 : 3;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (st.sel.has(g)) {
        ctx.strokeStyle = C.ink; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke();
      }
      lastFrame.pos.push({ g, x, y, r });
    }

    // arrow labels
    ctx.font = `700 14px ${C.font}`; ctx.lineJoin = "round";
    R.dims.forEach((d, i) => {
      const [x, y] = arrowEnds[i];
      let ux = x - ox, uy = y - oy; const L = Math.hypot(ux, uy) || 1; ux /= L; uy /= L;
      let lx = x + ux * 10, ly = y + uy * 10;
      if (Math.abs(ux) >= Math.abs(uy)) { ctx.textAlign = ux > 0 ? "left" : "right"; ctx.textBaseline = "middle"; }
      else { ctx.textAlign = "center"; ctx.textBaseline = uy > 0 ? "top" : "bottom"; }
      // keep the label inside the canvas on narrow screens
      const tw = ctx.measureText(d.label).width;
      const left = ctx.textAlign === "left" ? lx : ctx.textAlign === "right" ? lx - tw : lx - tw / 2;
      lx += Math.max(0, 4 - left) - Math.max(0, left + tw - (w - 4));
      ctx.strokeStyle = C.surface; ctx.lineWidth = 4; ctx.strokeText(d.label, lx, ly);
      ctx.fillStyle = C.ink; ctx.fillText(d.label, lx, ly);
    });

    // dot labels: lists always; chairmen/accounts only when selected; blocs never (legend)
    const labelled = lastFrame.pos.filter((p) => st.mode === "lists" || ((st.mode === "chairmen" || st.mode === "accounts") && st.sel.has(p.g)));
    if (labelled.length) {
      ctx.font = `700 14px ${C.font}`;
      const L = placeLabels(ctx, labelled.map((p) => ({ ...p, text: groups[p.g].name })), ox);
      for (const l of L) {
        const v = vis(cur.n[l.g]) * dim(l.g);
        const col = U.blocColor(groups[l.g].bloc);
        if (Math.abs(l.ly - l.y) > 9) {
          ctx.strokeStyle = U.rgba(col, 0.6 * v); ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.moveTo(l.x + (l.right ? l.r : -l.r), l.y); ctx.lineTo(l.lx + (l.right ? -3 : 3), l.ly); ctx.stroke();
        }
        ctx.textAlign = l.right ? "left" : "right"; ctx.textBaseline = "middle";
        ctx.globalAlpha = v;
        ctx.strokeStyle = C.surface; ctx.lineWidth = 4; ctx.strokeText(l.text, l.lx, l.ly);
        ctx.fillStyle = U.rgba(col); ctx.fillText(l.text, l.lx, l.ly);
        ctx.globalAlpha = 1;
      }
    }
  }

  function hitGroup(x, y) {
    if (!lastFrame) return -1;
    let best = -1, bd = Infinity;
    for (const p of lastFrame.pos) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r + 6 && d < bd) { bd = d; best = p.g; }
    }
    return best;
  }

  function hit(x, y) {
    const g = hitGroup(x, y);
    if (g < 0) return null;
    const c = lastFrame.cur, gr = groups[g];
    const col = U.blocColor(gr.bloc);
    const rows = R.dims.map((d, i) => {
      const share = c.n[g] > 0 ? c.dm[g * ND + i] / c.n[g] : 0;
      return `<div class="row"><span style="flex:1">${U.esc(d.label)}</span><span class="m" style="font-family:var(--mono)">${Math.round(100 * share)}%</span>` +
        `<span class="bar" style="width:${Math.round(60 * share)}px;background:${U.rgba(d.color)}"></span><span style="width:${60 - Math.round(60 * share)}px"></span></div>`;
    }).join("");
    return {
      html: `<b style="color:${U.rgba(col)}">${U.esc(gr.name)}</b>${gr.sub ? ` <span class="m">· ${U.esc(gr.sub)}</span>` : ""}` +
        `<div class="m">${c.cnt[g]} posts in the ${st.win}-day window</div>` +
        `<div style="margin-top:6px">${rows}</div><div class="hint">Share of the window's posts that address each dimension. Click to ${st.sel.has(g) ? "unfollow" : "follow"}.</div>`,
    };
  }

  function toggleSel(g) {
    if (st.sel.has(g)) st.sel.delete(g); else st.sel.add(g);
    renderLegend();
    App.redraw();
  }

  // ---------------------------------------------------------------- rail
  let legendBox, legendRows = [];
  function renderLegend() {
    if (!legendBox) return;
    legendBox.innerHTML = "";
    legendRows = [];
    let lastBloc = null;
    groups.forEach((gr, g) => {
      if (st.mode !== "blocs" && gr.bloc !== lastBloc) {
        lastBloc = gr.bloc;
        legendBox.append(U.el("div", { class: "grp" }, U.esc(R.blocs[gr.bloc])));
      }
      const col = U.rgba(U.blocColor(gr.bloc));
      const sw = gr.acc && gr.acc.av
        ? `<img class="sw" alt="" src="${U.avatarSrc(gr.acc)}" style="box-shadow:0 0 0 2px ${col}">`
        : `<span class="sw" style="background:${col}"></span>`;
      const sub = st.mode === "lists" || st.mode === "blocs" ? "" : `<small><bdi>${U.esc(gr.sub)}</bdi></small>`;
      const b = U.el("button", { type: "button", "aria-pressed": String(st.sel.has(g)) },
        `${sw}<span class="nm"><bdi>${U.esc(gr.name)}</bdi>${sub}</span><span class="v"></span>`);
      b.addEventListener("click", () => toggleSel(g));
      legendBox.append(b);
      legendRows.push(b);
    });
  }

  function panel(day) {
    if (!lastFrame) return;
    const c = lastFrame.cur;
    legendRows.forEach((b, g) => {
      b.querySelector(".v").textContent = c.cnt[g];
      b.classList.toggle("off", vis(c.n[g]) <= 0);
    });
  }

  let minField, trailIn;
  function mount(rail) {
    const c1 = U.card(rail, "Show one dot per");
    U.seg(c1, {
      label: "Group by", value: st.mode,
      options: Object.entries(MODES).map(([k, m]) => [k, m.label]),
      onChange: (m) => {
        st.mode = m; st.trail = MODES[m].trail; trailIn.value = st.trail;
        trailIn.dispatchEvent(new Event("input"));
        minField.hidden = m === "blocs";
        buildGroups(); fit(); renderLegend(); App.redraw();
      },
    });
    U.slider(c1, { id: "mca-win", label: "Window", min: 7, max: 120, value: st.win, unit: " days",
      onInput: (v) => { st.win = v; st.taper = Math.min(st.taper, v / 2); fit(); App.rangeChanged(); } });
    U.slider(c1, { id: "mca-taper", label: "Fade in/out at window edges", min: 0, max: 30, value: st.taper, unit: " days",
      onInput: (v) => { st.taper = Math.min(v, st.win / 2); fit(); App.redraw(); } });
    trailIn = U.slider(c1, { id: "mca-trail", label: "Trail", min: 0, max: 120, value: st.trail, unit: " days",
      onInput: (v) => { st.trail = v; App.redraw(); } });
    minField = U.el("div");
    U.slider(minField, { id: "mca-min", label: "Fade out below", min: 1, max: 15, value: st.minPosts, unit: " posts",
      onInput: (v) => { st.minPosts = v; fit(); App.redraw(); } });
    minField.hidden = st.mode === "blocs";
    c1.append(minField);

    const c2 = U.card(rail, "Posts in window");
    legendBox = U.el("div", { class: "legend" });
    c2.append(legendBox, U.el("p", { class: "small" }, "Click a name or dot to follow it; the others fade."));
    renderLegend();

    const c3 = U.card(rail, "How to read it");
    c3.append(U.el("ul", { class: "notes" },
      "<li>A dot is the centroid of the group's posts in the trailing window, on an MCA of the five policy dimensions (posts of both blocs).</li>" +
      "<li>Each arrow points toward posts that address that dimension. Moving toward an arrow means a larger share of recent posts addresses it.</li>" +
      `<li>Arrow directions are exact; their lengths are scaled to fit.</li>`));
  }

  buildGroups();
  fit();

  App.view({
    id: "map", title: "Policy map",
    range: () => [st.win, R.T],
    defaultDay: () => R.T * 0.85,
    mount, draw, hit, panel,
    click(x, y) { const g = hitGroup(x, y); if (g >= 0) toggleSel(g); return g >= 0; },
    sub: (day) => `MCA map of ${MODES[st.mode].label.toLowerCase()} · posts from ${U.fmtDate(day - st.win, { day: "2-digit", month: "short" })} to ${U.fmtDate(day, { day: "2-digit", month: "short", year: "numeric" })}`,
    aspect: 0.7,
  });
})();
