'use strict';

/**
 * TRACE - Grabador Automatizado de Demo Profesional
 * 
 * Flujo:
 *  - Clip 1: B2C Comensal (móvil 412x915 -> 1280x720) [15-20 s]
 *  - Clip 2: B2B Operación (desktop 1280x720: Sala -> Cocina) [10-15 s]
 *  - Clip 3: Realtime (Cocina tachado -> Comensal Servido en vivo) [10-15 s]
 *  - Montaje final: trace-demo-final.mp4 + poster
 * 
 * Variables de entorno requeridas:
 *  - TRACE_STAFF_EMAIL
 *  - TRACE_STAFF_PASSWORD
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const BASE_URL = process.env.BASE_URL || 'http://localhost:4200';
const OUT_DIR = path.resolve(__dirname, '..', 'output', 'demo');
const RAW_DIR = path.join(OUT_DIR, 'raw');

if (!fs.existsSync(RAW_DIR)) {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

const staffEmail = process.env.TRACE_STAFF_EMAIL || process.env.STAFF_EMAIL;
const staffPassword = process.env.TRACE_STAFF_PASSWORD || process.env.STAFF_PASS;

if (!staffEmail || !staffPassword) {
  console.error('\n❌ ERROR: Faltan credenciales de staff.');
  console.error('Configura las variables de entorno TRACE_STAFF_EMAIL y TRACE_STAFF_PASSWORD.\n');
  process.exit(1);
}

// -------------------------------------------------------------
// LOCALIZACIÓN DE FFMPEG
// -------------------------------------------------------------
function getFfmpegPath() {
  try {
    const res = spawnSync('ffmpeg', ['-version']);
    if (res.status === 0) return 'ffmpeg';
  } catch {}

  const pythonWinPath = path.join(
    process.env.APPDATA || '',
    'Python', 'Python314', 'site-packages', 'imageio_ffmpeg', 'binaries', 'ffmpeg-win-x86_64-v7.1.exe'
  );
  if (fs.existsSync(pythonWinPath)) return pythonWinPath;

  const pwFfmpeg = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'ffmpeg-1011', 'ffmpeg-win64.exe');
  if (fs.existsSync(pwFfmpeg)) return pwFfmpeg;

  throw new Error('No se encontró un binario de FFmpeg disponible.');
}

const FFMPEG_BIN = getFfmpegPath();
console.log(`🎬 Binario FFmpeg detectado: ${FFMPEG_BIN}`);

// -------------------------------------------------------------
// SÍNTESIS DE AUDIO CLEAN CLICK (WAV)
// -------------------------------------------------------------
const CLICK_WAV_PATH = path.join(RAW_DIR, 'click.wav');
function generateClickWav(filepath, freq = 920, durationMs = 28) {
  const sampleRate = 44100;
  const numSamples = Math.floor(sampleRate * (durationMs / 1000));
  const buffer = Buffer.alloc(44 + numSamples * 2);
  
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const decay = Math.exp(-t * 140);
    const sample = Math.sin(2 * Math.PI * freq * t) * decay * 0.22;
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }
  fs.writeFileSync(filepath, buffer);
}
generateClickWav(CLICK_WAV_PATH);

// -------------------------------------------------------------
// UI-DEMO OVERLAYS: CURSOR, SUBTÍTULOS Y MICRO-ZOOMS
// -------------------------------------------------------------
async function injectCursor(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-cursor')) return;
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = `
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3L18 12L11.5 13L8.5 20L4 3Z" fill="#ffffff" stroke="#0f172a" stroke-width="1.8" stroke-linejoin="round"/>
      </svg>
    `;
    cursor.style.cssText = `
      position: fixed; z-index: 9999999; pointer-events: none;
      width: 26px; height: 26px;
      transition: left 0.12s ease-out, top 0.12s ease-out;
      filter: drop-shadow(0px 3px 6px rgba(0,0,0,0.35));
      left: -50px; top: -50px;
    `;
    document.body.appendChild(cursor);

    document.addEventListener('mousemove', (e) => {
      cursor.style.left = e.clientX + 'px';
      cursor.style.top = e.clientY + 'px';
    });
  });
}

async function injectSubtitleBar(page) {
  await page.evaluate(() => {
    if (document.getElementById('demo-subtitle')) return;
    const bar = document.createElement('div');
    bar.id = 'demo-subtitle';
    bar.style.cssText = `
      position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
      z-index: 9999998; pointer-events: none;
      padding: 8px 18px; border-radius: 9999px;
      background: rgba(15, 23, 42, 0.88);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13.5px; font-weight: 500; letter-spacing: 0.2px;
      box-shadow: 0 8px 24px -4px rgba(0,0,0,0.35);
      transition: opacity 0.28s ease, transform 0.28s ease;
      opacity: 0;
      white-space: nowrap;
    `;
    document.body.appendChild(bar);
  });
}

async function showSubtitle(page, text, holdMs = 0) {
  await page.evaluate((t) => {
    const bar = document.getElementById('demo-subtitle');
    if (!bar) return;
    if (t) {
      bar.textContent = t;
      bar.style.opacity = '1';
      bar.style.transform = 'translateX(-50%) translateY(0)';
    } else {
      bar.style.opacity = '0';
      bar.style.transform = 'translateX(-50%) translateY(6px)';
    }
  }, text);
  if (holdMs > 0) {
    await page.waitForTimeout(holdMs);
  }
}

async function microZoom(page, targetLocator, scale = 1.08, holdMs = 900) {
  try {
    const box = typeof targetLocator === 'string'
      ? await page.locator(targetLocator).first().boundingBox()
      : await targetLocator.boundingBox();
    const ox = box ? `${Math.round(box.x + box.width / 2)}px` : '50%';
    const oy = box ? `${Math.round(box.y + box.height / 2)}px` : '50%';

    await page.evaluate(({ ox, oy, s }) => {
      document.body.style.transition = 'transform 0.42s cubic-bezier(0.16, 1, 0.3, 1)';
      document.body.style.transformOrigin = `${ox} ${oy}`;
      document.body.style.transform = `scale(${s})`;
    }, { ox, oy, s: scale });

    await page.waitForTimeout(holdMs);

    await page.evaluate(() => {
      document.body.style.transform = 'scale(1.0)';
    });
    await page.waitForTimeout(350);
  } catch (err) {}
}

async function moveAndClick(page, locator, label, opts = {}, clickTracker = null) {
  const { postClickDelay = 700, force = false, zoom = false, zoomScale = 1.08 } = opts;
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) {
    console.warn(`[WARN] moveAndClick saltado: "${label}" no visible`);
    return false;
  }
  try {
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
    const box = await el.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
      await page.waitForTimeout(250);
    }
    if (zoom) {
      await microZoom(page, el, zoomScale, 500);
    }
    if (clickTracker) {
      clickTracker.record();
    }
    await el.click({ force });
  } catch (e) {
    console.warn(`[WARN] moveAndClick falló en "${label}": ${e.message}`);
    return false;
  }
  await page.waitForTimeout(postClickDelay);
  return true;
}

async function typeSlowly(page, locator, text, label, charDelay = 42) {
  const el = typeof locator === 'string' ? page.locator(locator).first() : locator;
  const visible = await el.isVisible().catch(() => false);
  if (!visible) return false;
  await moveAndClick(page, el, label, { postClickDelay: 250 });
  await el.fill('');
  await el.pressSequentially(text, { delay: charDelay });
  await page.waitForTimeout(300);
  return true;
}

// -------------------------------------------------------------
// POSTPROCESADO CON FFMPEG (CONVERSIÓN, RECORTE Y AUDIO)
// -------------------------------------------------------------
function extractSegment(inputWebm, outputMp4, startTimeSec, endTimeSec, clickOffsetsMs = [], isMobile = false) {
  console.log(`\n🎞️ Exportando segmento: ${path.basename(outputMp4)} (${startTimeSec.toFixed(2)}s -> ${endTimeSec.toFixed(2)}s)`);
  const duration = Math.max(0.5, endTimeSec - startTimeSec);

  const videoFilter = isMobile
    ? 'scale=-2:700,pad=1280:720:(1280-iw)/2:(720-ih)/2:color=0x0b0f19'
    : 'scale=1280:720';

  let filterComplex = '';
  let args = ['-y'];

  if (startTimeSec > 0) {
    args.push('-ss', startTimeSec.toFixed(3));
  }
  args.push('-t', duration.toFixed(3), '-i', inputWebm);

  if (clickOffsetsMs.length > 0 && fs.existsSync(CLICK_WAV_PATH)) {
    args.push('-i', CLICK_WAV_PATH);
    let delayInputs = '';
    clickOffsetsMs.forEach((ts, idx) => {
      const ms = Math.max(0, Math.round(ts));
      filterComplex += `[1:a]adelay=${ms}|${ms}[c${idx}]; `;
      delayInputs += `[c${idx}]`;
    });
    const totalInputs = clickOffsetsMs.length + 1;
    filterComplex += `aevalsrc=0:d=${duration.toFixed(3)}[base]; [base]${delayInputs}amix=inputs=${totalInputs}:dropout_transition=0:normalize=0[aout]; [0:v]${videoFilter}[vout]`;
    args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '[aout]');
  } else {
    filterComplex = `aevalsrc=0:d=${duration.toFixed(3)}[aout]; [0:v]${videoFilter}[vout]`;
    args.push('-filter_complex', filterComplex, '-map', '[vout]', '-map', '[aout]');
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputMp4
  );

  const res = spawnSync(FFMPEG_BIN, args);
  if (res.status !== 0) {
    console.error(`❌ Falló extracción de ${outputMp4}:\n${res.stderr.toString()}`);
    throw new Error(`FFmpeg error en ${path.basename(outputMp4)}`);
  }
  console.log(`✅ Clip generado: ${outputMp4} (${(fs.statSync(outputMp4).size / 1024 / 1024).toFixed(2)} MB)`);
}

// -------------------------------------------------------------
// GRABACIÓN COORDINADA (COMENSAL + STAFF)
// -------------------------------------------------------------
(async () => {
  console.log('===============================================================');
  console.log('🎥 INICIANDO GRABACIÓN AUTOMATIZADA: TRACE DEMO');
  console.log('===============================================================');

  const browser = await chromium.launch({ headless: true });

  const rawComensalPath = path.join(RAW_DIR, 'raw_comensal.webm');
  const rawStaffPath = path.join(RAW_DIR, 'raw_staff.webm');

  const clip1Mp4 = path.join(OUT_DIR, 'clip1-comensal.mp4');
  const clip2Mp4 = path.join(OUT_DIR, 'clip2-operacion.mp4');
  const clip3Mp4 = path.join(OUT_DIR, 'clip3-realtime.mp4');
  const finalMp4 = path.join(OUT_DIR, 'trace-demo-final.mp4');
  const posterPng = path.join(OUT_DIR, 'trace-demo-poster.png');

  // Timings y tracking de clicks
  const timings = {
    clip1: { start: 0, end: 0, clicks: [] },
    clip2: { start: 0, end: 0, clicks: [] },
    clip3A: { start: 0, end: 0, clicks: [] },
    clip3B: { start: 0, end: 0, clicks: [] }
  };

  // CONTEXTO 1: COMENSAL (MÓVIL 412x915)
  const ctxComensal = await browser.newContext({
    recordVideo: { dir: RAW_DIR, size: { width: 412, height: 915 } },
    viewport: { width: 412, height: 915 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile Safari/537.36'
  });
  const pageComensal = await ctxComensal.newPage();
  const t0Comensal = Date.now();

  // CONTEXTO 2: STAFF (DESKTOP 1280x720)
  const ctxStaff = await browser.newContext({
    recordVideo: { dir: RAW_DIR, size: { width: 1280, height: 720 } },
    viewport: { width: 1280, height: 720 }
  });
  const pageStaff = await ctxStaff.newPage();
  const t0Staff = Date.now();

  try {
    // =========================================================
    // FASE 1: CLIP 1 - COMENSAL (B2C)
    // =========================================================
    console.log('\n--- 📱 EJECUTANDO CLIP 1: COMENSAL ---');
    timings.clip1.start = (Date.now() - t0Comensal) / 1000;

    await pageComensal.goto(`${BASE_URL}/?mesa=5`, { waitUntil: 'domcontentloaded' });
    await pageComensal.waitForTimeout(600);
    await injectCursor(pageComensal);
    await injectSubtitleBar(pageComensal);

    await showSubtitle(pageComensal, 'QR → Mesa 5', 400);

    // Escribir nombre
    await typeSlowly(pageComensal, '#input-nombre', 'Carlos', 'Nombre comensal', 36);

    // Alérgeno Gluten
    await showSubtitle(pageComensal, 'Filtro de alérgenos');
    await moveAndClick(pageComensal, 'ion-select', 'Selector de alérgenos', { postClickDelay: 450 });

    const glutenOption = pageComensal.locator('button.select-interface-option:has-text("Gluten"), .alert-checkbox-label:has-text("Gluten")').first();
    await moveAndClick(pageComensal, glutenOption, 'Opción Gluten', {
      zoom: true,
      zoomScale: 1.05,
      postClickDelay: 350
    }, { record: () => timings.clip1.clicks.push(Date.now() - t0Comensal) });

    const okBtn = pageComensal.locator('button.alert-button:has-text("Aceptar"), button:has-text("Aceptar")').first();
    await moveAndClick(pageComensal, okBtn, 'Aceptar alérgenos', { postClickDelay: 450 }, {
      record: () => timings.clip1.clicks.push(Date.now() - t0Comensal)
    });

    // Acceder a la carta
    await moveAndClick(pageComensal, 'button.btn-acceder', 'Acceder a la carta', { postClickDelay: 600 });
    await pageComensal.waitForURL('**/carta', { timeout: 10000 });
    await injectCursor(pageComensal);
    await injectSubtitleBar(pageComensal);

    await showSubtitle(pageComensal, 'Plato compatible con el filtro', 400);

    // Seleccionar Chuletón de Ávila
    const chuletonBtn = pageComensal.locator('button.menu-item:has-text("Chuletón")').first();
    await moveAndClick(pageComensal, chuletonBtn, 'Chuletón de Ávila', { postClickDelay: 650 });

    // Seleccionar opción en el modal
    const firstOption = pageComensal.locator('.modal-sheet button.option-item').first();
    if (await firstOption.isVisible()) {
      await moveAndClick(pageComensal, firstOption, 'Gramaje', { postClickDelay: 300 });
    }

    // Añadir al pedido
    const btnAnadir = pageComensal.locator('.modal-sheet button.btn-anadir-modal');
    await moveAndClick(pageComensal, btnAnadir, 'Añadir al pedido', {
      zoom: true,
      zoomScale: 1.06,
      postClickDelay: 650
    }, { record: () => timings.clip1.clicks.push(Date.now() - t0Comensal) });

    // Abrir carrito
    await moveAndClick(pageComensal, '.cart-pill', 'Abrir carrito', { postClickDelay: 550 });
    await pageComensal.waitForURL('**/resumen-comanda', { timeout: 10000 });
    await injectCursor(pageComensal);
    await injectSubtitleBar(pageComensal);

    // Nota de cocina
    await showSubtitle(pageComensal, 'Nota para cocina');
    await moveAndClick(pageComensal, 'button.btn-notas', 'Añadir nota', { postClickDelay: 350 });
    const noteInput = pageComensal.locator('ion-alert input.alert-input').first();
    await noteInput.fill('');
    await noteInput.pressSequentially('Sin sal, por favor', { delay: 32 });
    await moveAndClick(pageComensal, 'ion-alert button:has-text("Guardar")', 'Guardar nota', { postClickDelay: 400 });

    // Enviar comanda
    await showSubtitle(pageComensal, 'Envío de comanda en tiempo real');
    await moveAndClick(pageComensal, 'button.btn-confirmar', 'Confirmar pedido', {
      zoom: true,
      zoomScale: 1.05,
      postClickDelay: 350
    }, { record: () => timings.clip1.clicks.push(Date.now() - t0Comensal) });

    await moveAndClick(pageComensal, 'ion-alert button:has-text("Enviar")', 'Enviar definitivo', {
      postClickDelay: 600
    }, { record: () => timings.clip1.clicks.push(Date.now() - t0Comensal) });

    await pageComensal.waitForSelector('ion-alert button:has-text("Ver seguimiento")', { timeout: 10000 });
    await moveAndClick(pageComensal, 'ion-alert button:has-text("Ver seguimiento")', 'Ver seguimiento', { postClickDelay: 700 });
    await pageComensal.waitForURL('**/seguimiento-comanda', { timeout: 10000 });
    await injectCursor(pageComensal);
    await injectSubtitleBar(pageComensal);

    await showSubtitle(pageComensal, 'Comanda enviada · Estado: Pendiente', 1200);
    await showSubtitle(pageComensal, '');

    timings.clip1.end = (Date.now() - t0Comensal) / 1000;
    console.log(`Punto final Clip 1: ${timings.clip1.end.toFixed(2)}s`);

    // =========================================================
    // FASE 2: CLIP 2 - OPERACIÓN (SALA & COCINA)
    // =========================================================
    console.log('\n--- 💻 EJECUTANDO CLIP 2: OPERACIÓN (SALA & COCINA) ---');
    timings.clip2.start = (Date.now() - t0Staff) / 1000;

    await pageStaff.goto(`${BASE_URL}/admin/login`, { waitUntil: 'domcontentloaded' });
    await pageStaff.waitForTimeout(400);
    await injectCursor(pageStaff);
    await injectSubtitleBar(pageStaff);

    // Rellenar credenciales discretamente
    const emailInput = pageStaff.locator('ion-input[name="email"] input').first();
    const passInput = pageStaff.locator('ion-input[name="password"] input').first();
    await emailInput.fill(staffEmail);
    await passInput.fill(staffPassword);
    await pageStaff.waitForTimeout(400);
    
    const btnAcceso = pageStaff.locator('ion-button.btn-acceso').first();
    await moveAndClick(pageStaff, btnAcceso, 'Acceso Staff', { force: true, postClickDelay: 800 }, {
      record: () => timings.clip2.clicks.push(Date.now() - t0Staff)
    });
    await pageStaff.waitForURL(url => !url.toString().includes('/login'), { timeout: 15000 });
    await injectCursor(pageStaff);
    await injectSubtitleBar(pageStaff);

    await showSubtitle(pageStaff, 'Gestión de Sala — Notificación en vivo', 700);

    // Esperar comanda de Mesa 5 en Entradas
    await pageStaff.waitForSelector('.kanban-card:has-text("Mesa 5")', { timeout: 10000 });
    const cardMesa5 = pageStaff.locator('.kanban-card:has-text("Mesa 5")').first();

    const boxCard = await cardMesa5.boundingBox();
    if (boxCard) {
      await pageStaff.mouse.move(boxCard.x + boxCard.width / 2, boxCard.y + boxCard.height / 2, { steps: 8 });
      await pageStaff.waitForTimeout(500);
    }

    // Aprobar y Enviar a Cocina
    await showSubtitle(pageStaff, 'Validación y despacho');
    const btnAprobar = cardMesa5.locator('button.btn-swipe-action.action-orange, button:has-text("Aprobar")').first();
    await moveAndClick(pageStaff, btnAprobar, 'Aprobar y Enviar', {
      zoom: true,
      zoomScale: 1.05,
      postClickDelay: 800
    }, { record: () => timings.clip2.clicks.push(Date.now() - t0Staff) });

    // Navegar a Cocina
    await showSubtitle(pageStaff, 'KDS Cocina — Alerta de alérgenos');
    const btnIrCocina = pageStaff.locator('ion-button:has-text("Cocina"), .btn-neon-orange').first();
    await moveAndClick(pageStaff, btnIrCocina, 'Abrir Cocina', { postClickDelay: 700 });
    await pageStaff.waitForURL('**/admin/cocina', { timeout: 10000 });
    await injectCursor(pageStaff);
    await injectSubtitleBar(pageStaff);

    // Mostrar el ticket en cocina con su alerta de alérgenos
    await pageStaff.waitForSelector('.ticket:has-text("MESA 5")', { timeout: 10000 });
    const ticketCocina = pageStaff.locator('.ticket:has-text("MESA 5")').first();
    const boxTicket = await ticketCocina.boundingBox();
    if (boxTicket) {
      await pageStaff.mouse.move(boxTicket.x + boxTicket.width / 2, boxTicket.y + 70, { steps: 8 });
      await pageStaff.waitForTimeout(1400);
    }
    await showSubtitle(pageStaff, '');

    timings.clip2.end = (Date.now() - t0Staff) / 1000;
    console.log(`Punto final Clip 2: ${timings.clip2.end.toFixed(2)}s`);

    // =========================================================
    // FASE 3: CLIP 3 - REALTIME (COCINA -> COMENSAL)
    // =========================================================
    console.log('\n--- ⚡ EJECUTANDO CLIP 3: REALTIME (COCINA -> COMENSAL) ---');

    // 3A: Acción en Cocina
    timings.clip3A.start = (Date.now() - t0Staff) / 1000;
    await showSubtitle(pageStaff, 'Cocina — Preparación y despacho', 400);

    // Guardar timestamp en comensal justo antes de despachar en cocina
    timings.clip3B.start = Math.max(0, (Date.now() - t0Comensal) / 1000 - 0.5);

    const itemChecklist = ticketCocina.locator('li.item-checklist, .checkbox-visual').first();
    await moveAndClick(pageStaff, itemChecklist, 'Marcar preparado', {
      force: true,
      zoom: true,
      zoomScale: 1.06,
      postClickDelay: 1000
    }, { record: () => timings.clip3A.clicks.push(Date.now() - t0Staff) });

    await showSubtitle(pageStaff, 'Ticket completado', 700);
    await showSubtitle(pageStaff, '');
    timings.clip3A.end = (Date.now() - t0Staff) / 1000;

    // 3B: Actualización en Comensal
    await injectCursor(pageComensal);
    await injectSubtitleBar(pageComensal);

    // Esperar a que el badge cambie a Servido en vivo
    await pageComensal.waitForFunction(() => {
      const badge = document.querySelector('.ronda-estado');
      const text = badge ? (badge.textContent || '').toLowerCase() : '';
      return text.includes('servido');
    }, { timeout: 15000 });

    await showSubtitle(pageComensal, 'Sincronización en tiempo real · Servido', 500);
    await microZoom(pageComensal, '.ronda-estado', 1.08, 1200);

    // Mover cursor a las opciones de sesión
    const btnAccion = pageComensal.locator('button.btn-pedir-cuenta, button:has-text("Pedir otra ronda"), button:has-text("Cerrar sesión")').first();
    if (await btnAccion.isVisible()) {
      const box = await btnAccion.boundingBox();
      if (box) {
        await pageComensal.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
        await pageComensal.waitForTimeout(1200);
      }
    }
    await showSubtitle(pageComensal, '');

    timings.clip3B.end = (Date.now() - t0Comensal) / 1000;

  } catch (err) {
    console.error('Error durante la grabación:', err);
    await browser.close().catch(() => {});
    process.exit(1);
  } finally {
    const rawComensalVideo = pageComensal.video();
    const rawStaffVideo = pageStaff.video();

    await ctxComensal.close();
    await ctxStaff.close();
    await browser.close();

    if (rawComensalVideo) {
      const actualPath = await rawComensalVideo.path();
      fs.copyFileSync(actualPath, rawComensalPath);
      console.log(`Video crudo Comensal guardado en: ${rawComensalPath}`);
    }
    if (rawStaffVideo) {
      const actualPath = await rawStaffVideo.path();
      fs.copyFileSync(actualPath, rawStaffPath);
      console.log(`Video crudo Staff guardado en: ${rawStaffPath}`);
    }
  }

  // =============================================================
  // POSTPROCESADO CON FFMPEG
  // =============================================================
  console.log('\n===============================================================');
  console.log('🎞️ GENERANDO CLIPS DEFINITIVOS Y MONTAJE FINAL');
  console.log('===============================================================');

  // Clip 1: Comensal
  const clicks1Offsets = timings.clip1.clicks.map(t => t - timings.clip1.start * 1000);
  extractSegment(rawComensalPath, clip1Mp4, timings.clip1.start, timings.clip1.end, clicks1Offsets, true);

  // Clip 2: Operación (Sala + Cocina)
  const clicks2Offsets = timings.clip2.clicks.map(t => t - timings.clip2.start * 1000);
  extractSegment(rawStaffPath, clip2Mp4, timings.clip2.start, timings.clip2.end, clicks2Offsets, false);

  // Clip 3A: Cocina despacho
  const clip3AMp4 = path.join(RAW_DIR, 'clip3a.mp4');
  const clicks3AOffsets = timings.clip3A.clicks.map(t => t - timings.clip3A.start * 1000);
  extractSegment(rawStaffPath, clip3AMp4, timings.clip3A.start, timings.clip3A.end, clicks3AOffsets, false);

  // Clip 3B: Comensal realtime
  const clip3BMp4 = path.join(RAW_DIR, 'clip3b.mp4');
  extractSegment(rawComensalPath, clip3BMp4, timings.clip3B.start, timings.clip3B.end, [], true);

  // Concatenar 3A y 3B en clip3-realtime.mp4
  const list3Path = path.join(RAW_DIR, 'concat_clip3.txt');
  fs.writeFileSync(list3Path, `file '${clip3AMp4.replace(/\\/g, '/')}'\nfile '${clip3BMp4.replace(/\\/g, '/')}'\n`);
  spawnSync(FFMPEG_BIN, [
    '-y', '-f', 'concat', '-safe', '0', '-i', list3Path,
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '19', '-pix_fmt', 'yuv420p', '-r', '30',
    '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    clip3Mp4
  ]);
  console.log(`✅ Clip 3 Realtime completado: ${clip3Mp4}`);

  // Montaje Final: Clip 1 + Clip 2 + Clip 3
  console.log('\n🎬 Generando montaje final: trace-demo-final.mp4');
  const concatFinalList = path.join(RAW_DIR, 'concat_final.txt');
  fs.writeFileSync(concatFinalList, `file '${clip1Mp4.replace(/\\/g, '/')}'\nfile '${clip2Mp4.replace(/\\/g, '/')}'\nfile '${clip3Mp4.replace(/\\/g, '/')}'\n`);
  
  const resFinal = spawnSync(FFMPEG_BIN, [
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFinalList,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '19',
    '-pix_fmt', 'yuv420p',
    '-r', '30',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    finalMp4
  ]);

  if (resFinal.status !== 0) {
    console.error('Error concatenando montaje final:', resFinal.stderr.toString());
  } else {
    console.log(`🎉 MONTAJE FINAL GENERADO: ${finalMp4}`);
  }

  // Generar poster frame (momento KDS con alerta de alérgenos en clip2)
  console.log('\n🖼️ Extrayendo Poster Frame...');
  spawnSync(FFMPEG_BIN, [
    '-y',
    '-ss', '00:00:08.500',
    '-i', clip2Mp4,
    '-vframes', '1',
    '-q:v', '2',
    posterPng
  ]);
  console.log(`✅ Poster frame generado: ${posterPng}`);

  // Inspección de metadata
  console.log('\n📊 METADATA DE LOS VÍDEOS GENERADOS:');
  const inspectVideo = (label, filePath) => {
    const probe = spawnSync(FFMPEG_BIN, ['-i', filePath]);
    const out = probe.stderr.toString();
    const durMatch = out.match(/Duration: (\d{2}:\d{2}:\d{2}\.\d{2})/);
    const resMatch = out.match(/, (\d{3,4}x\d{3,4})/);
    const fpsMatch = out.match(/, (\d+(?:\.\d+)?) fps/);
    const sizeMb = (fs.statSync(filePath).size / 1024 / 1024).toFixed(2);
    console.log(` • ${label}:`);
    console.log(`     Duración: ${durMatch ? durMatch[1] : 'N/A'}`);
    console.log(`     Resolución: ${resMatch ? resMatch[1] : 'N/A'}`);
    console.log(`     FPS: ${fpsMatch ? fpsMatch[1] : 'N/A'}`);
    console.log(`     Tamaño: ${sizeMb} MB`);
  };

  inspectVideo('Clip 1 (Comensal)', clip1Mp4);
  inspectVideo('Clip 2 (Operación)', clip2Mp4);
  inspectVideo('Clip 3 (Realtime)', clip3Mp4);
  inspectVideo('Montaje Final', finalMp4);

  console.log('\n===============================================================');
  console.log('🎉 GRABACIÓN Y PRODUCCIÓN COMPLETADAS CON ÉXITO');
  console.log('===============================================================');
})();
