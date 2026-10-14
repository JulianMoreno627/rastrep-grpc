const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const grpc = require('@grpc/grpc-js');
const { trackingProto } = require('./grpc-server');

const GRPC_HOST = process.env.GRPC_HOST || 'localhost:50051';
const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL || '*';

function httpStatus(err) {
  if (err.code === grpc.status.NOT_FOUND) return 404;
  if (err.code === grpc.status.INVALID_ARGUMENT) return 400;
  return 500;
}

function startWeb() {
  const app = express();
  app.use(cors({ origin: FRONTEND_URL }));
  app.use(express.json());

  const client = new trackingProto.Tracking(GRPC_HOST, grpc.credentials.createInsecure());

  app.get('/api/health', (req, res) => res.json({ ok: true, grpc: GRPC_HOST }));

  app.get('/api/orders/:id', (req, res) => {
    client.GetOrder({ order_id: req.params.id }, (err, order) => {
      if (err) return res.status(httpStatus(err)).json({ error: err.details || err.message });
      res.json(order);
    });
  });

  app.post('/api/orders/:id/destination', (req, res) => {
    const { lat, lng, name } = req.body || {};
    const destination = { lat: Number(lat), lng: Number(lng), name: String(name || 'Destino') };
    client.ChangeDestination({ order_id: req.params.id, destination }, (err, order) => {
      if (err) return res.status(httpStatus(err)).json({ error: err.details || err.message });
      res.json(order);
    });
  });

  app.get('/api/orders/:id/track', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const stream = client.TrackOrder({ order_id: req.params.id });

    stream.on('data', (location) => {
      res.write(`data: ${JSON.stringify(location)}\n\n`);
    });
    stream.on('error', (err) => {
      if (err.code !== grpc.status.CANCELLED) console.error('[Web] Error gRPC:', err.message);
    });

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 20000);

    req.on('close', () => {
      clearInterval(heartbeat);
      stream.cancel();
    });
  });

  const frontendDir = path.join(__dirname, '..', '..', 'frontend');
  if (fs.existsSync(frontendDir)) {
    app.use(express.static(frontendDir));
  } else {
    app.get('/', (req, res) => res.send('Backend gRPC de rastreo funcionando. Usa /api/health'));
  }

  app.listen(PORT, () => console.log(`[Web] Gateway HTTP en http://localhost:${PORT}`));
}

if (require.main === module) startWeb();

module.exports = { startWeb };
