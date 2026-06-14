import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

function cleanValue(val) {
  if (!val || val.trim() === '' || val.trim().toLowerCase() === 'null' || val.trim().toLowerCase() === 'undefined') {
    return 'sin datos';
  }
  return val.trim();
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

async function scrollFeed(page, maxResults = 50) {
  console.log('\n🔄 Desplazando resultados en Google Maps...');
  const feedSelector = 'div[role="feed"]';
  try {
    await page.waitForSelector(feedSelector, { timeout: 15000 });
  } catch (e) {
    console.warn('⚠️ Nota: No se detectó el contenedor role="feed". Intentando extraer enlaces visibles.');
  }
  let previousCount = 0;
  let noChangeCount = 0;
  while (true) {
    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
      return anchors.map(a => a.href);
    });
    const uniqueLinks = [...new Set(links)];
    console.log(`   👉 Enlaces encontrados: ${uniqueLinks.length} / ${maxResults}`);
    if (uniqueLinks.length >= maxResults) {
      console.log(`   ✅ Objetivo alcanzado: ${uniqueLinks.length} prospectos.`);
      return uniqueLinks.slice(0, maxResults);
    }
    if (uniqueLinks.length === previousCount) {
      noChangeCount++;
      if (noChangeCount >= 5) {
        console.log('   🏁 No hay más resultados disponibles.');
        return uniqueLinks;
      }
    } else {
      noChangeCount = 0;
      previousCount = uniqueLinks.length;
    }
    await page.evaluate((sel) => {
      const feed = document.querySelector(sel);
      if (feed) {
        feed.scrollBy(0, 1000);
      } else {
        window.scrollBy(0, 1000);
      }
    }, feedSelector);
    await page.waitForTimeout(1500);
  }
}

async function extractBusinessDetails(page, url) {
  console.log(`\n🔍 Extrayendo datos de: ${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('h1', { timeout: 15000 });
    await page.waitForTimeout(1000);
    const nombre = await safeGetText(page, 'h1');
    let categoria = 'sin datos';
    const catSelectors = [
      'button[jsaction*="pane.rating.category"]',
      'button[jsaction*="category"]',
      'button[class*="fontBodyMedium"]'
    ];
    for (const sel of catSelectors) {
      const txt = await safeGetText(page, sel);
      if (txt && txt !== 'sin datos' && !isNaN(Number(txt)) === false && !txt.toLowerCase().includes('reseña')) {
        categoria = txt;
        break;
      }
    }
    let rating = 'sin datos';
    let reseñas = 'sin datos';
    try {
      const ratingEl = page.locator('div.F7nice').first();
      if (await ratingEl.isVisible()) {
        const text = await ratingEl.textContent();
        if (text) {
          if (text.includes('(')) {
            const parts = text.split('(');
            rating = parts[0].trim();
            reseñas = parts[1].replace(')', '').trim();
          } else {
            const match = text.match(/^([0-5](?:\.[0-9])?)(.*)$/);
            if (match) {
              rating = match[1];
              reseñas = match[2].trim() || 'sin datos';
            }
          }
        }
      }
      if (rating === 'sin datos') {
        const starEl = page.locator('span[role="img"][aria-label*="estrellas"], span[role="img"][aria-label*="stars"]').first();
        if (await starEl.isVisible()) {
          const label = await starEl.getAttribute('aria-label');
          if (label) {
            const m = label.match(/([0-5](?:[.,][0-9])?)/);
            if (m) rating = m[1];
          }
        }
      }
    } catch (e) {}
    let direccion = 'sin datos';
    try {
      const addrEl = page.locator('button[data-item-id="address"]').first();
      if (await addrEl.isVisible()) {
        direccion = (await addrEl.textContent() || '').trim();
      } else {
        const addrAria = page.locator('button[aria-label*="Dirección"], button[aria-label*="Address"]').first();
        if (await addrAria.isVisible()) {
          direccion = (await addrAria.textContent() || '').trim();
        }
      }
    } catch (e) {}
    direccion = direccion.replace(/[\uE000-\uF8FF]/g, '').trim();
    let telefono = 'sin datos';
    try {
      const phoneEl = page.locator('button[data-item-id^="phone:"]').first();
      if (await phoneEl.isVisible()) {
        const raw = await phoneEl.getAttribute('data-item-id');
        if (raw) telefono = raw.replace('phone:tel:', '').trim();
      } else {
        const phoneAria = page.locator('button[aria-label*="Teléfono"], button[aria-label*="Phone"]').first();
        if (await phoneAria.isVisible()) {
          telefono = (await phoneAria.textContent() || '').trim();
        }
      }
    } catch (e) {}
    let website = 'sin datos';
    try {
      const webEl = page.locator('a[data-item-id="authority"]').first();
      if (await webEl.isVisible()) {
        website = (await webEl.getAttribute('href') || '').trim();
      } else {
        const webAria = page.locator('a[aria-label*="Sitio web"], a[aria-label*="Website"]').first();
        if (await webAria.isVisible()) {
          website = (await webAria.getAttribute('href') || '').trim();
        }
      }
    } catch (e) {}
    const result = {
      nombre: cleanValue(nombre),
      categoria: cleanValue(categoria),
      rating: cleanValue(rating),
      reseñas: cleanValue(reseñas),
      telefono: cleanValue(telefono),
      website: cleanValue(website),
      direccion: cleanValue(direccion),
      mapsUrl: url
    };
    console.log(`   🏷️ Nombre: ${result.nombre}`);
    console.log(`   📂 Categoría: ${result.categoria}`);
    console.log(`   ⭐️ Rating: ${result.rating} (${result.reseñas} reseñas)`);
    console.log(`   📞 Teléfono: ${result.telefono}`);
    console.log(`   🌐 Website: ${result.website}`);
    return result;
  } catch (error) {
    console.error(`❌ Error al extraer ${url}`, error);
    return {
      nombre: 'sin datos',
      categoria: 'sin datos',
      rating: 'sin datos',
      reseñas: 'sin datos',
      telefono: 'sin datos',
      website: 'sin datos',
      direccion: 'sin datos',
      mapsUrl: url
    };
  }
}

function escapeCsvValue(val) {
  if (val === null || val === undefined) return 'sin datos';
  let str = String(val).trim();
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    str = '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function saveLeadsToCsv(leads, filename = 'leads_podologia_satelite_naucalpan.csv') {
  const headers = ['nombre', 'categoria', 'rating', 'reseñas', 'telefono', 'website', 'direccion', 'mapsUrl'];
  const rows = [headers.join(',')];
  for (const lead of leads) {
    const row = [
      escapeCsvValue(lead.nombre),
      escapeCsvValue(lead.categoria),
      escapeCsvValue(lead.rating),
      escapeCsvValue(lead.reseñas),
      escapeCsvValue(lead.telefono),
      escapeCsvValue(lead.website),
      escapeCsvValue(lead.direccion),
      escapeCsvValue(lead.mapsUrl)
    ];
    rows.push(row.join(','));
  }
  fs.writeFileSync(filename, '\ufeff' + rows.join('\n'), 'utf-8');
  console.log(`\n💾 Resultados guardados en "${filename}"`);
}

async function main() {
  const query = 'podología en Satélite Naucalpan';
  const maxLeads = 50;
  const isHeadless = process.env.HEADLESS !== 'false';
  console.log('🚀 === PROSPECTOR-ON PODOLOGÍA INICIADO ===');
  console.log(`📍 Búsqueda: "${query}"`);
  console.log(`📊 Límite: ${maxLeads}`);
  console.log(`🖥️ Headless: ${isHeadless ? 'Sí' : 'No'}`);
  const browser = await chromium.launch({ headless: isHeadless, args: ['--disable-blink-features=AutomationControlled'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' });
  const page = await context.newPage();
  try {
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    console.log(`🌐 Navegando a ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
    const leadUrls = await scrollFeed(page, maxLeads);
    if (leadUrls.length === 0) {
      console.log('❌ No se encontraron negocios.');
      await browser.close();
      return;
    }
    console.log(`\n📋 Procesando ${leadUrls.length} negocios...`);
    const finalLeads = [];
    for (let i = 0; i < leadUrls.length; i++) {
      console.log(`\n-----------------------------------------`);
      console.log(`💼 [${i + 1}/${leadUrls.length}] Procesando`);
      const details = await extractBusinessDetails(page, leadUrls[i]);
      if (details.nombre && details.nombre !== 'sin datos') {
        finalLeads.push(details);
      } else {
        console.log('⚠️ Omitido por falta de datos básicos.');
      }
      await page.waitForTimeout(1000);
    }
    saveLeadsToCsv(finalLeads);
  } catch (error) {
    console.error('❌ Error crítico:', error);
  } finally {
    console.log('\n🔒 Cerrando navegador...');
    await browser.close();
    console.log('🏁 === PROCESO TERMINADO ===');
  }
}

main();
