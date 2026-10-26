// Post bubbles: the interactive bubble_race.py. Each post is a bubble that emerges from its account's lane on
// the dock at upload time and rises as the timeline runs. The dock holds the top accounts of a look-back window,
// re-ranked every DOCK_STEP days with hysteresis (a port of dock_schedule()), and a lane that changes hands glows.
(function () {
  const { R, U, C } = App;
  const P = R.posts;
  const DOCK_STEP = 30, DOCK_WINDOW = 60, HYST = 1.3, STAGGER = 0.8, ALERT_DAYS = 15, POP_DAYS = 0.6, ICON_Q = 0.97;
  const GOLD = [240, 180, 0], GREEN = [46, 160, 67];
  const T0 = Date.parse(R.t0 + "T00:00:00Z"), DAY = 86400000;

  const st = { top: window.innerWidth < 700 ? 8 : 15, rankBy: "views", bloc: "all", pxd: 10 };

  // ---------------------------------------------------------------- per-post statics
  const days = Float64Array.from(P.day);
  const quant = (arr) => {
    const s = Float64Array.from(arr).sort();
    const x = ICON_Q * (s.length - 1), i = Math.floor(x);
    return s[i] + (s[Math.min(i + 1, s.length - 1)] - s[i]) * (x - i);
  };
  const qV = quant(P.views), qL = quant(P.likes), qC = quant(P.comments);
  // radius fraction from log views, as in load(): 5th percentile .. max
  const lv = Float64Array.from(P.views, (v) => Math.log10(Math.max(v, 1)));
  const sortedLv = Float64Array.from(lv).sort();
  const lvLo = Math.max(sortedLv[Math.floor(0.05 * (sortedLv.length - 1))], 0), lvHi = sortedLv[sortedLv.length - 1];
  const frac = Float64Array.from(lv, (v) => U.clamp((v - lvLo) / (lvHi - lvLo), 0, 1) ** 1.6);
  // deterministic jitter in [-1, 1] from the post id (FNV-1a)
  const jit = Float64Array.from(P.id, (s) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295 * 2 - 1;
  });
  // per-account cumulative posts/views for the lane stats and the race
  const NA = R.accounts.length;
  const accDays = Array.from({ length: NA }, () => []), accCumV = Array.from({ length: NA }, () => []);
  const firstDay = new Float64Array(NA).fill(Infinity);
  for (let i = 0; i < P.n; i++) {
    const a = P.acc[i];
    const prev = accCumV[a].length ? accCumV[a][accCumV[a].length - 1] : 0;
    accDays[a].push(P.day[i]); accCumV[a].push(prev + P.views[i]);
    if (P.day[i] < firstDay[a]) firstDay[a] = P.day[i];
  }
  const accAt = (a, day) => {
    const k = U.lowerBound(accDays[a], day + 1e-9);
    return [k, k ? accCumV[a][k - 1] : 0];
  };
  // totals over all posts
  const cum = { v: new Float64Array(P.n + 1), l: new Float64Array(P.n + 1), c: new Float64Array(P.n + 1) };
  for (let i = 0; i < P.n; i++) {
    cum.v[i + 1] = cum.v[i] + P.views[i]; cum.l[i + 1] = cum.l[i] + P.likes[i]; cum.c[i + 1] = cum.c[i] + P.comments[i];
  }

  // ---------------------------------------------------------------- dock schedule (port of dock_schedule)
  let epochs = [], events = [], bub = null; // bub: post indices on the dock (day order) and their lane
  function allowed(a) {
    const acc = R.accounts[a];
    if (st.bloc === "all") return true;
    if (st.bloc === "none") return acc.blocIdx < 0;
    return acc.blocIdx === +st.bloc;
  }
  function schedule() {
    const N = st.top;
    const slots = new Array(N).fill(null);
    epochs = []; events = [];
    const nEp = Math.floor(R.T / DOCK_STEP) + 1;
    for (let k = 0; k < nEp; k++) {
      const T = k * DOCK_STEP;
      const i0 = U.lowerBound(days, T - (DOCK_WINDOW - DOCK_STEP)), i1 = U.lowerBound(days, T + DOCK_STEP);
      const score = new Map();
      for (let i = i0; i < i1; i++) {
        const a = P.acc[i];
        if (!allowed(a)) continue;
        score.set(a, (score.get(a) || 0) + (st.rankBy === "views" ? P.views[i] : 1));
      }
      const ranked = [...score.keys()].sort((p, q) => score.get(q) - score.get(p) || (R.accounts[p].u < R.accounts[q].u ? -1 : 1));
      const rank = new Map(ranked.map((a, i) => [a, i]));
      const top = ranked.slice(0, N);
      if (k === 0) {
        [...top].sort((p, q) => firstDay[p] - firstDay[q]).forEach((a, i) => { slots[i] = a; });
      } else {
        const members = new Set(slots);
        const rk = (a) => (a === null || !rank.has(a) ? Infinity : rank.get(a));
        const weak = slots.map((a, i) => i).filter((i) => slots[i] === null || rk(slots[i]) >= N * HYST)
          .sort((i, j) => (slots[i] !== null) - (slots[j] !== null) || rk(slots[j]) - rk(slots[i]));
        let m = 0;
        for (const a of top) {
          if (members.has(a)) continue;
          if (!weak.length) break;
          const i = weak.shift();
          events.push({ day: T + m * STAGGER, epoch: k, slot: i, old: slots[i], nu: a });
          m++;
          slots[i] = a;
        }
      }
      epochs.push([...slots]);
    }
    const slotOf = epochs.map((e) => new Map(e.map((a, i) => [a, i]).filter(([a]) => a !== null)));
    const idx = [], lane = [];
    for (let i = 0; i < P.n; i++) {
      const ep = Math.min(Math.floor(P.day[i] / DOCK_STEP), epochs.length - 1);
      const s = slotOf[ep].get(P.acc[i]);
      if (s !== undefined) { idx.push(i); lane.push(s); }
    }
    bub = { idx: Int32Array.from(idx), lane: Int32Array.from(lane), day: Float64Array.from(idx, (i) => P.day[i]) };
    App.redraw();
  }
  const epochAt = (day) => Math.min(Math.max(0, Math.floor(day / DOCK_STEP)), epochs.length - 1);

  // ---------------------------------------------------------------- drawing helpers
  function star(ctx, x, y, r, fill) {
    ctx.beginPath();
    for (let k = 0; k < 10; k++) {
      const rr = k % 2 ? r * 0.45 : r, a = -Math.PI / 2 + k * Math.PI / 5;
      ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C.surface; ctx.stroke();
  }
  function heart(ctx, x, y, r, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y + r * 0.8);
    ctx.bezierCurveTo(x - r * 1.3, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.35);
    ctx.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.3, y - r * 0.1, x, y + r * 0.8);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C.surface; ctx.stroke();
  }
  function speech(ctx, x, y, r, fill) {
    const w = r * 1.9, h = r * 1.35;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, r * 0.3);
    ctx.moveTo(x + w * 0.1, y + h / 2 - 0.5); ctx.lineTo(x + w * 0.35, y + h / 2 + r * 0.55); ctx.lineTo(x + w * 0.35, y + h / 2 - 0.5);
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = C.surface; ctx.stroke();
  }
  // genre ring colour; dark rings (ethos navy) are lightened on the dark theme so they stay visible
  const genreCol = (g) => {
    const c = R.genreColors[g] || R.genreColors[R.genreColors.length - 1];
    return C.dark && Math.max(...c) < 120 ? c.map((v) => Math.round(v + (255 - v) * 0.45)) : c;
  };
  const shortName = (ctx, s, maxW) => {
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
    return s + "…";
  };
  const monthStarts = (d0, d1) => {
    const a = new Date(T0 + d0 * DAY), out = [];
    let y = a.getUTCFullYear(), m = a.getUTCMonth();
    for (;;) {
      const d = (Date.UTC(y, m, 1) - T0) / DAY;
      if (d > d1) break;
      if (d >= d0) out.push([d, new Date(Date.UTC(y, m, 1))]);
      if (++m > 11) { m = 0; y++; }
    }
    return out;
  };

  // ---------------------------------------------------------------- frame
  let frame = null; // last frame's layout and drawn bubbles, for hit tests
  function draw(ctx, w, h, day) {
    if (!bub) return;
    const narrow = w < 600;
    const X0 = narrow ? 8 : 92, X1 = w - (narrow ? 8 : 16);
    const N = st.top, laneW = (X1 - X0) / N;
    const alt = laneW < 84; // lane names alternate between two rows when lanes are narrow
    const dockY = h - (narrow ? 64 : alt ? 112 : 84), top = 8, pxd = st.pxd;
    const laneX = (i) => X0 + laneW * (i + 0.5);
    const visibleDays = (dockY - top + 60) / pxd;
    const rmax = Math.min(34, laneW * 0.6), rmin = Math.min(3, rmax / 3);

    // month gridlines and labels scrolling up
    ctx.font = `${narrow ? 11 : 13}px ${C.font}`;
    ctx.textBaseline = "middle";
    for (const [d, dt] of monthStarts(day - visibleDays, day)) {
      const y = dockY - (day - d) * pxd;
      if (y < top || y > dockY - 6) continue;
      const al = U.clamp((y - top) / 100, 0, 1);
      ctx.strokeStyle = C.grid; ctx.globalAlpha = al; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X0 - 6, y + 0.5); ctx.lineTo(X1, y + 0.5); ctx.stroke();
      ctx.fillStyle = C.muted; ctx.textAlign = narrow ? "left" : "right";
      ctx.fillText(dt.toLocaleDateString("en-GB", { timeZone: "UTC", month: narrow ? "short" : "long", year: narrow ? "2-digit" : "numeric" }),
        narrow ? X0 + 2 : X0 - 12, y - (narrow ? 7 : 0));
      ctx.globalAlpha = 1;
    }

    // lanes that just changed hands glow
    const changed = new Map();
    for (const e of events) {
      const age = day - e.day;
      if (age >= 0 && age < ALERT_DAYS) changed.set(e.slot, Math.max(changed.get(e.slot) || 0, (1 - age / ALERT_DAYS) ** 2));
    }
    for (const [s, al] of changed) {
      const g = ctx.createLinearGradient(0, top, 0, dockY);
      g.addColorStop(0, U.rgba(GOLD, 0)); g.addColorStop(1, U.rgba(GOLD, 0.35 * al));
      ctx.fillStyle = g;
      ctx.fillRect(laneX(s) - laneW / 2 + 1, top, laneW - 2, dockY - top);
    }

    // bubbles: posts uploaded in [day - visibleDays, day], small first so viral ones sit on top
    const i0 = U.lowerBound(bub.day, day - visibleDays), i1 = U.lowerBound(bub.day, day + 1e-9);
    const list = [];
    for (let k = i0; k < i1; k++) {
      const p = bub.idx[k];
      const age = day - P.day[p];
      const r0 = rmin + (rmax - rmin) * frac[p];
      const r = Math.max(1.5, r0 * (0.3 + 0.7 * Math.min(1, age / POP_DAYS)));
      const y = dockY - 8 - r0 - age * pxd;
      const alpha = U.clamp((y - top) / 90, 0, 1);
      if (alpha <= 0) continue;
      const x = laneX(bub.lane[k]) + jit[p] * Math.max(0, laneW / 2 - r0 * 0.6);
      list.push({ p, x, y, r, alpha });
    }
    list.sort((a, b) => a.r - b.r);
    for (const b of list) {
      const acc = R.accounts[P.acc[b.p]];
      const ring = genreCol(P.genre[b.p]);
      if (b.r >= 5) U.drawAvatar(ctx, acc, b.x, b.y, b.r, ring, b.alpha, Math.max(1.5, b.r * 0.13));
      else {
        ctx.globalAlpha = b.alpha;
        ctx.fillStyle = U.rgba(ring);
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (b.r >= 6) {
        ctx.globalAlpha = b.alpha;
        const s = U.clamp(b.r * 0.32, 4, 9);
        if (P.views[b.p] >= qV) star(ctx, b.x + b.r * 0.1, b.y - b.r - s * 0.2, s * 1.15, U.rgba(GOLD));
        if (P.likes[b.p] >= qL) heart(ctx, b.x - b.r * 0.78, b.y - b.r * 0.72, s * 0.85, U.rgba(GREEN));
        if (P.comments[b.p] >= qC) speech(ctx, b.x + b.r * 0.8, b.y - b.r * 0.7, s * 0.8, C.ink);
        ctx.globalAlpha = 1;
      }
    }

    // dock bar, nozzles, lane avatars and stats
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.roundRect(X0 - 6, dockY - 6, X1 - X0 + 12, 12, 6); ctx.fill();
    const slots = epochs[epochAt(day)];
    const lanes = [];
    const avR = U.clamp(laneW * 0.3, 8, 16);
    for (let i = 0; i < slots.length; i++) {
      const a = slots[i];
      if (a === null) continue;
      const x = laneX(i), acc = R.accounts[a];
      // nozzle brightens when the account posted in the last 2 days
      const recent = U.lowerBound(accDays[a], day + 1e-9) > U.lowerBound(accDays[a], day - 2);
      ctx.fillStyle = recent ? U.rgba(GOLD) : C.surface;
      ctx.beginPath(); ctx.arc(x, dockY, 4, 0, Math.PI * 2); ctx.fill();
      const ay = dockY + 8 + avR;
      if (changed.has(i)) {
        ctx.fillStyle = U.rgba(GOLD, 0.55 * changed.get(i));
        ctx.beginPath(); ctx.arc(x, ay, avR + 5, 0, Math.PI * 2); ctx.fill();
      }
      U.drawAvatar(ctx, acc, x, ay, avR, U.blocColor(acc.blocIdx), 1, 2);
      lanes.push({ a, x, y: ay, r: avR });
      if (narrow) continue;
      const [n, v] = accAt(a, day);
      const ty = ay + avR + 5 + (alt ? (i % 2) * 26 : 0);
      const maxW = alt ? laneW * 2 - 6 : laneW - 4;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = `700 12px ${C.font}`; ctx.fillStyle = C.ink;
      ctx.fillText(shortName(ctx, acc.name, maxW), x, ty);
      ctx.font = `11px ${C.font}`; ctx.fillStyle = C.muted;
      ctx.fillText(`${n} · ${U.fmtNum(v)}`, x, ty + 13);
    }
    frame = { list, lanes };
  }

  // ---------------------------------------------------------------- interaction
  function hitBubble(x, y) {
    if (!frame) return null;
    for (let k = frame.list.length - 1; k >= 0; k--) {
      const b = frame.list[k];
      if (Math.hypot(b.x - x, b.y - y) <= Math.max(b.r, 4) + 2) return b;
    }
    return null;
  }
  function hitLane(x, y) {
    if (!frame) return null;
    return frame.lanes.find((l) => Math.hypot(l.x - x, l.y - y) <= l.r + 3) || null;
  }
  function hit(x, y) {
    const b = hitBubble(x, y);
    if (b) {
      const p = b.p, acc = R.accounts[P.acc[p]];
      const g = P.genre[p], gc = U.rgba(genreCol(g));
      const dims = P.dims[p] < 0 ? '<span class="m">Policy dimensions not labelled</span>'
        : R.dims.filter((d, k) => P.dims[p] >> k & 1).map((d) => `<span dir="rtl" style="display:inline-block;margin:2px 4px 0 0;padding:0 6px;border-radius:4px;border:1px solid ${U.rgba(d.color)};font-size:12px">${U.esc(d.label)}</span>`).join("")
          || '<span class="m">No policy dimension</span>';
      const badges = [P.views[p] >= qV && "top 3% views", P.likes[p] >= qL && "top 3% likes", P.comments[p] >= qC && "top 3% comments"].filter(Boolean);
      return {
        html: `<b>${U.esc(acc.name)}</b> <span class="m">· ${U.esc(acc.list || acc.faction || "")}</span>` +
          `<div class="m">${U.fmtDate(P.day[p])}</div>` +
          `<div style="font-family:var(--mono);font-size:12px;margin-top:4px">${U.fmtNum(P.views[p])} views · ${U.fmtNum(P.likes[p])} likes · ${U.fmtNum(P.comments[p])} comments</div>` +
          `<div class="row" style="margin-top:4px"><span style="width:10px;height:10px;border-radius:50%;border:2px solid ${gc}"></span>${U.esc(R.genres[g])}${badges.length ? ` <span class="m">· ${badges.join(", ")}</span>` : ""}</div>` +
          `<div style="margin-top:4px">${dims}</div><div class="hint">Click to open the post on TikTok.</div>`,
      };
    }
    const l = hitLane(x, y);
    if (l) {
      const acc = R.accounts[l.a];
      const [n, v] = accAt(l.a, App.S.day);
      return {
        html: `<b>${U.esc(acc.name)}</b> <span class="m">@${U.esc(acc.u)}</span>` +
          `<div class="m">${U.esc([acc.list || acc.faction, acc.bloc].filter(Boolean).join(" · "))}</div>` +
          `<div style="font-family:var(--mono);font-size:12px;margin-top:4px">${n} posts · ${U.fmtNum(v)} views so far</div>`,
        cursor: "default",
      };
    }
    return null;
  }
  function click(x, y) {
    const b = hitBubble(x, y);
    if (!b) return false;
    const a = U.el("a", { href: `https://www.tiktok.com/@${R.accounts[P.acc[b.p]].u}/video/${P.id[b.p]}`, target: "_blank", rel: "noopener" });
    document.body.append(a); a.click(); a.remove();
    return false;
  }

  // ---------------------------------------------------------------- rail
  let raceBox, raceRows = null, feedBox;
  const ROW_H = 34, RACE_N = 10;
  function mount(rail) {
    const c1 = U.card(rail, "Dock");
    U.slider(c1, { id: "bub-top", label: "Lanes", min: 8, max: 20, value: st.top, onInput: (v) => { st.top = v; schedule(); } });
    const lab = U.el("div", { class: "small" }, "Rank accounts by");
    c1.append(lab);
    U.seg(c1, { label: "Rank by", value: st.rankBy, options: [["views", "Views"], ["posts", "Posts"]], onChange: (v) => { st.rankBy = v; schedule(); } });
    const sel = U.el("select", { class: "ctl", id: "bub-bloc", "aria-label": "Accounts that can join the dock" },
      `<option value="all">All accounts</option>` + R.blocs.map((b, i) => `<option value="${i}">${U.esc(b)}</option>`).join("") +
      `<option value="none">Outside the two blocs</option>`);
    sel.value = st.bloc;
    sel.addEventListener("change", () => { st.bloc = sel.value; schedule(); });
    c1.append(U.el("div", { class: "small" }, "Who can join the dock"), sel);
    U.slider(c1, { id: "bub-pxd", label: "Zoom", min: 3, max: 30, value: st.pxd, unit: " px/day", onInput: (v) => { st.pxd = v; App.redraw(); } });

    const c2 = U.card(rail, "Total views so far");
    raceBox = U.el("div", { style: `position:relative;height:${RACE_N * ROW_H}px` });
    c2.append(raceBox);
    raceRows = null;

    const c3 = U.card(rail, "Dock changes");
    feedBox = U.el("div", { class: "legend", style: "max-height:220px" });
    c3.append(feedBox);

    const c4 = U.card(rail, "How to read it");
    const ring = (g) => `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;border:2.5px solid ${U.rgba(genreCol(g))};vertical-align:-1px"></span>`;
    c4.append(U.el("ul", { class: "notes" },
      `<li>Each bubble is a post, launched from its account's lane at upload time. Its size shows views.</li>` +
      `<li>Outline shows rhetoric genre: ${R.genres.map((g, i) => `${ring(i)} ${U.esc(g)}`).join(", ")}.</li>` +
      `<li><b style="color:${U.rgba(GOLD)}">★</b> top 3% by views, <b style="color:${U.rgba(GREEN)}">♥</b> top 3% by likes, speech bubble: top 3% by comments.</li>` +
      `<li>The dock holds the top accounts of the last ${DOCK_WINDOW} days, re-ranked every ${DOCK_STEP} days. A lane that changes hands glows.</li>` +
      `<li>Hover a bubble for the post's numbers; click it to open the post on TikTok.</li>`));
  }

  let feedKey = null;
  function panel(day) {
    if (!raceBox) return;
    // race: top accounts by cumulative views; rows glide with CSS transitions
    if (!raceRows) {
      raceRows = R.accounts.map((acc) => {
        const row = U.el("div", { style: `position:absolute;left:0;right:0;top:0;height:${ROW_H - 4}px;display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;align-items:center;transition:transform .45s ease, opacity .3s;opacity:0` },
          (acc.av ? `<img alt="" src="${U.avatarSrc(acc)}" style="width:22px;height:22px;border-radius:50%;box-shadow:0 0 0 2px ${U.rgba(U.blocColor(acc.blocIdx))}">` : `<span style="width:22px;height:22px;border-radius:50%;background:${U.rgba(U.blocColor(acc.blocIdx))}"></span>`) +
          `<div style="min-width:0"><div style="display:flex;justify-content:space-between;gap:6px;font-size:12px;line-height:1.2"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700">${U.esc(acc.name)}</span><span class="v" style="font-family:var(--mono);color:var(--muted)"></span></div>` +
          `<div style="height:5px;margin-top:3px;border-radius:3px;background:var(--accent);width:0" class="b"></div></div>`);
        raceBox.append(row);
        return row;
      });
    }
    const vals = R.accounts.map((a) => accAt(a.i, day)[1]);
    const order = vals.map((v, i) => i).sort((a, b) => vals[b] - vals[a]);
    const vmax = Math.max(vals[order[0]], 1);
    order.forEach((a, rk) => {
      const row = raceRows[a];
      const on = rk < RACE_N && vals[a] > 0;
      row.style.transform = `translateY(${Math.min(rk, RACE_N) * ROW_H}px)`;
      row.style.opacity = on ? 1 : 0;
      if (on) {
        row.querySelector(".v").textContent = U.fmtNum(vals[a]);
        row.querySelector(".b").style.width = (100 * vals[a] / vmax).toFixed(1) + "%";
      }
    });
    // feed: lane changes in the last ALERT_DAYS, newest first
    const recent = events.filter((e) => e.day <= day && day - e.day < ALERT_DAYS).reverse();
    const key = recent.map((e) => e.day + ":" + e.slot).join();
    if (key !== feedKey) {
      feedKey = key;
      feedBox.innerHTML = recent.length ? recent.map((e) => {
        const nu = R.accounts[e.nu], old = e.old !== null ? R.accounts[e.old] : null;
        return `<div style="display:grid;grid-template-columns:22px minmax(0,1fr);gap:8px;align-items:center;padding:4px 6px;font-size:13px">` +
          (nu.av ? `<img alt="" src="${U.avatarSrc(nu)}" style="width:22px;height:22px;border-radius:50%">` : `<span></span>`) +
          `<span style="min-width:0"><b style="color:${U.rgba(GREEN)}">▲</b> <b>${U.esc(nu.name)}</b> joins` +
          (old ? `<br><span class="small">▼ replaces ${U.esc(old.name)}</span>` : "") + `</span></div>`;
      }).join("") : `<p class="small" style="padding:0 6px">No changes in the last ${ALERT_DAYS} days.</p>`;
    }
  }

  function sub(day) {
    const k = U.lowerBound(days, day + 1e-9);
    return `${k.toLocaleString("en-US")} posts · ${U.fmtNum(cum.v[k])} views · ${U.fmtNum(cum.l[k])} likes · ${U.fmtNum(cum.c[k])} comments so far`;
  }

  schedule();
  App.view({
    id: "bubbles", title: "Post bubbles",
    range: () => [0, R.T],
    defaultDay: () => R.T * 0.6,
    mount, draw, hit, click, panel, sub,
    unmount() { raceBox = null; raceRows = null; feedBox = null; feedKey = null; },
    aspect: 0.68,
  });
})();
