/**
 * Dashboard Benchmark Paid Media - Banca PT
 *
 * Client-side only. Faz fetch a `data/latest.json` (gerado semanalmente pelo pipeline
 * Python) e renderiza KPIs, graficos (Chart.js), galeria de criativos e tabela.
 *
 * Estado da UI (bancos, plataformas, categorias, datas, activeOnly) e um objecto
 * `state`. Sempre que muda, `render()` recalcula tudo a partir do dataset.
 */

const DATA_URL = "data/latest.json";

const state = {
  banks: new Set(),
  platforms: new Set(),
  categories: new Set(),
  from: null,
  to: null,
  datePreset: "30",
  activeOnly: true,
  search: "",
  sort: { key: "last_seen", dir: "desc" },
};

let dataset = null;
const charts = {};

function fmtNumber(n) {
  if (n == null || Number.isNaN(n)) return "-";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".", ",") + "k";
  return String(n);
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleDateString("pt-PT");
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function renderChips(container, items, selectedSet, getLabel, getColor) {
  container.innerHTML = "";
  items.forEach((item) => {
    const key = item.key || item.name;
    const chip = el(
      "button",
      {
        class: "chip",
        "aria-pressed": selectedSet.has(key) ? "true" : "false",
        type: "button",
        onclick: () => {
          if (selectedSet.has(key)) selectedSet.delete(key);
          else selectedSet.add(key);
          chip.setAttribute("aria-pressed", selectedSet.has(key) ? "true" : "false");
          render();
        },
      },
      [
        getColor
          ? el("span", { class: "chip__swatch", style: `background:${getColor(item)}` })
          : null,
        getLabel(item),
      ]
    );
    container.appendChild(chip);
  });
}

function initFilters() {
  const banks = dataset.meta.banks;
  const platforms = dataset.meta.platforms;
  const categories = dataset.meta.categories;

  banks.forEach((b) => state.banks.add(b.name));
  platforms.forEach((p) => state.platforms.add(p.key));
  categories.forEach((c) => state.categories.add(c.key));

  renderChips(
    document.getElementById("filterBanks"),
    banks,
    state.banks,
    (b) => b.short_name || b.name,
    (b) => b.color
  );
  renderChips(
    document.getElementById("filterPlatforms"),
    platforms,
    state.platforms,
    (p) => p.label,
    (p) => p.color
  );
  renderChips(
    document.getElementById("filterCategories"),
    categories,
    state.categories,
    (c) => c.label,
    (c) => c.color
  );

  const fromInput = document.getElementById("filterFrom");
  const toInput = document.getElementById("filterTo");
  const dateCustom = document.getElementById("dateCustom");
  const presetButtons = Array.from(document.querySelectorAll("[data-preset]"));

  function applyPreset(preset) {
    presetButtons.forEach((b) => b.setAttribute("aria-pressed", b.dataset.preset === preset ? "true" : "false"));
    state.datePreset = preset;
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);
    if (preset === "all") {
      state.from = null;
      state.to = null;
      dateCustom.hidden = true;
    } else if (preset === "custom") {
      state.from = fromInput.value || null;
      state.to = toInput.value || null;
      dateCustom.hidden = false;
    } else {
      const days = parseInt(preset, 10);
      const from = new Date(today);
      from.setDate(today.getDate() - days);
      state.from = from.toISOString().slice(0, 10);
      state.to = todayIso;
      fromInput.value = state.from;
      toInput.value = state.to;
      dateCustom.hidden = true;
    }
    render();
  }

  presetButtons.forEach((btn) => btn.addEventListener("click", () => applyPreset(btn.dataset.preset)));
  fromInput.addEventListener("change", () => { state.from = fromInput.value || null; render(); });
  toInput.addEventListener("change", () => { state.to = toInput.value || null; render(); });

  applyPreset("30");

  const activeBtn = document.getElementById("btnActiveOnly");
  activeBtn.addEventListener("click", () => {
    state.activeOnly = !state.activeOnly;
    activeBtn.setAttribute("aria-pressed", state.activeOnly ? "true" : "false");
    activeBtn.textContent = state.activeOnly ? "So ativos" : "Todos";
    render();
  });

  document.getElementById("btnReset").addEventListener("click", () => {
    state.banks = new Set(banks.map((b) => b.name));
    state.platforms = new Set(platforms.map((p) => p.key));
    state.categories = new Set(categories.map((c) => c.key));
    state.activeOnly = true;
    state.search = "";
    document.getElementById("tableSearch").value = "";
    activeBtn.setAttribute("aria-pressed", "true");
    activeBtn.textContent = "So ativos";
    // Re-render dos chips para reflectir o estado (todos activos)
    document.querySelectorAll("#filterBanks .chip, #filterPlatforms .chip, #filterCategories .chip")
      .forEach((c) => c.setAttribute("aria-pressed", "true"));
    applyPreset("30");
  });

  const search = document.getElementById("tableSearch");
  search.addEventListener("input", () => {
    state.search = search.value.toLowerCase().trim();
    renderTable();
  });

  document.querySelectorAll("thead th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else { state.sort.key = key; state.sort.dir = "desc"; }
      renderTable();
    });
  });
}

function applyFilters(ads) {
  return ads.filter((a) => {
    if (!state.banks.has(a.bank)) return false;
    if (!state.platforms.has(a.platform)) return false;
    if (!state.categories.has(a.category)) return false;
    if (state.activeOnly && !a.is_active) return false;
    if (state.from && a.first_seen < state.from) return false;
    if (state.to && a.first_seen > state.to) return false;
    return true;
  });
}

function bankColor(bank) {
  const b = dataset.meta.banks.find((x) => x.name === bank);
  return b ? b.color : "#144063";
}

function platformColor(p) {
  const x = dataset.meta.platforms.find((y) => y.key === p);
  return x ? x.color : "#144063";
}

function categoryColor(k) {
  const x = dataset.meta.categories.find((y) => y.key === k);
  return x ? x.color : "#C4C4C4";
}

function categoryLabel(k) {
  const x = dataset.meta.categories.find((y) => y.key === k);
  return x ? x.label : k;
}

function platformLabel(k) {
  const x = dataset.meta.platforms.find((y) => y.key === k);
  return x ? x.label : k;
}

function shortBank(bank) {
  const b = dataset.meta.banks.find((x) => x.name === bank);
  return b ? b.short_name || b.name : bank;
}

/* ============ KPIs ============ */
function renderKPIs(filtered) {
  const active = filtered.filter((a) => a.is_active);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoIso = weekAgo.toISOString().slice(0, 10);

  const newThisWeek = active.filter((a) => a.first_seen >= weekAgoIso).length;
  const withReach = active.filter((a) => a.reach_mid != null && a.reach_mid > 0);
  const totalReach = withReach.reduce((sum, a) => sum + a.reach_mid, 0);
  const reachCoverage = active.length ? Math.round((withReach.length / active.length) * 100) : 0;

  const platformCounts = {};
  active.forEach((a) => (platformCounts[a.platform] = (platformCounts[a.platform] || 0) + 1));
  const topPlatform = Object.entries(platformCounts).sort((a, b) => b[1] - a[1])[0];

  const categoryCounts = {};
  active.forEach((a) => (categoryCounts[a.category] = (categoryCounts[a.category] || 0) + 1));
  const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];

  const cgdBank = dataset.meta.banks.find((b) => b.is_cgd);
  const cgdActive = cgdBank ? active.filter((a) => a.bank === cgdBank.name).length : 0;
  const sov = active.length ? Math.round((cgdActive / active.length) * 100 * 10) / 10 : 0;

  document.getElementById("kpiActive").textContent = active.length.toLocaleString("pt-PT");
  document.getElementById("kpiNew").textContent = newThisWeek.toLocaleString("pt-PT");
  const reachEl = document.getElementById("kpiReach");
  reachEl.textContent = totalReach > 0 ? fmtNumber(totalReach) : "-";
  reachEl.title =
    `Alcance somado de ${withReach.length.toLocaleString("pt-PT")} anuncios com dados disponiveis ` +
    `(${reachCoverage}% do total ativo). Google divulga o alcance so ~90d apos a data de estreia; ` +
    `por isso ads Google recentes contribuem com "-".`;
  document.getElementById("kpiPlatform").textContent = topPlatform
    ? `${platformLabel(topPlatform[0]).split(" ")[0]} (${topPlatform[1]})`
    : "-";
  document.getElementById("kpiCategory").textContent = topCategory
    ? `${categoryLabel(topCategory[0])} (${topCategory[1]})`
    : "-";
  document.getElementById("kpiSov").textContent = `${sov}%`.replace(".", ",");
}

/* ============ Charts ============ */
function destroyChart(name) {
  if (charts[name]) { charts[name].destroy(); delete charts[name]; }
}

function chartByBank(filtered) {
  destroyChart("byBank");
  const counts = {};
  filtered.forEach((a) => (counts[a.bank] = (counts[a.bank] || 0) + 1));
  const banks = dataset.meta.banks.map((b) => b.name).filter((n) => counts[n]);
  banks.sort((a, b) => counts[b] - counts[a]);

  charts.byBank = new Chart(document.getElementById("chartByBank"), {
    type: "bar",
    data: {
      labels: banks.map(shortBank),
      datasets: [{
        label: "Anuncios",
        data: banks.map((b) => counts[b]),
        backgroundColor: banks.map(bankColor),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { grid: { color: "#EEF1F5" } }, y: { grid: { display: false } } },
    },
  });
}

function chartByPlatform(filtered) {
  destroyChart("byPlatform");
  const banks = dataset.meta.banks.map((b) => b.name);
  const platforms = dataset.meta.platforms.map((p) => p.key);
  const matrix = {};
  banks.forEach((b) => { matrix[b] = {}; platforms.forEach((p) => (matrix[b][p] = 0)); });
  filtered.forEach((a) => { if (matrix[a.bank]) matrix[a.bank][a.platform] = (matrix[a.bank][a.platform] || 0) + 1; });

  const activeBanks = banks.filter((b) => platforms.some((p) => matrix[b][p] > 0));

  charts.byPlatform = new Chart(document.getElementById("chartByPlatform"), {
    type: "bar",
    data: {
      labels: activeBanks.map(shortBank),
      datasets: platforms.map((p) => ({
        label: platformLabel(p).split(" ")[0],
        data: activeBanks.map((b) => matrix[b][p]),
        backgroundColor: platformColor(p),
        borderRadius: 3,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: "#EEF1F5" } },
      },
    },
  });
}

function chartByCategory(filtered) {
  destroyChart("byCategory");
  const banks = dataset.meta.banks.map((b) => b.name);
  const cats = dataset.meta.categories.map((c) => c.key);
  const matrix = {};
  banks.forEach((b) => { matrix[b] = {}; cats.forEach((c) => (matrix[b][c] = 0)); });
  filtered.forEach((a) => { if (matrix[a.bank]) matrix[a.bank][a.category] = (matrix[a.bank][a.category] || 0) + 1; });
  const activeBanks = banks.filter((b) => cats.some((c) => matrix[b][c] > 0));

  charts.byCategory = new Chart(document.getElementById("chartByCategory"), {
    type: "bar",
    data: {
      labels: activeBanks.map(shortBank),
      datasets: cats.map((c) => ({
        label: categoryLabel(c),
        data: activeBanks.map((b) => matrix[b][c]),
        backgroundColor: categoryColor(c),
        borderRadius: 3,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, grid: { color: "#EEF1F5" } },
      },
    },
  });
}

function chartTimeline(filtered) {
  destroyChart("timeline");
  const weeks = new Set(dataset.weekly.map((w) => w.week));
  filtered.forEach((a) => {
    const d = new Date(a.first_seen);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    weeks.add(d.toISOString().slice(0, 10));
  });
  const sortedWeeks = Array.from(weeks).sort().slice(-12);

  const byBankByWeek = {};
  dataset.meta.banks.forEach((b) => { byBankByWeek[b.name] = Object.fromEntries(sortedWeeks.map((w) => [w, 0])); });

  filtered.forEach((a) => {
    const d = new Date(a.first_seen);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - (day - 1));
    const wk = d.toISOString().slice(0, 10);
    if (byBankByWeek[a.bank] && byBankByWeek[a.bank][wk] != null) {
      byBankByWeek[a.bank][wk] += 1;
    }
  });

  const activeBanks = dataset.meta.banks.filter((b) => sortedWeeks.some((w) => byBankByWeek[b.name][w] > 0));

  charts.timeline = new Chart(document.getElementById("chartTimeline"), {
    type: "line",
    data: {
      labels: sortedWeeks.map((w) => w.slice(5)),
      datasets: activeBanks.map((b) => ({
        label: shortBank(b.name),
        data: sortedWeeks.map((w) => byBankByWeek[b.name][w]),
        borderColor: b.color,
        backgroundColor: b.color + "22",
        tension: 0.3,
        fill: false,
        pointRadius: 3,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: "bottom" } },
      scales: { y: { beginAtZero: true, grid: { color: "#EEF1F5" } }, x: { grid: { display: false } } },
    },
  });
}

function chartReach(filtered) {
  destroyChart("reach");
  const reach = {};
  filtered.forEach((a) => {
    if (a.reach_mid != null && a.reach_mid > 0) {
      reach[a.bank] = (reach[a.bank] || 0) + a.reach_mid;
    }
  });
  const banks = dataset.meta.banks.map((b) => b.name).filter((n) => reach[n]);
  banks.sort((a, b) => reach[b] - reach[a]);

  charts.reach = new Chart(document.getElementById("chartReach"), {
    type: "bar",
    data: {
      labels: banks.map(shortBank),
      datasets: [{
        label: "Alcance UE (mid)",
        data: banks.map((b) => reach[b]),
        backgroundColor: banks.map(bankColor),
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${fmtNumber(ctx.parsed.x)} pessoas (UE)` } },
      },
      scales: {
        x: { grid: { color: "#EEF1F5" }, ticks: { callback: (v) => fmtNumber(v) } },
        y: { grid: { display: false } },
      },
    },
  });
}

function chartFormat(filtered) {
  destroyChart("format");
  const counts = { image: 0, video: 0, carousel: 0, text: 0, unknown: 0 };
  filtered.forEach((a) => { counts[a.format || "unknown"] = (counts[a.format || "unknown"] || 0) + 1; });
  const labels = Object.keys(counts).filter((k) => counts[k]);
  const data = labels.map((k) => counts[k]);
  const colors = { image: "#0071CE", video: "#EF7457", carousel: "#5BA7A7", text: "#95DAF7", unknown: "#C4C4C4" };

  charts.format = new Chart(document.getElementById("chartFormat"), {
    type: "doughnut",
    data: {
      labels: labels.map((l) => l.charAt(0).toUpperCase() + l.slice(1)),
      datasets: [{ data, backgroundColor: labels.map((l) => colors[l] || "#C4C4C4"), borderWidth: 2, borderColor: "#fff" }],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right" } } },
  });
}

/* ============ Gallery ============ */
function renderGallery(filtered) {
  const container = document.getElementById("gallery");
  container.innerHTML = "";
  const items = [...filtered].sort((a, b) => (b.first_seen || "").localeCompare(a.first_seen || "")).slice(0, 12);
  if (items.length === 0) {
    container.appendChild(el("p", { class: "hint" }, "Sem criativos para os filtros seleccionados."));
    return;
  }
  items.forEach((a) => {
    const thumb = a.creative_url
      ? el("div", { class: "gallery__thumb" }, [el("img", { src: a.creative_url, alt: "" })])
      : el("div", { class: "gallery__thumb gallery__thumb--empty" }, "Sem preview");
    const item = el(
      "a",
      { class: "gallery__item", href: a.external_url || "#", target: "_blank", rel: "noopener" },
      [
        thumb,
        el("div", { class: "gallery__meta" }, [
          el("div", { class: "gallery__bank" }, shortBank(a.bank)),
          el("div", { class: "gallery__cat" }, `${categoryLabel(a.category)} - ${platformLabel(a.platform).split(" ")[0]}`),
          el("div", { class: "gallery__cat" }, fmtDate(a.first_seen)),
        ]),
      ]
    );
    container.appendChild(item);
  });
}

/* ============ Tabela ============ */
function renderTable() {
  const filtered = applyFilters(dataset.ads);
  const tbody = document.getElementById("adsTableBody");
  const count = document.getElementById("tableCount");

  let rows = filtered;
  if (state.search) {
    rows = rows.filter((a) =>
      [a.bank, a.category, a.platform, a.text || "", a.landing_url || ""].join(" ").toLowerCase().includes(state.search)
    );
  }

  const { key, dir } = state.sort;
  rows = [...rows].sort((a, b) => {
    const va = a[key] ?? "";
    const vb = b[key] ?? "";
    if (va < vb) return dir === "asc" ? -1 : 1;
    if (va > vb) return dir === "asc" ? 1 : -1;
    return 0;
  });

  tbody.innerHTML = "";
  const MAX = 500;
  rows.slice(0, MAX).forEach((a) => {
    const tr = el("tr", {}, [
      el("td", {}, shortBank(a.bank)),
      el("td", {}, platformLabel(a.platform).split(" ")[0]),
      el("td", {}, el("span", { class: "badge", style: `background:${categoryColor(a.category)}22;color:${categoryColor(a.category)}` }, categoryLabel(a.category))),
      el("td", {}, a.format || "-"),
      el("td", {}, el("div", { class: "text-cell", title: a.text || "" }, (a.text || "").slice(0, 200))),
      el("td", {}, fmtDate(a.first_seen)),
      el("td", {}, fmtDate(a.last_seen)),
      el("td", {}, a.reach_mid != null && a.reach_mid > 0 ? fmtNumber(a.reach_mid) : "-"),
      el("td", {}, el("span", { class: `badge ${a.is_active ? "badge--active" : "badge--inactive"}` }, a.is_active ? "sim" : "nao")),
      el("td", {}, a.external_url ? el("a", { href: a.external_url, target: "_blank", rel: "noopener" }, "abrir") : "-"),
    ]);
    tbody.appendChild(tr);
  });
  count.textContent = `${rows.length.toLocaleString("pt-PT")} anuncios${rows.length > MAX ? ` (a mostrar os primeiros ${MAX})` : ""}`;
}

/* ============ Render ============ */
function render() {
  const filtered = applyFilters(dataset.ads);
  renderKPIs(filtered);
  chartByBank(filtered);
  chartByPlatform(filtered);
  chartByCategory(filtered);
  chartTimeline(filtered);
  chartReach(filtered);
  chartFormat(filtered);
  renderGallery(filtered);
  renderTable();
}

/* ============ Bootstrap ============ */
async function main() {
  try {
    const res = await fetch(DATA_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    dataset = await res.json();
  } catch (err) {
    document.querySelector("main.container").innerHTML =
      `<div class="card"><h2>Ainda sem dados</h2><p class="hint">O ficheiro <code>data/latest.json</code> ainda nao existe.` +
      ` Corra o pipeline pela primeira vez (<code>python scripts/run_all.py</code>) ou dispare manualmente o workflow no GitHub Actions.</p></div>`;
    console.error(err);
    return;
  }

  document.getElementById("lastUpdated").textContent =
    "Ultima atualizacao: " + new Date(dataset.meta.generated_at).toLocaleString("pt-PT");

  initFilters();
  render();
}

main();
