// ═══════════════════════════════════════════════
//  🚨 VIGILANTE — Monitora leads sem resposta
//  Schedule: */5 * * * * (a cada 5 minutos)
// ═══════════════════════════════════════════════

import { verificarSeguranca, logCron, notificarSophia, kommoRequest } from "./_utils.js";

export default async function handler(req, res) {
  if (!verificarSeguranca(req, res)) return;

  const inicio = Date.now();

  try {
    const agora = Math.floor(Date.now() / 1000);
    const cincoMin = 5 * 60;
    const quinzeMin = 15 * 60;

    const data = await kommoRequest("/leads?filter[statuses][0][status_id]=142&limit=100");
    const leads = data._embedded?.leads || [];

    const parados  = leads.filter((l) => agora - l.updated_at > cincoMin);
    const criticos = leads.filter((l) => agora - l.updated_at > quinzeMin);

    // Alerta imediato para leads críticos (+15 min sem resposta)
    if (criticos.length > 0) {
      await notificarSophia("🚨 LEAD CRÍTICO SEM RESPOSTA!", {
        quantidade: criticos.length,
        leads: criticos.map((l) => ({
          id: l.id,
          nome: l.name,
          minutos: Math.floor((agora - l.updated_at) / 60),
        })),
      });
    }

    // Compilado do almoço (12h)
    const hora = new Date().getHours();
    if (hora === 12 && parados.length > 0) {
      await notificarSophia("☀️ COMPILADO DO ALMOÇO", {
        total_aguardando: parados.length,
        lista: parados.map((l) => `${l.name} — ${Math.floor((agora - l.updated_at) / 60)} min`).join("\n"),
      });
    }

    const resultado = {
      total_verificados: leads.length,
      leads_parados: parados.length,
      leads_criticos: criticos.length,
      duracao_ms: Date.now() - inicio,
    };

    await logCron("vigilante", "ok", leads.length, criticos.length, resultado);
    return res.status(200).json({ executado_em: new Date().toISOString(), ...resultado });
  } catch (e) {
    console.error("[VIGILANTE]", e);
    await logCron("vigilante", "erro", 0, 0, {}, e.message);
    return res.status(500).json({ error: e.message });
  }
}
