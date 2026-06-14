import os
import pandas as pd

def exportacion_doble_segura(df_nuevos, archivo_maestro, archivo_ataque):
    # Asegurar orden de columnas
    columnas_ordenadas = ['nombre', 'prioridad', 'fuga_detectada', 'whatsapp_link', 'rating', 'resenas']
    cols_existentes = [c for c in columnas_ordenadas if c in df_nuevos.columns]
    df_nuevos = df_nuevos[cols_existentes]

    # 1. Maestro (Historial)
    if os.path.exists(archivo_maestro):
        df_antiguo = pd.read_csv(archivo_maestro)
        df_combinado = pd.concat([df_antiguo, df_nuevos], ignore_index=True)
    else:
        df_combinado = df_nuevos

    # Limpieza
    if 'telefono' in df_combinado.columns:
        df_combinado = df_combinado.drop_duplicates(subset=['telefono'], keep='first')
    df_combinado.to_csv(archivo_maestro, index=False)

    # 2. Parrilla de Ataque (Lista para el Lunes)
    # IMPORTANTE: Abrir este archivo en Google Sheets para que los links funcionen
    df_solo_ataque = df_nuevos[df_nuevos['whatsapp_link'].str.contains('http', na=False)]
    df_solo_ataque.to_csv(archivo_ataque, index=False)
    print(f"Parrilla lista: {archivo_ataque}. ¡Ábrela en Google Sheets para los clics!")