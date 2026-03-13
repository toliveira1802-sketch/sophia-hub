// ═══════════════════════════════════════════════
//  📅 LEMBRETES — Confirma agendamentos do dia
//  Schedule: 0 18 * * * (todo dia às 18h)
// ═══════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";
import { verificarSeguranca, logCron, notificarSophia, kommoRequest } from "./_utils.js";

export default async function handler(req, res) {
  if (!verificarSeguranca(req, res)) return;

  const inicio = Date.now();

  try {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    amanha.setHours(0, 0, 0, 0);
    const amanhaFim = new Date(amanha);
    amanhaFim.setHours(23, 59, 59, 999);

    const tsInicio = Math.floor(amanha.getTime() / 1000);
    const tsFim    = Math.floor(amanhaFim.getTime() / 1000);

    // Busca leads com agendamento para amanhã (status_id de agendados — ajuste ao seu funil)
    const data  = await kommoRequest(`/leads?filter[custom_fields][0][field_id]=CAMPO_DATA_AGENDAMENTO&filter[custom_fields][0][from]=${tsInicio}&filter[custom_fields][0][to]=${tsFim}&limit=100`);
    const leads = data._embedded?.leads || [];

    if (leads.length === 0) {
      await logCron("lembretes", "ok", 0, 0, { msg: "Nenhum agendamento para amanhã" });
      return res.status(200).json({ msg: "Nenhum agendamento para amanhã", executado_em: new Date().toISOString() });
    }

    const claude   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const enviados = [];
    let confirmados = 0;

    for (const lead of leads) {
      // Gera mensagem de lembrete personalizada
      const resp = await claude.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Crie lembrete de agendamento WhatsApp para a oficina Doctor Auto.
Cliente: ${lead.name}
Horário: amanhã (confirme na mensagem de forma simpática)
Regras: máx 4 linhas, tom profissional mas acolhedor, pedir confirmação com sim/não, não mencionar IA.
Ritual de entrega: lembre que o veículo será entregue limpo e com relatório digital.
Retorne APENAS a mensagem.`,
        }],
      });

      const mensagem = resp.content[0].text.trim();

      // Cria task no Kommo para o consultor enviar o lembrete
      await kommoRequest("/tasks", "POST", [{
        text: `[ANA · LEMBRETES] Enviar lembrete de agendamento:\n\n"${mensagem}"`,
        complete_till: Math.floor(Date.now() / 1000) + 7200, // 2h para completar
        task_type_id: 1,
        entity_id: lead.id,
        entity_type: "leads",
      }]);

      enviados.push({ lead_id: lead.id, nome: lead.name, mensagem });
      confirmados++;
    }

    // Resumo para Sophia
    await notificarSophia("📅 LEMBRETES DE AMANHÃ GERADOS", {
      total_agendamentos: leads.length,
      lembretes_criados: confirmados,
    });

    const resultado = {
      total_agendamentos: leads.length,
      lembretes_criados: confirmados,
      duracao_ms: Date.now() - inicio,
    };

    await logCron("lembretes", "ok", leads.length, confirmados, { ...resultado, enviados });
    return res.status(200).json({ executado_em: new Date().toISOString(), ...resultado, enviados });
  } catch (e) {
    console.error("[LEMBRETES]", e);
    await logCron("lembretes", "erro", 0, 0, {}, e.message);
    return res.status(500).json({ error: e.message });
  }
}
