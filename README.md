# Prospector ON

Sistema Node.js con Playwright para prospectar negocios locales en Google Maps y preparar CSVs de contacto manual para vender Tarjeta ON.

Tarjeta ON no es una página web completa. Es un link sencillo para negocios locales con WhatsApp, ubicación, horarios, servicios, fotos, redes, QR y botones de contacto.

## Objetivo comercial

Vender 100 Tarjetas ON en 30 días.

## Requisitos

- Node.js 18 o superior
- NPM
- Playwright con Chromium instalado

Instalación inicial:

```bash
npm install
npx playwright install chromium
```

Configuración opcional en `.env`:

```env
HEADLESS=false
OPENAI_API_KEY=tu_clave_si_usas_los_scripts_antiguos_con_openai
```

## Flujo general recomendado

Buscar prospectos:

```bash
npm run prospectar -- --nicho "barberías" --zona "Satélite Naucalpan" --limite 30
```

Eso genera un CSV como:

```text
leads_barberias_satelite_naucalpan.csv
```

Exportar para contacto manual:

```bash
npm run export-contacto -- --archivo "leads_barberias_satelite_naucalpan.csv"
```

Eso genera:

```text
leads_barberias_satelite_naucalpan_contacto_manual.csv
```

El CSV final incluye nombre, categoría, rating, reseñas, teléfono, dirección, Google Maps URL, prioridad, score, clasificación, mensaje personalizado, link wa.me y notas.

## Ejemplos

Barberías:

```bash
npm run prospectar -- --nicho "barberías" --zona "Satélite Naucalpan" --limite 30
npm run export-contacto -- --archivo "leads_barberias_satelite_naucalpan.csv"
```

Estéticas, uñas, pestañas y cejas:

```bash
npm run prospectar -- --nicho "estéticas uñas pestañas cejas" --zona "Naucalpan" --limite 40
npm run export-contacto -- --archivo "leads_esteticas_unas_pestanas_cejas_naucalpan.csv"
```

Veterinarias:

```bash
npm run prospectar -- --nicho "veterinarias" --zona "Naucalpan" --limite 30
npm run export-contacto -- --archivo "leads_veterinarias_naucalpan.csv"
```

Restaurantes/comida:

```bash
npm run prospectar -- --nicho "restaurantes comida" --zona "Naucalpan" --limite 30
npm run export-contacto -- --archivo "leads_restaurantes_comida_naucalpan.csv"
```

Talleres/autos:

```bash
npm run prospectar -- --nicho "talleres mecánicos autos" --zona "Naucalpan" --limite 30
npm run export-contacto -- --archivo "leads_talleres_mecanicos_autos_naucalpan.csv"
```

## Scripts existentes

Se conservan los scripts originales:

- `npm start`
- `npm run barberias`
- `npm run podologia`
- `npm run export-chatgpt`
- `npm run export-whatsapp`
- `npm run export-contacto-barberias`
- `npm run export-contacto-podologia`

Los scripts nuevos son:

- `npm run prospectar`
- `npm run export-contacto`

## Reglas de operación

- No se envían mensajes automáticamente.
- Solo se prepara el CSV, el mensaje y el link wa.me.
- Los CSV se guardan con BOM UTF-8 para abrir bien en Excel.
- Si un dato no aparece en Google Maps, se guarda como `sin datos`.

## Playbook visual

- Nunca afirmar numero exacto de fotos salvo verificacion manual.
- Tratar fotos como dato estimado, no como evidencia confirmada.
- En diagnostico final, marcar fotos como `requiere validacion visual`.
