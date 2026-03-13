import requests

# Puxando as senhas do cofre do Render
KOMMO_TOKEN = os.getenv("KOMMO_TOKEN", "")
KOMMO_URL = os.getenv("KOMMO_URL", "")

def escanear_campos():
    print("📡 Escaneando o Kommo da Doctor Auto Prime...\n")
    
    url = f"{KOMMO_URL}/api/v4/leads/custom_fields"
    headers = {
        "Authorization": f"Bearer {KOMMO_TOKEN}",
        "Content-Type": "application/json"
    }
    
    resposta = requests.get(url, headers=headers)
    
    if resposta.status_code == 200:
        dados = resposta.json()
        campos = dados.get("_embedded", {}).get("custom_fields", [])
        
        print("🎯 CAMPOS ENCONTRADOS NO FUNIL:")
        print("-" * 40)
        for campo in campos:
            id_campo = campo.get("id")
            nome_campo = campo.get("name")
            print(f"ID: {id_campo}  |  Nome: {nome_campo}")
        print("-" * 40)
    else:
        print(f"⚠️ Erro ao conectar: Status {resposta.status_code}")
        print(resposta.text)

if __name__ == "__main__":
    escanear_campos()