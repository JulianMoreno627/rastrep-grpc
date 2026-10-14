const grpc = require('@grpc/grpc-js');
const { trackingProto } = require('./grpc-server');

const GRPC_HOST = process.env.GRPC_HOST || 'localhost:50051';
const ORDER_ID = 'PED-001';
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 1000);
const METERS_PER_STEP = 25;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function meters(a, b) {
  const dLat = (b.lat - a.lat) * 111320;
  const dLng = (b.lng - a.lng) * 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

function generatePoints(route) {
  const points = [route[0]];
  let leftover = 0;
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const length = meters(a, b);
    let d = METERS_PER_STEP - leftover;
    while (d < length) {
      const t = d / length;
      points.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      d += METERS_PER_STEP;
    }
    leftover = length - (d - METERS_PER_STEP);
  }
  points.push(route[route.length - 1]);
  return points;
}

function getOrder(client) {
  return new Promise((resolve, reject) => {
    client.GetOrder({ order_id: ORDER_ID }, (err, order) => (err ? reject(err) : resolve(order)));
  });
}

function driveRoute(client, route) {
  return new Promise(async (resolve) => {
    let finished = false;
    const stream = client.SendLocations((err, summary) => {
      finished = true;
      if (err && err.code === grpc.status.ABORTED) {
        console.log(`[Simulador] El servidor cortó el recorrido: ${err.details}`);
        return resolve(true);
      }
      if (err) console.error('[Simulador] Error:', err.message);
      else console.log(`[Simulador] Resumen del servidor: ${summary.message} (${summary.points_received} puntos)`);
      resolve(false);
    });

    for (const { lat, lng } of generatePoints(route)) {
      if (finished) return;
      stream.write({ order_id: ORDER_ID, lat, lng, timestamp: Date.now() });
      await wait(INTERVAL_MS);
    }
    stream.end();
  });
}

async function startSimulator() {
  const client = new trackingProto.Tracking(GRPC_HOST, grpc.credentials.createInsecure());
  console.log(`[Simulador] Conectando al servidor gRPC en ${GRPC_HOST}`);

  while (true) {
    try {
      const order = await getOrder(client);
      console.log(`[Simulador] Repartidor sale del restaurante (${order.route.length} puntos de ruta)...`);
      const aborted = await driveRoute(client, order.route);
      if (aborted) continue;
    } catch (e) {
      console.error('[Simulador] No se pudo obtener el pedido:', e.message);
    }
    await wait(8000);
  }
}

if (require.main === module) startSimulator();

module.exports = { startSimulator };
