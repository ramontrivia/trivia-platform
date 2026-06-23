import { supabase } from "../services/supabase.js";

// Monta a memoria completa do cliente: nome, historico de agendamentos,
// profissional preferida e ultimas conversas. Retorna texto para o prompt.
export async function montarMemoriaCliente({ companyId, customerPhone, leadId }) {
  const partes = [];

  // 1. Busca agendamentos do cliente (com nomes de servico e profissional)
  const { data: agendamentos } = await supabase
    .from("tp_appointments")
    .select("scheduled_at, status, service_id, provider_id")
    .eq("company_id", companyId)
    .eq("customer_phone", customerPhone)
    .order("scheduled_at", { ascending: false })
    .limit(10);

  // 2. Busca interacoes recentes
  let interacoes = [];
  if (leadId) {
    const { data: ints } = await supabase
      .from("tp_lead_interactions")
      .select("message")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(6);
    interacoes = ints || [];
  }

  // Se nao tem historico nenhum, retorna vazio (cliente novo)
  if ((!agendamentos || agendamentos.length === 0) && interacoes.length === 0) {
    return "";
  }

  // Resolve nomes de servicos e profissionais
  let nomesServicos = {};
  let nomesProviders = {};
  if (agendamentos && agendamentos.length > 0) {
    const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
    const provIds = [...new Set(agendamentos.map((a) => a.provider_id))];
    const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
    const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);
    (servs || []).forEach((s) => { nomesServicos[s.id] = s.name; });
    (provs || []).forEach((p) => { nomesProviders[p.id] = p.name; });
  }

  partes.push("=== MEMORIA DESTE CLIENTE (use para personalizar, com naturalidade) ===");

  if (agendamentos && agendamentos.length > 0) {
    partes.push("\nHistorico de agendamentos:");
    agendamentos.forEach((a) => {
      const serv = nomesServicos[a.service_id] || "servico";
      const prov = nomesProviders[a.provider_id] || "profissional";
      const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR");
      partes.push("- " + serv + " com " + prov + " em " + data + " (" + a.status + ")");
    });

    const contagem = {};
    agendamentos.forEach((a) => { const p = nomesProviders[a.provider_id]; if (p) contagem[p] = (contagem[p] || 0) + 1; });
    const favorita = Object.keys(contagem).sort((x, y) => contagem[y] - contagem[x])[0];
    if (favorita && contagem[favorita] > 1) {
      partes.push("\nProfissional preferida: " + favorita);
    }
  }

  if (interacoes.length > 0) {
    partes.push("\nUltimas mensagens deste cliente:");
    interacoes.reverse().forEach((i) => { if (i.message) partes.push("- " + i.message); });
  }

  partes.push("\nSe for cliente recorrente, demonstre que lembra dele de forma natural, sem exagero.");
  return partes.join("\n");
}
