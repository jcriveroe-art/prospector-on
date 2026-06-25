import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TEMPLATE_NAME = 'diagnostico_on_inicial';
const LANGUAGE_CODE = 'es_MX';

// Archivo de progreso para poder reanudar
const PROGRESO_PATH = path.join(process.cwd(), 'agente-denue', 'output', '_progreso_lote_50.json');
const REPORTE_PATH = path.join(process.cwd(), 'agente-denue', 'output', 'reporte_lote_50.json');

// Delay entre mensajes para no quemar el número (1.5 minutos = 90000 ms)
const DELAY_MS = 90000;

function formatPhone(phone) {
  if (!phone) return '';
  let d = phone.replace(/[^0-9]/g, '');
  if (!d) return '';
  if (d.startsWith('521') && d.length === 13) {
    d = '52' + d.slice(3);
  } else if (d.length === 10) {
    d = '52' + d;
  }
  return d;
}

function sanitizar(texto) {
  if (!texto) return '';
  return String(texto)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/["']/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 60);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function enviarTemplate(telefono, nombreNegocio) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'template',
        template: {
          name: TEMPLATE_NAME,
          language: { code: LANGUAGE_CODE },
          components: [
            {
              type: 'body',
              parameters: [
                {
                  type: 'text',
                  parameter_name: 'nombre_negocio',
                  text: sanitizar(nombreNegocio)
                }
              ]
            }
          ]
        }
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return { ok: true, data: response.data };
  } catch (err) {
    const metaError = err.response?.data?.error || {};
    return {
      ok: false,
      code: metaError.code,
      message: metaError.message || err.message
    };
  }
}

function normalizeName(name) {
  if (!name) return '';
  return name.toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

async function main() {
  console.log('=== VALIDAR WHATSAPP Y CARGAR LEADS (EN GOOGLE MAPS) ===\n');

  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Faltan variables de entorno. Revisa .env');
    process.exit(1);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Leer lote_50_seleccionado.json
  const jsonPath = path.join(process.cwd(), 'agente-denue', 'output', 'lote_50_seleccionado.json');
  if (!fs.existsSync(jsonPath)) {
    console.error('❌ No se encontró lote_50_seleccionado.json');
    process.exit(1);
  }

  const businesses = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  console.log(`📋 Total en lote_50_seleccionado.json: ${businesses.length}`);

  // Cargar progreso previo
  let progreso = { ultimoIdx: -1, validos: 0, invalidos: 0, omitidos: 0, insertados: 0 };
  if (fs.existsSync(PROGRESO_PATH)) {
    progreso = JSON.parse(fs.readFileSync(PROGRESO_PATH, 'utf8'));
    if (Array.isArray(progreso.validos)) progreso.validos = progreso.validos.length;
    if (Array.isArray(progreso.invalidos)) progreso.invalidos = progreso.invalidos.length;
    console.log(`▶️  Reanudando desde índice ${progreso.ultimoIdx + 1}`);
  }

  // Límite de envíos para esta corrida
  const LIMIT = parseInt(process.argv[2] || process.env.LIMIT || '20', 10);
  console.log(`🎯 Límite de envíos exitosos para esta corrida: ${LIMIT}`);

  // 1. Teléfonos ya en CRM
  const { data: existentes } = await supabase.from('cola_envios').select('telefono');
  const telExistentes = new Set((existentes || []).map(r => r.telefono));
  console.log(`📞 Ya en CRM (Teléfonos): ${telExistentes.size}`);

  // 2. Negocios ya en CRM para evitar duplicar marcas
  const { data: convExistentes } = await supabase.from('conversaciones').select('negocio, nombre');
  const nombresExistentes = new Set();
  (convExistentes || []).forEach(c => {
    if (c.negocio) nombresExistentes.add(normalizeName(c.negocio));
    if (c.nombre) nombresExistentes.add(normalizeName(c.nombre));
  });
  console.log(`🏢 Ya en CRM (Negocios únicos): ${nombresExistentes.size}\n`);

  let validos = progreso.validos || 0;
  let invalidos = progreso.invalidos || 0;
  let omitidos = progreso.omitidos || 0;
  let insertados = progreso.insertados || 0;
  let enviadosEnEstaCorrida = 0;
  
  const nombresEnEstaCorrida = new Set();

  for (let i = progreso.ultimoIdx + 1; i < businesses.length; i++) {
    const biz = businesses[i];
    
    // El filtro por municipio ya se aplicó en la selección del lote.
    // No omitimos por municipio aquí.

    const telefono = formatPhone(biz.telefono);

    if (!telefono || telefono.length < 12) {
      omitidos++;
      fs.writeFileSync(PROGRESO_PATH, JSON.stringify({
        ultimoIdx: i,
        validos,
        invalidos,
        omitidos,
        insertados
      }, null, 2));
      continue;
    }

    const nombreFormateado = biz.mapsnombre || biz.nombre;
    const nombreNormalizado = normalizeName(nombreFormateado);

    // Evitar duplicar por teléfono O por nombre de negocio
    if (telExistentes.has(telefono) || nombresExistentes.has(nombreNormalizado) || nombresEnEstaCorrida.has(nombreNormalizado)) {
      omitidos++;
      fs.writeFileSync(PROGRESO_PATH, JSON.stringify({
        ultimoIdx: i,
        validos,
        invalidos,
        omitidos,
        insertados
      }, null, 2));
      continue;
    }

    process.stdout.write(`[${i+1}/${businesses.length}] ${nombreFormateado} (${telefono})... `);

    const resultado = await enviarTemplate(telefono, nombreFormateado);

    if (resultado.ok) {
      validos++;
      enviadosEnEstaCorrida++;
      nombresEnEstaCorrida.add(nombreNormalizado);
      console.log(`✅ entregado (${enviadosEnEstaCorrida}/${LIMIT})`);

      // 1. Insertar o actualizar registro completo en 'conversaciones'
      const { error: convError } = await supabase.from('conversaciones').upsert({
        telefono,
        nombre: nombreFormateado || null,
        negocio: nombreFormateado || null,
        categoria: biz.giro || biz.subcategoria || null,
        zona: biz.municipio || biz.colonia || null,
        estado: 'contactado',
        estado_contacto: 'enviado', // CORREGIDO: se inicia en 'enviado', el webhook lo actualizará a 'Entregado' al confirmarse
        bot_enabled: true,
        fuente_busqueda: 'denue_enmaps',
        mensaje_inicial_enviado: true,
        mensaje_inicial_enviado_at: new Date().toISOString(),
        direccion: biz.mapsdireccion || biz.direccion || null,
        maps_url: biz.mapsUrl || biz.maps_url || null,
      }, { onConflict: 'telefono' });

      if (convError) {
        console.error(`  ⚠️ Error Supabase (conversaciones): ${convError.message}`);
      }

      // 2. Registrar el mensaje saliente en el historial
      const cuerpoMensaje = `Hola, soy Juan Carlos de Presencia Digital. Estaba revisando perfiles de Google Maps en la zona y me encontré con el de ${sanitizar(nombreFormateado)}. Me llamaron la atención un par de oportunidades que podrían ayudarles a conseguir más clientes. ¿Te las puedo compartir?`;
      const { error: msgError } = await supabase.from('mensajes').insert({
        telefono,
        direccion: 'saliente',
        mensaje: cuerpoMensaje,
        raw: resultado.data || null
      });

      if (msgError) {
        console.error(`  ⚠️ Error al registrar mensaje saliente: ${msgError.message}`);
      }

      // 3. Insertar en cola_envios para seguimiento de lotes
      const payloadCola = {
        telefono,
        nombre: nombreFormateado || null,
        estado: 'enviado',
        intentos: 0,
        prioridad: 5,
        origen: 'denue_noenmaps',
      };
      let { error } = await supabase.from('cola_envios').insert(payloadCola);
      if (error && error.message.includes('column "nombre" of relation "cola_envios" does not exist')) {
        console.log("⚠️ La columna 'nombre' no existe en 'cola_envios'. Reintentando inserción sin 'nombre'...");
        delete payloadCola.nombre;
        const { error: retryError } = await supabase.from('cola_envios').insert(payloadCola);
        error = retryError;
      }

      if (error) {
        console.error(`  ⚠️ Error Supabase (cola_envios): ${error.message}`);
      } else {
        insertados++;
        telExistentes.add(telefono);
      }
    } else {
      invalidos++;
      // Código 131047 = número no existe en WhatsApp
      // Código 131026 = mensaje no entregable
      console.log(`❌ fallo (${resultado.code}: ${resultado.message})`);
    }

    // Guardar progreso en cada iteración para máxima seguridad
    fs.writeFileSync(PROGRESO_PATH, JSON.stringify({
      ultimoIdx: i,
      validos,
      invalidos,
      omitidos,
      insertados
    }, null, 2));

    if (enviadosEnEstaCorrida >= LIMIT) {
      console.log(`\n🛑 Deteniendo: Se alcanzó el límite de ${LIMIT} envíos exitosos para esta corrida.`);
      break;
    }

    await sleep(DELAY_MS);
  }

  // Reporte final
  const reporte = {
    timestamp: new Date().toISOString(),
    total: businesses.length,
    validos,
    invalidos,
    omitidos,
    insertados,
    tasaEntrega: `${((validos / (validos + invalidos)) * 100).toFixed(1)}%`
  };

  fs.writeFileSync(REPORTE_PATH, JSON.stringify(reporte, null, 2));

  console.log('\n==================================================');
  console.log('✅ VALIDACIÓN COMPLETADA');
  console.log('==================================================');
  console.log(`Total procesados:     ${businesses.length}`);
  console.log(`Con WhatsApp activo:  ${validos}`);
  console.log(`Sin WhatsApp:         ${invalidos}`);
  console.log(`Omitidos (ya en CRM): ${omitidos}`);
  console.log(`Insertados en CRM:    ${insertados}`);
  console.log(`Tasa de entrega:      ${reporte.tasaEntrega}`);
  console.log('==================================================\n');
}

main().catch(err => {
  console.error('❌ Error crítico:', err);
  process.exit(1);
});

