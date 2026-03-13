// ============================================================
//  ANA — Agente de Atendimento e Vendas · Doctor Auto
//  Sophia Hub · v2.0  (Supabase integrado)
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

// ─────────────────────────────────────────────
//  CLIENTES
// ─────────────────────────────────────────────

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // service_role: acesso total, sem RLS
);

// ─────────────────────────────────────────────
//  HELPERS SUPABASE
// ─────────────────────────────────────────────

/** Carrega histórico de conversa de um lead. Retorna [] se não existir. */
async function carregarHistorico(leadIdKommo) {
  const { data, error } = await supabase
    .from("ana_conversas")
    .select("historico")
    .eq("lead_id_kommo", String(leadIdKommo))
    .single();

  if (error || !data) return [];
  return data.historico || [];
}

/** Salva (upsert) o histórico de conversa no Supabase. */
async function salvarHistorico(leadIdKommo, leadNome, historico) {
  const { error } = await supabase.from("ana_conversas").upsert(
    {
      lead_id_kommo: String(leadIdKommo),
      lead_nome: leadNome || null,
      historico,
      ultimo_contato: new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    },
    { onConflict: "lead_id_kommo" }
  );
  if (error) console.error("[Ana] Erro ao salvar histórico:", error.message);
}

/** Registra o resultado de uma execução de cron ou tool. */
async function logCron(cron, status, leadsProcessados = 0, acoesTomadas = 0, resultado = {}, erroMsg = null) {
  const { error } = await supabase.from("ana_logs").insert({
    cron,
    status,
    leads_processados: leadsProcessados,
    acoes_tomadas: acoesTomadas,
    resultado,
    erro_msg: erroMsg,
  });
  if (error) console.error("[Ana] Erro ao salvar log:", error.message);
}

/** Retorna campanhas ativas para o reativador. */
async function buscarCampanhasAtivas() {
  const hoje = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("ana_campanhas")
    .select("*")
    .eq("status", "ativa")
    .lte("data_inicio", hoje)
    .gte("data_fim", hoje);
  if (error) { console.error("[Ana] Erro ao buscar campanhas:", error.message); return []; }
  return data || [];
}

/** Atualiza métricas de uma campanha com delta incremental. */
async function atualizarCampanha(campanhaId, delta) {
  const { data: c } = await supabase.from("ana_campanhas").select("*").eq("id", campanhaId).single();
  if (!c) return;
  const update = { atualizado_em: new Date().toISOString() };
  for (const [campo, valor] of Object.entries(delta)) {
    update[campo] = (c[campo] || 0) + valor;
  }
  await supabase.from("ana_campanhas").update(update).eq("id", campanhaId);
}

// ─────────────────────────────────────────────
//  SYSTEM PROMPT DA ANA
// ─────────────────────────────────────────────

const ANA_SYSTEM_PROMPT = `
Você é Ana, a agente de atendimento e vendas da Doctor Auto.

## QUEM VOCÊ É
Profissional do mercado automotivo — descontraída, direta e confiante.
Fala com propriedade sobre revisões, reparos, diagnósticos e serviços de oficina.
Nunca parece robótica. Usa linguagem natural, próxima, sem ser informal demais.
Representa duas unidades: Doctor Auto Prime e Doctor Auto Bosch.

## SUA MISSÃO
Conduzir o cliente da primeira mensagem até o agendamento confirmado.
Qualificar o lead, entender a necessidade, apresentar solução e fechar.

## REGRAS INVIOLÁVEIS
- NUNCA passe preços sem autorização explícita da Sophia
- NUNCA dê desconto sem autorização. Na dúvida → consulte a Sophia via tool
- NUNCA invente informações sobre veículos ou serviços
- SEMPRE identifique a unidade correta antes de agendar:
  · Doctor Auto Prime → indicar João ou Pedro
  · Doctor Auto Bosch → indicar Roniela ou Antônio

## COMO VOCÊ ATUA
1. Saúda o cliente de forma natural e personalizada
2. Identifica o veículo, problema e urgência
3. Qualifica o lead (use a tool analista_qualificar)
4. Conduz a conversa com segurança técnica
5. Aciona as tools certas no momento certo
6. Fecha com agendamento confirmado

## SUAS FERRAMENTAS
- vigilante_verificar: checar leads sem resposta
- analista_qualificar: ao receber lead novo ou retomada de conversa
- reativador_engajar: quando lead está frio há mais de 24h
- vendas_suporte: durante negociação de preço, upsell ou objeção
- agendador_confirmar: marcar, reagendar ou cancelar horário

## TOM E ESTILO
✓ "Oi João! Vi que seu Civic está com barulho no motor — me conta mais!"
✓ "Essa questão de freio a gente resolve rápido. Quando você consegue trazer?"
✗ "Prezado cliente, recebemos sua solicitação e iremos processá-la."
✗ Mensagens longas demais — seja direta

## FUNIS DAP
- Funil 1 — Isca (primeiro contato, qualificação)
- Funil 2 — Upsell (serviço adicional após diagnóstico)
- Funil 3 — Projeto (serviço maior, aprovação necessária)
- Funil 4 — Pós-Venda (follow-up após entrega)
- Funil 5 — War Room (lead parado, reativação agressiva)

Sempre identifique em qual funil o cliente está e aja de acordo.
`;

// ─────────────────────────────────────────────
//  DEFINIÇÃO DAS TOOLS
// ─────────────────────────────────────────────

const ANA_TOOLS = [
  {
    name: "vigilante_verificar",
    description: "Verifica leads sem resposta no Kommo. Use quando suspeitar que um cliente está sendo ignorado. Retorna lista de leads parados e tempo sem resposta.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "ID do lead no Kommo (opcional — se vazio, verifica todos os leads ativos)" },
        threshold_minutes: { type: "number", description: "Tempo mínimo sem resposta em minutos (padrão: 5)" },
      },
      required: [],
    },
  },
  {
    name: "analista_qualificar",
    description: "Qualifica e pontua um lead de 0 a 100. Identifica o funil DAP correto, classifica prioridade (A/B/C) e sugere próxima ação.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "ID do lead no Kommo" },
        contexto: { type: "string", description: "Resumo da conversa ou problema relatado pelo cliente" },
        veiculo: { type: "string", description: "Veículo mencionado pelo cliente (ex: Honda Civic 2019)" },
        servico_interesse: { type: "string", description: "Serviço de interesse (ex: revisão, freios, diagnóstico)" },
      },
      required: ["lead_id", "contexto"],
    },
  },
  {
    name: "reativador_engajar",
    description: "Reativa leads inativos há mais de 24h. Verifica campanhas ativas e gera mensagem personalizada alinhada com o funil atual.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "ID do lead no Kommo" },
        funil: { type: "string", enum: ["isca", "upsell", "projeto", "pos_venda", "war_room"], description: "Funil atual do lead" },
        ultimo_contato: { type: "string", description: "Data/hora do último contato (ISO 8601)" },
        motivo_parada: { type: "string", description: "Por que o lead parou de responder (se conhecido)" },
      },
      required: ["lead_id", "funil"],
    },
  },
  {
    name: "vendas_suporte",
    description: "Suporte em tempo real durante negociação. Sugere argumentos de venda, identifica upsell. Use durante objeção de preço ou fechamento.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "ID do lead no Kommo" },
        servico: { type: "string", description: "Serviço sendo negociado" },
        veiculo: { type: "string", description: "Veículo do cliente" },
        objecao: { type: "string", description: "Objeção levantada pelo cliente (ex: está caro, vou pesquisar)" },
        preco_ofertado: { type: "number", description: "Preço que foi apresentado ao cliente (se houver)" },
      },
      required: ["lead_id", "servico", "objecao"],
    },
  },
  {
    name: "agendador_confirmar",
    description: "Gerencia agendamentos no sistema Doctor Auto e Kommo. Marca, reagenda, cancela e envia lembretes.",
    input_schema: {
      type: "object",
      properties: {
        acao: { type: "string", enum: ["marcar", "reagendar", "cancelar", "lembrete", "ritual_entrega"], description: "Ação a executar" },
        lead_id: { type: "string", description: "ID do lead no Kommo" },
        data_hora: { type: "string", description: "Data e hora do agendamento (ISO 8601)" },
        unidade: { type: "string", enum: ["prime", "bosch"], description: "Unidade Doctor Auto (prime = João/Pedro, bosch = Roniela/Antônio)" },
        servico: { type: "string", description: "Serviço agendado" },
        observacoes: { type: "string", description: "Observações adicionais para a equipe" },
      },
      required: ["acao", "lead_id", "unidade"],
    },
  },
];

// ─────────────────────────────────────────────
//  IMPLEMENTAÇÕES DAS TOOLS
// ─────────────────────────────────────────────

async function vigilanteVerificar({ lead_id, threshold_minutes = 5 }) {
  const KOMMO_TOKEN = process.env.KOMMO_TOKEN;
  const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;

  try {
    const url = lead_id
      ? `https://${KOMMO_DOMAIN}/api/v4/leads/${lead_id}`
      : `https://${KOMMO_DOMAIN}/api/v4/leads?filter[statuses][0][pipeline_id]=0&limit=50`;

    const res = await fetch(url, { headers: { Authorization: `Bearer ${KOMMO_TOKEN}` } });
    const data = await res.json();

    const leads = lead_id ? [data] : data._embedded?.leads || [];
    const agora = Date.now() / 1000;
    const threshold = threshold_minutes * 60;
    const leadsSemResposta = leads.filter((l) => agora - l.updated_at > threshold);

    const resultado = {
      total_verificados: leads.length,
      leads_sem_resposta: leadsSemResposta.length,
      detalhes: leadsSemResposta.map((l) => ({
        id: l.id,
        nome: l.name,
        minutos_parado: Math.floor((agora - l.updated_at) / 60),
        responsavel: l.responsible_user_id,
      })),
      alerta: leadsSemResposta.length > 0,
    };

    await logCron("vigilante", "ok", leads.length, leadsSemResposta.length, resultado);
    return resultado;
  } catch (e) {
    await logCron("vigilante", "erro", 0, 0, {}, e.message);
    return { erro: "Falha ao consultar Kommo", detalhes: e.message };
  }
}

async function analistaQualificar({ lead_id, contexto, veiculo, servico_interesse }) {
  const res = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Você é um especialista em qualificação de leads para oficina automotiva.
Analise este lead e retorne APENAS um JSON válido:

Lead ID: ${lead_id}
Contexto: ${contexto}
Veículo: ${veiculo || "não informado"}
Serviço de interesse: ${servico_interesse || "não informado"}

Retorne:
{
  "nota": (0-100),
  "classificacao": ("A" | "B" | "C"),
  "funil": ("isca" | "upsell" | "projeto" | "pos_venda" | "war_room"),
  "urgencia": ("alta" | "media" | "baixa"),
  "proxima_acao": "descrição da próxima ação recomendada",
  "potencial_ticket": ("alto" | "medio" | "baixo"),
  "justificativa": "breve explicação da nota"
}`,
    }],
  });

  try {
    const json = JSON.parse(res.content[0].text.match(/\{[\s\S]*\}/)[0]);
    const resultado = { lead_id, ...json };
    await logCron("analista", "ok", 1, 1, resultado);
    return resultado;
  } catch {
    return {
      lead_id, nota: 50, classificacao: "B", funil: "isca",
      urgencia: "media", proxima_acao: "Continuar conversa e coletar mais dados",
      potencial_ticket: "medio", justificativa: "Dados insuficientes para qualificação precisa",
    };
  }
}

async function reativadorEngajar({ lead_id, funil, ultimo_contato, motivo_parada }) {
  const campanhas = await buscarCampanhasAtivas();
  const campanha = campanhas.find((c) => c.funil === funil || c.funil === "war_room");

  const estrategias = {
    isca: "Relembre o benefício inicial, ofereça algo novo, seja leve e curioso",
    upsell: "Mencione que o serviço está disponível, urgência suave",
    projeto: "Pergunte se ainda faz sentido avançar, mostre disponibilidade",
    pos_venda: "Check-in genuíno sobre a experiência, solicite feedback",
    war_room: "Abordagem direta, oferta especial limitada, última tentativa",
  };

  const contextoExtra = campanha
    ? `\nCampanha ativa: "${campanha.nome}" — inspire-se na mensagem base: "${campanha.mensagem_base || ""}"`
    : "";

  const res = await claude.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `Crie uma mensagem de reativação para WhatsApp/Kommo.

Contexto:
- Funil: ${funil}
- Estratégia: ${estrategias[funil]}
- Último contato: ${ultimo_contato || "desconhecido"}
- Motivo parada: ${motivo_parada || "desconhecido"}
- Negócio: Doctor Auto (oficina automotiva premium)${contextoExtra}

Regras:
- Máximo 3 linhas
- Natural, não robótico
- Não mencione que é IA
- Não force venda direta (exceto war_room)
- Termine com pergunta aberta

Retorne APENAS a mensagem, sem explicações.`,
    }],
  });

  const mensagem = res.content[0].text.trim();

  if (campanha) await atualizarCampanha(campanha.id, { total_leads: 1 });
  await logCron("reativador", "ok", 1, 1, { lead_id, funil, campanha_id: campanha?.id || null });

  return {
    lead_id, funil, mensagem_reativacao: mensagem,
    proxima_verificacao: "24h", estrategia_aplicada: estrategias[funil],
    campanha_ativa: campanha ? campanha.nome : null,
  };
}

async function vendasSuporte({ lead_id, servico, veiculo, objecao, preco_ofertado }) {
  const res = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `Você é um especialista em vendas de serviços automotivos premium.

Situação:
- Serviço: ${servico}
- Veículo: ${veiculo || "não informado"}
- Objeção do cliente: ${objecao}
- Preço ofertado: ${preco_ofertado ? `R$ ${preco_ofertado}` : "não informado"}

Política da Doctor Auto:
- Margem: 35-120%
- Desconto: NUNCA sem autorização
- Posicionamento: premium, qualidade superior, garantia

Retorne JSON:
{
  "argumento_principal": "argumento mais forte para usar agora",
  "argumentos_secundarios": ["argumento 2", "argumento 3"],
  "upsell_sugerido": "serviço complementar que faz sentido oferecer (ou null)",
  "desconto_recomendado": false,
  "escalar_para_sophia": (true se a situação precisar de aprovação),
  "mensagem_sugerida": "mensagem pronta para mandar ao cliente"
}`,
    }],
  });

  try {
    const json = JSON.parse(res.content[0].text.match(/\{[\s\S]*\}/)[0]);
    return { lead_id, servico, ...json };
  } catch {
    return {
      lead_id, argumento_principal: "Qualidade e garantia Doctor Auto",
      escalar_para_sophia: true, mensagem_sugerida: "Deixa eu verificar a melhor condição pra você!",
    };
  }
}

async function agendadorConfirmar({ acao, lead_id, data_hora, unidade, servico, observacoes }) {
  const KOMMO_TOKEN = process.env.KOMMO_TOKEN;
  const KOMMO_DOMAIN = process.env.KOMMO_DOMAIN;
  const responsaveis = { prime: "João ou Pedro", bosch: "Roniela ou Antônio" };

  try {
    await fetch(`https://${KOMMO_DOMAIN}/api/v4/tasks`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KOMMO_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify([{
        text: `[${acao.toUpperCase()}] ${servico || "Serviço"} — ${data_hora || "A confirmar"}\nResponsável: ${responsaveis[unidade]}\n${observacoes || ""}`,
        complete_till: data_hora ? Math.floor(new Date(data_hora).getTime() / 1000) : null,
        task_type_id: 1,
        entity_id: parseInt(lead_id),
        entity_type: "leads",
      }]),
    });
  } catch (e) {
    console.error("Erro ao criar task no Kommo:", e);
  }

  // Atualiza campanhas ativas ao confirmar agendamento
  if (acao === "marcar") {
    const campanhas = await buscarCampanhasAtivas();
    for (const c of campanhas) await atualizarCampanha(c.id, { agendados: 1 });
  }

  await logCron("lembretes", "ok", 1, 1, { acao, lead_id, unidade });

  const msgs = {
    marcar: `Agendamento confirmado! Venha falar com ${responsaveis[unidade]} na unidade ${unidade === "prime" ? "Doctor Auto Prime" : "Doctor Auto Bosch"}. Te esperamos! 🔧`,
    reagendar: `Reagendamento confirmado! Anotado aqui para ${data_hora}. Qualquer dúvida é só chamar!`,
    cancelar: `Cancelamento registrado. Quando quiser reagendar é só me chamar. Até logo!`,
    lembrete: `Só passando pra lembrar do seu agendamento amanhã na Doctor Auto! Qualquer imprevisto me avisa.`,
    ritual_entrega: `Seu carro está pronto! A equipe preparou um checklist completo. ${responsaveis[unidade]} vai te mostrar tudo na entrega. Nos vemos em breve! 🎉`,
  };

  return { sucesso: true, acao, lead_id, unidade, responsavel: responsaveis[unidade], mensagem_cliente: msgs[acao], data_hora: data_hora || null };
}

// ─────────────────────────────────────────────
//  EXECUTOR DE TOOLS
// ─────────────────────────────────────────────

async function executarTool(nome, input) {
  switch (nome) {
    case "vigilante_verificar": return await vigilanteVerificar(input);
    case "analista_qualificar": return await analistaQualificar(input);
    case "reativador_engajar":  return await reativadorEngajar(input);
    case "vendas_suporte":      return await vendasSuporte(input);
    case "agendador_confirmar": return await agendadorConfirmar(input);
    default: return { erro: `Tool desconhecida: ${nome}` };
  }
}

// ─────────────────────────────────────────────
//  LOOP PRINCIPAL DA ANA
//  1. Carrega histórico do Supabase (ana_conversas)
//  2. Executa loop agêntico com tools
//  3. Salva histórico atualizado de volta no Supabase
// ─────────────────────────────────────────────

export async function rodarAna(leadId, novaMsg, leadNome = null) {
  // 1. Carrega histórico persistido
  const historico = await carregarHistorico(leadId);

  const messages = [
    ...historico,
    { role: "user", content: novaMsg },
  ];

  let resposta = null;

  // 2. Loop agêntico
  while (true) {
    const res = await claude.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: ANA_SYSTEM_PROMPT,
      tools: ANA_TOOLS,
      messages,
    });

    if (res.stop_reason === "tool_use") {
      const toolUse = res.content.find((b) => b.type === "tool_use");
      messages.push({ role: "assistant", content: res.content });
      const resultado = await executarTool(toolUse.name, toolUse.input);
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(resultado) }],
      });
      continue;
    }

    resposta = res.content.find((b) => b.type === "text")?.text;
    break;
  }

  // 3. Adiciona resposta final e salva histórico
  messages.push({ role: "assistant", content: resposta });
  await salvarHistorico(leadId, leadNome, messages);

  return { resposta };
}

// ─────────────────────────────────────────────
//  VERCEL SERVERLESS FUNCTION
//  POST /api/ana
//  Body: { lead_id, mensagem, lead_nome? }
// ─────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { mensagem, lead_id, lead_nome } = req.body;

  if (!mensagem || !lead_id) {
    return res.status(400).json({ error: "mensagem e lead_id são obrigatórios" });
  }

  try {
    const msgComContexto = `[Lead Kommo ID: ${lead_id}]\n${mensagem}`;
    const { resposta } = await rodarAna(lead_id, msgComContexto, lead_nome);
    return res.status(200).json({ resposta, lead_id });
  } catch (e) {
    console.error("Erro na Ana:", e);
    await logCron("manual", "erro", 0, 0, {}, e.message);
    return res.status(500).json({ error: "Erro interno", detalhes: e.message });
  }
}
