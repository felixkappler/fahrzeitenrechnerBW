// -----------------------------
// mobile.js — Mobile Darstellung + Mini-Map im Chat mit Scrollbarkeit
// -----------------------------

// Prüfen, ob Mobile-Ansicht
function isMobileView() {
  return window.innerWidth <= 768;
}

// Karte auf mobiler Ansicht ausblenden
function setupMobileView() {
  const map = document.getElementById("map");
  if (!map) return;
  map.style.display = isMobileView() ? "none" : "block";
}

// Events für Load & Resize
window.addEventListener("load", setupMobileView);
window.addEventListener("resize", setupMobileView);

// -----------------------------
// Mini-Map im Chat erzeugen
// -----------------------------
function showMiniMap(latlngs) {
  if (!isMobileView() || !latlngs || latlngs.length < 2) return;

  const chatMessages = document.getElementById("chat-messages");
  if (!chatMessages) return;

  console.log("📍 Mini-Map wird erzeugt…", latlngs.length, "Punkte");

  // Wrapper im Flow (nicht absolut), Höhe im Flow mit min-height
  const wrapper = document.createElement("div");
  wrapper.className = "msg bot minimap-msg";
  wrapper.style.width = "100%";
  wrapper.style.minHeight = "200px"; // sichtbare Höhe
  wrapper.style.marginTop = "0.5rem";
  wrapper.style.flex = "none"; // verhindert Flexbox-Einflüsse

  // Div für Leaflet Karte
  const mapDiv = document.createElement("div");
  mapDiv.id = "mini-map-" + Date.now();
  mapDiv.style.width = "100%";
  mapDiv.style.height = "100%";

  wrapper.appendChild(mapDiv);
  chatMessages.appendChild(wrapper);

  // Leaflet Karte erst nach Layout initialisieren
  requestAnimationFrame(() => {
    const miniMap = L.map(mapDiv.id, {
      attributionControl: false,
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      tap: false
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 14 }).addTo(miniMap);
    const route = L.polyline(latlngs, { color: "#007bff", weight: 4 }).addTo(miniMap);
    miniMap.fitBounds(route.getBounds(), { padding: [10, 10] });
    miniMap.invalidateSize();
  });
}

// -----------------------------
// Optionales CSS für Mini-Map falls noch nicht vorhanden
// -----------------------------
const style = document.createElement("style");
style.textContent = `
/* Mini-Map Wrapper */
.minimap-msg {
  display: block;
  overflow: hidden;
  min-height: 200px;
  flex: none;
}

/* Mini-Map Div */
.mini-map {
  width: 100%;
  height: 100%;
  border-radius: 8px;
  box-shadow: 0 0 6px rgba(0,0,0,0.2);
}

/* Leaflet Karten innerhalb von Chat-Nachrichten */
.msg.bot > div.leaflet-container {
  width: 100% !important;
  height: 100% !important;
  border-radius: 12px;
}
`;
document.head.appendChild(style);

//Darstellung Chat
function adjustChatHeight() {
  const inputHeight = document.getElementById('user-input-container').offsetHeight;
  const chatMessages = document.getElementById('chat-messages');
  chatMessages.style.maxHeight = `${window.innerHeight - inputHeight}px`;
}

window.addEventListener('resize', adjustChatHeight);
window.addEventListener('load', adjustChatHeight);
