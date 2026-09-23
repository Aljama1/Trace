# Arquitectura del Proyecto: Trace (App Comandas)

Esta aplicación ha sido desarrollada siguiendo los estándares más recientes de **Angular (v20)** y **Ionic 8**, priorizando el rendimiento, la escalabilidad, la accesibilidad y la integridad de datos (mecanismos de inalterabilidad inspirados en el RD 1007/2023).

> 📐 **Apoyo visual.** Los diagramas que acompañan esta arquitectura (capas Clean Architecture, flujo de datos B2C en tiempo real, modelo Entidad-Relación, secuencia de emisión de factura y cronograma Gantt real) se han centralizado en el anexo [`diagramas.md`](diagramas.md).

---

## 0. Decisiones arquitectónicas clave (ADR)

Esta sección recoge, en formato Architecture Decision Record (ADR), las cinco decisiones técnicas estructurales del proyecto. Cada ADR documenta el contexto, las alternativas evaluadas, la decisión adoptada y sus consecuencias, con el fin de hacer explícito el *porqué* —y no solo el *cómo*— de la arquitectura.

### ADR-001 — Componentes Standalone frente a NgModules

- **Contexto.** Angular ofreció hasta la versión 13 un modelo basado en `NgModule` como unidad de empaquetado. Desde Angular 14 los Standalone Components son la API recomendada y desde Angular 17 son el modo por defecto al generar nuevos proyectos.
- **Alternativas evaluadas.**
  1. Mantener `NgModule` con *lazy loading* clásico (compatible, conocido, pero con más *boilerplate*).
  2. Adoptar Standalone Components al 100 % (alineado con la guía oficial, pero con menos material didáctico consolidado).
- **Decisión.** Migrar al 100 % a Standalone Components y eliminar `app.module.ts` y `home.module.ts`.
- **Consecuencias.** *Lazy loading* declarativo a nivel de ruta con `loadComponent`, reducción significativa del `bundle` inicial y simplificación del *injection context*. A cambio, se renuncia a parte del ecosistema de librerías que aún publica módulos.

### ADR-002 — Reactividad con Angular Signals frente a RxJS puro

- **Contexto.** El proyecto requiere reactividad fina sobre estado mutable (carrito, perfil del comensal, estados de pedido en cocina) y reactividad sobre flujos asíncronos (`onSnapshot` de Firestore, formularios).
- **Alternativas evaluadas.**
  1. RxJS puro con `BehaviorSubject` + `async pipe` (paradigma tradicional Angular, currvas de aprendizaje conocidas, mayor verbosidad).
  2. Angular Signals + `computed()` + `effect()` (API estable desde Angular 17, granularidad fina de detección de cambios, alineada con el futuro `zoneless`).
  3. Librería externa como NgRx Signals o NgXs (potencia adicional, complejidad innecesaria para el alcance del TFG).
- **Decisión.** *Signals* como vehículo principal de estado en `core/services`; RxJS solo donde es idiomático (formularios reactivos, `from()` sobre promesas de Firebase).
- **Consecuencias.** Filtros derivados (alérgenos, urgencia temporal, separación BARRA/COCINA, agrupación KDS) se resuelven como `computed()` puros que se recalculan solo cuando cambian sus dependencias, eliminando *change detection* global. El equipo evita el coste cognitivo de los operadores RxJS avanzados (`switchMap`, `combineLatest`, `share`) salvo donde aportan claridad.

### ADR-003 — Firestore (BaaS) frente a backend propio PostgreSQL + REST

- **Contexto.** El alcance del TFG exige sincronización en tiempo real entre el móvil del comensal y los KDS de cocina/barra/caja, autenticación de dos roles (anónimo B2C + email/contraseña B2B) y despliegue en plazos de un cuatrimestre por un único desarrollador.
- **Alternativas evaluadas.**
  1. Backend propio (Node + Express + PostgreSQL + Socket.IO desplegado en VPS): control total del esquema, integridad relacional fuerte, pero requiere implementar autenticación, *websockets*, *hosting* y operación.
  2. Firebase BaaS (Firestore + Auth + Hosting + Security Rules): tiempo real nativo (`onSnapshot`), modelo de seguridad declarativo, *vendor lock-in* y modelo documental.
  3. Supabase (PostgreSQL gestionado con tiempo real): equilibrio entre los dos anteriores, ecosistema menos maduro en el momento de la elección.
- **Decisión.** Firestore. La integridad referencial se garantiza por reglas de seguridad y por el cliente; el modelado documental encaja con el dominio (la comanda viaja como un agregado completo con sus líneas embebidas).
- **Consecuencias.** Se acepta un *vendor lock-in* explícito y se mitiga abstrayendo todo acceso al SDK en `core/services/`. El coste a escala se documenta en `trabajo_futuro.md` como riesgo de evolución multi-tenant.

### ADR-004 — Autenticación anónima en B2C frente a registro de cliente

- **Contexto.** El comensal debe poder pedir desde la mesa con la mínima fricción posible (UX de "abrir cámara y empezar a pedir"). A la vez, cada pedido debe ser trazable a un identificador único para aplicar reglas de seguridad y dar seguimiento individual.
- **Alternativas evaluadas.**
  1. Registro con email/contraseña o *magic link* (mayor capacidad de marketing/retención, pero fricción inaceptable en un primer contacto).
  2. Inicio de sesión con redes sociales (similar, depende del ecosistema instalado en el móvil del comensal).
  3. Autenticación anónima de Firebase (`signInAnonymously`) que entrega un UID estable mientras dure la sesión del navegador.
- **Decisión.** Autenticación anónima. Cada cliente obtiene un UID criptográficamente único; las reglas de seguridad de Firestore lo cruzan con `idMesa` para autorizar lecturas y mutaciones.
- **Consecuencias.** Cero registro, cero contraseñas, cero RGPD-PII en el lado cliente. A cambio, se renuncia a la posibilidad de reconocer a un comensal recurrente (limitación documentada como evolución futura).

### ADR-005 — Encadenamiento SHA-256 (modo demostración) frente a firma digital AEAT productiva

- **Contexto.** El RD 1007/2023 (Veri\*factu) exige garantías técnicas de inalterabilidad y trazabilidad de las facturas emitidas. La conexión productiva con los servicios de la AEAT requiere certificado electrónico de representante y alta como obligado tributario, requisitos administrativos no satisfacibles desde un contexto académico.
- **Alternativas evaluadas.**
  1. Integración productiva con los servicios SOAP/REST de la AEAT (correcto a efectos fiscales, inviable en un TFG sin sujeto pasivo real).
  2. Encadenamiento criptográfico SHA-256 a nivel de aplicación + reglas Firestore *append-only* + contador correlativo inviolable (cubre los mecanismos técnicos exigidos en modo demostración).
  3. Solo numeración correlativa sin hash (incumpliría el criterio de inalterabilidad).
- **Decisión.** Implementar la opción 2: cada factura calcula `hashActual = SHA-256(numero | fecha | total | hashAnterior)` mediante `crypto.subtle.digest`, y la transacción de emisión incrementa `metadatos/contadores_facturas` en `+1` exactamente (regla de seguridad). La colección `facturas` está blindada contra `update` y `delete`.
- **Consecuencias.** El sistema reproduce fielmente los mecanismos técnicos del decreto y es auditable. La integración productiva con AEAT queda documentada como línea de consolidación en [`trabajo_futuro.md`](trabajo_futuro.md), separando deliberadamente lo *técnico* (resuelto) de lo *administrativo-fiscal* (fuera del alcance).

### ADR-006 — Máquina de estados de la comanda: cuatro estados frente a cinco

- **Contexto.** El ciclo de vida de una comanda requería modelar, como mínimo, los estados "recibida", "en preparación", "entregada" y "cobrada". Se planteó un quinto estado intermedio (`LISTO`) entre "en preparación" y "entregada", representando el momento en que cocina/barra terminan pero el camarero todavía no ha llevado el pedido a la mesa.
- **Alternativas evaluadas.**
  1. **Cinco estados** (`PENDIENTE → PREPARANDO → LISTO → SERVIDO → PAGADO`): más granularidad, permite al camarero saber exactamente qué está listo para recoger. Requiere una acción manual del sala para avanzar de `LISTO` a `SERVIDO`.
  2. **Cuatro estados** (`PENDIENTE → PREPARANDO → SERVIDO → PAGADO`): la transición automática a `SERVIDO` ocurre cuando cocina/barra tickean el último ítem, asumiendo que marcar = el producto ya ha salido a la mesa.
- **Decisión.** Cuatro estados. En el flujo real del restaurante objetivo el personal de cocina y barra lleva el pedido a la mesa al mismo tiempo que lo marca como preparado. Introducir `LISTO` creaba código muerto en toda la pila (tipo `EstadoComanda`, query Firestore, computed signals, stepper del cliente, traducciones i18n, manual y memoria) sin aportar ningún valor operativo. Además, `pedidosCocina` solo escucha `estado === 'PREPARANDO'`, por lo que una comanda en `LISTO` desaparecía de la vista de cocina sin salida automática, atascando el flujo.
- **Consecuencias.** El modelo de dominio es más simple y coherente con el flujo real. Si en el futuro se despliega en un restaurante con camareros de recogida dedicados (rol de "runner"), readoptar `LISTO` requeriría añadir de nuevo el estado al tipo, al `computed` de `pedidosEnCurso` y a la query, e implementar el avance manual en el panel de sala.

---

## 1. Patrón Standalone (Arquitectura sin Módulos)
A diferencia de las versiones antiguas de Angular que dependían de `NgModules`, este proyecto utiliza **Standalone Components** al 100%.
*   **Modularidad Total:** Cada componente gestiona sus propias dependencias, lo que facilita el mantenimiento.
*   **Lazy Loading Eficiente:** Los componentes se cargan bajo demanda a través del router, reduciendo el tiempo de carga inicial.
*   **Simplificación:** Eliminación de archivos innecesarios como `app.module.ts`, centralizando la configuración en `main.ts` y `app.routes.ts`.
*   **Control Flow Nativo:** Uso exclusivo de `@if` / `@for` / `@switch` (Angular 17+), eliminando las directivas estructurales heredadas.

## 2. Gestión de Estado con Angular Signals
Para la reactividad de la interfaz, se ha optado por **Signals** en lugar de depender exclusivamente de observables complejos.
*   **Rendimiento:** Angular solo actualiza las partes de la pantalla que realmente cambian, sin necesidad de comprobaciones globales pesadas.
*   **Sincronización:** Permite que datos como el carrito de compra o el estado de los pedidos se mantengan coherentes en toda la app de forma declarativa.
*   **Cómputos derivados:** Filtrado de alérgenos, agregación por estación (Barra/Cocina), urgencia temporal y separación de rondas se resuelven con `computed()` puros, sin múltiples consultas a la BD.

## 3. Integración Real-Time con Firebase
El "corazón" de la aplicación es la conexión con **Firebase Cloud Firestore**.
*   **Patrón Observer:** Se utilizan listeners (`onSnapshot`) que empujan los cambios desde la base de datos a la interfaz al instante.
*   **Seguridad:** Implementación de **Firebase Auth** para distinguir entre clientes anónimos (B2C) y personal del staff autenticado por email/contraseña (B2B).
*   **Protección de Rutas:** Uso de **Guards** funcionales (`AdminGuard`) para asegurar que solo el personal autorizado acceda al panel de gestión.
*   **Reglas de Seguridad Blindadas:** `firestore.rules` distingue clientes anónimos y staff, restringe las mutaciones del cliente al estado `PENDIENTE` (más el flag `solicitaCuenta`), y aplica *append-only* sobre la colección de facturas.

## 4. Stack Tecnológico Principal
| Tecnología | Función |
| :--- | :--- |
| **Angular 20** | Framework base de la aplicación (Standalone + Signals + Control Flow). |
| **Ionic 8 Angular** | Biblioteca de componentes UI para móviles y web. |
| **Firebase Firestore** | Base de datos NoSQL orientada a documentos en tiempo real. |
| **Firebase Auth** | Identidad anónima (B2C) y email/contraseña (B2B). |
| **Capacitor 8** | Bridge para convertir la web app en una aplicación nativa (iOS/Android). |
| **@ngx-translate/core** | Internacionalización dinámica (es / en) con pipes `currency` y `date` reactivos. |
| **jsPDF + jspdf-autotable** | Generación de informes (cierre Z, factura) en cliente. |
| **TypeScript 5.9** | Lenguaje de tipado fuerte para un código más robusto. |

## 5. Módulo de Facturación e Integridad de Datos (Demostración de trazabilidad)
La aplicación incorpora un módulo de facturación que simula los mecanismos técnicos de trazabilidad e integridad inspirados en el RD 1007/2023:
*   **Numeración correlativa inalterable:** Contador global persistido en `metadatos/contadores_facturas`, con regla de Firestore que solo permite incrementos `+1` (no admite rebobinado).
*   **Encadenamiento criptográfico:** Cada factura calcula un hash SHA-256 sobre sus campos críticos y el hash de la factura anterior, formando una cadena auditable.
*   **Append-only:** Las reglas de Firestore prohíben `update` y `delete` sobre la colección `facturas`, garantizando integridad histórica.
*   **Generación de PDF:** Documento de factura con desglose de IVA y hash SHA-256 de trazabilidad (modo demostración — sin validez fiscal oficial).

> La integración productiva con los servicios de la AEAT está fuera del alcance del TFG por requerir un certificado de representante y alta como obligado tributario; ver `trabajo_futuro.md`.

## 6. Sistema de Diseño (Design System)
La aplicación implementa un lenguaje visual unificado diseñado para entornos de alta operatividad:
*   **Tematización Dinámica:** Uso de variables CSS nativas para el soporte completo de modos claro y oscuro, optimizando la legibilidad en diferentes condiciones de iluminación (ej. Cocinas o terrazas). Los modales y vistas admin se han adaptado de forma exhaustiva a ambos temas.
*   **Arquitectura de Estilos:** Empleo de SCSS con efectos de transparencia mediante `backdrop-filter` (técnica conocida en la literatura UI como *glassmorphism*) y micro-interacciones que aportan retroalimentación táctil al usuario.
*   **Tokens de Diseño:** Centralización de colores corporativos y estados operativos (neón operacional) para garantizar la consistencia en todas las interfaces del staff.
*   **Registro Centralizado de Iconos:** Provider único que registra todos los iconos de Ionicons utilizados, evitando duplicaciones y *tree-shake* descontrolado.

## 7. Persistencia y Preferencias de Usuario
Para mejorar la experiencia de usuario y la resiliencia de la aplicación:
*   **UserSettingsService:** Capa de abstracción que gestiona el estado de configuración (tema, idioma, preferencias de filtrado) vinculando los *Angular Signals* con el almacenamiento persistente del navegador (`localStorage`).
*   **Continuidad de Sesión:** El sistema es capaz de restaurar el estado completo de la mesa, el carrito y las preferencias estéticas tras una interrupción de la red o recarga del navegador.

## 8. Internacionalización (i18n)
*   **@ngx-translate/core** con diccionarios JSON para español e inglés.
*   Cambio de idioma en caliente sin recarga, con `currency` y `date` adaptándose al locale activo.
*   Cobertura total del literal en B2C y B2B (incluyendo facturación y reportes Z).

## 9. PWA, Modo Offline y Distribución Nativa (Capacitor)
*   Integración de `@angular/service-worker` para cachear recursos estáticos.
*   Instalable como PWA en iOS y Android directamente desde el navegador (sin app store).
*   Compilable como **APK nativo Android** mediante Capacitor 8 (`appId: com.trace.comandas`), con icono personalizado, configuración de StatusBar y Keyboard nativa. La misma base de código Angular sirve para la web, la PWA y la app nativa.
*   La arquitectura soporta iOS; la compilación para iPhone requiere un Mac con Xcode.
*   Mitiga problemas en restaurantes con redes Wi-Fi inestables gracias al service worker.

---

