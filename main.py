import gradio as gr
import json
import os
import requests
from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage

# Puxando as chaves do cofre do Render
KOMMO_TOKEN = os.getenv("KOMMO_TOKEN", "")
KOMMO_URL = os.getenv("KOMMO_URL", "")

# 1. Molde de Extração
class DadosKommo(BaseModel):
    nome_cliente: str = Field(description="Nome do cliente")
    placa_veiculo: str = Field(description="Placa do carro, se o cliente informar")
    marca_veiculo: str = Field(description="Marca do carro (ex: VW, Audi, BMW)")
    modelo_veiculo: str = Field(description="Modelo do carro (ex: Jetta, Up, 320i)")
    ano_veiculo: str = Field(description="Ano do veículo, se informado")
    sintoma_ou_servico: str = Field(description="Resumo do problema")
    temperatura_lead: str = Field(description="'Frio', 'Morno', 'Quente' ou 'Fervendo'")

# 2. Definição do Estado
class AgentState(TypedDict):
    mensagens: list
    nome_cliente: str
    temperatura_lead: str
    dados_extraidos: dict

# 3. Configuração da IA
llm = ChatAnthropic(model="claude-3-haiku-20240307", temperature=0.7)
llm_com_ferramentas = llm.bind_tools([DadosKommo])

# O NOVO CÉREBRO DA ANNA
PROMPT_ANNA = """Você é a Anna, a primeira voz da Doctor Auto Prime. Nossa visão é ser a maior referência em excelência automotiva da região.
Você está falando no WhatsApp. Seja extremamente natural, ágil e humana. NUNCA pareça um robô.

SEU OBJETIVO: Descobrir Nome, Marca, Modelo, Ano, Placa e Sintoma/Desejo do cliente.

REGRAS DE OURO:
1. NUNCA diga "vamos coletar suas informações" ou "preciso de dados". Faça perguntas de forma fluida e uma por vez, misturadas na conversa. (Ex: "Nossa, um Golf Stage 3 é uma máquina! Por curiosidade, qual a placa e o ano dele pra eu já puxar o histórico aqui?")
2. GATILHO TSI 60 MIL KM: Se o cliente falar de um motor TSI (como o Golf) com quilometragem próxima a 60.000 km, seja consultiva. Elogie o carro e sugira sutilmente que essa é a quilometragem ideal para agendar uma descarbonização preventiva das válvulas, explicando rapidamente que isso recupera o fôlego e melhora o consumo.
3. NUNCA passe preços. Seu papel é encantar e preparar o terreno para o diagnóstico técnico.
4. Mande mensagens curtas, como se estivesse digitando no celular.
"""

def no_anna(state: AgentState):
    mensagens_atuais = state.get("mensagens", [])
    mensagens_para_llm = [SystemMessage(content=PROMPT_ANNA)] + mensagens_atuais
    resposta = llm_com_ferramentas.invoke(mensagens_para_llm)
    
    if hasattr(resposta, 'tool_calls') and resposta.tool_calls:
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

# --- O FILTRO BLINDADO DE TEXTO ---
def extrair_texto_da_ia(resposta_ia):
    if isinstance(resposta_ia.content, list):
        textos = [b["text"] for b in resposta_ia.content if isinstance(b, dict) and "text" in b]
        texto_final = " ".join(textos)
        return texto_final if texto_final.strip() else "Perfeito, entendi os detalhes do carro!"
    return str(resposta_ia.content) if resposta_ia.content else "Detalhes anotados!"

def enviar_mensagem_whatsapp(chat_id: str, texto: str):
    if not KOMMO_TOKEN or not KOMMO_URL:
        return
    url = f"{KOMMO_URL}/api/v4/messages"
    headers = {"Authorization": f"Bearer {KOMMO_TOKEN}", "Content-Type": "application/json"}
    payload = {"chat_id": chat_id, "text": texto}
    requests.post(url, json=payload, headers=headers)

def atualizar_lead_kommo(lead_id: str, dados_extraidos: dict):
    if not KOMMO_TOKEN or not KOMMO_URL:
        return
    url = f"{KOMMO_URL}/api/v4/leads/{lead_id}"
    headers = {"Authorization": f"Bearer {KOMMO_TOKEN}", "Content-Type": "application/json"}
    campos = []
    
    if dados_extraidos.get("marca_veiculo"):
        campos.append({"field_id": 966005, "values": [{"value": dados_extraidos["marca_veiculo"]}]})
    if dados_extraidos.get("modelo_veiculo"):
        campos.append({"field_id": 966007, "values": [{"value": dados_extraidos["modelo_veiculo"]}]})
    if dados_extraidos.get("nome_cliente"):
        campos.append({"field_id": 966001, "values": [{"value": dados_extraidos["nome_cliente"]}]})
    if dados_extraidos.get("placa_veiculo"):
        campos.append({"field_id": 966003, "values": [{"value": dados_extraidos["placa_veiculo"]}]})

    if campos:
        requests.patch(url, json={"custom_fields_values": campos}, headers=headers)

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
    
    mensagem_cliente = dados_brutos.get("message[add][0][text]", "Oi")
    chat_id = dados_brutos.get("message[add][0][chat_id]", "") 
    lead_id = dados_brutos.get("message[add][0][lead_id]", "")
    
    estado_inicial = {
        "mensagens": [HumanMessage(content=str(mensagem_cliente))],
        "nome_cliente": "Cliente",
        "temperatura_lead": "Frio",
        "dados_extraidos": {}
    }
    
    resultado = hub_app.invoke(estado_inicial)
    resposta_anna = extrair_texto_da_ia(resultado["mensagens"][-1])
    
    if chat_id:
        enviar_mensagem_whatsapp(chat_id, resposta_anna)
    if lead_id and resultado.get("dados_extraidos"):
        atualizar_lead_kommo(lead_id, resultado["dados_extraidos"])
    
    return {"status": "sucesso"}

# A NOVA MEMÓRIA DA ANNA NO HUB
def interagir_no_hub(mensagem_usuario, historico):
    mensagens_memoria = []
    for msg in historico:
        if msg["role"] == "user":
            mensagens_memoria.append(HumanMessage(content=msg["content"]))
        else:
            mensagens_memoria.append(AIMessage(content=msg["content"]))
            
    mensagens_memoria.append(HumanMessage(content=mensagem_usuario))

    estado_teste = {
        "mensagens": mensagens_memoria,
        "nome_cliente": "Usuario Teste",
        "temperatura_lead": "Frio",
        "dados_extraidos": {}
    }
    
    resultado = hub_app.invoke(estado_teste)
    resposta_anna = extrair_texto_da_ia(resultado["mensagens"][-1])
    
    dados = resultado.get("dados_extraidos", {})
    if dados:
        painel_raiox = json.dumps(dados, indent=2, ensure_ascii=False)
    else:
        painel_raiox = "Nenhum dado de veículo extraído nesta mensagem."
        
    historico.append({"role": "user", "content": mensagem_usuario})
    historico.append({"role": "assistant", "content": resposta_anna})
    
    return "", historico, painel_raiox

with gr.Blocks(theme=gr.themes.Monochrome(), title="Hub Doctor Auto Prime") as tela_do_hub:
    gr.Markdown("# 🚘 Centro de Comando IA - Doctor Auto Prime")
    with gr.Row():
        with gr.Column(scale=2):
            gr.Markdown("### 👩‍🔧 Anna - Setor: Pré-Vendas & Triagem")
            chat_interface = gr.Chatbot(height=450, type="messages", avatar_images=(None, "https://cdn-icons-png.flaticon.com/512/4712/4712035.png"))
            caixa_texto = gr.Textbox(label="Sua mensagem para a Anna", placeholder="Ex: Tenho um Golf TSI...")
            botao_enviar = gr.Button("Enviar", variant="primary")
            
        with gr.Column(scale=1):
            gr.Markdown("### 🩻 Raio-X (Dados para o Kommo)")
            tela_raiox = gr.Code(label="JSON Extraído", language="json", interactive=False)
    
    caixa_texto.submit(interagir_no_hub, inputs=[caixa_texto, chat_interface], outputs=[caixa_texto, chat_interface, tela_raiox])
    botao_enviar.click(interagir_no_hub, inputs=[caixa_texto, chat_interface], outputs=[caixa_texto, chat_interface, tela_raiox])

app = gr.mount_gradio_app(app, tela_do_hub, path="/hub")