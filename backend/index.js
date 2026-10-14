const { startGrpcServer } = require('./src/grpc-server');
const { startWeb } = require('./src/web');
const { startSimulator } = require('./src/simulator');

async function main() {
  await startGrpcServer();
  startWeb();
  startSimulator();
}

main().catch((err) => {
  console.error('Error al iniciar:', err);
  process.exit(1);
});
