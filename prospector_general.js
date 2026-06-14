import fs from 'fs';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

function slugify(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cleanValue(val) {
  if (!val || val.trim() === '' || val.trim().toLowerCase() === 'null' || val.trim().toLowerCase() === 'undefined') {
    return 'sin datos';
  }
  return val.trim().replace(/[\uE000-\uF8FF]/g, '').trim();
}

async function safeGetText(page, selector, fallback = 'sin datos') {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible()) {
      const text = await el.textContent();
      return text ? cleanValue(text) : fallback;
    }
  } catch (e) {}
  return fallback;
}

async function scrollFeed(page, maxResults = 40) {
  console.log('\nDesplazando resultados en Google Maps...');
  const feedSelector = 'div[role="feed"]';

  try {
    await page.waitForSelector(feedSelector, { timeout: 15000 });
  } catch (e) {
    console.warn('Nota: no se detecto el contenedor de resultados. Se intentaran leer enlaces visibles.');
  }

  let previousCount = 0;
  let noChangeCount = 0;

  while (true) {
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return anchors.map((a) => a.href);
    });
    const uniqueLinks = [...new Set(links)];
    console.log(`   Enlaces encontrados: ${uniqueLinks.length} / ${maxResults}`);

    if (uniqueLinks.length >= maxResults) return uniqueLinks.slice(0, maxResults);

    if (uniqueLinks.length === previousCount) {
      noChangeCount++;
      if (noChangeCount >= 5) return uniqueLinks;
    } else {
      noChangeCount = 0;
      previousCount = uniqueLinks.length;
    }

    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) feed.scrollBy(0, 1000);
      else window.scrollBy(0, 1000);
    }, feedSelector);
    await page.waitForTimeout(1500);
  }
}

async function extractBusinessDetails(page, url) {
  console.log(`\nExtrayendo: ${url}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(1500);

    // NOMBRE
    const nombre = await safeGetText(page, 'h1');

    // CATEGORÍA
    let categoria = 'sin datos';
    const catSelectors = [
      'button[jsaction*="pane.rating.category"]',
      'button[jsaction*="category"]',
      'button[class*="fontBodyMedium"]'
    ];
    for (const selector of catSelectors) {
      const text = await safeGetText(page, selector);
      const lowered = text.toLowerCase();
      if (text !== 'sin datos' && isNaN(Number(text)) && !lowered.includes('reseña') && !lowered.includes('review')) {
        categoria = text;
        break;
      }
    }

    // RATING Y RESEÑAS
    let rating = 'sin datos';
    let resenas = 'sin datos';
    try {
      const ratingEl = page.locator('div.F7nice').first();
      if (await ratingEl.isVisible()) {
        const text = await ratingEl.textContent();
        if (text) {
          if (text.includes('(')) {
            const parts = text.split('(');
            rating = parts[0].trim();
            resenas = parts[1].replace(')', '').trim();
          } else {
            const match = text.match(/^([0-5](?:[.,][0-9])?)(.*)$/);
            if (match) {
              rating = match[1].replace(',', '.');
              resenas = match[2].trim() || 'sin datos';
            }
          }
        }
      }

      if (rating === 'sin datos') {
        const starEl = page.locator('span[role="img"][aria-label*="estrellas"], span[role="img"][aria-label*="stars"]').first();
        if (await starEl.isVisible()) {
          const label = await starEl.getAttribute('aria-label');
          const match = label ? label.match(/([0-5](?:[.,][0-9])?)/) : null;
          if (match) rating = match[1].replace(',', '.');
        }
      }
    } catch (e) {}

    // DIRECCIÓN
    let direccion = 'sin datos';
    try {
      const addrEl = page.locator('button[data-item-id="address"]').first();
      if (await addrEl.isVisible()) direccion = await addrEl.textContent();
      else {
        const addrAria = page.locator('button[aria-label*="Dirección"], button[aria-label*="Address"]').first();
        if (await addrAria.isVisible()) direccion = await addrAria.textContent();
      }
    } catch (e) {}

    // TELÉFONO
    let telefono = 'sin datos';
    try {
      const phoneEl = page.locator('button[data-item-id^="phone:"]').first();
      if (await phoneEl.isVisible()) {
        const rawPhone = await phoneEl.getAttribute('data-item-id');
        if (rawPhone) telefono = rawPhone.replace('phone:tel:', '').trim();
      } else {
        const phoneAria = page.locator('button[aria-label*="Teléfono"], button[aria-label*="Phone"]').first();
        if (await phoneAria.isVisible()) telefono = await phoneAria.textContent();
      }
    } catch (e) {}

    // SITIO WEB
    let website = 'sin datos';
    try {
      const webEl = page.locator('a[data-item-id="authority"]').first();
      if (await webEl.isVisible()) website = await webEl.getAttribute('href');
      else {
        const webAria = page.locator('a[aria-label*="Sitio web"], a[aria-label*="Website"]').first();
        if (await webAria.isVisible()) website = await webAria.getAttribute('href');
      }
    } catch (e) {}

    // DESCRIPCIÓN DEL NEGOCIO
    let descripcion = 'sin datos';
    try {
      const descSelectors = [
        'div[class*="PYvSYb"]',
        'div[class*="HlvSq"]',
        'div[class*="dbg0pd"]',
        'div[jslog*="description"]'
      ];
      for (const sel of descSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible()) {
          const text = await el.textContent();
          if (text && text.trim().length > 10) {
            descripcion = cleanValue(text);
            break;
          }
        }
      }
    } catch (e) {}

    // HORARIOS
    let horarios = 'sin datos';
    try {
      const horarioSelectors = [
        'div[class*="t39EBf"]',
        'button[data-item-id*="oh"]',
        'div[aria-label*="horario"], div[aria-label*="hours"]',
        'table[class*="eK4R0e"]'
      ];
      for (const sel of horarioSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible()) {
          horarios = 'completos';
          break;
        }
      }
    } catch (e) {}

    await page.waitForTimeout(2000);

    // FOTOS
    let fotos = '0';
    try {
      const fotoCount = await page.evaluate(() => {
        // Buscar cualquier botón o elemento que contenga número de fotos
        const allButtons = Array.from(document.querySelectorAll('button'));
        for (const btn of allButtons) {
          const label = btn.getAttribute('aria-label') || '';
          const text = btn.textContent || '';
          const combined = label + ' ' + text;
          const match = combined.match(/(\d+)\s*(foto|photo|imagen|image)/i);
          if (match) return match[1];
        }
        // Buscar en divs y spans también
        const allEls = Array.from(document.querySelectorAll('div, span'));
        for (const el of allEls) {
          const label = el.getAttribute('aria-label') || '';
          const match = label.match(/(\d+)\s*(foto|photo)/i);
          if (match) return match[1];
        }
        return '0';
      });
      fotos = fotoCount || '0';
    } catch (e) {
      fotos = '0';
    }

    // ÚLTIMA RESEÑA — abrimos el panel de reseñas
    let ultimaResena = 'sin datos';
    try {
      const reviewBtnSelectors = [
        'button[jsaction*="reviews"]',
        'button[aria-label*="reseña"]',
        'button[aria-label*="review"]'
      ];
      for (const sel of reviewBtnSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible()) {
          await btn.click({ timeout: 3000 });
          await page.waitForTimeout(2000);
          break;
        }
      }

      const fechaSelectors = [
        'span[class*="rsqaWe"]',
        'span[class*="dehysf"]',
        'span[class*="y3Ibjb"]'
      ];
      for (const sel of fechaSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible()) {
          const text = await el.textContent();
          if (text) {
            ultimaResena = cleanValue(text);
            break;
          }
        }
      }

      // Volver a la vista principal
      const backBtn = page.locator('button[aria-label*="Atrás"], button[aria-label*="Back"]').first();
      if (await backBtn.isVisible()) await backBtn.click({ timeout: 2000 });
      await page.waitForTimeout(1000);

    } catch (e) {}

    // RESPONDE RESEÑAS
    let respondeResenas = 'no';
    try {
      const respuestaSelectors = [
        'div[class*="CDe7pd"]',
        'div[class*="wiI7pd"]',
        'div[aria-label*="Respuesta"]',
        'div[aria-label*="Response from"]'
      ];
      for (const sel of respuestaSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible()) {
          respondeResenas = 'si';
          break;
        }
      }
    } catch (e) {}

    // PUBLICACIONES RECIENTES EN GBP
    let publicaciones = '0';
    try {
      const postSelectors = [
        'div[class*="LBgpqf"]',
        'div[class*="WNxzHc"]',
        'div[aria-label*="Actualización"]',
        'div[aria-label*="Update"]'
      ];
      for (const sel of postSelectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible()) {
          publicaciones = '1';
          break;
        }
      }
    } catch (e) {}

    const result = {
      nombre: cleanValue(nombre),
      categoria: cleanValue(categoria),
      rating: cleanValue(rating),
      resenas: cleanValue(resenas),
      telefono: cleanValue(telefono),
      website: cleanValue(website),
      direccion: cleanValue(direccion || ''),
      fotos: cleanValue(fotos),
      descripcion: cleanValue(descripcion),
      horarios: cleanValue(horarios),
      ultima_resena: cleanValue(ultimaResena),
      responde_resenas: cleanValue(respondeResenas),
      publicaciones: cleanValue(publicaciones),
      mapsUrl: url
    };

    console.log(`   Nombre: ${result.nombre}`);
    console.log(`   Categoria: ${result.categoria}`);
    console.log(`   Rating: ${result.rating} (${result.resenas} reseñas)`);
    console.log(`   Telefono: ${result.telefono}`);
    console.log(`   Website: ${result.website}`);
    console.log(`   Fotos: ${result.fotos}`);
    console.log(`   Descripcion: ${result.descripcion.substring(0, 60)}...`);
    console.log(`   Horarios: ${result.horarios}`);
    console.log(`   Ultima resena: ${result.ultima_resena}`);
    console.log(`   Responde resenas: ${result.responde_resenas}`);
    console.log(`   Publicaciones: ${result.publicaciones}`);

    return result;

  } catch (error) {
    console.error(`Error extrayendo datos: ${error.message}`);
    return {
      nombre: 'sin datos',
      categoria: 'sin datos',
      rating: 'sin datos',
      resenas: 'sin datos',
      telefono: 'sin datos',
      website: 'sin datos',
      direccion: 'sin datos',
      fotos: '0',
      descripcion: 'sin datos',
      horarios: 'sin datos',
      ultima_resena: 'sin datos',
      responde_resenas: 'no',
      publicaciones: '0',
      mapsUrl: url
    };
  }
}

function escapeCsvValue(val) {
  if (val === null || val === undefined) return 'sin datos';
  let str = String(val).trim();
  if (str === '') return 'sin datos';
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function saveLeadsToCsv(leads, filename) {
  const headers = [
    'nombre', 'categoria', 'rating', 'resenas', 'telefono',
    'website', 'direccion', 'fotos', 'descripcion', 'horarios',
    'ultima_resena', 'responde_resenas', 'publicaciones', 'mapsUrl'
  ];
  const rows = [headers.join(',')];

  for (const lead of leads) {
    rows.push(headers.map((header) => escapeCsvValue(lead[header])).join(','));
  }

  fs.writeFileSync(filename, '\ufeff' + rows.join('\n'), 'utf-8');
  console.log(`\nResultados guardados en "${filename}"`);
}

async function main() {
  const nicho = getArg('nicho');
  const zona = getArg('zona');
  const limite = Number.parseInt(getArg('limite', '40'), 10) || 40;
  const salida = getArg('salida') || `leads_${slugify(nicho)}_${slugify(zona)}.csv`;

  if (!nicho || !zona) {
    console.error('Uso: npm run prospectar -- --nicho "dentistas" --zona "Satelite Naucalpan" --limite 30');
    process.exit(1);
  }

  const query = `${nicho} en ${zona}`;
  const isHeadless = process.env.HEADLESS !== 'false';

  console.log('=== PROSPECTOR ON GENERAL ===');
  console.log(`Busqueda: "${query}"`);
  console.log(`Limite: ${limite}`);
  console.log(`Salida: ${salida}`);
  console.log(`Headless: ${isHeadless ? 'Si' : 'No'}`);

  const browser = await chromium.launch({
    headless: isHeadless,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    const leadUrls = await scrollFeed(page, limite);

    if (leadUrls.length === 0) {
      console.log('No se encontraron negocios.');
      return;
    }

    const leads = [];
    for (let i = 0; i < leadUrls.length; i++) {
      console.log(`\n[${i + 1}/${leadUrls.length}] Procesando negocio`);
      const details = await extractBusinessDetails(page, leadUrls[i]);
      if (details.nombre !== 'sin datos') leads.push(details);
      await page.waitForTimeout(1500);
    }

    saveLeadsToCsv(leads, salida);
  } catch (error) {
    console.error('Error critico:', error);
  } finally {
    await browser.close();
    console.log('Proceso terminado.');
  }
}

main();
