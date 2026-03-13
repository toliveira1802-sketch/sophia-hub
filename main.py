from fastapi import FastAPI, Request
from pydantic import BaseModel, Field
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool

# 1. Molde de Extração (A Tool da Anna)
class DadosKommo(BaseModel):
    """Use APENAS no final da triagem, quando coletar os dados do veículo e dor do cliente."""
    nome_cliente: str = Field(description="Nome do cliente")
    marca_veiculo: str = Field(description="Marca do carro (ex: VW, Audi)")
    modelo_veiculo: str = Field(description="Modelo do carro (ex: Up TSI, Jetta)")
    ano_veiculo: str = Field(description="Ano do veículo, se informado")
    sintoma_ou_servico: str = Field(description="Resumo do problema ou serviço (ex: luz injeção)")
    temperatura_lead: str = Field(description="'Frio', 'Morno', 'Quente' ou 'Fervendo'")

# 2. Definição do Estado do LangGraph
class AgentState(TypedDict):
    mensagens: list
    nome_cliente: str
    temperatura_lead: str
    dados_extraidos: dict

# 3. Configuração da IA (Anthropic)
llm = ChatAnthropic(model="claude-3-5-sonnet-20240620", temperature=0.7)
llm_com_ferramentas = llm.bind_tools([DadosKommo])

# Prompt Mestre da Anna
PROMPT_ANNA = """Você é a Anna, a assistente de pré-vendas e relacionamento da Doctor Auto Prime.
NUNCA passe preço para diagnóstico. Seja 100% humana e descontraída.
Colete Marca, Modelo e Ano do carro. Fique atenta para sugerir descarbonização em motores TSI próximos aos 60 mil km."""

# 4. O Nó da Anna
def no_anna(state: AgentState):
    mensagens_atuais = state.get("mensagens", [])
    mensagens_para_llm = [SystemMessage(content=PROMPT_ANNA)] + mensagens_atuais
    
    resposta = llm_com_ferramentas.invoke(mensagens_para_llm)
    
    if resposta.tool_calls:
        dados = resposta.tool_calls[0]['args']
        print("🚨 DADOS EXTRAÍDOS PARA O KOMMO:", dados)
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

@app.get("/")
async def pagina_inicial():
    return {"status": "online", "mensagem": "Hub da Anna operando 100%!"}

# AQUI ESTÁ A CORREÇÃO DO ERRO 422: Usamos "Request" genérico
@app.post("/webhook/kommo")
async def receber_mensagem(request: Request):
    # Aceita qualquer formato que vier (JSON ou Formulário)
    try:
        dados_brutos = await request.json()
    except:
        form_data = await request.form()
        dados_brutos = dict(form_data)
        
    print("📦 PACOTE BRUTO DO KOMMO:", dados_brutos)
    
    # Tentamos pescar a mensagem (isso pode variar dependendo de como o Kommo envia)
    # Se der erro aqui, o print acima vai nos salvar para ajustarmos a chave exata
    mensagem_cliente = dados_brutos.get("message[add][0][text]", "Oi")
    
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
    
    return {
        "status": "sucesso",
        "resposta_anna": resposta_anna
    }