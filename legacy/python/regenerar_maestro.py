import pandas as pd
import urllib.parse

df = pd.read_csv('leads_barberias_satelite_naucalpan.csv')
df['rating'] = pd.to_numeric(df['rating'], errors='coerce')
df['resenas'] = pd.to_numeric(df['resenas'], errors='coerce')

def crear_link_whatsapp(row):
    tel = str(row['telefono']).replace(' ', '').replace('-', '').replace('+', '')
    if not tel or tel.lower() in ['sin datos', 'sindatos', 'nan', 'none']:
        return 'Sin telefono disponible'
    rating = row['rating']
    resenas = int(row['resenas']) if not pd.isna(row['resenas']) else 0
    nombre = row['nombre']
    website = str(row['website']).lower().strip()
    if pd.isna(rating) or resenas < 15:
        return 'Prioridad Baja (Poco volumen)'
    if rating <= 4.3:
        mensaje = (
            f"Hola, buenas tardes. Vi tu ubicacion en Maps de {nombre}. "
            f"Note que tienen un flujo alto con mas de {resenas} opiniones, pero su calificacion bajo a {rating}. "
            f"En zonas competitivas como Satelite esto desvia a muchos clientes premium hacia la competencia. "
            f"Te grabe un Diagnostico Express de 2 minutos en video para mostrarte como solucionarlo gratis. "
            f"Te lo comparto por aqui?"
        )
    elif website == 'sin datos' or 'facebook.com' in website:
        mensaje = (
            f"Hola, buenas tardes. Vi tu ubicacion de {nombre} en Maps. "
            f"Tienen una excelente calificacion de {rating}, pero note que no cuentan con un enlace directo de agenda o sitio web en su perfil. "
            f"Hoy en dia la gente prefiere reservar en 3 clics o se va con el que si lo facilita. "
            f"Te prepare un analisis express sin costo de tu perfil para mostrarte donde se esta yendo el dinero. Te lo mando?"
        )
    else:
        return 'Prioridad Media (Ya cuenta con Web propia)'
    return f"https://wa.me/{tel}?text={urllib.parse.quote(mensaje)}"

def asignar_prioridad_numerica(row):
    if pd.isna(row['rating']) or pd.isna(row['resenas']) or row['resenas'] < 15:
        return 4
    if row['rating'] <= 4.3:
        return 1
    if str(row['website']).lower().strip() == 'sin datos' or 'facebook.com' in str(row['website']).lower():
        return 2
    return 3

def asignar_etiqueta_prioridad(row):
    if pd.isna(row['rating']) or pd.isna(row['resenas']) or row['resenas'] < 15:
        return '4. BAJA - Sin volumen'
    if row['rating'] <= 4.3:
        return '1. ALTA - Reputacion Herida'
    if str(row['website']).lower().strip() == 'sin datos' or 'facebook.com' in str(row['website']).lower():
        return '2. ALTA - Fuga Digital'
    return '3. MEDIA - Presencia Completa'

def asignar_diagnostico(row):
    if pd.isna(row['rating']) or pd.isna(row['resenas']) or row['resenas'] < 15:
        return 'Sin volumen suficiente'
    if row['rating'] <= 4.3:
        return f"Reputacion herida: {row['rating']} estrellas con {int(row['resenas'])} resenas"
    website = str(row['website']).lower().strip()
    if website == 'sin datos' or 'facebook.com' in website:
        return f"Sin sitio web propio - Solo Facebook o sin enlace ({row['rating']} estrellas)"
    return f"Presencia digital completa ({row['rating']} estrellas)"

df['whatsapp_link'] = df.apply(crear_link_whatsapp, axis=1)
df['prioridad_orden'] = df.apply(asignar_prioridad_numerica, axis=1)
df['prioridad'] = df.apply(asignar_etiqueta_prioridad, axis=1)
df['diagnostico'] = df.apply(asignar_diagnostico, axis=1)

df_final = df.sort_values(by=['prioridad_orden', 'resenas'], ascending=[True, False])
df_final = df_final.drop(columns=['prioridad_orden'])

cols = ['nombre', 'prioridad', 'diagnostico', 'rating', 'resenas', 'telefono', 'website', 'direccion', 'mapsUrl', 'whatsapp_link']
cols_existentes = [c for c in cols if c in df_final.columns]
df_final = df_final[cols_existentes]

# Sobreescribir limpio (no merge con historial anterior que no tenía estas columnas)
df_final.to_csv('maestro_barberias_satelite.csv', index=False)

df_ataque = df_final[df_final['whatsapp_link'].str.startswith('https://wa.me', na=False)]
df_ataque.to_csv('parrilla_ataque_hoy.csv', index=False)

print(f"Maestro regenerado: {len(df_final)} registros")
print(f"Parrilla de ataque: {len(df_ataque)} leads listos")
print()
print(df_final[['nombre', 'prioridad', 'diagnostico']].head(10).to_string())
