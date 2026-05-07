# 🌊 AlertaRíos v2.1 — Sistema de Alerta Temprana REAL

Sistema **100% gratuito** de alertas en tiempo real para inundaciones, crecientes,  
deslizamientos y desbordamientos en Colombia — Norte de Santander.

---

## ✅ ¿Qué hace REALMENTE esta app?

| Función | Fuente real | ¿Es simulado? |
|---|---|---|
| Caudal de ríos hoy | **GloFAS / Copernicus EU** | ❌ Datos reales |
| Caudal en nacimientos (cuenca alta) | **GloFAS cuenca alta** | ❌ Datos reales |
| Riesgo de desbordamiento por río | Caudal vs umbral histórico IDEAM | ❌ Cálculo real |
| Tiempo estimado para creciente | Tendencia del caudal m³/s·h | ❌ Cálculo real |
| Riesgo de deslizamientos | Lluvia 24h/48h vs umbral por zona | ❌ Cálculo real |
| Impacto de deslizamiento en río | Cruce caudal + zona geológica | ❌ Cálculo real |
| Pronóstico lluvia 7 días | **Open-Meteo** | ❌ Datos reales |
| Alertas push automáticas | **Firebase FCM** | ❌ Funcional |
| Feed en tiempo real | **Firebase Firestore onSnapshot** | ❌ Funcional |
| Reporte ciudadano | **Firebase Firestore** | ❌ Funcional |
| Mapa con ríos coloreados | **Leaflet + GloFAS** | ❌ Datos reales |
| Ubicación automática | GPS del dispositivo | ❌ Funcional |
| Funciona sin internet | Service Worker + caché | ❌ Funcional |

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────┐
│           FUENTES DE DATOS GRATUITAS                 │
│                                                      │
│  GloFAS (EU Copernicus)  ←─ Caudal m³/s (ríos)      │
│  Open-Meteo              ←─ Lluvia mm/día            │
│  NASA POWER              ←─ Clima histórico          │
│  IDEAM                   ←─ Umbrales históricos      │
│  UNGRD                   ←─ Zonas deslizamiento      │
└──────────────────┬──────────────────────────────────┘
                   │  cada 30 min
                   ▼
┌─────────────────────────────────────────────────────┐
│        Firebase Cloud Functions (gratis)             │
│                                                      │
│  checkRivers()                                       │
│  ├── GloFAS: caudal actual vs umbral                 │
│  ├── GloFAS: creciente en nacimiento                 │
│  ├── Open-Meteo: lluvia 24h y 48h por zona           │
│  ├── evalLandslideRisk(): deslizamientos             │
│  └── Si hay alerta nueva:                            │
│       ├── Guarda en Firestore /alerts                │
│       ├── Actualiza /rivers_status                   │
│       ├── Actualiza /landslide_status                │
│       └── Envía push FCM a todos los usuarios        │
└──────────────────┬──────────────────────────────────┘
                   │  Firestore onSnapshot (tiempo real)
                   ▼
┌─────────────────────────────────────────────────────┐
│        PWA — index.html (Firebase Hosting)           │
│                                                      │
│  Tab Inicio    → Hero de riesgo, ríos cercanos,      │
│                  deslizamientos, nacimientos,         │
│                  pronóstico 7 días, feed alertas     │
│  Tab En Vivo   → Feed en tiempo real con filtros     │
│  Tab Mapa      → Leaflet: ríos coloreados,           │
│                  marcadores deslizamientos           │
│  Tab Reportar  → Reporte ciudadano → Firestore       │
│  Tab Ajustes   → Push, GPS, fuentes de datos         │
│                                                      │
│  Service Worker → offline + caché + push background  │
└─────────────────────────────────────────────────────┘
```

---

## 🗺️ Ríos monitoreados

| Río | Nacimiento | Umbral precaución | Umbral crítico |
|---|---|---|---|
| Pamplonita | Páramo del Almorzadero (2900 msnm) | 80 m³/s | 150 m³/s |
| Zulia | Serranía de los Motilones (2400 msnm) | 200 m³/s | 400 m³/s |
| Táchira | Páramo El Zumbador, Venezuela (2800 msnm) | 60 m³/s | 120 m³/s |
| Catatumbo | Sierra de Perijá, Venezuela (1600 msnm) | 500 m³/s | 900 m³/s |
| Sardinata | Serranía de San Lucas (1800 msnm) | 120 m³/s | 250 m³/s |

---

## 🏔️ Zonas de deslizamiento monitoreadas

| Zona | Municipio | Río afectado | Umbral lluvia precaución | Umbral lluvia peligro |
|---|---|---|---|---|
| Valle del Zulia | Cáchira | Zulia | 40 mm/24h | 70 mm/24h |
| Cañón del Pamplonita | Herrán / Toledo | Pamplonita | 50 mm/24h | 80 mm/24h |
| Cuenca Algodonal | Ábrego | Catatumbo | 45 mm/24h | 75 mm/24h |
| Serranía Motilones | Tibú | Catatumbo | 55 mm/24h | 90 mm/24h |

Los umbrales se ajustan en `ZONAS_DESLIZAMIENTO` dentro de `functions/index.js`.

---

## 🚀 Instalación paso a paso

### Requisitos
- Cuenta GitHub (gratis)
- Cuenta Firebase (gratis — plan Spark)
- Node.js 18+ instalado en tu PC
- Firebase CLI: `npm install -g firebase-tools`

---

### Paso 1 — Crear proyecto Firebase

1. Ve a https://console.firebase.google.com
2. **"Agregar proyecto"** → nombre: `alerta-rios`
3. En el proyecto, haz clic en **"</>"** (Web) y registra la app
4. Copia el objeto `firebaseConfig` que aparece

---

### Paso 2 — Activar servicios Firebase

**Firestore Database**
- Build → Firestore Database → Crear base de datos
- Modo: **Producción** → Región: `us-central1`

**Cloud Messaging (FCM)**
- Project Settings → Cloud Messaging → Web Push certificates
- Genera el certificado VAPID y guarda la clave pública

**Cloud Functions**
- Build → Functions → Comenzar (requiere verificación de cuenta, gratuito)

**Authorized Domains**
- Authentication → Settings → Authorized domains
- Agregar tu dominio de GitHub Pages o Firebase Hosting

---

### Paso 3 — Configurar credenciales

Las credenciales ya están incrustadas en `index.html`. Si creas un proyecto nuevo,
busca en `index.html` el bloque `FIREBASE_CONFIG` y reemplaza los valores.

---

### Paso 4 — Subir a GitHub

```bash
git init
git add .
git commit -m "AlertaRíos v2.1 — alertas reales + deslizamientos"
git remote add origin https://github.com/TU_USUARIO/inundaciones.git
git push -u origin main
```

---

### Paso 5 — Configurar secretos de GitHub para CI/CD

GitHub → Settings → Secrets and variables → Actions → New repository secret:

| Secreto | Cómo obtenerlo |
|---|---|
| `FIREBASE_TOKEN` | Ejecuta `firebase login:ci` en tu PC → copia el token |
| `FIREBASE_PROJECT_ID` | El ID de tu proyecto Firebase (ej: `inundacionescolombia-80a5f`) |

Con esto, cada `git push` al branch `main` despliega automáticamente:
- Firebase Hosting (index.html, sw.js, manifest.json, icons/)
- Cloud Functions (functions/index.js)
- Firestore rules y indexes

---

### Paso 6 — Primer deploy manual

```bash
firebase login
firebase use TU_PROJECT_ID

cd functions && npm install && cd ..
firebase deploy
```

---

### Paso 7 — Iconos PWA

La carpeta `icons/` ya incluye los 8 tamaños generados (72 a 512px).  
Si quieres personalizarlos, reemplaza los archivos manteniendo los mismos nombres.

---

## 📊 Límites del plan gratuito Firebase (Spark)

| Servicio | Límite gratuito | AlertaRíos usa |
|---|---|---|
| Firestore lecturas | 50,000/día | ~800/día ✅ |
| Firestore escrituras | 20,000/día | ~200/día ✅ |
| Cloud Functions invocaciones | 2,000,000/mes | ~1,440/mes ✅ |
| Firebase Hosting | 10 GB/mes | < 2 MB ✅ |
| FCM notificaciones push | **Ilimitado** | ✅ |

---

## 📡 APIs gratuitas — detalles técnicos

### GloFAS Flood API (Copernicus / EU)
- URL: `https://flood-api.open-meteo.com/v1/flood`
- Sin clave. Sin registro. Sin límite de uso.
- Actualización: cada 6 horas. Modelo GloFAS 4.0.

### Open-Meteo
- URL: `https://api.open-meteo.com/v1/forecast`
- Sin clave. Sin registro. Sin límite de uso.
- Precipitación diaria, probabilidad de lluvia, código de tiempo.
- Actualización: cada hora.

---

## 📁 Estructura del proyecto

```
inundaciones/
├── index.html                  ← App PWA completa (Firebase conectado)
├── sw.js                       ← Service Worker (offline + push background)
├── manifest.json               ← Configuración instalación PWA
├── firebase.json               ← Config Firebase Hosting + Functions
├── firestore.rules             ← Reglas de seguridad Firestore
├── firestore.indexes.json      ← Índices de consultas
├── icons/                      ← Iconos PWA (72 a 512px)
├── functions/
│   ├── index.js                ← Cloud Functions: ríos + deslizamientos
│   └── package.json
└── .github/
    └── workflows/
        └── deploy.yml          ← CI/CD: deploy completo en cada push
```

---

## 🆘 Qué hacer cuando hay alerta roja

La app muestra automáticamente:
1. Banner rojo parpadeante en la parte superior
2. Notificación push al celular (también con pantalla bloqueada)
3. Hero de estado con nivel EMERGENCIA
4. Feed en vivo con detalle del río o zona de deslizamiento
5. Tiempo estimado para desbordamiento

**Números de emergencia:**
- Emergencias generales: **123**
- Bomberos: **119**
- Cruz Roja: **132**
- Defensa Civil: **144**

---

## 🔧 Personalizar umbrales

Los umbrales de ríos están basados en datos históricos del IDEAM.  
Para ajustarlos con datos más precisos de tu estación:

1. Consulta el [DHIME IDEAM](http://dhime.ideam.gov.co)
2. Descarga histórico de caudales de tu estación
3. Identifica el percentil 85 (precaución) y 95 (peligro)
4. Actualiza `umbral_warn` y `umbral_danger` en `functions/index.js` y en `index.html`

Para zonas de deslizamiento, ajusta `umbral_warn` y `umbral_danger` en `ZONAS_DESLIZAMIENTO`  
dentro de `functions/index.js` basándote en registros históricos de lluvia del IDEAM o UNGRD.

---

## 🤝 Contribuir

Si eres parte de una organización comunitaria, alcaldía, JAC o corporación ambiental
de Norte de Santander, puedes:

- Agregar más ríos y puntos de monitoreo
- Conectar datos reales de estaciones IDEAM (DHIME)
- Integrar alertas oficiales de CORPONOR
- Agregar más zonas de deslizamiento con datos SGC / UNGRD
- Traducir al inglés para cuencas binacionales Colombia–Venezuela

**MIT License — Uso libre para el bien común.**

---

*Datos: GloFAS (Copernicus EU), Open-Meteo, IDEAM Colombia, UNGRD, SGC.*  
*Infraestructura: Firebase (Google), GitHub Pages, OpenStreetMap.*
