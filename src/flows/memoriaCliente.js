import { supabase } from "../services/supabase.js";

function limparNome(name) {
  return name
    .replace(/meu nome é/gi, "")
    .replace(/pode me chamar de/gi, "")
    .replace(/me chamo/gi, "")
    .replace(/sou o/gi, "")
    .replace(/sou a/gi, "")
    .replace(/é o/gi, "")
    .replace(/é a/gi, "")
    .trim()
    .split(" ")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

export async function salvarNomeCliente({ leadId, name }) {
  const nomeLimpo = limparNome(name);
  await supabase.from("tp_leads").update({ name: nomeLimpo }).eq("id", leadId);
}

export async function montarMemoriaCliente({ companyId, customerPhone, leadId }) {
  const partes = [];

  const { data: lead } = await supabase
    .from("tp_leads")
    .select("name, notas_pessoais, horario_preferido, profissional_favorita, ultima_observacao")
    .eq("id", leadId)
    .single();

  const { data: agendamentos } = await supabase
    .from("tp_appointments")
    .select("scheduled_at, status, service_id, provider_id")
    .eq("company_id", companyId)
    .eq("customer_phone", customerPhone)
    .order("scheduled_at", { ascending: false })
    .limit(10);

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

  if ((!agendamentos || agendamentos.length === 0) && interacoes.length === 0 && !lead?.name) {
    return "";
  }

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

  partes.push("=== MEMORIA DESTE CLIENTE ===");
  if (lead?.name) partes.push("Nome: " + lead.name);
  if (lead?.notas_pessoais) partes.push("Notas pessoais: " + lead.notas_pessoais);
  if (lead?.horario_preferido) partes.push("Horário preferido: " + lead.horario_preferido);
  if (lead?.profissional_favorita) partes.push("Profissional favorita: " + lead.profissional_favorita);
  if (lead?.ultima_observacao) partes.push("Última observação: " + lead.ultima_observacao);

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
    if (favorita && contagem[favorita] > 1) partes.push("\nProfissional mais frequente: " + favorita);
  }

  if (interacoes.length > 0) {
    partes.push("\nUltimas mensagens:");
    interacoes.reverse().forEach((i) => { if (i.message) partes.push("- " + i.message); });
  }

  partes.push("\nUse a memoria com naturalidade. Chame o cliente pelo nome sempre que possivel. Use as preferencias para personalizar o atendimento.");
  return partes.join("\n");
}