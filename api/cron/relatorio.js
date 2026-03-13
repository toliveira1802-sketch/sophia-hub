// ═══════════════════════════════════════════════
//  📊 RELATÓRIO DIÁRIO — Resumo para Sophia
//  Schedule: 0 19 * * * (todo dia às 19h)
// ═══════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { verificarSeguranca, logCron, notificarSophia, kommoRequest } from "./_utils.js";

export default async function handler(req, res) {
  if (!verificarSeguranca(req, res)) return;

  const inicio = Date.now();

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    const hoje     = new Date().toISOString().split("T")[0];

    // ── 1. Logs do dia no Supabase ───────────────────────────
    const { data: logs } = await supabase
      .from("ana_logs")
      .select("*")
      .gte("criado_em", `${hoje}T00:00:00`)
      .lte("criado_em", `${hoje}T23:59:59`);

    const resumoLogs = (logs || []).reduce((acc, log) => {
      if (!acc[log.cron]) acc[log.cron] = { execucoes: 0, leads: 0, acoes: 0, erros: 0 };
      acc[log.cron].execucoes++;
      acc[log.cron].leads  += log.leads_processados || 0;
      acc[log.cron].acoes  += log.acoes_tomadas     || 0;
      if (log.status === "erro") acc[log.cron].erros++;
      return acc;
    }, {});

    // ── 2. Métricas do Kommo ─────────────────────────────────
    const agora     = Math.floor(Date.now() / 1000);
    const inicioDia = agora - 24 * 60 * 60;

    const [leadsNovos, leadsGanhos, leadsPerdidos] = await Promise.all([
      kommoRequest(`/leads?filter[created_at][from]=${inicioDia}&limit=1`),
      kommoRequest(`/leads?filter[statuses][0][status_id]=142&filter[closed_at][from]=${inicioDia}&limit=1`),
      kommoRequest(`/leads?filter[statuses][0][status_id]=143&filter[closed_at][from]=${inicioDia}&limit=1`),
    ]);

    const metricas = {
      leads_novos:   leadsNovos._total_items    || 0,
      leads_ganhos:  leadsGanhos._total_items   || 0,
      leads_perdidos: leadsPerdidos._total_items || 0,
      taxa_conversao: leadsNovos._total_items
        ? ((leadsGanhos._total_items || 0) / leadsNovos._total_items * 100).toFixed(1) + "%"
        : "0%",
    };

    // ── 3. Claude analisa tudo e gera relatório ──────────────
    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const respRelatorio = await claude.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: `Você é Ana, CSF (Chief Sales Force) do Doctor Auto. 
Analise os dados do dia e gere um relatório executivo conciso para Sophia (CEO).
Tom: profissional, direto, com insights acionáveis. Use emojis estrategicamente.
Formato: seções curtas — Resumo do Dia | Destaques | Alertas | Amanhã.`,
      messages: [{
        role: "user",
        content: `Dados de hoje (${hoje}):

MÉTRICAS KOMMO:
${JSON.stringify(metricas, null, 2)}

PERFORMANCE DOS AGENTES:
${JSON.stringify(resumoLogs, null, 2)}

Gere o relatório executivo do dia.`,
      }],
    });

    const relatorio = respRelatorio.content[0].text;

    // ── 4. Salva relatório no Supabase ───────────────────────
    await supabase.from("ana_logs").insert({
      cron: "relatorio",
      status: "ok",
      leads_processados: metricas.leads_novos,
      acoes_tomadas: 1,
      resultado: { metricas, resumoLogs, relatorio },
    });

    // ── 5. Notifica Sophia com o relatório completo ──────────
    await notificarSophia(`📊 RELATÓRIO DO DIA — ${hoje}`, { relatorio, metricas });

    const resultado = {
      data: hoje,
      metricas,
      agentes_executados: Object.keys(resumoLogs).length,
      relatorio,
      duracao_ms: Date.now() - inicio,
    };

    await logCron("relatorio", "ok", metricas.leads_novos, 1, resultado);
    return res.status(200).json({ executado_em: new Date().toISOString(), ...resultado });
  } catch (e) {
    console.error("[RELATORIO]", e);
    await logCron("relatorio", "erro", 0, 0, {}, e.message);
    return res.status(500).json({ error: e.message });
  }
}
