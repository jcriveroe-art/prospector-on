const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const leadsDir = path.join(__dirname, "PROSPECTOS LISTOS PARA CONTACTAR", "leads");
const finalFile = "leads_dental_maestro_importar_seguro.csv";

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function readCsv(filename) {
  const ruta = path.join(leadsDir, filename);
  const contenido = fs.readFileSync(ruta, "utf8").replace(/^\uFEFF/, "");
  const lineas = contenido.split(/\r?\n/).filter(Boolean);
  if (lineas.length === 0) return { headers: [], rows: [] };

  const headers = parseCSVLine(lineas[0]).map((h) => h.trim());
  const rows = lineas.slice(1).map((linea) => {
    const valores = parseCSVLine(linea);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = valores[i] || "";
    });
    return row;
  });

  return { headers, rows };
}

function runStep(script) {
  console.log(`\n=== Ejecutando ${script} ===`);
  const result = spawnSync(process.execPath, [script], {
    cwd: leadsDir,
    stdio: "inherit",
    shell: false
  });

  if (result.error) {
    console.error(`Error ejecutando ${script}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`${script} termino con codigo ${result.status}`);
    process.exit(result.status || 1);
  }
}

function printFinalSummary() {
  const rutaFinal = path.join(leadsDir, finalFile);
  if (!fs.existsSync(rutaFinal)) {
    console.error(`No se genero el archivo final: ${rutaFinal}`);
    process.exit(1);
  }

  const { rows } = readCsv(finalFile);
  const estados = new Map();

  for (const row of rows) {
    const estado = row.estado_contacto || "sin_estado";
    estados.set(estado, (estados.get(estado) || 0) + 1);
  }

  console.log("\n=== RESUMEN FINAL CRM ===");
  console.log(`Total maestro: ${rows.length}`);
  console.log("Agrupacion por estado_contacto:");
  for (const [estado, total] of [...estados.entries()].sort()) {
    console.log(`  ${estado}: ${total}`);
  }
  console.log(`Archivo final listo para importar: ${path.join(leadsDir, finalFile)}`);
}

function main() {
  if (!fs.existsSync(leadsDir)) {
    console.error(`No existe la carpeta de leads: ${leadsDir}`);
    process.exit(1);
  }

  process.chdir(leadsDir);

  runStep("juntar_contacto_manual.cjs");
  runStep("agregar_zona_fuente.cjs");
  runStep("marcar_contactados_whatsapp.cjs");
  printFinalSummary();
}

main();
