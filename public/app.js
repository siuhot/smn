// ===== CONFIG =====
// ⚠️ sửa đúng domain worker (KHÔNG .workers.dev.workers.dev)
const API_BASE = "https://smn.itstarsec.workers.dev";  // <-- đổi nếu cần
const UI_REFRESH_MS = 8000;

// ===== DOM helpers =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const state = {
  view: "overview",
  scenario: "hot_15m",
  scenarios: [],
  logs: [],
  timer: null,
};

async function api(path) {
  // an toàn tuyệt đối, tránh ghép sai URL
  const url = new URL(path, API_BASE);

  const res = await fetch(url.toString(), { method: "GET" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

function setView(view) {
  state.view = view;

  const map = {
    overview: "#view-overview",
    signals: "#view-signals",
    watchlist: "#view-watchlist",
    reports: "#view-reports",
    logs: "#view-logs",
    settings: "#view-settings",
  };

  Object.values(map).forEach((sel) => $(sel)?.classList.add("hidden"));
  $(map[view])?.classList.remove("hidden");

  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
}

function addLog(line) {
  const ts = new Date().toLocaleTimeString();
  state.logs.unshift(`[${ts}] ${line}`);
  state.logs = state.logs.slice(0, 120);
  const box = $("#logsBox");
  if (box) box.textContent = state.logs.join("\n");
}

function fmtVnd(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("vi-VN") + " VND";
}
function fmtNum(n) {
  if (typeof n !== "number") return String(n);
  return n.toLocaleString("vi-VN");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[m]));
}

// ===== Renderers =====
function renderScenarioList() {
  const el = $("#scenarioList");
  if (!el) return;

  el.innerHTML = (state.scenarios || []).map((s) => `
    <div class="sc-item">
      <div class="sc-title">${escapeHtml(s.name)}</div>
      <div class="sc-desc">${escapeHtml(s.desc)}</div>
    </div>
  `).join("") || `<div class="muted">—</div>`;
}

function renderSignalsTable(sid, rows) {
  const table = $("#signalsTable");
  if (!table) return;

  let cols = [];
  let grid = "";
  let outRows = [];

  if (sid === "hot_15m") {
    cols = ["Symbol", "Count", "Amount"];
    grid = "1fr 1fr 1fr";
    outRows = rows.map((r) => [r[0], fmtNum(r[1]), fmtVnd(r[2])]);
  } else if (sid === "flow_30m") {
    cols = ["Symbol", "Buy", "Sell", "Net"];
    grid = "1fr 1fr 1fr 1fr";
    outRows = rows.map((r) => {
      const net = (r[1] - r[2]);
      const netTxt = (net >= 0 ? "+" : "") + fmtVnd(net);
      return [r[0], fmtVnd(r[1]), fmtVnd(r[2]), netTxt];
    });
  } else if (sid === "spike_5m") {
    cols = ["Symbol", "Spike x", "Score"];
    grid = "1fr 1fr 1fr";
    outRows = rows.map((r) => [r[0], String(r[1]), fmtNum(r[2])]);
  } else if (sid === "whale_15m") {
    cols = ["Symbol", "Amount", "Side"];
    grid = "1fr 1fr 1fr";
    outRows = rows.map((r) => [r[0], fmtVnd(r[1]), r[2]]);
  } else {
    cols = ["Data"];
    grid = "1fr";
    outRows = (rows || []).map((r) => [String(r)]);
  }

  const head = `
    <div class="trow thead" style="grid-template-columns:${grid}">
      ${cols.map((c) => `<div class="tcell">${escapeHtml(c)}</div>`).join("")}
    </div>
  `;

  const body = outRows.map((r) => `
    <div class="trow" style="grid-template-columns:${grid}">
      ${r.map((v) => `<div class="tcell">${escapeHtml(v)}</div>`).join("")}
    </div>
  `).join("");

  table.innerHTML = head + body;
}

function renderWatchlist(list) {
  const el = $("#watchChips");
  if (!el) return;
  el.innerHTML = (list || []).map((s) => `<div class="chip">${escapeHtml(s)}</div>`).join("");
}

function renderWatchSnapshotTable(rowsHot, rowsFlow, watchlist) {
  const table = $("#watchTable");
  if (!table) return;

  const hotMap = new Map((rowsHot || []).map((r) => [r[0], r]));
  const flowMap = new Map((rowsFlow || []).map((r) => [r[0], r]));

  const symbols = (watchlist && watchlist.length ? watchlist : Array.from(new Set([...hotMap.keys(), ...flowMap.keys()])))
    .slice(0, 12);

  const cols = ["Symbol", "Hot Count", "Net Flow (30m)"];
  const grid = "1fr 1fr 1fr";

  const head = `
    <div class="trow thead" style="grid-template-columns:${grid}">
      ${cols.map((c) => `<div class="tcell">${escapeHtml(c)}</div>`).join("")}
    </div>
  `;

  const body = symbols.map((sym) => {
    const h = hotMap.get(sym);
    const f = flowMap.get(sym);
    const hotCnt = h ? fmtNum(h[1]) : "—";
    const net = f ? (f[1] - f[2]) : null;
    const netTxt = (net === null) ? "—" : ((net >= 0 ? "+" : "") + fmtVnd(net));
    return `
      <div class="trow" style="grid-template-columns:${grid}">
        <div class="tcell">${escapeHtml(sym)}</div>
        <div class="tcell">${escapeHtml(hotCnt)}</div>
        <div class="tcell">${escapeHtml(netTxt)}</div>
      </div>
    `;
  }).join("");

  table.innerHTML = head + body;
}

function renderBrief(summary, hotRows, spikeRows) {
  const box = $("#dailyBrief");
  if (!box) return;

  const topHot = hotRows?.[0]?.[0] || "—";
  const topSpike = spikeRows?.[0]?.[0] || "—";
  const buy = fmtVnd(summary?.totals?.buyAmount ?? 0);
  const sell = fmtVnd(summary?.totals?.sellAmount ?? 0);
  const cnt = fmtNum(summary?.totals?.tradeCount ?? 0);

  const text =
`DAILY BRIEF (MVP)
- Pulse: ${summary?.market?.pulse || "—"}
- Top HOT 15m: ${topHot}
- Top SPIKE 5m: ${topSpike}
- Buy: ${buy}
- Sell: ${sell}
- Trades: ${cnt}

Cách dùng:
- HOT: biết mã đang được chú ý.
- NET FLOW: cảm nhận lực mua/bán ròng.
- SPIKE: bắt bất thường ngắn hạn (tự kiểm chứng chart/giá).`;

  box.textContent = text;
}

// ===== Decision Badge Engine =====
function updateDecision(summary, flowRows, spikeRows) {
  const badge = $("#decisionBadge");
  if (!badge) return;

  const pulse = summary?.market?.pulse || "—";
  const hot = Number(summary?.market?.hotScore ?? 0);

  // netFlow = sum(buy - sell) trong flowRows
  const netFlow = (flowRows || []).reduce((s, r) => s + ((Number(r[1]) || 0) - (Number(r[2]) || 0)), 0);

  // bestSpike = max spikeX
  const bestSpike = Math.max(0, ...(spikeRows || []).map((r) => Number(r[1]) || 0));
  const topSpikeSym = (spikeRows?.[0]?.[0]) || "—";
  const topSymbol = summary?.market?.topSymbol || "—";

  // RULES
  const isSetupSpike =
    pulse === "Nghiêng mua" &&
    netFlow > 500_000_000 &&
    bestSpike >= 2.0 &&
    hot < 80;

  const isLateTrend =
    pulse === "Nghiêng mua" &&
    netFlow > 0 &&
    bestSpike < 2.0 &&
    hot >= 75;

  if (isSetupSpike) {
    badge.className = "decision buy";
    badge.innerHTML = `🟢 SETUP SPIKE — vào mã spike
      <small>Net Flow dương mạnh, spike nổi bật (${topSpikeSym}), Hot Score chưa quá cao → ưu tiên “vào sớm”.</small>`;
    return;
  }

  if (isLateTrend) {
    badge.className = "decision late";
    badge.innerHTML = `🟡 LATE TREND — follow top
      <small>Thị trường nóng, spike không rõ → nếu follow (${topSymbol}) thì đánh nhỏ & chốt nhanh.</small>`;
    return;
  }

  badge.className = "decision no";
  badge.innerHTML = `🔴 NO TRADE ZONE — đứng ngoài
    <small>Chưa có edge rõ ràng (Pulse/Net Flow/Spike/Hot Score chưa đồng thuận).</small>`;
}

// ===== Data refresh =====
async function refreshAll(reason = "auto") {
  try {
    const [sc, summary, hot, flow, spike, whale, watch] = await Promise.all([
      api("/api/scenarios"),
      api("/api/summary"),
      api("/api/data?id=hot_15m"),
      api("/api/data?id=flow_30m"),
      api("/api/data?id=spike_5m"),
      api("/api/data?id=whale_15m"),
      api("/api/data?id=watchlist"),
    ]);

    // scenarios
    state.scenarios = sc.scenarios || [];
    renderScenarioList();

    // summary tiles
    $("#pulse").textContent = summary.market.pulse;
    $("#topSymbol").textContent = summary.market.topSymbol;
    $("#hotScore").textContent = String(summary.market.hotScore);
    $("#buyAmt").textContent = fmtVnd(summary.totals.buyAmount);
    $("#sellAmt").textContent = fmtVnd(summary.totals.sellAmount);
    $("#tradeCnt").textContent = fmtNum(summary.totals.tradeCount);
    $("#lastTs").textContent = new Date(summary.ts).toLocaleTimeString();

    // decision badge (5-block engine)
    updateDecision(summary, flow.rows, spike.rows);

    // current signals tab
    const cur = await api(`/api/data?id=${encodeURIComponent(state.scenario)}`);
    renderSignalsTable(state.scenario, cur.rows);

    // watchlist
    renderWatchlist(watch.rows);
    renderWatchSnapshotTable(hot.rows, flow.rows, watch.rows);

    // reports
    renderBrief(summary, hot.rows, spike.rows);

    addLog(`refresh (${reason}) • ok`);
  } catch (e) {
    addLog(`refresh (${reason}) • error: ${e?.message || e}`);
  }
}

// ===== Bind UI =====
function bindNav() {
  $$(".nav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      setView(btn.dataset.view);
      addLog(`view -> ${btn.dataset.view}`);
    });
  });
}

function bindTabs() {
  $$(".tab").forEach((t) => {
    t.addEventListener("click", async () => {
      $$(".tab").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      state.scenario = t.dataset.sid;
      addLog(`scenario -> ${state.scenario}`);
      try {
        const cur = await api(`/api/data?id=${encodeURIComponent(state.scenario)}`);
        renderSignalsTable(state.scenario, cur.rows);
      } catch (e) {
        addLog(`scenario load error: ${e?.message || e}`);
      }
    });
  });
}

function bindActions() {
  $("#btnRefresh")?.addEventListener("click", () => refreshAll("manual"));

  $("#toggleLight")?.addEventListener("change", (e) => {
    document.documentElement.style.setProperty("--bg", e.target.checked ? "#f3f6ff" : "#0b1220");
  });
}

function startAuto() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => refreshAll("auto"), UI_REFRESH_MS);
}

async function boot() {
  addLog("boot");
  bindNav();
  bindTabs();
  bindActions();
  setView("overview");
  await refreshAll("boot");
  startAuto();
}

boot();
