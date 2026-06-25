import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { generateResponse } from "../services/openai.js";

export async function isAdmin({ companyId, customerPhone }) {
  const { data } = await supabase
    .from("tp_admins")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("phone", customerPhone)
    .single();
  return data || null;
}

export async function isProvider({ companyId, customerPhone }) {
  const { data, error } = await supabase
    .from("tp_providers")
    .select("id, name, company_id")
    .eq("phone", customerPhone)
    .eq("company_id", companyId)
    .limit(1);
  if (!data || data.length === 0) return null;
  return data[0];
}

export async function enviarAgendaProfissional({ company, customerPhone, provider }) {
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();

  const { data: agendamentos } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, status, customer_name, customer_phone, service_id")
    .eq("company_id", company.id)
    .eq("provider_id", provider.id)
    .gte("scheduled_at", inicioHoje)
    .in("status", ["aguardando_aprovacao", "confirmado"])
    .order("scheduled_at", { ascending: true });

  if (!agendamentos || agendamentos.length === 0) {
    await sendTextMessage({ to: customerPhone, message: "Olá, " + provider.name + "! Você não tem agendamentos a partir de hoje.", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const nomesServicos = {};
  (servs || []).forEach((s) => { nomesServicos[s.id] = s.name; });

  const porData = {};
  agendamentos.forEach((a) => {
    const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    if (!porData[data]) porData[data] = [];
    porData[data].push(a);
  });

  let msg = "📅 *AGENDA DE " + provider.name.toUpperCase() + "*\n";
  msg += "─────────────────────\n\n";

  for (const data of Object.keys(porData)) {
    msg += "📅 *" + data.toUpperCase() + "*\n";
    for (const a of porData[data]) {
      const hora = new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const serv = nomesServicos[a.service_id] || "?";
      const cliente = a.customer_name || a.customer_phone;
      const status = a.status === "confirmado" ? "✅" : "⏳";
      msg += "  " + status + " " + hora + " — " + cliente + " (" + serv + ")\n";
    }
    msg += "\n";
  }

  msg += "─────────────────────\n";
  msg += "Total: " + agendamentos.length + " agendamento(s)";

  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}

export async function iniciarCancelamentoAdmin({ company, customerPhone, nomeProfissional }) {
  // Busca a profissional pelo nome
  const { data: providers } = await supabase
    .from("tp_providers")
    .select("id, name")
    .eq("company_id", company.id)
    .ilike("name", "%" + nomeProfissional + "%")
    .limit(1);

  if (!providers || providers.length === 0) {
    await sendTextMessage({
      to: customerPhone,
      message: "Não encontrei nenhuma profissional com o nome \"" + nomeProfissional + "\". Verifique o nome e tente novamente.",
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token
    });
    return;
  }

  const provider = providers[0];

  // Busca agendamentos ativos da profissional
  const { data: agendamentos } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, status, customer_name, customer_phone, service_id")
    .eq("company_id", company.id)
    .eq("provider_id", provider.id)
    .in("status", ["aguardando_aprovacao", "confirmado"])
    .order("scheduled_at", { ascending: true });

  if (!agendamentos || agendamentos.length === 0) {
    await sendTextMessage({
      to: customerPhone,
      message: nomeProfissional + " não tem agendamentos ativos no momento.",
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token
    });
    return;
  }

  const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const nomesServicos = {};
  (servs || []).forEach((s) => { nomesServicos[s.id] = s.name; });

  const lista = agendamentos.map((a, i) => {
    const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR");
    const hora = new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const serv = nomesServicos[a.service_id] || "?";
    const cliente = a.customer_name || a.customer_phone;
    return (i + 1) + ") " + serv + " — " + cliente + " em " + data + " às " + hora;
  }).join("\n");

  const msg = "📋 *AGENDAMENTOS DE " + provider.name.toUpperCase() + "*\n\n" +
    lista + "\n\n" +
    "Qual deseja cancelar? Responda com o número (ex: 1) ou TODOS para cancelar todos.";

  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  // Salva estado de cancelamento admin no banco
  const { data: adminLead } = await supabase
    .from("tp_admins")
    .select("id")
    .eq("company_id", company.id)
    .eq("phone", customerPhone)
    .single();

  await supabase.from("tp_conversation_state").upsert({
    company_id: company.id,
    customer_phone: customerPhone,
    step: "admin_cancelar",
    context: JSON.stringify({
      providerId: provider.id,
      providerName: provider.name,
      agendamentos: agendamentos.map((a, i) => ({
        indice: i,
        id: a.id,
        service: nomesServicos[a.service_id],
        customerPhone: a.customer_phone,
        customerName: a.customer_name,
        data: new Date(a.scheduled_at).toLocaleDateString("pt-BR"),
        hora: new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      }))
    })
  });
}

export async function processarCancelamentoAdmin({ company, customerPhone, customerMessage }) {
  // Busca estado
  const { data: estadoRow } = await supabase
    .from("tp_conversation_state")
    .select("context")
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone)
    .single();

  if (!estadoRow) return false;

  const { providerId, providerName, agendamentos } = JSON.parse(estadoRow.context);
  const msgUpper = customerMessage.trim().toUpperCase();

  let agendamentosParaCancelar = [];
  if (msgUpper === "TODOS") {
    agendamentosParaCancelar = agendamentos;
  } else {
    const num = parseInt(customerMessage.trim(), 10);
    if (isNaN(num) || num < 1 || num > agendamentos.length) {
      await sendTextMessage({
        to: customerPhone,
        message: "Número inválido. Responda com um número entre 1 e " + agendamentos.length + " ou TODOS.",
        phoneNumberId: company.phone_number_id,
        whatsappToken: company.whatsapp_token
      });
      return true;
    }
    agendamentosParaCancelar = [agendamentos[num - 1]];
  }

  // Cancela no banco
  const ids = agendamentosParaCancelar.map((a) => a.id);
  await supabase.from("tp_appointments").update({ status: "cancelado" }).in("id", ids);

  // Avisa cada cliente e a profissional
  for (const ag of agendamentosParaCancelar) {
    // Avisa o cliente
    if (ag.customerPhone) {
      await sendTextMessage({
        to: ag.customerPhone,
        message: "Olá" + (ag.customerName ? " " + ag.customerName : "") + "! Infelizmente seu agendamento de " + ag.service + " com " + providerName + " em " + ag.data + " às " + ag.hora + " foi cancelado pelo salão. Entre em contato para remarcar. 💙",
        phoneNumberId: company.phone_number_id,
        whatsappToken: company.whatsapp_token
      });
    }

    // Avisa a profissional
    const { data: providerData } = await supabase
      .from("tp_providers")
      .select("phone")
      .eq("id", providerId)
      .single();

    if (providerData?.phone) {
      await sendTextMessage({
        to: providerData.phone,
        message: "Olá " + providerName + "! O agendamento de " + ag.service + " com " + (ag.customerName || ag.customerPhone) + " em " + ag.data + " às " + ag.hora + " foi cancelado pela gerência.",
        phoneNumberId: company.phone_number_id,
        whatsappToken: company.whatsapp_token
      });
    }
  }

  // Confirma para o admin
  await sendTextMessage({
    to: customerPhone,
    message: "✅ " + agendamentosParaCancelar.length + " agendamento(s) de " + providerName + " cancelado(s) com sucesso. Cliente e profissional foram avisados.",
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token
  });

  // Limpa estado
  await supabase.from("tp_conversation_state").delete()
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone);

  return true;
}

export async function enviarRelatorioAdmin({ company, customerPhone, adminName }) {
  const { data: todos } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, status, customer_phone, customer_name, service_id, provider_id")
    .eq("company_id", company.id)
    .order("scheduled_at", { ascending: true });

  if (!todos || todos.length === 0) {
    await sendTextMessage({ to: customerPhone, message: "Nenhum agendamento encontrado.", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const servIds = [...new Set(todos.map((a) => a.service_id))];
  const provIds = [...new Set(todos.map((a) => a.provider_id))];
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);
  const nomesServicos = {};
  const nomesProviders = {};
  (servs || []).forEach((s) => { nomesServicos[s.id] = s.name; });
  (provs || []).forEach((p) => { nomesProviders[p.id] = p.name; });

  const ativos = todos.filter((a) => a.status === "aguardando_aprovacao" || a.status === "confirmado");
  const cancelados = todos.filter((a) => a.status === "cancelado");

  const porData = {};
  ativos.forEach((a) => {
    const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    if (!porData[data]) porData[data] = {};
    const prov = nomesProviders[a.provider_id] || "?";
    if (!porData[data][prov]) porData[data][prov] = [];
    porData[data][prov].push(a);
  });

  let relatorio = "📋 *AGENDA ESPAÇO CHANELL*\n";
  relatorio += "Olá, " + adminName + "!\n";
  relatorio += "─────────────────────\n\n";

  if (Object.keys(porData).length === 0) {
    relatorio += "Nenhum agendamento ativo no momento.\n\n";
  } else {
    for (const data of Object.keys(porData)) {
      relatorio += "📅 *" + data.toUpperCase() + "*\n";
      for (const prov of Object.keys(porData[data])) {
        relatorio += "  💅 " + prov + "\n";
        for (const a of porData[data][prov]) {
          const hora = new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          const serv = nomesServicos[a.service_id] || "?";
          const cliente = a.customer_name || a.customer_phone;
          const status = a.status === "confirmado" ? "✅" : "⏳";
          relatorio += "    " + status + " " + hora + " — " + cliente + " (" + serv + ")\n";
        }
      }
      relatorio += "\n";
    }
  }

  relatorio += "─────────────────────\n";
  relatorio += "📊 *RESUMO*\n";
  const aguardando = ativos.filter((a) => a.status === "aguardando_aprovacao");
  const confirmados = ativos.filter((a) => a.status === "confirmado");
  relatorio += "⏳ Aguardando: " + aguardando.length + "\n";
  relatorio += "✅ Confirmados: " + confirmados.length + "\n";
  relatorio += "❌ Cancelados: " + cancelados.length + "\n";
  relatorio += "Total geral: " + todos.length;

  await sendTextMessage({ to: customerPhone, message: relatorio, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}