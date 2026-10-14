const path = require('path');
const grpc = require('@grpc/grpc-js');
const protoLoader = require('@grpc/proto-loader');
const { ORDERS } = require('./data');

const PROTO_PATH = path.join(__dirname, '..', 'proto', 'tracking.proto');
const definition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true, longs: Number, defaults: true,
});
const trackingProto = grpc.loadPackageDefinition(definition).tracking;

const subscribers = {};
const lastLocation = {};
const activeTrip = {};

const COVERAGE_RADIUS_M = 20000;

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function calculateRoute(origin, destination) {
  const url = 'https://router.project-osrm.org/route/v1/driving/' +
    `${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    const coords = data.routes[0].geometry.coordinates;
    return [origin, ...coords.map(([lng, lat]) => ({ lat, lng })), destination];
  } catch (e) {
    console.error('[gRPC] OSRM no respondió, se usa línea recta:', e.message);
    return [origin, destination];
  }
}

function broadcast(orderId, location) {
  const streams = subscribers[orderId];
  if (!streams) return;
  for (const stream of streams) stream.write(location);
}

function GetOrder(call, callback) {
  const order = ORDERS[call.request.order_id];
  if (!order) {
    return callback({ code: grpc.status.NOT_FOUND, message: 'El pedido no existe' });
  }
  callback(null, order);
}

function SendLocations(call, callback) {
  let points = 0;
  let orderId = '';
  let responded = false;
  const respond = (err, summary) => {
    if (responded) return;
    responded = true;
    if (activeTrip[orderId] === abort) delete activeTrip[orderId];
    callback(err, summary);
  };
  const abort = () => respond({ code: grpc.status.ABORTED, message: 'El cliente cambió el destino' });

  call.on('data', (loc) => {
    points++;
    orderId = loc.order_id;
    const order = ORDERS[orderId];
    if (!order || responded) return;
    activeTrip[orderId] = abort;

    const distance = distanceMeters(loc.lat, loc.lng, order.destination.lat, order.destination.lng);
    let status = 'ON_THE_WAY';
    if (distance < 200) status = 'NEARBY';
    if (distance < 15) status = 'DELIVERED';
    order.status = status;

    const location = { ...loc, status, remaining_distance_m: Math.round(distance) };
    lastLocation[orderId] = location;
    broadcast(orderId, location);
  });

  call.on('end', () => {
    console.log(`[gRPC] Recorrido de ${orderId} terminado: ${points} puntos recibidos`);
    respond(null, { points_received: points, message: `Recorrido de ${orderId} completado` });
  });

  call.on('error', (e) => console.error('[gRPC] Error en SendLocations:', e.message));
}

function TrackOrder(call) {
  const orderId = call.request.order_id;
  if (!subscribers[orderId]) subscribers[orderId] = new Set();
  subscribers[orderId].add(call);
  console.log(`[gRPC] Nuevo seguidor de ${orderId} (total: ${subscribers[orderId].size})`);

  if (lastLocation[orderId]) call.write(lastLocation[orderId]);

  call.on('cancelled', () => {
    subscribers[orderId].delete(call);
    console.log(`[gRPC] Seguidor de ${orderId} desconectado`);
  });
}

async function ChangeDestination(call, callback) {
  const { order_id, destination } = call.request;
  const order = ORDERS[order_id];
  if (!order) {
    return callback({ code: grpc.status.NOT_FOUND, message: 'El pedido no existe' });
  }
  const distance = destination
    ? distanceMeters(order.origin.lat, order.origin.lng, destination.lat, destination.lng)
    : NaN;
  if (!(distance <= COVERAGE_RADIUS_M)) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Destino fuera de la zona de cobertura (20 km)' });
  }

  order.destination = { lat: destination.lat, lng: destination.lng, name: destination.name || 'Destino' };
  order.route = await calculateRoute(order.origin, order.destination);
  order.status = 'CREATED';
  delete lastLocation[order_id];
  console.log(`[gRPC] Nuevo destino para ${order_id}: ruta de ${order.route.length} puntos`);

  if (activeTrip[order_id]) activeTrip[order_id]();

  callback(null, order);
}

function startGrpcServer() {
  const address = process.env.GRPC_BIND || '0.0.0.0:50051';
  return new Promise((resolve, reject) => {
    const server = new grpc.Server();
    server.addService(trackingProto.Tracking.service, {
      GetOrder, SendLocations, TrackOrder, ChangeDestination,
    });
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (err) => {
      if (err) return reject(err);
      console.log(`[gRPC] Servidor escuchando en ${address}`);
      for (const order of Object.values(ORDERS)) {
        const initialDestination = order.destination;
        calculateRoute(order.origin, initialDestination).then((route) => {
          if (order.destination === initialDestination) order.route = route;
        });
      }
      resolve(server);
    });
  });
}

if (require.main === module) startGrpcServer();

module.exports = { startGrpcServer, trackingProto };
