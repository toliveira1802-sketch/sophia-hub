from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
import requests
import os

# Puxando as chaves do cofre do Render
KOMMO_TOKEN = os.getenv("KOMMO_TOKEN", "")
KOMMO_URL = os.getenv("KOMMO_URL", "")

# 1. Molde de Extração (Agora com a PLACA incluída!)
class DadosKommo(BaseModel):
    nome_cliente: str = Field(description="Nome do cliente")
    placa_veiculo: str = Field(description="Placa do carro, se o cliente informar")
    marca_veiculo: str = Field(description="Marca do carro (ex: VW, Audi, BMW)")
    modelo_veiculo: str = Field(description="Modelo do carro (ex: Jetta, Up, 320i)")
    ano_veiculo: str = Field(description="Ano do veículo, se informado")
    sintoma_ou_servico: str = Field(description="Resumo do problema")
    temperatura_lead: str = Field(description="'Frio', 'Morno', 'Quente' ou 'Fervendo'")

# 2. Definição do Estado do LangGraph
class AgentState(TypedDict):
    mensagens: list
    nome_cliente: str
    temperatura_lead: str
    dados_extraidos: dict

# 3. Configuração da IA
llm = ChatAnthropic(model="claude-3-5-sonnet-20240620", temperature=0.7)
llm_com_ferramentas = llm.bind_tools([DadosKommo])

# Prompt Mestre
PROMPT_ANNA = """Você é a Anna, a assistente de pré-vendas e relacionamento da Doctor Auto Prime.
NUNCA passe preço para diagnóstico. Seja 100% humana e descontraída.
Colete Nome, Placa, Marca, Modelo e Ano do carro. Fique atenta para sugerir descarbonização em motores TSI próximos aos 60 mil km."""

# 4. O Nó da Anna
def no_anna(state: AgentState):
    mensagens_atuais = state.get("mensagens", [])
    mensagens_para_llm = [SystemMessage(content=PROMPT_ANNA)] + mensagens_atuais
    resposta = llm_com_ferramentas.invoke(mensagens_para_llm)
    
    # Se a Anna usou a ferramenta de extração
    if hasattr(resposta, 'tool_calls') and resposta.tool_calls:
        dados = resposta.tool_calls[0]['args']
        print("🚨 DADOS EXTRAÍDOS:", dados)
        return {
            "mensagens": mensagens_atuais + [resposta],
            "nome_cliente": dados.get("nome_cliente", ""),
            "temperatura_lead": dados.get("temperatura_lead", "Frio"),
            "dados_extraidos": dados
        }
    
    return {"mensagens": mensagens_atuais + [resposta]}

# 5. Montando o Grafo
grafo = StateGraph(AgentState)
grafo.add_node("Anna_SDR", no_anna)
grafo.add_edge(START, "Anna_SDR")
grafo.add_edge("Anna_SDR", END)
hub_app = grafo.compile()

# 6. Criando a API (FastAPI)
app = FastAPI(title="Hub IA - Doctor Auto Prime")

# --- FUNÇÃO QUE FALA NO WHATSAPP ---
def enviar_mensagem_whatsapp(chat_id: str, texto: str):
    if not KOMMO_TOKEN or not KOMMO_URL:
        return
        
    url = f"{KOMMO_URL}/api/v4/messages"
    headers = {"Authorization": f"Bearer {KOMMO_TOKEN}", "Content-Type": "application/json"}
    payload = {"chat_id": chat_id, "text": texto}
    
    resposta = requests.post(url, json=payload, headers=headers)
    print("📡 Status Envio WhatsApp:", resposta.status_code)

# --- FUNÇÃO QUE INJETA NO CRM (COM SEUS IDs!) ---
def atualizar_lead_kommo(lead_id: str, dados_extraidos: dict):
    if not KOMMO_TOKEN or not KOMMO_URL:
        return
        
    url = f"{KOMMO_URL}/api/v4/leads/{lead_id}"
    headers = {"Authorization": f"Bearer {KOMMO_TOKEN}", "Content-Type": "application/json"}
    
    campos_para_atualizar = []
    
    # Injetando MARCA (ID 966005)
    if dados_extraidos.get("marca_veiculo"):
        campos_para_atualizar.append({"field_id": 966005, "values": [{"value": dados_extraidos["marca_veiculo"]}]})
        
    # Injetando MODELO (ID 966007)
    if dados_extraidos.get("modelo_veiculo"):
        campos_para_atualizar.append({"field_id": 966007, "values": [{"value": dados_extraidos["modelo_veiculo"]}]})

    # Injetando NOME CLIENTE (ID 966001)
    if dados_extraidos.get("nome_cliente"):
        campos_para_atualizar.append({"field_id": 966001, "values": [{"value": dados_extraidos["nome_cliente"]}]})

    # Injetando PLACA (ID 966003)
    if dados_extraidos.get("placa_veiculo"):
        campos_para_atualizar.append({"field_id": 966003, "values": [{"value": dados_extraidos["placa_veiculo"]}]})

    if not campos_para_atualizar:
        return

    payload = {"custom_fields_values": campos_para_atualizar}
    resposta = requests.patch(url, json=payload, headers=headers)
    print("🎯 Status Injeção CRM:", resposta.status_code)

@app.get("/")
async def pagina_inicial():
    return {"status": "online", "mensagem": "Anna operando 100%!"}

@app.post("/webhook/kommo")
async def receber_mensagem(request: Request):
    try:
        dados_brutos = await request.json()
    except:
        form_data = await request.form()
        dados_brutos = dict(form_data)
    
    # Pescando os 3 pilares: Mensagem, ID do Chat e ID do Lead
    mensagem_cliente = dados_brutos.get("message[add][0][text]", "Oi")
    chat_id = dados_brutos.get("message[add][0][chat_id]", "") 
    lead_id = dados_brutos.get("message[add][0][lead_id]", "")
    
    mensagem_usuario = HumanMessage(content=str(mensagem_cliente))
    estado_inicial = {
        "mensagens": [mensagem_usuario],
        "nome_cliente": "Cliente",
        "temperatura_lead": "Frio",
        "dados_extraidos": {}
    }
    
    # A Anna pensa e responde
    resultado = hub_app.invoke(estado_inicial)
    resposta_anna = resultado["mensagens"][-1].content
    
    # 1. Manda a resposta pro WhatsApp
    if chat_id:
        enviar_mensagem_whatsapp(chat_id, resposta_anna)
        
    # 2. Se ela extraiu os dados, injeta no painel do Kommo!
    if lead_id and resultado.get("dados_extraidos"):
        atualizar_lead_kommo(lead_id, resultado["dados_extraidos"])
    
    return {"status": "sucesso"}