const PRODUCTION_API_URL = "https://rastreo-grpc-backend.onrender.com";

const IS_LOCAL = ["localhost", "127.0.0.1"].includes(window.location.hostname);
window.API_URL = IS_LOCAL ? window.location.origin : PRODUCTION_API_URL;
window.ORDER_ID = "PED-001";
