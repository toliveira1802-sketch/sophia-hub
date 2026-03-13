// ═══════════════════════════════════════════════
//  🔄 REATIVADOR — Reativa leads inativos
//  Schedule: 0 8 * * * (todo dia às 8h)
// ═══════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";
import { verificarSeguranca, logCron, notificarSophia, kommoRequest, buscarCampanhasAtivas, atualizarCampanha } from "./_utils.js";

export default async function handler(req, res) {
  if (!verificarSeguranca(req, res)) return;

  const inicio = Date.now();

  try {
    const umDia = 24 * 60 * 60;
    const agora = Math.floor(Date.now() / 1000);

    const data  = await kommoRequest(`/leads?filter[updated_at][to]=${agora - umDia}&limit=100`);
    const leads = data._embedded?.leads || [];

    // Busca campanha ativa para enriquecer mensagens
    const campanhas = await buscarCampanhasAtivas();
    const campanha  = campanhas[0] || null;

    const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    let reativados = 0;
    let warRoom    = 0;
    const mensagensGeradas = [];

    for (const lead of leads.slice(0, 50)) {
      const diasInativo  = Math.floor((agora - lead.updated_at) / 86400);
      const funil        = diasInativo > 7 ? "war_room" : "pos_venda";
      const contextoExtra = campanha
        ? `\nCampanha ativa: "${campanha.nome}". Inspire-se na mensagem base: "${campanha.mensagem_base || ""}"`
        : "";

      const resp = await claude.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        messages: [{
          role: "user",
          content: `Crie mensagem de reativação WhatsApp para a oficina Doctor Auto.
Lead: ${lead.name} | Inativo: ${diasInativo} dias | Funil: ${funil}${contextoExtra}
Regras: máx 3 linhas, natural, terminar com pergunta aberta, não mencionar IA.
${funil === "war_room" ? "Última tentativa — seja direto mas não desesperado." : "Tom: leve e genuíno."}
Retorne APENAS a mensagem.`,
        }],
      });

      const mensagem = resp.content[0].text.trim();

      // Cria task no Kommo para o consultor enviar
      await kommoRequest("/tasks", "POST", [{
        text: `[ANA · REATIVADOR] Enviar mensagem:\n\n"${mensagem}"`,
        complete_till: agora + 3600,
        task_type_id: 1,
        entity_id: lead.id,
        entity_type: "leads",
      }]);

      mensagensGeradas.push({ lead_id: lead.id, nome: lead.name, funil, diasInativo, mensagem });
      reativados++;
      if (funil === "war_room") warRoom++;
      if (campanha) await atualizarCampanha(campanha.id, { total_leads: 1 });
    }

    const resultado = {
      total_inativos: leads.length,
      reativados,
      war_room: warRoom,
      campanha_ativa: campanha?.nome || null,
      duracao_ms: Date.now() - inicio,
    };

    await notificarSophia("🔄 REATIVAÇÃO DIÁRIA CONCLUÍDA", resultado);
    await logCron("reativador", "ok", leads.length, reativados, { ...resultado, mensagens: mensagensGeradas });

    return res.status(200).json({ executado_em: new Date().toISOString(), ...resultado, mensagens: mensagensGeradas });
  } catch (e) {
    console.error("[REATIVADOR]", e);
    await logCron("reativador", "erro", 0, 0, {}, e.message);
    return res.status(500).json({ error: e.message });
  }
}
