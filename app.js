(() => {
'use strict';

/* ───────────── Config (Direct Blynk & Weather) ───────────── */
// Apni API Keys yahan daalo
const BLYNK_TOKEN = "paA92qkJbuRNlsEXmawF9naBXlrNACnm"; 
const BLYNK_URL = "https://blr1.blynk.cloud/external/api";
const OWM_API_KEY = "702d0ea7d28d8526e9ca0f8ace182074"; 
const FARM_LAT = "23.1815"; 
const FARM_LON = "79.9864";

const POLL_MS = 5000; // Har 5 second me sensor data aayega

const CROPS = {
  potato: { label: 'Potato (आलू)',  min: 40, max: 70, note: 'Root zone: medium' },
  wheat:  { label: 'Wheat (गेहूँ)',  min: 35, max: 65, note: 'Shallow root' },
  tomato: { label: 'Tomato (टमाटर)', min: 45, max: 75, note: 'Moisture sensitive' },
  rice:   { label: 'Rice (धान)',    min: 60, max: 85, note: 'High saturation' },
};
const SEASONS = {
  summer: { label: 'Summer', sub: '+5% heat offset', adj: 5 },
  winter: { label: 'Winter', sub: 'Base profile',    adj: 0 },
  rainy:  { label: 'Rainy',  sub: '−5% retention',   adj: -5 },
};
const METRICS = {
  moisture:    { label: 'Soil moisture', unit: '%',  color: '#5aa9ff', key: 'm',  fixed: [0, 100] },
  temperature: { label: 'Temperature',   unit: '°C', color: '#f0b429', key: 'tp' },
  humidity:    { label: 'Humidity',      unit: '%',  color: '#6fe0c0', key: 'h' },
};

/* ───────────── State ───────────── */
const $ = (s, r = document) => r.querySelector(s);
const seasonNow = () => { const m = new Date().getMonth(); return m >= 2 && m <= 4 ? 'summer' : (m >= 5 && m <= 8 ? 'rainy' : 'winter'); };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};
const S = {
  crop: CROPS[store.get('ks_crop')] ? store.get('ks_crop') : 'potato',
  season: SEASONS[store.get('ks_season')] ? store.get('ks_season') : seasonNow(),
  metric: 'moisture',
  points: [], // Live chart data store karne ke liye
  device: { moisture: null, temperature: null, humidity: null, pump: false, auto: true, online: false, diag: "Loading..." },
  busy: false,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const band = () => {
  const c = CROPS[S.crop], a = SEASONS[S.season].adj;
  return { min: clamp(c.min + a, 5, 95), max: clamp(c.max + a, 5, 95) };
};

/* ───────────── Utils ───────────── */
const fmt = (v, d = 0) => (v == null || Number.isNaN(v) ? '--' : Number(v).toFixed(d));
const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
function spark(el, vals, color) {
  const v = vals.filter((x) => x != null).slice(-36);
  if (v.length < 2) { el.innerHTML = ''; return; }
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  el.style.setProperty('--c', color);
  el.innerHTML = v.map((x) => `<span style="height:${14 + ((x - lo) / span) * 86}%"></span>`).join('');
}

/* ───────────── Direct API Calls ───────────── */
async function blynkGet(pin) {
  try {
    const res = await fetch(`${BLYNK_URL}/get?token=${BLYNK_TOKEN}&${pin}`);
    return await res.json();
  } catch (e) { return null; }
}

async function blynkSet(pin, val) {
  try {
    await fetch(`${BLYNK_URL}/update?token=${BLYNK_TOKEN}&${pin}=${val}`);
  } catch (e) { console.error("Control failed"); }
}

async function checkWeather() {
  if(!OWM_API_KEY || OWM_API_KEY === "APNI_OPENWEATHER_KEY_YAHAN_DAALO") return;
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${FARM_LAT}&lon=${FARM_LON}&appid=${OWM_API_KEY}&units=metric&cnt=5`);
    const data = await res.json();
    const slots = data.list || [];
    const rainOf = (s) => (s.rain && s.rain['3h']) || 0;
    const totalMm = slots.reduce((a, s) => a + rainOf(s), 0);
    const peakMm = slots.reduce((a, s) => Math.max(a, rainOf(s)), 0);
    const maxPop = slots.reduce((a, s) => Math.max(a, s.pop || 0), 0);

    $('#wxMm').textContent = `${totalMm.toFixed(1)} mm`;
    $('#wxPop').textContent = `${Math.round(maxPop * 100)}%`;
    $('#wxPeak').textContent = `${peakMm.toFixed(1)} mm`;

    const heavyRainExpected = (totalMm >= 5 && maxPop >= 0.5);
    const pill = $('#wxPill');

    if(heavyRainExpected) {
        $('#wxBanner').hidden = false;
        $('#wxBannerText').textContent = `12h Forecast: ${totalMm.toFixed(1)}mm rain expected. Irrigation is not recommended.`;
        pill.textContent = 'Warning'; pill.className = 'pill warn';
        $('#wxNote').textContent = "Heavy rain expected. Consider keeping Auto mode OFF.";
    } else {
        $('#wxBanner').hidden = true;
        pill.textContent = 'Clear'; pill.className = 'pill ok';
        $('#wxNote').textContent = "No heavy rain forecast in the next 12 hours.";
    }
  } catch(e) { $('#wxNote').textContent = "Could not fetch weather data."; }
}

/* ───────────── UI Rendering ───────────── */
function setLimits(b) {
  $('#gMin').setAttribute('transform', `rotate(${b.min * 1.8} 120 125)`);
  $('#gMax').setAttribute('transform', `rotate(${b.max * 1.8} 120 125)`);
  const el = $('#gBand');
  el.setAttribute('stroke-dasharray', `${b.max - b.min} 100`);
  el.setAttribute('stroke-dashoffset', String(-b.min));
  $('#gBandVal').textContent = `${b.min}–${b.max}%`;
}

function renderProfile() {
  const sel = $('#cropSel');
  if (!sel.options.length) sel.innerHTML = Object.entries(CROPS).map(([k, c]) => `<option value="${k}">${c.label} · ${c.min}–${c.max}%</option>`).join('');
  sel.value = S.crop;
  $('#seasonSeg').innerHTML = Object.entries(SEASONS).map(([k, s]) => `<button type="button" data-season="${k}" class="${k === S.season ? 'on' : ''}">${s.label}<small>${s.sub}</small></button>`).join('');
  const b = band();
  $('#bMin').textContent = b.min;
  $('#bMax').textContent = b.max;
  $('#tgtNote').textContent = `${CROPS[S.crop].note}. Base ${CROPS[S.crop].min}–${CROPS[S.crop].max}%.`;
  setLimits(b);
}

function render() {
  const d = S.device;
  const bd = band();
  
  $('#devChip').className = `chip ${d.online ? 'on' : 'off'}`;
  $('#devText').textContent = d.online ? 'Controller online' : 'Controller offline';

  const m = d.moisture;
  $('#mVal').textContent = fmt(m);
  const gv = $('#gVal');
  gv.setAttribute('stroke-dasharray', `${m == null ? 0 : clamp(m, 0, 100)} 100`);
  gv.style.opacity = m == null || m < 0.5 ? 0 : 1;
  const zone = m == null ? 'opt' : m < bd.min ? 'dry' : m > bd.max ? 'wet' : 'opt';
  gv.setAttribute('class', `g-val ${zone}`);
  
  let status = 'Optimal';
  if (d.pump) status = 'Irrigating';
  else if (zone === 'dry') status = 'Critical · dry';
  else if (zone === 'wet') status = 'Saturated';
  $('#gStatus').textContent = status;
  
  $('#modePill').textContent = d.auto ? 'Auto' : 'Manual';
  $('#modePill').className = `pill ${d.auto ? 'ok' : ''}`;

  $('#tVal').textContent = fmt(d.temperature, 1);
  $('#hVal').textContent = fmt(d.humidity);
  $('#diagMsg').textContent = d.diag || 'No message';

  $('#autoSw').setAttribute('aria-checked', String(d.auto === true));
  $('#pumpLed').className = `led-lg ${d.pump ? 'on' : ''}`;
  $('#pumpTxt').textContent = d.pump ? 'RUNNING' : 'OFF';
  $('#btnRun').classList.toggle('on', d.pump === true);
  $('#btnStop').classList.toggle('on', d.pump === false);
  
  $('#btnRun').disabled = d.auto || S.busy || !d.online;
  $('#btnStop').disabled = !d.online || S.busy;
  $('#autoSw').disabled = !d.online || S.busy;
}

/* ───────────── Chart Logic (Live Session) ───────────── */
let chart;
const pumpBands = {
  id: 'pumpBands',
  beforeDatasetsDraw(c) {
    const { ctx, chartArea: a, scales: { x } } = c; if (!a || !S.points.length) return;
    const w = S.points.length > 1 ? x.getPixelForValue(1) - x.getPixelForValue(0) : 6;
    ctx.save(); ctx.fillStyle = 'rgba(79,209,161,.10)';
    S.points.forEach((p, i) => {
      if (!p.p) return;
      const l = Math.max(a.left, x.getPixelForValue(i) - w / 2), r = Math.min(a.right, x.getPixelForValue(i) + w / 2);
      ctx.fillRect(l, a.top, Math.max(0, r - l), a.bottom - a.top);
    });
    ctx.restore();
  },
};

function initChart() {
  Chart.defaults.font.family = "'Plus Jakarta Sans', system-ui, sans-serif";
  Chart.defaults.color = '#667085';
  chart = new Chart($('#chart'), {
    type: 'line', data: { labels: [], datasets: [] }, plugins: [pumpBands],
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 4 } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 6, maxRotation: 0, font: { size: 10.5 }, padding: 8 } },
        y: { grid: { color: 'rgba(255,255,255,.045)', drawTicks: false }, border: { display: false }, ticks: { maxTicksLimit: 5, font: { size: 10.5, family: 'ui-monospace, Menlo, monospace' }, padding: 10 } },
      },
      plugins: { legend: { display: false } },
    },
  });
}

function drawChart() {
  if (!chart) return;
  const M = METRICS[S.metric];
  const vals = S.points.map((p) => p[M.key]);
  $('#chartEmpty').hidden = vals.length > 0;
  
  chart.data.labels = S.points.map((p) => new Date(p.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }));
  
  const ds = [{
    data: vals, borderColor: M.color, borderWidth: 2, tension: 0.35, pointRadius: 0,
    backgroundColor: (ctx) => {
      const a = ctx.chart.chartArea; if (!a) return null;
      const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
      g.addColorStop(0, hexA(M.color, 0.22)); g.addColorStop(1, hexA(M.color, 0)); return g;
    }, fill: true
  }];
  
  if (S.metric === 'moisture') {
    const b = band();
    ds.push({ data: S.points.map(() => b.min), borderColor: 'rgba(240,180,41,.5)', borderWidth: 1, borderDash: [4, 5], pointRadius: 0, fill: false });
    ds.push({ data: S.points.map(() => b.max), borderColor: 'rgba(79,209,161,.5)', borderWidth: 1, borderDash: [4, 5], pointRadius: 0, fill: false });
  }
  
  chart.data.datasets = ds;
  const y = chart.options.scales.y;
  if (M.fixed) { y.min = M.fixed[0]; y.max = M.fixed[1]; } else { y.min = undefined; y.max = undefined; y.grace = '12%'; }
  chart.update();

  const nums = vals.filter(v => v != null);
  $('#stMin').textContent = nums.length ? `${Math.min(...nums).toFixed(1)}${M.unit}` : '--';
  $('#stMax').textContent = nums.length ? `${Math.max(...nums).toFixed(1)}${M.unit}` : '--';
  $('#stAvg').textContent = nums.length ? `${(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)}${M.unit}` : '--';
  
  spark($('#tSpark'), S.points.map(p => p.tp), METRICS.temperature.color);
  spark($('#hSpark'), S.points.map(p => p.h), METRICS.humidity.color);
}

/* ───────────── Core Loops & Controls ───────────── */
async function poll() {
  if(S.busy) return;
  try {
    const [hw, v0, v1, v2, v3, v5, v6] = await Promise.all([
      fetch(`${BLYNK_URL}/isHardwareConnected?token=${BLYNK_TOKEN}`).then(r => r.json()),
      blynkGet('v0'), blynkGet('v1'), blynkGet('v2'), blynkGet('v3'), blynkGet('v5'), blynkGet('v6')
    ]);
    
    S.device = {
      online: hw === true,
      moisture: v0 != null ? Number(v0) : null,
      temperature: v1 != null ? Number(v1) : null,
      humidity: v2 != null ? Number(v2) : null,
      auto: v3 == 1,
      pump: v5 > 0,
      diag: v6 ? String(v6).slice(0, 140) : null
    };

    // Live Chart Update (Pichle 60 readings save rakhega)
    if(S.device.online && S.device.moisture != null) {
      S.points.push({ t: Date.now(), m: S.device.moisture, tp: S.device.temperature, h: S.device.humidity, p: S.device.pump ? 1 : 0 });
      if(S.points.length > 60) S.points.shift();
      drawChart();
    }
    render();
  } catch (e) {
    S.device.online = false;
    render();
  }
}

async function act(fn) {
  S.busy = true; render();
  await fn();
  setTimeout(async () => { S.busy = false; await poll(); }, 1000);
}

function bind() {
  $('#autoSw').addEventListener('click', () => act(() => blynkSet('v3', S.device.auto ? 0 : 1)));
  $('#btnRun').addEventListener('click', () => act(() => blynkSet('v4', 1)));
  $('#btnStop').addEventListener('click', () => act(() => blynkSet('v4', 0)));

  $('#cropSel').addEventListener('change', (e) => { S.crop = e.target.value; store.set('ks_crop', S.crop); renderProfile(); render(); drawChart(); });
  $('#seasonSeg').addEventListener('click', (e) => { const b = e.target.closest('[data-season]'); if (!b) return; S.season = b.dataset.season; store.set('ks_season', S.season); renderProfile(); render(); drawChart(); });

  $('#metricSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-metric]'); if (!b) return; S.metric = b.dataset.metric;
    [...$('#metricSeg').children].forEach((x) => x.classList.toggle('on', x === b)); drawChart();
  });
}

/* ───────────── Boot ───────────── */
// HTML se Lock Screen aur Logout button hata do
if($('#lock')) $('#lock').hidden = true; 
if($('#app')) $('#app').hidden = false;
if($('#btnLogout')) $('#btnLogout').hidden = true; // Logout button chhupa diya
if($('#chartEmpty')) $('#chartEmpty').textContent = "Waiting for live data...";

for(let i=0; i<10; i+=10) { $('#gTicks').innerHTML += `<line class="g-tick" x1="6" y1="125" x2="12" y2="125" transform="rotate(${i * 1.8} 120 125)"/>`; }

renderProfile();
bind();
initChart();

poll(); 
checkWeather(); 

setInterval(poll, POLL_MS); 
setInterval(checkWeather, 15 * 60 * 1000); 
})();