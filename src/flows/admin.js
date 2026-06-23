// =====================================================================
// admin.js
// Painel administrativo via WhatsApp.
// Quando um admin manda "ADM", recebe um relatório completo do salão.
// =====================================================================

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
  const hoje = new Date();
  const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();
  const fimHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate(), 23, 59, 59).toISOString();

  // Busca todos os agendamentos
  const { data: todos } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, status, customer_phone, customer_name, service_id, provider_id")
    .eq("company_id", company.id)
    .order("scheduled_at", { ascending: true });

  if (!todos || todos.length === 0) {
    await sendTextMessage({ to: customerPhone, message: "Nenhum agendamento encontrado.", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  // Busca nomes de serviços e profissionais
  const servIds = [...new Set(todos.map((a) => a.service_id))];
  const provIds = [...new Set(todos.map((a) => a.provider_id))];
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);
  const nomesServicos = {};
  const nomesProviders = {};
  (servs || []).forEach((s) => { nomesServicos[s.id] = s.name; });
  (provs || []).forEach((p) => { nomesProviders[p.id] = p.name; });

  // Separa por status
  const aguardando = todos.filter((a) =>