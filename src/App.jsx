import { useState, useRef, useEffect } from "react";

const AGENTS = {
  sophia: {
    name: "Sophia",
    initials: "SO",
    role: "Rainha · Orquestradora",
    emoji: "👑",
    color: "#c8a96e",
    bg: "rgba(200,169,110,0.1)",
    border: "rgba(200,169,110,0.35)",
    glow: "rgba(200,169,110,0.12)",
    system: `Você é Sophia, a IA orquestradora central de um ecossistema de agentes inteligentes. Você é estratégica, direta e controla todos os outros agentes. Sua missão é receber demandas, analisar e decidir como delegar. Responda em português brasileiro, de forma clara e objetiva. Seja concisa mas perspicaz.`,
  },
  simone: {
    name: "Simone",
    initials: "SI",
    role: "Inteligência do Sistema",
    emoji: "🧠",
    color: "#6eb5c8",
    bg: "rgba(110,181,200,0.1)",
    border: "rgba(110,181,200,0.35)",
    glow: "rgba(110,181,200,0.12)",
    system: `Você é Simone, a IA responsável pela inteligência interna do sistema. Você monitora qualidade, equilíbrio operacional e redução de custos. É analítica, precisa e reporta insights para Sophia. Responda em português brasileiro de forma técnica mas clara.`,
  },
  ana: {
    name: "Ana",
    initials: "AN",
    role: "Atendimento ao Cliente",
    emoji: "💬",
    color: "#c86e9a",
    bg: "rgba(200,110,154,0.1)",
    border: "rgba(200,110,154,0.35)",
    glow: "rgba(200,110,154,0.12)",
    system: `Você é Ana, a IA de atendimento ao cliente. Você é calorosa, empática e resolutiva. Conversa diretamente com clientes, resolve dúvidas e escalona para Sophia quando necessário. Responda em português brasileiro de forma acolhedora e clara.`,
  },
};

const styles = {
  root: {
    background: "#06070a",
    minHeight: "100vh",
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    color: "#e8e2d5",
    display: "flex",
    flexDirection: "column",
  },
  gridBg: {
    position: "fixed",
    inset: 0,
    backgroundImage:
      "linear-gradient(rgba(200,169,110,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(200,169,110,0.03) 1px, transparent 1px)",
    backgroundSize: "40px 40px",
    pointerEvents: "none",
    zIndex: 0,
  },
  content: { position: "relative", zIndex: 1, display: "flex", flexDirection: "column", flex: 1, padding: "1.5rem", gap: "1.2rem", maxWidth: 900, margin: "0 auto", width: "100%" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: "1rem", borderBottom: "1px solid #1e2130" },
  title: { fontSize: "1.8rem", fontWeight: 800, color: "#c8a96e", letterSpacing: "-0.03em", lineHeight: 1 },
  titleSub: { fontSize: "0.62rem", color: "#5a5f72", marginTop: 4, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: "monospace" },
  badge: { display: "flex", alignItems: "center", gap: 6, background: "rgba(143,200,110,0.1)", border: "1px solid rgba(143,200,110,0.3)", padding: "4px 10px", borderRadius: 2, fontSize: "0.6rem", color: "#8fc86e", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "monospace" },
  pulse: { width: 6, height: 6, borderRadius: "50%", background: "#8fc86e", animation: "pulse 2s infinite" },
  agentTabs: { display: "flex", gap: "0.8rem" },
  agentTab: (agent, active) => ({
    flex: 1,
    background: active ? AGENTS[agent].bg : "rgba(255,255,255,0.02)",
    border: `1px solid ${active ? AGENTS[agent].border : "#1e2130"}`,
    borderRadius: 4,
    padding: "0.9rem 1rem",
    cursor: "pointer",
    transition: "all 0.2s",
    textAlign: "left",
    boxShadow: active ? `0 0 24px ${AGENTS[agent].glow}` : "none",
  }),
  tabEmoji: { fontSize: "1.2rem", marginBottom: 4 },
  tabName: (agent, active) => ({ fontSize: "1rem", fontWeight: 700, color: active ? AGENTS[agent].color : "#5a5f72", marginBottom: 2 }),
  tabRole: { fontSize: "0.58rem", color: "#5a5f72", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "monospace" },
  terminal: { background: "#040506", border: "1px solid #1e2130", borderRadius: 4, overflow: "hidden", flex: 1, display: "flex", flexDirection: "column" },
  termHeader: { background: "#0d0f14", borderBottom: "1px solid #1e2130", padding: "0.7rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" },
  dots: { display: "flex", gap: 5 },
  dot: (c) => ({ width: 9, height: 9, borderRadius: "50%", background: c }),
  termLabel: (agent) => ({ fontFamily: "monospace", fontSize: "0.6rem", color: AGENTS[agent].color, textTransform: "uppercase", letterSpacing: "0.12em" }),
  messages: { padding: "1rem", flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.8rem", minHeight: 280, maxHeight: 380 },
  message: { display: "flex", gap: "0.7rem", alignItems: "flex-start" },
  avatar: (agent) => ({
    width: 28, height: 28, borderRadius: 2, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.55rem", fontFamily: "monospace", fontWeight: 700, flexShrink: 0,
    background: agent === "user" ? "rgba(255,255,255,0.04)" : AGENTS[agent]?.bg,
    border: `1px solid ${agent === "user" ? "#1e2130" : AGENTS[agent]?.border}`,
    color: agent === "user" ? "#5a5f72" : AGENTS[agent]?.color,
  }),
  msgText: (isUser) => ({ fontSize: "0.83rem", lineHeight: 1.65, color: isUser ? "#5a5f72" : "rgba(232,226,213,0.85)", paddingTop: 2, flex: 1, whiteSpace: "pre-wrap" }),
  inputArea: { borderTop: "1px solid #1e2130", padding: "0.8rem 1rem", display: "flex", gap: "0.7rem", alignItems: "flex-end" },
  input: { flex: 1, background: "transparent", border: "none", borderBottom: "1px solid #1e2130", color: "#e8e2d5", fontSize: "0.85rem", padding: "0.35rem 0", outline: "none", fontFamily: "inherit", resize: "none" },
  sendBtn: (agent, disabled) => ({
    background: disabled ? "#1e2130" : AGENTS[agent].color,
    color: disabled ? "#5a5f72" : "#06070a",
    border: "none", padding: "0.45rem 1rem", borderRadius: 2,
    fontFamily: "monospace", fontSize: "0.62rem", textTransform: "uppercase",
    letterSpacing: "0.1em", cursor: disabled ? "not-allowed" : "pointer",
    fontWeight: 700, transition: "opacity 0.2s", whiteSpace: "nowrap",
  }),
  notice: { fontFamily: "monospace", fontSize: "0.58rem", color: "rgba(200,169,110,0.4)", textAlign: "center", padding: "0 1rem 0.6rem" },
};

export default function SophiaHub() {
  const [activeAgent, setActiveAgent] = useState("sophia");
  const [histories, setHistories] = useState({ sophia: [], simone: [], ana: [] });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesRef = useRef(null);

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
  }, [histories, loading]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    const userMsg = { role: "user", content: msg };
    const newHistory = [...(histories[activeAgent] || []), userMsg];
    setHistories((h) => ({ ...h, [activeAgent]: newHistory }));
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: AGENTS[activeAgent].system,
          messages: newHistory,
        }),
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "Erro na resposta.";
      setHistories((h) => ({
        ...h,
        [activeAgent]: [...newHistory, { role: "assistant", content: reply }],
      }));
    } catch (e) {
      setHistories((h) => ({
        ...h,
        [activeAgent]: [...newHistory, { role: "assistant", content: "Erro de conexão com a API." }],
      }));
    }
    setLoading(false);
  };

  const agent = AGENTS[activeAgent];
  const msgs = histories[activeAgent];

  return (
    <div style={styles.root}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.8)} }
        @keyframes blink { 0%,100%{opacity:.2} 50%{opacity:1} }
        ::-webkit-scrollbar{width:3px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:#1e2130;border-radius:2px}
      `}</style>
      <div style={styles.gridBg} />
      <div style={styles.content}>
        <header style={styles.header}>
          <div>
            <div style={styles.title}>Sophia <span style={{ color: "#5a5f72", fontWeight: 400 }}>Hub</span></div>
            <div style={styles.titleSub}>Central de Orquestração · Ecossistema IA</div>
          </div>
          <div style={styles.badge}>
            <div style={styles.pulse} />
            Sistema Ativo
          </div>
        </header>

        <div style={styles.agentTabs}>
          {Object.keys(AGENTS).map((key) => {
            const a = AGENTS[key];
            const active = activeAgent === key;
            return (
              <button key={key} style={styles.agentTab(key, active)} onClick={() => setActiveAgent(key)}>
                <div style={styles.tabEmoji}>{a.emoji}</div>
                <div style={styles.tabName(key, active)}>{a.name}</div>
                <div style={styles.tabRole}>{a.role}</div>
              </button>
            );
          })}
        </div>

        <div style={styles.terminal}>
          <div style={styles.termHeader}>
            <div style={styles.dots}>
              <div style={styles.dot("rgba(200,110,110,.6)")} />
              <div style={styles.dot("rgba(200,180,110,.6)")} />
              <div style={styles.dot("rgba(110,200,110,.6)")} />
            </div>
            <div style={styles.termLabel(activeAgent)}>{agent.name} · Chat</div>
            <div style={{ width: 50 }} />
          </div>

          <div style={styles.messages} ref={messagesRef}>
            {msgs.length === 0 && (
              <div style={styles.message}>
                <div style={styles.avatar(activeAgent)}>{agent.initials}</div>
                <div style={styles.msgText(false)}>
                  Olá! Sou {agent.name}. {activeAgent === "sophia" ? "Orquestre comigo seu ecossistema." : activeAgent === "simone" ? "Pronta para analisar o sistema." : "Como posso ajudar seu cliente hoje?"}
                </div>
              </div>
            )}
            {msgs.map((m, i) => {
              const isUser = m.role === "user";
              return (
                <div key={i} style={styles.message}>
                  <div style={styles.avatar(isUser ? "user" : activeAgent)}>{isUser ? "EU" : agent.initials}</div>
                  <div style={styles.msgText(isUser)}>{m.content}</div>
                </div>
              );
            })}
            {loading && (
              <div style={styles.message}>
                <div style={styles.avatar(activeAgent)}>{agent.initials}</div>
                <div style={{ display: "flex", gap: 4, paddingTop: 8 }}>
                  {[0, 1, 2].map((i) => (
                    <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: agent.color, animation: `blink 1.2s ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div style={styles.inputArea}>
            <textarea
              style={styles.input}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder={`Falar com ${agent.name}...`}
              rows={1}
            />
            <button style={styles.sendBtn(activeAgent, loading || !input.trim())} onClick={sendMessage} disabled={loading || !input.trim()}>
              Enviar
            </button>
          </div>
          <div style={styles.notice}>API Anthropic · Histórico separado por agente · Enter para enviar</div>
        </div>
      </div>
    </div>
  );
}
