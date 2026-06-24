// =====================================================================
// lembrete.js
// Módulo de lembrete 24h — envia mensagem automática para clientes
// com agendamento confirmado no dia seguinte.
// Disparado via N8N todo dia às 18h através do endpoint /lembrete
// =====================================================================

import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

export async function enviarLembretes() {
  console.log("⏰ Módulo Lembrete 24h iniciado...");

  // Calcula o intervalo de amanhã (00:00 até 23:59)
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  amanha.setHours(0, 0, 0, 0);

  const fimAmanha = new Date(amanha);
  fimAmanha.setHours(23, 59, 59, 999);

  // Busca agendamentos confirmados de amanhã
  const { data: agendamentos, error } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, customer_phone, customer_name, service_id, provider_id, company_id")
    .eq("status", "confirmado")
    .gte("scheduled_at", amanha.toISOString())
    .lte("scheduled_at", fimAmanha.toISOString());

  if (error) {
    console.error("Erro ao buscar agendamentos:", error.message);
    return { sucesso: false, erro: error.message };
  }

  if (!agendamentos || agendamentos.length === 0) {
    console.log("✅ Nenhum agendamento confirmado para amanhã.");
    return { sucesso: true, enviados: 0 };
  }

  console.log("📋 Agendamentos encontrados:", agendamentos.length);

  // Busca dados das empresas, serviços e profissionais
  const companyIds = [...new Set(agendamentos.map((a) => a.company_id))];
  const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
  const provIds = [...new Set(agendamentos.map((a) => a.provider_id))];

  const { data: companies } = await supabase.from("tp_companies").select("id, phone_number_id, whatsapp_token, name").in("id", companyIds);
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);

  const mapaEmpresas = {};
  const mapaServicos = {};
  const mapaProviders = {};
  (companies || []).forEach((c) => { mapaEmpresas[c.id] = c; });
  (servs || []).forEach((s) => { mapaServicos[s.id] = s.name; });
  (provs || []).forEach((p) => { mapaProviders[p.id] = p.name; });

  let enviados = 0;
  let erros = 0;

  for (const agendamento of agendamentos) {
    try {
      const empresa = mapaEmpresas[agendamento.company_id];
      if (!empresa) continue;

      const nomeCliente = agendamento.customer_name || "cliente";
      const nomeServico = mapaServicos[agendamento.service_id] || "serviço";
      const nomeProfissional = mapaProviders[agendamento.provider_id] || "profissional";
      const hora = new Date(agendamento.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      const mensagem = `Oi ${nomeCliente}! 😊 Lembrando que você tem horário amanhã às ${hora} com ${nomeProfissional} no Espaço Channel.\n\nSe precisar cancelar ou remarcar, é só me avisar aqui. Até amanhã! 💇‍♀️`;

      await sendTextMessage({
        to: agendamento.customer_phone,
        message: mensagem,
        phoneNumberId: empresa.phone_number_id,
        whatsappToken: empresa.whatsapp_token,
      });

      console.log("✅ Lembrete enviado para:", agendamento.customer_phone);
      enviados++;
    } catch (err) {
      console.error("❌ Erro ao enviar lembrete para:", agendamento.customer_phone, err.message);
      erros++;
    }
  }

  console.log("⏰ Lembretes concluídos — Enviados:", enviados, "| Erros:", erros);
  return { sucesso: true, enviados, erros };
}
