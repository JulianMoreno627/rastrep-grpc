const API = window.API_URL;
const ORDER_ID = window.ORDER_ID;
const AVERAGE_SPEED_MPS = 6;

const STATUS_LABELS = {
  CREATED: 'CREADO',
  ON_THE_WAY: 'EN CAMINO',
  NEARBY: 'CERCA',
  DELIVERED: 'ENTREGADO',
};
const STATUS_ORDER = ['ON_THE_WAY', 'NEARBY', 'DELIVERED'];

const $ = (id) => document.getElementById(id);

const map = L.map('map').setView([1.2142, -77.2786], 15);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

const scooterIcon = L.divIcon({ className: '', html: '<div class="scooter-icon">🛵</div>', iconSize: [30, 30], iconAnchor: [15, 15] });
let courierMarker = null;
let destinationMarker = null;
let myMarker = null;
let destinationFromGps = false;
const plannedRoute = L.polyline([], { color: '#6b7393', weight: 4, dashArray: '6 8' }).addTo(map);
const traveledPath = L.polyline([], { color: '#2f4bd6', weight: 5, opacity: 0.8 }).addTo(map);

function setConnection(text, type) {
  const chip = $('connection');
  chip.textContent = text;
  chip.className = `chip chip--${type}`;
}

function setStatus(status) {
  const badge = $('status');
  badge.textContent = STATUS_LABELS[status] || status;
  badge.dataset.status = status;

  const current = STATUS_ORDER.indexOf(status);
  document.querySelectorAll('.steps li').forEach((li) => {
    li.classList.toggle('done', STATUS_ORDER.indexOf(li.dataset.step) <= current);
  });
}

function setHelp(text) {
  $('destination-help').textContent = text;
}

async function loadOrder() {
  for (let attempt = 1; attempt <= 20; attempt++) {
    try {
      const response = await fetch(`${API}/api/orders/${ORDER_ID}`);
      if (!response.ok) throw new Error('respuesta ' + response.status);
      return await response.json();
    } catch (e) {
      setConnection(`Despertando el servidor… (intento ${attempt})`, 'wait');
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw new Error('No se pudo conectar con el backend');
}

function renderOrder(order) {
  $('order-id').textContent = order.id;
  $('description').textContent = order.description;
  $('courier').textContent = order.courier;

  L.marker([order.origin.lat, order.origin.lng]).addTo(map).bindPopup('🍔 ' + order.origin.name);
  renderDestination(order);
}

function renderDestination(order) {
  if (destinationMarker) destinationMarker.remove();
  destinationMarker = L.marker([order.destination.lat, order.destination.lng])
    .addTo(map).bindPopup('🏠 ' + order.destination.name);
  $('destination').textContent = order.destination.name;
  plannedRoute.setLatLngs(order.route.map((point) => [point.lat, point.lng]));
  map.fitBounds(plannedRoute.getBounds(), { padding: [60, 60] });
}

async function changeDestination(lat, lng, name) {
  setHelp('Calculando la ruta…');
  try {
    const response = await fetch(`${API}/api/orders/${ORDER_ID}/destination`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lat, lng, name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    traveledPath.setLatLngs([]);
    setStatus('CREATED');
    $('distance').textContent = '—';
    $('eta').textContent = '—';
    renderDestination(data);
    setHelp('O haz clic en el mapa para elegir otro destino.');
  } catch (e) {
    setHelp('No se pudo cambiar el destino: ' + e.message);
  }
}

function watchMyLocation() {
  if (!navigator.geolocation) {
    setHelp('Tu navegador no permite obtener la ubicación. Haz clic en el mapa.');
    return;
  }
  navigator.geolocation.watchPosition(
    (pos) => {
      const me = [pos.coords.latitude, pos.coords.longitude];
      if (!myMarker) {
        myMarker = L.circleMarker(me, { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 })
          .addTo(map).bindPopup('📍 Tú estás aquí');
      } else {
        myMarker.setLatLng(me);
      }
      if (!destinationFromGps) {
        destinationFromGps = true;
        changeDestination(me[0], me[1], 'Tu ubicación');
      }
    },
    () => setHelp('No diste permiso de ubicación. Haz clic en el mapa para elegir el destino.'),
    { enableHighAccuracy: true }
  );
}

$('use-my-location').onclick = () => {
  if (myMarker) {
    const { lat, lng } = myMarker.getLatLng();
    changeDestination(lat, lng, 'Tu ubicación');
  } else {
    watchMyLocation();
  }
};
map.on('click', (e) => changeDestination(e.latlng.lat, e.latlng.lng, 'Punto elegido en el mapa'));

function trackOrder() {
  const source = new EventSource(`${API}/api/orders/${ORDER_ID}/track`);

  source.onopen = () => setConnection('En vivo · gRPC conectado', 'ok');
  source.onerror = () => setConnection('Reconectando…', 'wait');

  source.onmessage = (event) => {
    const location = JSON.parse(event.data);
    const pos = [location.lat, location.lng];

    if (location.status === 'ON_THE_WAY' && $('status').dataset.status === 'DELIVERED') {
      traveledPath.setLatLngs([]);
    }

    if (!courierMarker) {
      courierMarker = L.marker(pos, { icon: scooterIcon, zIndexOffset: 1000 }).addTo(map);
    } else {
      courierMarker.setLatLng(pos);
    }
    traveledPath.addLatLng(pos);

    setStatus(location.status);
    const meters = location.remaining_distance_m;
    $('distance').textContent = meters >= 1000 ? (meters / 1000).toFixed(2) + ' km' : meters + ' m';
    $('eta').textContent = location.status === 'DELIVERED'
      ? '¡Llegó!'
      : Math.max(1, Math.round(meters / AVERAGE_SPEED_MPS / 60)) + ' min';
  };
}

loadOrder()
  .then((order) => { renderOrder(order); trackOrder(); watchMyLocation(); })
  .catch((e) => setConnection(e.message, 'error'));
