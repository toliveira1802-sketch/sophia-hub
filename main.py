from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
import requests
import os

# Puxando as senhas do cofre do Render
KOMMO_TOKEN = os.getenv("KOMMO_TOKEN", "")
KOMMO_URL = os.getenv("KOMMO_URL", "")

class DadosKommo(BaseModel):
    nome_cliente: str = Field(description="Nome do cliente")
    marca_veiculo: str = Field(description="Marca do carro")
    modelo_veiculo: str = Field(description="Modelo do carro")
    ano_veiculo: str = Field(description="Ano do veículo, se informado")
    sintoma_ou_servico: str = Field(description="Resumo do problema")
    temperatura_lead: str = Field(description="'Frio', 'Morno', 'Quente' ou 'Fervendo'")

class AgentState(TypedDict):
    mensagens: list
    nome_cliente: str
    temperatura_lead: str
    dados_extraidos: dict

llm = ChatAnthropic(model="claude-3-5-sonnet-20240620", temperature=0.7)
llm_com_ferramentas = llm.bind_tools([DadosKommo])

PROMPT_ANNA = """Você é a Anna, a assistente de pré-vendas e relacionamento da Doctor Auto Prime.
NUNCA passe preço para diagnóstico. Seja 100% humana e descontraída.
Colete Marca, Modelo e Ano do carro. Fique atenta para sugerir descarbonização em motores TSI próximos aos 60 mil km."""

def no_anna(state: AgentState):
    mensagens_atuais = state.get("mensagens", [])
    mensagens_para_llm = [SystemMessage(content=PROMPT_ANNA)] + mensagens_atuais
    resposta = llm_com_ferramentas.invoke(mensagens_para_llm)
    
    if resposta.tool_calls:
        dados = resposta.tool_calls[0]['args']
        return {
            "mensagens": mensagens_atuais + [resposta],
            "nome_cliente": dados.get("nome_cliente", ""),
            "temperatura_lead": dados.get("temperatura_lead", "Frio"),
            "dados_extraidos": dados
        }
    return {"mensagens": mensagens_atuais + [resposta]}

grafo = StateGraph(AgentState)
grafo.add_node("Anna_SDR", no_anna)
grafo.add_edge(START, "Anna_SDR")
grafo.add_edge("Anna_SDR", END)
hub_app = grafo.compile()

app = FastAPI(title="Hub IA - Doctor Auto Prime")

# --- A FUNÇÃO NOVA QUE FALA COM O KOMMO ---
def enviar_mensagem_whatsapp(chat_id: str, texto: str):
    if not KOMMO_TOKEN or not KOMMO_URL:
        print("⚠️ Faltam as chaves do Kommo no Render!")
        return
        
    url = f"{KOMMO_URL}/api/v4/messages"
    headers = {
        "Authorization": f"Bearer {KOMMO_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = {
        "chat_id": chat_id,
        "text": texto
    }
    # Dispara o tiro de volta pro WhatsApp
    resposta = requests.post(url, json=payload, headers=headers)
    print("📡 Status do envio pro WhatsApp:", resposta.status_code)

@app.get("/")
async def pagina_inicial():
    return {"status": "online", "mensagem": "Anna operando 100%!"}

@app.post("/webhook/kommo")
async def receber_mensagem(request: Request):
    form_data = await request.form()
    dados_brutos = dict(form_data)
    
    # Pescando a mensagem e o ID do chat (Crucial para saber pra quem responder)
    mensagem_cliente = dados_brutos.get("message[add][0][text]", "Oi")
    chat_id = dados_brutos.get("message[add][0][chat_id]", "") 
    
    mensagem_usuario = HumanMessage(content=str(mensagem_cliente))
    estado_inicial = {
        "mensagens": [mensagem_usuario],
        "nome_cliente": "Cliente",
        "temperatura_lead": "Frio",
        "dados_extraidos": {}
    }
    
    resultado = hub_app.invoke(estado_inicial)
    resposta_anna = resultado["mensagens"][-1].content
    
    print("🧠 RESPOSTA DA ANNA:", resposta_anna)
    
    # SE O CHAT ID EXISTIR, ATIRA A MENSAGEM DE VOLTA!
    if chat_id:
        enviar_mensagem_whatsapp(chat_id, resposta_anna)
    else:
        print("⚠️ ID do chat não encontrado. Não foi possível responder.")

@app.get("/listar-campos")
async def listar_campos():
    if not KOMMO_TOKEN or not KOMMO_URL:
        return {"erro": "Faltam as chaves do Kommo no Render!"}
        
    url = f"{KOMMO_URL}/api/v4/leads/custom_fields"
    headers = {
        "Authorization": f"Bearer {KOMMO_TOKEN}"
    }
    
    # O nosso próprio servidor faz a busca
    resposta = requests.get(url, headers=headers)
    
    if resposta.status_code == 200:
        dados = resposta.json()
        campos = dados.get('_embedded', {}).get('custom_fields', [])
        
        # Monta um dicionário limpo só com Nome e ID
        lista_limpa = {campo['name']: campo['id'] for campo in campos}
        return lista_limpa
    else:
        return {"erro": resposta.status_code, "detalhe": resposta.text}
    
    return {"status": "sucesso"}

# --- FUNÇÃO PARA INJETAR DADOS NO CRM ---
def atualizar_lead_kommo(lead_id: str, dados_extraidos: dict):
    if not KOMMO_TOKEN or not KOMMO_URL:
        print("⚠️ Faltam as chaves do Kommo para atualizar o lead!")
        return
        
    url = f"{KOMMO_URL}/api/v4/leads/{lead_id}"
    headers = {
        "Authorization": f"Bearer {KOMMO_TOKEN}",
        "Content-Type": "application/json"
    }
    
    campos_para_atualizar = []
    
    # 1. Injetando a MARCA (ID 966005)
    if "marca_veiculo" in dados_extraidos and dados_extraidos["marca_veiculo"]:
        campos_para_atualizar.append({
            "field_id": 966005,
            "values": [{"value": dados_extraidos["marca_veiculo"]}]
        })
        
    # 2. Injetando o MODELO (ID 966007)
    if "modelo_veiculo" in dados_extraidos and dados_extraidos["modelo_veiculo"]:
        campos_para_atualizar.append({
            "field_id": 966007,
            "values": [{"value": dados_extraidos["modelo_veiculo"]}]
        })

    # 3. Injetando o NOME CLIENTE (ID 966001)
    if "nome_cliente" in dados_extraidos and dados_extraidos["nome_cliente"]:
        campos_para_atualizar.append({
            "field_id": 966001,
            "values": [{"value": dados_extraidos["nome_cliente"]}]
        })

    # Só dispara se tiver algum campo para atualizar
    if not campos_para_atualizar:
        return

    payload = {
        "custom_fields_values": campos_para_atualizar
    }
    
    # Atira os dados pro CRM!
    resposta = requests.patch(url, json=payload, headers=headers)
    print("🎯 Status da injeção de dados no Lead:", resposta.status_code)