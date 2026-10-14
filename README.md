# RutaYa — Rastreo de domicilios en tiempo real con gRPC

Taller de **Programación Web**: app que implementa **gRPC** y se despliega en la nube.

Un repartidor (simulado) se mueve por una ruta y envía su ubicación. El cliente abre la página y ve la moto moverse en un mapa (Leaflet) en tiempo real, con el estado del pedido, la distancia y el tiempo estimado.

---

## 1. ¿Dónde está gRPC?

El contrato está en `backend/proto/tracking.proto` y usa **3 tipos de llamada gRPC** en 4 métodos:

| Método | Tipo | Quién lo usa | Para qué |
|---|---|---|---|
| `GetOrder` | **Unaria** (1 petición → 1 respuesta) | Gateway web y simulador | Datos del pedido (origen, destino, repartidor y ruta) |
| `SendLocations` | **Client streaming** (muchas peticiones → 1 respuesta) | Simulador del repartidor | Envía su ubicación cada segundo por una sola conexión; al final recibe un `Summary` |
| `TrackOrder` | **Server streaming** (1 petición → muchas respuestas) | Gateway web | Recibe en tiempo real cada nueva ubicación |
| `ChangeDestination` | **Unaria** | Gateway web | El cliente envía su ubicación GPS (o un punto del mapa); el servidor calcula la ruta por las calles con OSRM y corta el recorrido actual del simulador con `ABORTED` |

### Arquitectura

```
                     RENDER (backend, un solo Web Service)                       VERCEL (frontend)
 ┌──────────────────────────────────────────────────────────────────────┐
 │                                                                      │
 │  simulator ──gRPC client streaming──▶ servidor gRPC                  │
 │                                       (localhost:50051)              │
 │                                            │                         │
 │                                gRPC server streaming + unaria        │
 │                                            ▼                         │
 │                                     Express (gateway) ───────────────┼──SSE/HTTP──▶ index.html + Leaflet
 └──────────────────────────────────────────────────────────────────────┘
```

**¿Por qué hay un gateway Express?** Los navegadores no pueden hablar gRPC nativo (no controlan HTTP/2 a ese nivel). Express actúa como cliente gRPC y reenvía las ubicaciones al navegador con Server-Sent Events (SSE).

**¿Por qué todo en un solo servicio de Render?** Render no acepta gRPC desde internet y sus servicios privados son de pago. Las 3 piezas son programas separados que se comunican por gRPC real (HTTP/2 + Protocol Buffers); solo comparten la misma máquina.

### ¿Por qué gRPC y no REST para este caso?

- **Streaming nativo:** el rastreo es un flujo continuo de datos. Con REST habría que preguntar cada segundo ("polling"); con gRPC el dato llega apenas existe.
- **HTTP/2:** varios streams sobre una sola conexión, con menos latencia.
- **Protocol Buffers:** mensajes binarios más pequeños y rápidos que JSON.
- **Contrato tipado:** el `.proto` define exactamente qué datos se envían; cliente y servidor no se desalinean.

---

## 2. Estructura

```
rastreo-grpc/
├── backend/                 → se despliega en RENDER
│   ├── proto/tracking.proto → contrato gRPC
│   ├── src/
│   │   ├── grpc-server.js   → servidor gRPC (implementa los 4 métodos)
│   │   ├── simulator.js     → cliente gRPC: el repartidor (client streaming)
│   │   ├── web.js           → Express: cliente gRPC + SSE para el navegador
│   │   └── data.js          → pedido de ejemplo (en memoria)
│   ├── index.js             → arranca las 3 piezas juntas
│   └── package.json
├── frontend/                → se despliega en VERCEL
│   ├── index.html
│   ├── app.js               → mapa Leaflet y conexión en vivo
│   ├── styles.css
│   └── config.js            → AQUÍ va la URL de tu backend en Render
└── render.yaml              → configuración opcional para Render
```

---

## 3. Correrlo en tu computador

Requisito: **Node.js 18 o superior**.

```bash
cd backend
npm install
npm start
```

Abre **http://localhost:3000** — el backend también sirve el frontend en local.

Para mostrar en clase que son piezas independientes, puedes correrlas en 3 terminales:

```bash
npm run server       # terminal 1: servidor gRPC
npm run web          # terminal 2: gateway Express
npm run simulator    # terminal 3: el repartidor empieza a moverse
```

---

## 4. Desplegar en la nube

### Paso 0 — Subir a GitHub
Crea un repositorio y sube toda la carpeta `rastreo-grpc` (sin `node_modules`).

### Paso 1 — Backend en Render
1. Entra a https://render.com → **New +** → **Web Service** → conecta tu repositorio.
2. Configura:
   - **Root Directory:** `backend`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
3. **Create Web Service** y espera a que diga *Live*.
4. Copia la URL (ej. `https://rastreo-grpc-backend.onrender.com`) y pruébala: `https://TU-URL/api/health` debe responder `{"ok":true,...}`.

(Alternativa: **New + → Blueprint** usando el `render.yaml` incluido.)

### Paso 2 — Frontend en Vercel
1. Edita `frontend/config.js` y pon tu URL de Render en `PRODUCTION_API_URL`. Haz commit y push.
2. Entra a https://vercel.com → **Add New → Project** → importa el repositorio.
3. Configura:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Other (sin build command)
4. **Deploy**. Abre la URL de Vercel y verás la moto moverse.

### Paso 3 (recomendado) — Restringir CORS
En Render → tu servicio → **Environment** → agrega:
`FRONTEND_URL = https://tu-proyecto.vercel.app`

---

## 5. Consejos para la exposición

- **Abre la página 2–3 minutos antes.** En el plan gratis, Render apaga el servidor tras ~15 min sin uso y tarda en despertar. La página muestra "Despertando el servidor…" mientras tanto.
- Muestra el archivo `.proto` y explica los 3 tipos de llamada.
- Abre la página en dos dispositivos a la vez: ambos ven al repartidor moverse (varios clientes suscritos al mismo server streaming).
- En Render → **Logs** se ven los mensajes `[gRPC]` y `[Simulador]` en vivo, incluido el `Summary` que devuelve el client streaming al terminar cada recorrido.

## 6. Personalizar

- **Otra ciudad:** cambia las coordenadas del restaurante en `backend/src/data.js` (clic derecho en Google Maps para copiarlas).
- **Velocidad:** variable de entorno `INTERVAL_MS` (milisegundos entre ubicaciones, por defecto 1000).
