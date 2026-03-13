// ============================================================
//  UTILITÁRIOS COMPARTILHADOS — Ana Crons
//  Sophia Hub · Doctor Auto
// ============================================================

import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/** Verifica CRON_SECRET. Retorna false e responde 401 se inválido. */
export function verificarSeguranca(req, res) {
  const secret = req.headers["x-cron-secret"] || req.query.secret;
  if (secret !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "Não autorizado" });
    return false;
  }
  return true;
}

/** Registra resultado de um cron na tabela ana_logs. */
export async function logCron(cron, status, leadsProcessados = 0, acoesTomadas = 0, resultado = {}, erroMsg = null) {
  const supabase = getSupabase();
  const { error } = await supabase.from("ana_logs").insert({
    cron, status,
    leads_processados: leadsProcessados,
    acoes_tomadas: acoesTomadas,
    resultado,
    erro_msg: erroMsg,
  });
  if (error) console.error(`[${cron}] Erro ao salvar log:`, error.message);
}

/** Notifica Sophia via Slack (opcional). */
export async function notificarSophia(evento, dados) {
  console.log(`[SOPHIA] ${evento}:`, JSON.stringify(dados));
  if (process.env.SLACK_WEBHOOK) {
    await fetch(process.env.SLACK_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `*${evento}*\n\`\`\`${JSON.stringify(dados, null, 2)}\`\`\`` }),
    }).catch((e) => console.error("Slack error:", e.message));
  }
}

/** Helper para chamadas à API do Kommo. */
export async function kommoRequest(path, method = "GET", body = null) {
  const res = await fetch(`https://${process.env.KOMMO_DOMAIN}/api/v4${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.KOMMO_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : null,
  });
  return res.json();
}

/** Busca campanhas ativas para o dia de hoje. */
export async function buscarCampanhasAtivas() {
  const supabase = getSupabase();
  const hoje = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("ana_campanhas")
    .select("*")
    .eq("status", "ativa")
    .lte("data_inicio", hoje)
    .gte("data_fim", hoje);
  if (error) { console.error("Erro ao buscar campanhas:", error.message); return []; }
  return data || [];
}

/** Incrementa métricas de uma campanha. Ex: { agendados: 1 } */
export async function atualizarCampanha(campanhaId, delta) {
  const supabase = getSupabase();
  const { data: c } = await supabase.from("ana_campanhas").select("*").eq("id", campanhaId).single();
  if (!c) return;
  const update = { atualizado_em: new Date().toISOString() };
  for (const [campo, valor] of Object.entries(delta)) {
    update[campo] = (c[campo] || 0) + valor;
  }
  await supabase.from("ana_campanhas").update(update).eq("id", campanhaId);
}
