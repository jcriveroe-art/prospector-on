import pandas as pd
from prospector_ugc import validar_y_limpiar_marcas
from exportador import exportacion_doble_segura

def probar_resistencia_motores():
    print("INICIANDO PRUEBA DE ESTRÉS EN PROSPECTOR-ON...\n")
    
    # =====================================================================
    # TEST 1: Datos corruptos para el Motor UGC (Lia y Mike)
    # =====================================================================
    print("Simulando datos basura de Instagram...")
    datos_basura_ugc = [
        {
            "marca": "  Skinglow Mal Formado  ", # Espacios extras
            "instagram": "https://instagram.com/skinglow",
            "website": None, # Valor Nulo que suele romper Python
            "telefono": "55-1234-5678", # Guiones sin código de país
            "corre_ads": "si", # En minúsculas
            "tipo_anuncio": "Imagen fija / Carrusel",
            "avatar_ideal": "" # Vacío
        },
        {
            "marca": "Suplementos Extremos",
            "instagram": "https://instagram.com/extreme_supps",
            "website": "https://extreme.mx",
            "telefono": "nan", # String nulo de scraper
            "corre_ads": "NO", # En mayúsculas
            "tipo_anuncio": "Ninguno",
            "avatar_ideal": "Mike"
        }
    ]
    
    df_crudo_ugc = pd.DataFrame(datos_basura_ugc)
    
    try:
        # Forzar el paso por tu validador
        df_limpio_ugc = validar_y_limpiar_marcas(df_crudo_ugc)
        print("Validador UGC: Soportó los valores Nulos (None/nan) y homologó los textos.")
        
        # Simular guardado
        exportacion_doble_segura(df_limpio_ugc, "test_maestro_ugc.csv", "test_parrilla_ugc.csv")
        print("Exportador UGC: Archivos de prueba generados sin duplicar.")
        
    except Exception as e:
        print(f"EL MOTOR UGC TRONÓ: {e}")

    print("\n" + "="*50 + "\n")

    # =====================================================================
    # TEST 2: Simulación de ejecución doble para el Motor Local (Barberías)
    # =====================================================================
    print("Simulando doble ejecución del archivo de Satélite...")
    try:
        # Cargamos tu archivo real si existe para estresarlo duplicando sus datos
        df_local = pd.read_csv('leads_barberias_satelite_naucalpan.csv')
        
        # Duplicamos la base de datos a propósito para simular que corriste el comando dos veces
        df_duplicado_local = pd.concat([df_local, df_local], ignore_index=True)
        print(f"Registros inyectados artificialmente: {len(df_duplicado_local)}")
        
        # Mandamos al exportador seguro para ver si aplica la purga
        exportacion_doble_segura(df_duplicado_local, "test_maestro_local.csv", "test_parrilla_local.csv")
        
        # Verificar reducción
        df_verificar = pd.read_csv("test_maestro_local.csv")
        print(f"Registros finales tras la purga del exportador: {len(df_verificar)}")
        
        if len(df_verificar) <= len(df_local):
            print("CONTROL DE DUPLICADOS EXITOSO: El sistema ignoró la segunda corrida por completo.")
        else:
            print("Advertencia: Pasaron duplicados al archivo maestro.")
            
    except FileNotFoundError:
        print("No se encontró 'leads_barberias_satelite_naucalpan.csv' en la raíz para la prueba local.")
    except Exception as e:
        print(f"EL MOTOR LOCAL TRONÓ: {e}")

if __name__ == "__main__":
    probar_resistencia_motores()
