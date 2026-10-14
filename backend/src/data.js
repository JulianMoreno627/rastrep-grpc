const ORIGIN = { lat: 1.2142, lng: -77.2786, name: 'Restaurante (Plaza de Nariño)' };
const DESTINATION = { lat: 1.2262, lng: -77.2838, name: 'Casa del cliente' };

const FALLBACK_ROUTE = [
  [1.2142, -77.2786],
  [1.2160, -77.2795],
  [1.2180, -77.2802],
  [1.2200, -77.2812],
  [1.2220, -77.2820],
  [1.2242, -77.2830],
  [1.2262, -77.2838],
];

const ORDERS = {
  'PED-001': {
    id: 'PED-001',
    description: '2 hamburguesas + 1 gaseosa',
    courier: 'Carlos (moto ABC-12D)',
    origin: ORIGIN,
    destination: DESTINATION,
    status: 'CREATED',
    route: FALLBACK_ROUTE.map(([lat, lng]) => ({ lat, lng })),
  },
};

module.exports = { ORIGIN, DESTINATION, FALLBACK_ROUTE, ORDERS };
