import pandas as pd
import requests
import urllib.parse
import sys
import json
import re
from playwright.sync_api import sync_playwright
from exportador import exportacion_doble_segura
from exportador import exportacion_doble_segura
from exportador import exportacion_doble_segura
from exportador import exportacion_doble_segura

def extraer_prospectos_ugc(nicho, limite_marcas=50):
    """
    Simulación del motor de Prospector-On para capturar marcas en Instagram
    Nichos ideales para Lia y Mike: 'skincare_mexico', 'suplementos_gym', 'moda_hombre'
    """
    # En producción, aquí conectarías tu herramienta de scraping (Scrapling/Antigravity) 
    # apuntando a las búsquedas de Instagram o Meta Ads Library API
    
    print(f"Prospector-On buscando marcas en el nicho: {nicho}...")
    
    # Estructura de datos que tu scraper debe llenar por cada marca encontrada
    datos_marcas = [
        {
            "marca": "Glow Skin MX",
            "instagram": "https://instagram.com/glowskin_mx",
            "website": "https://glowskin.com.mx",
            "telefono": "+525512345678",
            "corre_ads": "Sí",
            "tipo_anuncio": "Imagen fija / Carrusel", # <-- ¡Aquí está el dolor!
            "avatar_ideal": "Lia Mendez"
        },
        {
            "marca": "Alpha Alpha Supplements",
            "instagram": "https://instagram.com/alpha_supps",
            "website": "https://alphasupps.mx",
            "telefono": "+525598765432",
            "corre_ads": "Sí",
            "tipo_anuncio": "Video institucional pesado",
            "avatar_ideal": "Mike"
        },
        {
            "marca": "Boutique Cuatro",
            "instagram": "https://instagram.com/b4_moda",
            "website": "sin datos",
            "telefono": "Sin datos",
            "corre_ads": "No",
            "tipo_anuncio": "Ninguno",
            "avatar_ideal": "Lia Mendez"
        }
    ]
    
    return pd.DataFrame(datos_marcas)

def simular_busqueda_meta_ads(palabra_clave, limite=30):
    """
    MODO AUDITORÍA: Levanta el navegador VISIBLE, acepta cookies y ejecuta 
    un scroll dinámico para forzar la carga del GraphQL de Meta.
    """
    # ad_type debe ser omitido o usar el parámetro correcto de la interfaz visual
    # La captura confirmó que Meta estaba cargando el filtro "Temas sociales/electorales"
    # La URL correcta para anuncios COMERCIALES no usa ad_type=ALL sino que deja el tipo vacío
    url_interfaz = f"https://www.facebook.com/ads/library/?active_status=ACTIVE&ad_type=ALL&country=MX&q={palabra_clave}&search_type=keyword_unordered&media_type=all"
    
    try:
        print(f"Abriendo navegador visible para auditoría del nicho: '{palabra_clave}'...")
        
        with sync_playwright() as p:
            # headless=False para ver físicamente qué está haciendo el script en tu Windows
            browser = p.chromium.launch(headless=False)
            context = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            pagina = context.new_page()
            
            # Ir a la URL
            pagina.goto(url_interfaz)
            print("Esperando carga inicial del DOM...")
            pagina.wait_for_timeout(4000)
            
            # PASO DE BLINDAJE 1: Intentar evadir o aceptar el banner de cookies si aparece
            try:
                # Buscamos botones comunes de Meta para aceptar cookies
                boton_cookies = pagina.locator('button:has-text("Permitir"), button:has-text("Aceptar"), button:has-text("Allow")')
                if boton_cookies.count() > 0:
                    boton_cookies.first.click()
                    print("Banner de cookies detectado y aprobado automáticamente.")
                    pagina.wait_for_timeout(2000)
            except Exception:
                pass

            # PASO DE BLINDAJE 2: Scroll automático (Lazy Loading)
            print("Ejecutando scroll dinámico por el feed de anuncios...")
            for _ in range(3):
                pagina.evaluate("window.scrollTo(0, document.body.scrollHeight);")
                pagina.wait_for_timeout(2000)
                
            # Extraer el texto global renderizado tras el comportamiento humano
            texto_global = pagina.content()
            
            # Evidencia de control: Guardamos una captura para que revises la carpeta si vuelve a fallar
            pagina.screenshot(path="evidencia_meta_ads.png")
            print("Captura de pantalla guardada como 'evidencia_meta_ads.png'.")
            
            browser.close()
            
        # Expresión regular sobre el bloque total
        nombres_marcas = re.findall(r'"pageName":"([^"]+)"', texto_global)
        
        if not nombres_marcas:
            print("El feed visual cargó pero no se encontraron variables de 'pageName' en el código.")
            return pd.DataFrame()
            
        datos_estandarizados = []
        nombres_vistos = set()
        
        for marca_real in nombres_marcas:
            if marca_real in nombres_vistos:
                continue
            nombres_vistos.add(marca_real)
            
            marca_limpia = marca_real.lower().replace(' ', '').replace('"', '').strip()
            
            if not marca_limpia or "anuncios" in marca_limpia:
                continue
                
            datos_estandarizados.append({
                "marca": marca_real,
                "instagram": f"https://instagram.com/{marca_limpia}",
                "website": f"https://{marca_limpia}.com.mx",
                "telefono": "Sin Datos",
                "corre_ads": "Sí",
                "tipo_anuncio": "Video institucional pesado" if "video" in texto_global.lower() else "Imagen fija / Carrusel",
                "avatar_ideal": "Mike" if any(x in marca_limpia for x in ["gym", "supps", "alpha", "proteina"]) else "Lia Mendez"
            })
            
            if len(datos_estandarizados) >= limite:
                break
            
        df_resultado = pd.DataFrame(datos_estandarizados)
        print(f"Extracción completada. {len(df_resultado)} marcas reales listas para procesar.")
        return df_resultado
        
    except Exception as e:
        print(f"Error en el modo auditoría: {e}")
        return pd.DataFrame()

def validar_y_limpiar_marcas(df_crudo):
    """
    Contrato de datos estricto para el motor UGC.
    Fuerza los tipos de datos correctos y evita errores de ejecución por nulos (NaN).
    """
    import numpy as np
    # 1. Definir columnas obligatorias que el clasificador necesita
    columnas_requeridas = ['marca', 'instagram', 'website', 'telefono', 'corre_ads', 'tipo_anuncio', 'avatar_ideal']
    
    # Si el DataFrame viene vacío, regresar un cascarón limpio con las columnas correctas
    if df_crudo.empty or len(df_crudo) == 0:
        return pd.DataFrame(columns=columnas_requeridas)
        
    # Asegurar que existan todas las columnas, si falta alguna la crea vacía
    for col in columnas_requeridas:
        if col not in df_crudo.columns:
            df_crudo[col] = "sin datos"
            
    # 2. Copiar solo lo que nos sirve para no arrastrar basura del scraper
    df_limpio = df_crudo[columnas_requeridas].copy()
    
    # 3. Limpieza de strings y manejo de nulos (Evita los temidos AttributeError / Float has no len)
    for col in ['marca', 'instagram', 'website', 'corre_ads', 'tipo_anuncio', 'avatar_ideal']:
        df_limpio[col] = df_limpio[col].fillna("sin datos").astype(str).str.strip()
        
    # 4. Homologar las respuestas de los Ads para que el clasificador no falle por sutiles diferencias
    df_limpio['corre_ads'] = df_limpio['corre_ads'].replace({'si': 'Sí', 'SI': 'Sí', 'yes': 'Sí', 'no': 'No', 'NO': 'No'})
    
    # 5. Estandarizar asignación de avatar por defecto en caso de que el scraper no lo determine
    df_limpio['avatar_ideal'] = df_limpio['avatar_ideal'].replace({'sin datos': 'Lia Mendez', '': 'Lia Mendez'})
    
    # 6. Limpieza estricta de teléfonos
    df_limpio['telefono'] = df_limpio['telefono'].fillna("Sin datos").astype(str).str.strip()
    
    return df_limpio

def clasificar_y_armar_enlaces_ugc(df_marcas, archivo_maestro="maestro_marcas_ugc.csv", archivo_ataque="parrilla_ugc_hoy.csv"):
    """
    Procesa las marcas encontradas, evalúa su dolor con Ads, asigna el avatar 
    (Lia o Mike) y genera el link de WhatsApp listo para dar un solo clic.
    """
    
    def evaluar_prioridad_ugc(row):
        # PRIORIDAD 1: Gastan dinero en Ads pero no usan formato orgánico/UGC. 
        # Tienen dinero y les urge tu servicio. El cierre es más fácil.
        if str(row['corre_ads']).strip() == 'Sí' and row['tipo_anuncio'] in ['Imagen fija / Carrusel', 'Video institucional pesado']:
            return 1
        # PRIORIDAD 2: Tienen sitio web pero no hacen Ads (Necesitan a Lia o Mike para empezar de cero)
        elif str(row['website']).lower().strip() != 'sin datos' and str(row['corre_ads']).strip() == 'No':
            return 2
        else:
            return 3

    def generar_link_prospeccion(row):
        tel = str(row['telefono']).replace(' ', '').replace('-', '').replace('+', '')
        if tel.lower() in ['sin datos', 'nan', 'none'] or not tel:
            return 'Solo contacto por Instagram DM'
            
        marca = row['marca']
        avatar = row['avatar_ideal']
        
        # Pitch dinámico dependiendo del dolor detectado por el script
        if row['prioridad_num'] == 1:
            mensaje = (
                f"Hola, buenas tardes. Vi la tienda en línea de {marca}. "
                f"Noté que están corriendo campañas de anuncios con imágenes fijas o formatos tradicionales. En e-commerce, ese formato te está costando el doble de presupuesto. "
                f"Tengo una agencia donde creamos videos orgánicos (UGC) con nuestros presentadores virtuales de IA, {avatar}. "
                f"Te reducen el costo por clic a la mitad y los entregamos en 48 horas. ¿Te puedo mandar un video muestra de cómo se vería tu producto con {avatar} sin costo?"
            )
        else:
            mensaje = (
                f"Hola. Vi el perfil de {marca}. Tienen excelentes productos pero les falta contenido en video formato TikTok para escalar su alcance orgánico. "
                f"Creamos contenido UGC con avatares de IA de alta conversión. ¿Te interesa ver una demostración rápida de {avatar} adaptada a tu marca?"
            )
            
        mensaje_codificado = urllib.parse.quote(mensaje)
        return f"https://wa.me/{tel}?text={mensaje_codificado}"

    # 1. Ejecutar la clasificación numérica interna
    df_marcas['prioridad_num'] = df_marcas.apply(evaluar_prioridad_ugc, axis=1)
    
    # 2. Mapear la etiqueta visual para que la leas cómodo en el CSV
    mapeo_prioridades = {
        1: "1. CRÍTICA (Fuga en anuncios)",
        2: "2. ALTA (E-commerce estático)",
        3: "3. Baja"
    }
    df_marcas['prioridad_ugc'] = df_marcas['prioridad_num'].map(mapeo_prioridades)
    
    # 3. Generar los enlaces de un solo clic usando el número asignado
    df_marcas['whatsapp_link'] = df_marcas.apply(generar_link_prospeccion, axis=1)
    
    # 4. Ordenar dejando los cierres más urgentes arriba
    df_final = df_marcas.sort_values(by='prioridad_num', ascending=True)
    df_final = df_final.drop(columns=['prioridad_num']) # Limpiar columna auxiliar
    
    # 5. EXPORTACIÓN DOBLE SEGURA
    exportacion_doble_segura(df_final, archivo_maestro, archivo_ataque)
    return df_final

if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Prospector UGC Meta Ads")
    parser.add_argument("--nicho", type=str, default="skincare_mexico", help="Nicho o palabra clave a buscar")
    parser.add_argument("--limite", type=int, default=20, help="Límite de resultados")
    args = parser.parse_args()
    
    df_crudo = simular_busqueda_meta_ads(args.nicho, args.limite)
    df_limpio = validar_y_limpiar_marcas(df_crudo)
    parrilla_lista = clasificar_y_armar_enlaces_ugc(df_limpio)
