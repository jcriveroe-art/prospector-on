import pandas as pd
import urllib.parse
import sys
from exportador import exportacion_doble_segura

def optimizar_y_generar_enlaces_wa(archivo_entrada, archivo_salida):
    # 1. Cargar el archivo crudo del scraper
    df = pd.read_csv(archivo_entrada)
    
    # 2. Limpieza básica de datos para asegurar el correcto análisis lógico
    df['rating'] = pd.to_numeric(df['rating'], errors='coerce')
    df['resenas'] = pd.to_numeric(df['resenas'], errors='coerce')
    
    # 3. Función interna para construir el mensaje personalizado y codificar la URL
    def crear_link_whatsapp(row):
        # Limpiar el teléfono eliminando espacios, guiones y símbolos
        tel = str(row['telefono']).replace(' ', '').replace('-', '').replace('+', '')
        
        # Validar si el teléfono es útil
        if not tel or tel.lower() in ['sin datos', 'sindatos', 'nan', 'none']:
            return 'Sin teléfono disponible'
            
        rating = row['rating']
        resenas = int(row['resenas']) if not pd.isna(row['resenas']) else 0
        nombre = row['nombre']
        website = str(row['website']).lower().strip()
        
        # Descartar negocios sin flujo mínimo (Menos de 15 reseñas)
        if pd.isna(rating) or resenas < 15:
            return 'Prioridad Baja (Poco volumen)'
            
        # CASO 1: Alerta por reputación herida (Rating menor o igual a 4.3)
        if rating <= 4.3:
            mensaje = (
                f"Hola, buenas tardes. Vi tu ubicación en Maps de {nombre}. "
                f"Noté que tienen un flujo alto con más de {resenas} opiniones, pero su calificación bajó a {rating}. "
                f"En zonas competitivas como Satélite esto desvía a muchos clientes premium hacia la competencia. "
                f"Te grabé un Diagnóstico Express de 2 minutos en video para mostrarte cómo solucionarlo gratis. ¿Te lo comparto por aquí?"
            )
            
        # CASO 2: Fuga de clientes (Buen rating pero sin web o amarrados a Facebook)
        elif website == 'sin datos' or 'facebook.com' in website:
            mensaje = (
                f"Hola, buenas tardes. Vi tu ubicación de {nombre} en Maps. "
                f"Tienen una excelente calificación de {rating}, pero noté que no cuentan con un enlace directo de agenda o sitio web en su perfil. "
                f"Hoy en día la gente prefiere reservar en 3 clics o se va con el que sí lo facilita. "
                f"Te preparé un análisis express sin costo de tu perfil para mostrarte dónde se está yendo el dinero. ¿Te lo mando?"
            )
        else:
            return 'Prioridad Media (Ya cuenta con Web propia)'
            
        # Codificar el texto plano a formato URL seguro
        mensaje_codificado = urllib.parse.quote(mensaje)
        return f"https://wa.me/{tel}?text={mensaje_codificado}"

    # 4. Determinar el número de prioridad para el ordenamiento final
    def asignar_prioridad_numerica(row):
        if pd.isna(row['rating']) or pd.isna(row['resenas']) or row['resenas'] < 15:
            return 4  # Baja
        if row['rating'] <= 4.3:
            return 1  # Alerta Roja (Reputación)
        if str(row['website']).lower().strip() == 'sin datos' or 'facebook.com' in str(row['website']).lower():
            return 2  # Alerta Alta (Fuga Digital)
        return 3      # Media

    # 4b. Asignar diagnóstico legible por humano
    def asignar_diagnostico(row):
        if pd.isna(row['rating']) or pd.isna(row['resenas']) or row['resenas'] < 15:
            return 'Sin volumen suficiente'
        if row['rating'] <= 4.3:
            return f"Reputacion herida: {row['rating']} estrellas con {int(row['resenas'])} resenas"
        website = str(row['website']).lower().strip()
        if website == 'sin datos' or 'facebook.com' in website:
            return f"Sin sitio web propio - Solo Facebook o sin enlace ({row['rating']} estrellas)"
        return f"Presencia digital completa ({row['rating']} estrellas)"

    # 4c. Asignar etiqueta de prioridad legible
    def asignar_etiqueta_prioridad(row):
        if pd.isna(row['rating']) or pd.isna(row['resenas']) or row['resenas'] < 15:
            return '4. BAJA - Sin volumen'
        if row['rating'] <= 4.3:
            return '1. ALTA - Reputacion Herida'
        website = str(row['website']).lower().strip()
        if website == 'sin datos' or 'facebook.com' in website:
            return '2. ALTA - Fuga Digital'
        return '3. MEDIA - Presencia Completa'

    # Aplicar las funciones creadas al DataFrame
    df['whatsapp_link'] = df.apply(crear_link_whatsapp, axis=1)
    df['prioridad_orden'] = df.apply(asignar_prioridad_numerica, axis=1)
    df['prioridad'] = df.apply(asignar_etiqueta_prioridad, axis=1)
    df['diagnostico'] = df.apply(asignar_diagnostico, axis=1)

    # 5. ORDENAR EL ARCHIVO COMPLETO
    # Primero las prioridades urgentes (1 y 2), y dentro de ellas, por volumen de reseñas descendentemente
    df_final = df.sort_values(by=['prioridad_orden', 'resenas'], ascending=[True, False])
    
    # Eliminar solo la columna auxiliar numérica de ordenamiento
    df_final = df_final.drop(columns=['prioridad_orden'])

    # Reordenar columnas para que prioridad y diagnostico aparezcan primero
    cols = ['nombre', 'prioridad', 'diagnostico', 'rating', 'resenas', 'telefono', 'website', 'direccion', 'mapsUrl', 'whatsapp_link']
    cols_existentes = [c for c in cols if c in df_final.columns]
    df_final = df_final[cols_existentes]
    
    # 6. Exportación segura y blindada
    exportacion_doble_segura(df_final, 'maestro_barberias_satelite.csv', 'parrilla_ataque_hoy.csv')

if __name__ == "__main__":
    if len(sys.argv) == 3:
        optimizar_y_generar_enlaces_wa(sys.argv[1], sys.argv[2])
    else:
        optimizar_y_generar_enlaces_wa('leads_barberias_satelite_naucalpan.csv', 'leads_finales_antigravity.csv')
