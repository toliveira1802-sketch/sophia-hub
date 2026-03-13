// ═══════════════════════════════════════════════
//  📊 ANALISTA — Qualifica leads novos
//  Schedule: */10 * * * * (a cada 10 minutos)
// ═══════════════════════════════════════════════

import Anthropic from "@anthropic-ai/sdk";
import { verificarSeguranca, logCron, notificarSophia, kommoRequest } from "./_utils.js";

export default async function handler(req, res) {
  if (!verificarSeguranca(req, res)) return;

  const inicio = Date.now();

  try {
    const dezMin = 10 * 60;
    const agora  = Math.floor(Date.now() / 1000);

    const data  = await kommoRequest(`/leads?filter[created_at][from]=${agora - dezMin}&limit=50`);
    const leads = data._embedded?.leads || [];

    if (leads.length === 0) {
      await logCron("analista", "ok", 0, 0, { msg: "Nenhum lead novo" });
      return res.status(200).json({ msg: "Nenhum lead novo", executado_em: new Date().toISOString() });
    }

    const claude     = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resultados = [];
    let qualificados = 0;
    let alertas      = 0;

    for (const lead of leads) {
      const resp = await claude.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        messages: [{
          role: "user",
          content: `Qualifique este lead de oficina automotiva e retorne APENAS JSON válido:
Lead: ${lead.name}
Valor estimado: R$ ${lead.price || 0}
Status ID: ${lead.status_id}

{
  "nota": (0-100),
  "classificacao": ("A"|"B"|"C"),
  "funil": ("isca"|"upsell"|"projeto"|"pos_venda"|"war_room"),
  "urgencia": ("alta"|"media"|"baixa"),
  "proxima_acao": "string"
}`,
        }],
      });

      try {
        const json = JSON.parse(resp.content[0].text.match(/\{[\s\S]*\}/)[0]);
        resultados.push({ lead_id: lead.id, nome: lead.name, ...json });
        qualificados++;

        // Adiciona nota no Kommo
        await kommoRequest(`/leads/${lead.id}/notes`, "POST", [{
          note_type: "common",
          params: {
            text: `[ANA · ANALISTA] Nota: ${json.nota}/100 (${json.classificacao}) | Funil: ${json.funil} | Urgência: ${json.urgencia}\n→ ${json.proxima_acao}`,
          },
        }]);

        // Alerta imediato para leads A urgência alta
        if (json.classificacao === "A" && json.urgencia === "alta") {
          await notificarSophia("🔥 LEAD QUENTE QUALIFICADO!", {
            id: lead.id, nome: lead.name, nota: json.nota, proxima_acao: json.proxima_acao,
          });
          alertas++;
        }
      } catch {
        resultados.push({ lead_id: lead.id, erro: "Falha na qualificação" });
      }
    }

    const resultado = {
      total_verificados: leads.length,
      qualificados,
      alertas_enviados: alertas,
      duracao_ms: Date.now() - inicio,
      resultados,
    };

    await logCron("analista", "ok", leads.length, qualificados, resultado);
    return res.status(200).json({ executado_em: new Date().toISOString(), ...resultado });
  } catch (e) {
    console.error("[ANALISTA]", e);
    await logCron("analista", "erro", 0, 0, {}, e.message);
    return res.status(500).json({ error: e.message });
  }
}
