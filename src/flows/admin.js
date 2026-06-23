import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

export async function isAdmin({ companyId, customerPhone }) {
  const { data } = await supabase
    .from("tp_admins")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("phone", customerPhone)
    .single();
  return data || null;
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

  const aguardando = todos.filter((a) => a.status === "aguardando_aprovacao");
  const confirmados = todos.filter((a) => a.status === "confirmado");
  const cancelados = todos.filter((a) => a.status === "cancelado");

  const formatar = (a) => {
    const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR");
    const hora = new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const serv = nomesServicos[a.service_id] || "?";
    const prov = nomesProviders[a.provider_id] || "?";
    const cliente = a.customer_name || a.customer_phone;
    return "• " + cliente + " — " + serv + " c/ " + prov + " em " + data + " às " + hora;
  };

  let relatorio = "📋 *PAINEL ESPAÇO CHANNEL*\nOlá, " + adminName + "!\n\n";

  relatorio += "⏳ *AGUARDANDO CONFIRMAÇÃO (" + aguardando.length + ")*\n";
  relatorio += aguardando.length > 0 ? aguardando.map(formatar).join("\n") : "Nenhum.";
  relatorio += "\n\n";

  relatorio += "✅ *CONFIRMADOS (" + confirmados.length + ")*\n";
  relatorio += confirmados.length > 0 ? confirmados.map(formatar).join("\n") : "Nenhum.";
  relatorio += "\n\n";

  relatorio += "❌ *CANCELADOS (" + cancelados.length + ")*\n";
  relatorio += cancelados.length > 0 ? cancelados.map(formatar).join("\n") : "Nenhum.";
  relatorio += "\n\n";

  relatorio += "📊 *RESUMO*\n";
  relatorio += "Total: " + todos.length + " agendamentos\n";
  relatorio += "Aguardando: " + aguardando.length + " | Confirmados: " + confirmados.length + " | Cancelados: " + cancelados.length;

  await sendTextMessage({ to: customerPhone, message: relatorio, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}