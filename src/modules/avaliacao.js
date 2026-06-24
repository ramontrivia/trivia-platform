// =====================================================================
// avaliacao.js
// Módulo de avaliação pós-atendimento.
// Disparado via N8N a cada hora.
// Envia pedido de avaliação 2h após o horário do agendamento.
// =====================================================================

import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

export async function enviarPedidosAvaliacao() {
  console.log("⭐ Módulo Avaliação iniciado...");

  const agora = new Date();
  const duasHorasAtras = new Date(agora.getTime() - 2 * 60 * 60 * 1000);
  const tresHorasAtras = new Date(agora.getTime() - 3 * 60 * 60 * 1000);

  const { data: agendamentos, error } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, customer_phone, customer_name, service_id, provider_id, company_id, avaliacao")
    .eq("status", "confirmado")
    .is("avaliacao", null)
    .gte("scheduled_at", tresHorasAtras.toISOString())
    .lte("scheduled_at", duasHorasAtras.toISOString());

  if (error) {
    console.error("Erro ao buscar agendamentos:", error.message);
    return { sucesso: false, erro: error.message };
  }

  if (!agendamentos || agendamentos.length === 0) {
    console.log("✅ Nenhum agendamento para avaliar agora.");
    return { sucesso: true, enviados: 0 };
  }

  const companyIds = [...new Set(agendamentos.map((a) => a.company_id))];
  const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
  const provIds = [...new Set(agendamentos.map((a) => a.provider_id))];

  const { data: companies } = await supabase.from("tp_companies").select("id, phone_number_id, whatsapp_token").in("id", companyIds);
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);

  const mapaEmpresas = {};
  const mapaServicos = {};
  const mapaProviders = {};
  (companies || []).forEach((c) => { mapaEmpresas[c.id] = c; });
  (servs || []).forEach((s) => { mapaServicos[s.id] = s.name; });
  (provs || []).forEach((p) => { mapaProviders[p.id] = p.name; });

  let enviados = 0;

  for (const agendamento of agendamentos) {
    try {
      const empresa = mapaEmpresas[agendamento.company_id];
      if (!empresa) continue;

      const nomeCliente = agendamento.customer_name || "cliente";
      const nomeServico = mapaServicos[agendamento.service_id] || "serviço";
      const nomeProfissional = mapaProviders[agendamento.provider_id] || "profissional";

      const mensagem = "Oi " + nomeCliente + "! 😊 Esperamos que tenha gostado do seu " + nomeServico + " com a " + nomeProfissional + " hoje!\n\nComo foi sua experiência? Me dá uma nota de 1 a 5 ⭐\n\n1 - Ruim\n2 - Regular\n3 - Bom\n4 - Ótimo\n5 - Excelente";

      await sendTextMessage({
        to: agendamento.customer_phone,
        message: mensagem,
        phoneNumberId: empresa.phone_number_id,
        whatsappToken: empresa.whatsapp_token,
      });

      await supabase
        .from("tp_appointments")
        .update({ avaliacao: 0 })
        .eq("id", agendamento.id);

      console.log("⭐ Pedido de avaliação enviado para:", agendamento.customer_phone);
      enviados++;
    } catch (err) {
      console.error("❌ Erro ao enviar avaliação:", err.message);
    }
  }

  console.log("⭐ Avaliações concluídas — Enviados:", enviados);
  return { sucesso: true, enviados };
}

export async function processarAvaliacao({ company, customerPhone, customerMessage }) {
  const nota = parseInt(customerMessage.trim(), 10);

  if (isNaN(nota) || nota < 1 || nota > 5) return false;

  const { data: agendamento } = await supabase
    .from("tp_appointments")
    .select("id, service_id, provider_id")
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone)
    .eq("avaliacao", 0)
    .order("scheduled_at", { ascending: false })
    .limit(1)
    .single();

  if (!agendamento) return false;

  await supabase
    .from("tp_appointments")
    .update({ avaliacao: nota })
    .eq("id", agendamento.id);

  const emojis = ["", "😔", "😐", "🙂", "😊", "🤩"];
  const textos = ["", "Sentimos muito!", "Obrigada pelo feedback!", "Que bom!", "Ótimo!", "Incrível!"];

  await sendTextMessage({
    to: customerPhone,
    message: "Nota " + nota + " registrada! " + emojis[nota] + " " + textos[nota] + " Obrigada pelo feedback! Até a próxima visita ao Espaço Channel. 💇‍♀️",
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token,
  });

  console.log("⭐ Avaliação registrada:", nota, "para", customerPhone);
  return true;
}