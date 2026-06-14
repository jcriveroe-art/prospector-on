import pandas as pd
import sys

def procesar_y_clasificar_leads(archivo_entrada, archivo_salida):
    df = pd.read_csv(archivo_entrada)
    
    df['rating'] = pd.to_numeric(df['rating'], errors='coerce')
    df['resenas'] = pd.to_numeric(df['resenas'], errors='coerce')
    
    def evaluar_y_preparar(row):
        rating = row['rating']
        resenas = row['resenas']
        website = str(row['website']).lower().strip()
        
        if pd.isna(rating) or pd.isna(resenas) or resenas < 15:
            prioridad = '4. Baja'
            fuga = 'Volumen insuficiente'
        elif rating <= 4.3:
            prioridad = '1. ALTA (Reputación)'
            fuga = 'Reputación herida, necesitan gestión'
        elif website == 'sin datos' or 'facebook.com' in website:
            prioridad = '2. ALTA (Fuga Web)'
            fuga = 'Sin sitio web, tráfico perdido'
        else:
            prioridad = '3. Media'
            fuga = 'Estable, buscar mejora'
        return prioridad, fuga

    df[['prioridad', 'fuga_detectada']] = df.apply(lambda row: pd.Series(evaluar_y_preparar(row)), axis=1)
    
    # Preparar link de WhatsApp
    mensaje = "Hola, vi su negocio en Maps y detecté detalles que están haciendo que pierdan clientes. Hago diagnósticos rápidos, ¿le interesa recibir el suyo?"
    msg_encoded = mensaje.replace(' ', '%20')
    df['whatsapp_link'] = df['telefono'].apply(lambda tel: f"https://wa.me/{tel}?text={msg_encoded}")
    
    df_ordenado = df.sort_values(by=['prioridad', 'resenas'], ascending=[True, False])
    columnas_finales = ['nombre', 'prioridad', 'fuga_detectada', 'whatsapp_link', 'rating', 'resenas']
    df_ordenado[columnas_finales].to_csv(archivo_salida, index=False)
    print(f"Procesado: {archivo_salida}")

if __name__ == "__main__":
    if len(sys.argv) == 3:
        procesar_y_clasificar_leads(sys.argv[1], sys.argv[2])
    else:
        procesar_y_clasificar_leads('leads_barberias_satelite_naucalpan.csv', 'leads_listos_para_atacar.csv')
