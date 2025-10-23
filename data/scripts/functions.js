document.addEventListener('contextmenu', event => event.preventDefault());

// --- Hilfsfunktionen ---
function haversine(a, b) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const sinDlat = Math.sin(dLat / 2), sinDlon = Math.sin(dLon / 2);
  const c = 2 * Math.atan2(
    Math.sqrt(sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon),
    Math.sqrt(1 - (sinDlat * sinDlat + Math.cos(lat1) * Math.cos(lat2) * sinDlon * sinDlon))
  );
  return R * c;
}

// --- Priority Queue für Dijkstra ---
class PQ {
  constructor() { this._items = []; }
  push(item, pr) { this._items.push({ item, pr }); this._items.sort((a, b) => a.pr - b.pr); }
  pop() { return this._items.shift()?.item; }
  empty() { return this._items.length === 0; }
}

// --- Dijkstra-Algorithmus ---
function dijkstra(graph, startId, endId, trainVmax_kmh) {
  const dist = {}, prev = {}, pq = new PQ();
  Object.keys(graph.nodes).forEach(id => dist[id] = Infinity);
  dist[startId] = 0;
  pq.push(startId, 0);

  while (!pq.empty()) {
    const u = pq.pop();
    if (u === endId) break;
    const edges = graph.edges[u] || [];
    for (const e of edges) {
      const edgeV = e.maxspeed ? Math.min(trainVmax_kmh, e.maxspeed) : trainVmax_kmh;
      const timeSeconds = (e.len_m / 1000) / edgeV * 3600;
      const alt = dist[u] + timeSeconds;
      if (alt < dist[e.v]) {
        dist[e.v] = alt;
        prev[e.v] = { from: u, edge: e };
        pq.push(e.v, alt);
      }
    }
  }

  if (!prev[endId]) return null;
  const path = [];
  let cur = endId;
  while (cur !== startId) {
    const p = prev[cur];
    path.push({ to: cur, from: p.from, edge: p.edge });
    cur = p.from;
  }
  path.reverse();
  return { path, time_s: dist[endId] };
}

// --- Leaflet Map ---
const map = L.map('map').setView([48.7, 9.2], 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const stationLayer = L.layerGroup().addTo(map);

// --- UI Elemente ---
const fromInput = document.getElementById('from');
const toInput = document.getElementById('to');
const viaInput = document.getElementById('via');
const vmaxInput = document.getElementById('vmax');
const calcBtn = document.getElementById('calc');
const clearBtn = document.getElementById('clear');
const summaryDiv = document.getElementById('summary');
const tableWrap = document.getElementById('table-wrap');
const fromList = document.getElementById('from-list');
const toList = document.getElementById('to-list');

let selectedFrom = null, selectedTo = null, selectedVias = [];

// ------------------------------------------------------
// 🟩 Lokale JSON-basierte Bahnhofsdaten laden
// ------------------------------------------------------
let stationData = [];

async function loadStations() {
  const res = await fetch('data/stations.json');
  const js = await res.json();
  if (js.elements) {
    stationData = js.elements
      .filter(el => el.type === 'node' && el.tags && el.tags.name)
      .map(el => ({
        id: el.id,
        lat: el.lat,
        lon: el.lon,
        name: el.tags.name,
        network: el.tags.network || '',
        operator: el.tags.operator || '',
        ref: el.tags['railway:ref'] || '',
        uic: el.tags.uic_ref || '',
        category: el.tags['railway:station_category'] || '',
        wheelchair: el.tags.wheelchair || '',
        wikidata: el.tags.wikidata || '',
        rawTags: el.tags
      }));
  }
  console.log(`✅ ${stationData.length} Stationen geladen`);
}

loadStations();

// ------------------------------------------------------
// 🔍 Lokale Autocomplete-Suche
// ------------------------------------------------------
async function nominatimSearch(q) {
  if (!q || q.length < 2) return [];
  const lower = q.toLowerCase();

  const results = stationData.filter(s =>
    s.name.toLowerCase().includes(lower) ||
    s.ref.toLowerCase().includes(lower) ||
    s.uic.toLowerCase().includes(lower)
  );

  return results.map(s => ({
    display: `${s.name}${s.ref ? " [" + s.ref + "]" : ""}${s.network ? " – " + s.network : ""}`,
    lat: s.lat,
    lon: s.lon,
    props: s
  }));
}

// ------------------------------------------------------
// 🔧 Autocomplete UI Logik
// ------------------------------------------------------
function attachAutocomplete(inputEl, listEl, onSelect) {
  let timer = null;
  inputEl.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = inputEl.value.trim();
      if (!q) { listEl.style.display = 'none'; return; }
      const items = await nominatimSearch(q);
      listEl.innerHTML = '';
      if (items.length === 0) { listEl.style.display = 'none'; return; }
      for (const it of items) {
        const div = document.createElement('div');
        div.className = 'autocomplete-item';
        div.textContent = it.display;
        div.addEventListener('click', () => {
          onSelect(it);
          listEl.style.display = 'none';
        });
        listEl.appendChild(div);
      }
      listEl.style.display = 'block';
    }, 200);
  });
  document.addEventListener('click', e => {
    if (!inputEl.contains(e.target) && !listEl.contains(e.target))
      listEl.style.display = 'none';
  });
}

attachAutocomplete(fromInput, fromList, (it) => {
  selectedFrom = it;
  fromInput.value = it.display;
  addStationMarker(it, 'start');
});
attachAutocomplete(toInput, toList, (it) => {
  selectedTo = it;
  toInput.value = it.display;
  addStationMarker(it, 'end');
});

// ------------------------------------------------------
// 🗺️ Stationen & Karte
// ------------------------------------------------------
function addStationMarker(it, role) {
  L.marker([it.lat, it.lon], { title: it.display })
    .addTo(stationLayer)
    .bindPopup(`<b>${role.toUpperCase()}</b><br>${it.display}`);
  map.panTo([it.lat, it.lon]);
}

clearBtn.addEventListener('click', () => {
  selectedFrom = null;
  selectedTo = null;
  selectedVias = [];
  fromInput.value = '';
  toInput.value = '';
  viaInput.value = '';
  vmaxInput.value = 120;
  stationLayer.clearLayers();
  routeLayer.clearLayers();
  summaryDiv.textContent = 'Keine Route berechnet.';
  tableWrap.innerHTML = '';
});

// ------------------------------------------------------
// 🧮 Routenberechnung (mit Overpass)
// ------------------------------------------------------
function bboxFromPoints(points, pad_km = 15) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  const padDeg = pad_km / 111;
  return [minLat - padDeg, minLon - padDeg, maxLat + padDeg, maxLon + padDeg];
}

async function fetchRailNetwork(bbox) {
  const [s, w, n, e] = bbox;
  const q = `[out:json][timeout:60];
    (way["railway"~"^(rail|railway)$"](${s},${w},${n},${e}); >;);
    out body;`;
  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url, { method: 'POST', body: q, headers: { 'Content-Type': 'text/plain' } });
  const js = await res.json();
  const nodes = {}, ways = {};
  for (const el of js.elements) {
    if (el.type === 'node') nodes[el.id] = { id: el.id, lat: el.lat, lon: el.lon };
    if (el.type === 'way') ways[el.id] = el;
  }
  return { nodes, ways };
}

function buildGraph(nodes, ways) {
  const graph = { nodes: {}, edges: {} };
  for (const nid in nodes) graph.nodes[nid] = nodes[nid];

  function addEdge(u, v, len, wayid, maxspeed) {
    if (!graph.edges[u]) graph.edges[u] = [];
    graph.edges[u].push({ v, len_m: len, wayid, maxspeed });
  }

  for (const wid in ways) {
    const w = ways[wid];
    const nds = w.nodes;
    let maxspeed = null;
    if (w.tags && w.tags.maxspeed) {
      const parsed = parseInt(w.tags.maxspeed);
      if (!isNaN(parsed)) maxspeed = parsed;
    }
    for (let i = 0; i < nds.length - 1; i++) {
      const a = nodes[nds[i]], b = nodes[nds[i + 1]];
      if (!a || !b) continue;
      const len = haversine({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
      addEdge(String(a.id), String(b.id), len, wid, maxspeed);
      addEdge(String(b.id), String(a.id), len, wid, maxspeed);
    }
  }
  return graph;
}

function findNearestNode(nodes, lat, lon) {
  let best = null, bestd = Infinity;
  for (const id in nodes) {
    const n = nodes[id];
    const d = haversine({ lat: n.lat, lon: n.lon }, { lat, lon });
    if (d < bestd) { bestd = d; best = n; }
  }
  return best;
}

async function computeRoute(points, trainVmax_kmh) {
  const segmentResults = [];
  let totalTimeSec = 0, totalLen = 0;
  const fullPolyline = [];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const bbox = bboxFromPoints([a, b], 12);
    const net = await fetchRailNetwork(bbox);
    const graph = buildGraph(net.nodes, net.ways);
    const na = findNearestNode(net.nodes, a.lat, a.lon);
    const nb = findNearestNode(net.nodes, b.lat, b.lon);
    if (!na || !nb) throw new Error('Keine Schienendaten im Ausschnitt gefunden.');
    const res = dijkstra(graph, String(na.id), String(nb.id), trainVmax_kmh);
    if (!res) throw new Error('Kein Pfad gefunden.');

    const segCoords = [];
    let cur = String(na.id);
    segCoords.push([net.nodes[cur].lat, net.nodes[cur].lon]);
    for (const step of res.path) {
      const to = step.to;
      segCoords.push([net.nodes[to].lat, net.nodes[to].lon]);
    }

    let segLen = 0;
    for (let k = 0; k < segCoords.length - 1; k++)
      segLen += haversine({ lat: segCoords[k][0], lon: segCoords[k][1] }, { lat: segCoords[k + 1][0], lon: segCoords[k + 1][1] });

    totalTimeSec += res.time_s;
    totalLen += segLen;
    fullPolyline.push(...segCoords);
    segmentResults.push({ from: a.display, to: b.display, time_s: res.time_s, len_m: segLen });
  }

  return { segments: segmentResults, totalTime_s: totalTimeSec, totalLen_m: totalLen, polyline: fullPolyline };
}

// ------------------------------------------------------
// 🚂 Berechnung starten
// ------------------------------------------------------
calcBtn.addEventListener('click', async () => {
  try {
    if (!selectedFrom || !selectedTo) { alert('Bitte Start- und Zielbahnhof wählen.'); return; }

    const viaStr = viaInput.value.trim();
    const vias = viaStr ? viaStr.split(',').map(s => s.trim()).filter(s => s) : [];
    const viaPoints = [];
    for (const v of vias) {
      const r = await nominatimSearch(v);
      if (r.length > 0) viaPoints.push(r[0]);
      else { alert('Wegpunkt nicht gefunden: ' + v); return; }
    }

    const points = [selectedFrom, ...viaPoints, selectedTo];
    const vmax = Number(vmaxInput.value) || 120;
    summaryDiv.textContent = 'Berechne Route...';
    routeLayer.clearLayers(); stationLayer.clearLayers();

    addStationMarker(selectedFrom, 'start');
    addStationMarker(selectedTo, 'end');
    for (const vp of viaPoints) addStationMarker(vp, 'via');

    const res = await computeRoute(points, vmax);

    const poly = L.polyline(res.polyline.map(p => [p[0], p[1]]), { weight: 5 }).addTo(routeLayer);
    map.fitBounds(poly.getBounds(), { padding: [40, 40] });

    const total_h = Math.floor(res.totalTime_s / 3600);
    const total_min = Math.round((res.totalTime_s % 3600) / 60);
    summaryDiv.textContent = `Route: ${(res.totalLen_m / 1000).toFixed(1)} km — Fahrzeit: ${total_h}h ${total_min}min`;

    let html = '<table><thead><tr><th>Abschnitt</th><th>Strecke (km)</th><th>Fahrzeit</th></tr></thead><tbody>';
    res.segments.forEach(s => {
      const h = Math.floor(s.time_s / 3600);
      const m = Math.round((s.time_s % 3600) / 60);
      html += `<tr><td>${s.from} → ${s.to}</td><td>${(s.len_m / 1000).toFixed(2)}</td><td>${h}h ${m}min</td></tr>`;
    });
    html += '</tbody></table>';
    tableWrap.innerHTML = html;

  } catch (err) {
    console.error(err);
    alert('Fehler: ' + err.message);
    summaryDiv.textContent = 'Fehler bei der Berechnung.';
  }
});

// --- Startansicht BW ---
const bwBounds = [[47.45, 7.8], [49.8, 10.6]];
L.rectangle(bwBounds, { color: '0', weight: 1, fill: false }).addTo(map);
map.fitBounds(bwBounds);