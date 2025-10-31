// scripts/ki.js

// -----------------------------
// 🟢 Leaflet Map
// -----------------------------
const map = L.map('map').setView([48.7, 9.2], 8);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
}).addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const stationLayer = L.layerGroup().addTo(map);

// -----------------------------
// 🟢 Chat UI
// -----------------------------
const chatMessages = document.getElementById('chat-messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');

function addMessage(text, sender='bot'){
  const div = document.createElement('div');
  div.className = `msg ${sender}`;
  div.textContent = text;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// -----------------------------
// 🟢 Hilfsfunktionen
// -----------------------------
function haversine(a, b) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const sinDlat = Math.sin(dLat / 2), sinDlon = Math.sin(dLon / 2);
  const c = 2 * Math.atan2(
    Math.sqrt(sinDlat*sinDlat + Math.cos(lat1)*Math.cos(lat2)*sinDlon*sinDlon),
    Math.sqrt(1-(sinDlat*sinDlat + Math.cos(lat1)*Math.cos(lat2)*sinDlon*sinDlon))
  );
  return R * c;
}

class PQ {
  constructor() { this._items = []; }
  push(item, pr) { this._items.push({item,pr}); this._items.sort((a,b)=>a.pr-b.pr); }
  pop() { return this._items.shift()?.item; }
  empty() { return this._items.length === 0; }
}

function dijkstra(graph, startId, endId, trainVmax_kmh) {
  const dist = {}, prev = {}, pq = new PQ();
  Object.keys(graph.nodes).forEach(id=>dist[id]=Infinity);
  dist[startId]=0;
  pq.push(startId,0);

  while(!pq.empty()) {
    const u = pq.pop();
    if(u===endId) break;
    const edges = graph.edges[u]||[];
    for(const e of edges){
      const edgeV = e.maxspeed?Math.min(trainVmax_kmh,e.maxspeed):trainVmax_kmh;
      const timeSeconds = (e.len_m/1000)/edgeV*3600;
      const alt = dist[u]+timeSeconds;
      if(alt<dist[e.v]){
        dist[e.v]=alt;
        prev[e.v]={from:u,edge:e};
        pq.push(e.v,alt);
      }
    }
  }

  if(!prev[endId]) return null;
  const path = [];
  let cur=endId;
  while(cur!==startId){
    const p = prev[cur];
    path.push({to:cur,from:p.from,edge:p.edge});
    cur=p.from;
  }
  path.reverse();
  return {path,time_s:dist[endId]};
}

// -----------------------------
// 🟢 Stationsdaten
// -----------------------------
let stationData = [];

async function loadStations() {
  const res = await fetch('./data/stations.json');
  const js = await res.json();
  if(js.elements) {
    stationData = js.elements
      .filter(el => el.type==="node" && el.tags && el.tags.name)
      .map(el => ({
        id: el.id,
        lat: el.lat,
        lon: el.lon,
        name: el.tags.name,
        ds100: el.tags["railway:ref"] || "",
        display: el.tags["railway:ref"] || el.tags.name,
        tags: el.tags
      }));
    addMessage(`✅ ${stationData.length} Stationen in Baden-Württemberg geladen.`, 'bot');
    addMessage(`Gebe eine Route ein. z.B.(RK nach TS über TBM um 13:00)`, 'bot')
  }
}

function findStation(query){
  const q = query.toLowerCase();
  let station = stationData.find(s => s.ds100.toLowerCase() === q);
  if(station) return station;
  return stationData.find(s => s.name.toLowerCase().includes(q));
}

// -----------------------------
// 🟢 Overpass & Graph
// -----------------------------
function bboxFromPoints(points, pad_km=15){
  let minLat=90,maxLat=-90,minLon=180,maxLon=-180;
  for(const p of points){
    if(p.lat<minLat) minLat=p.lat;
    if(p.lat>maxLat) maxLat=p.lat;
    if(p.lon<minLon) minLon=p.lon;
    if(p.lon>maxLon) maxLon=p.lon;
  }
  const padDeg = pad_km/111;
  return [minLat-padDeg,minLon-padDeg,maxLat+padDeg,maxLon+padDeg];
}

async function fetchRailNetwork(bbox){
  const [s,w,n,e] = bbox;
  const q = `[out:json][timeout:60];(way["railway"~"^(rail|railway)$"](${s},${w},${n},${e}); >;); out body;`;
  const url = 'https://overpass-api.de/api/interpreter';
  const res = await fetch(url,{method:'POST',body:q,headers:{'Content-Type':'text/plain'}});
  const js = await res.json();
  const nodes = {}, ways = {};
  for(const el of js.elements){
    if(el.type==='node') nodes[el.id]={id:el.id,lat:el.lat,lon:el.lon};
    if(el.type==='way') ways[el.id]=el;
  }
  return {nodes,ways};
}

function buildGraph(nodes,ways){
  const graph={nodes:{},edges:{}};
  for(const nid in nodes) graph.nodes[nid]=nodes[nid];

  function addEdge(u,v,len,wayid,maxspeed){
    if(!graph.edges[u]) graph.edges[u]=[];
    graph.edges[u].push({v,len_m:len,wayid,maxspeed});
  }

  for(const wid in ways){
    const w = ways[wid];
    const nds = w.nodes;
    let maxspeed = null;
    if(w.tags && w.tags.maxspeed){
      const parsed=parseInt(w.tags.maxspeed);
      if(!isNaN(parsed)) maxspeed=parsed;
    }
    for(let i=0;i<nds.length-1;i++){
      const a = nodes[nds[i]], b = nodes[nds[i+1]];
      if(!a||!b) continue;
      const len = haversine(a,b);
      addEdge(String(a.id),String(b.id),len,wid,maxspeed);
      addEdge(String(b.id),String(a.id),len,wid,maxspeed);
    }
  }
  return graph;
}

function findNearestNode(nodes,lat,lon){
  let best=null,bestd=Infinity;
  for(const id in nodes){
    const n=nodes[id];
    const d=haversine({lat:n.lat,lon:n.lon},{lat,lon});
    if(d<bestd){bestd=d;best=n;}
  }
  return best;
}

async function computeRouteWithGraph(points,trainVmax){
  let segmentResults=[],totalTimeSec=0,totalLen=0,fullPolyline=[];

  for(let i=0;i<points.length-1;i++){
    const a=points[i], b=points[i+1];
    const bbox = bboxFromPoints([a,b],12);
    const net = await fetchRailNetwork(bbox);
    const graph = buildGraph(net.nodes,net.ways);
    const na=findNearestNode(net.nodes,a.lat,a.lon);
    const nb=findNearestNode(net.nodes,b.lat,b.lon);
    if(!na||!nb) throw new Error('Keine Schienendaten im Ausschnitt gefunden.');
    const res = dijkstra(graph,String(na.id),String(nb.id),trainVmax);
    if(!res) throw new Error('Kein Pfad gefunden.');

    const segCoords = [];
    let cur = String(na.id);
    segCoords.push([net.nodes[cur].lat,net.nodes[cur].lon]);
    for(const step of res.path){
      const to = step.to;
      segCoords.push([net.nodes[to].lat,net.nodes[to].lon]);
    }

    let segLen=0;
    for(let k=0;k<segCoords.length-1;k++)
      segLen+=haversine({lat:segCoords[k][0],lon:segCoords[k][1]},{lat:segCoords[k+1][0],lon:segCoords[k+1][1]});

    totalTimeSec+=res.time_s;
    totalLen+=segLen;
    fullPolyline.push(...segCoords);
    segmentResults.push({from:a.display,to:b.display,time_s:res.time_s,len_m:segLen});
  }

  return {segments:segmentResults,totalTime_s:totalTimeSec,totalLen_m:totalLen,polyline:fullPolyline};
}

// -----------------------------
// 🟢 Parsing Chat & Zwischenpunkte
// -----------------------------
async function handleUserMessage(text){
  addMessage(text,'user');

  // Regex: von START nach ZIEL über P1 über P2 ... um HH:MM
  const regex = /(\S+)\s+nach\s+(\S+)((?:\s+über\s+\S+)*)\s*(?:um\s+(\d{1,2}:\d{2}))?/i;
  const m = text.match(regex);
  if(!m){
    addMessage("Bitte im Format 'RK nach TU über TBM über TS um 14:30' schreiben.",'bot'); 
    return; 
  }

  const [_, fromQ, toQ, viaStr, timeStr] = m;

  const viaMatches = [...viaStr.matchAll(/\s+über\s+(\S+)/g)];
  const viaPointsRaw = viaMatches.map(v=>v[1]);

  function parseLocation(q){
    const coordMatch = q.match(/^(\d+(\.\d+)?),(\d+(\.\d+)?)$/);
    if(coordMatch){
      return { lat: parseFloat(coordMatch[1]), lon: parseFloat(coordMatch[3]), display: q };
    }
    const station = findStation(q);
    if(station) return station;
    return null;
  }

  const fromStation = parseLocation(fromQ);
  const toStation = parseLocation(toQ);
  const viaPoints = viaPointsRaw.map(parseLocation);

  if(!fromStation || !toStation || viaPoints.some(v=>v===null)){
    addMessage("Ein Punkt konnte nicht gefunden werden. Prüfe DS100, Name oder Koordinaten.",'bot');
    return;
  }

  const allPoints = [fromStation,...viaPoints,toStation];
  const vmax = 120; //Hier steht die Vmax

  addMessage(`Ich berechne Route von ${fromStation.display} nach ${toStation.display}...`,'bot');

  try{
    routeLayer.clearLayers();
    stationLayer.clearLayers();

    // Marker setzen
    allPoints.forEach(p=>{
      L.marker([p.lat,p.lon],{title:p.display}).addTo(stationLayer).bindPopup(p.display);
    });

    const res = await computeRouteWithGraph(allPoints,vmax);

    // Polyline
    const poly = L.polyline(res.polyline,{weight:5,color:'blue'}).addTo(routeLayer);
    map.fitBounds(poly.getBounds(),{padding:[40,40]});

    const total_h = Math.floor(res.totalTime_s/3600);
    const total_min = Math.round((res.totalTime_s%3600)/60);
    let msg = `Route: ${(res.totalLen_m/1000).toFixed(1)} km — Fahrzeit: ${total_h}h ${total_min}min bei ${vmax} km/h`;
    if(timeStr){
      const [hh,mm] = timeStr.split(':').map(Number);
      const dep=new Date(); dep.setHours(hh,mm,0,0);
      const arr=new Date(dep.getTime()+res.totalTime_s*1000);
      msg += ` — Ankunft: ${arr.getHours()}:${arr.getMinutes().toString().padStart(2,'0')}`;
    }

    if(viaPoints.length>0){
      msg += `\nZwischenpunkte: ${viaPoints.map(v=>v.display).join(', ')}`;
    }

    addMessage(msg,'bot');

  } catch(err){
    console.error(err);
    addMessage('Fehler bei der Berechnung versuche es bitte erneut.','bot');
  }
}

// -----------------------------
// 🟢 Event Listener
// -----------------------------
sendBtn.addEventListener('click',()=>{
  const val = userInput.value.trim();
  if(val) handleUserMessage(val);
  userInput.value='';
});
userInput.addEventListener('keypress',e=>{
  if(e.key==='Enter') sendBtn.click();
});

// -----------------------------
// 🟢 Start
// -----------------------------
loadStations();

//Check device
function checkMobile() {
  const ua = navigator.userAgent || navigator.vendor || window.opera;

  // Prüfe, ob es ein Mobiltelefon ist (aber kein Tablet)
  const isPhone =
    (/Mobi|Android|iPhone|iPod/i.test(ua)) && !/iPad|Tablet/i.test(ua);

  if (isPhone) {
    const warning = document.getElementById('mobile-warning');
    const main = document.getElementById('main-content');

    if (warning && main) {
      warning.style.display = 'flex';
      main.style.display = 'none';
    }
  }
}

window.addEventListener('load', checkMobile);

