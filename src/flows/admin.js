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

  // Separa apenas ativos (aguardando + confirmados)
  const ativos = todos.filter((a) => a.status === "aguardando_aprovacao" || a.status === "confirmado");
  const cancelados = todos.filter((a) => a.status === "cancelado");

  // Agrupa ativos por data
  const porData = {};
  ativos.forEach((a) => {
    const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    if (!porData[data]) porData[data] = {};
    const prov = nomesProviders[a.provider_id] || "?";
    if (!porData[data][prov]) porData[data][prov] = [];
    porData[data][prov].push(a);
  });

  let relatorio = "📋 *AGENDA ESPAÇO CHANNEL*\n";
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