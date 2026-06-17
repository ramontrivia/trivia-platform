// =====================================================================
// criarAgendamento.js
// Cria o agendamento no banco (status aguardando_aprovacao) e
// notifica a prestadora escolhida, dando início ao prazo de 5 minutos
// para confirmação.
// =====================================================================

import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

/**
 * Cria um novo agendamento e notifica a prestadora.
 *
 * @param {object} params
 * @param {object} params.company - dados da empresa (precisa de phone_number_id, whatsapp_token)
 * @param {object} params.provider - prestadora escolhida
 * @param {object} params.service - serviço escolhido
 * @param {Date}   params.scheduledAt - data e hora escolhidas
 * @param {string} params.customerPhone
 * @param {string} [params.customerName]
 * @returns {object} o agendamento criado
 */
export async function criarAgendamento({
  company,
  provider,
  service,
  scheduledAt,
  customerPhone,
  customerName,
}) {
  const { data: appointment, error } = await supabase
    .from("tp_appointments")
    .insert({
      company_id: company.id,
      provider_id: provider.id,
      service_id: service.id,
      customer_phone: customerPhone,
      customer_name: customerName || null,
      scheduled_at: scheduledAt.toISOString(),
      status: "aguardando_aprovacao",
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar agendamento:", error.message);
    return null;
  }

  // Notifica a prestadora, pedindo confirmação
  if (provider.phone) {
    const dataFormatada = scheduledAt.toLocaleDateString("pt-BR");
    const horaFormatada = scheduledAt.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    await sendTextMessage({
      to: provider.phone,
      message: `Oi ${provider.name}! Novo agendamento: ${service.name} no dia ${dataFormatada} às ${horaFormatada}, com ${customerName || "cliente"}. Responde OK pra confirmar, você tem 5 minutinhos.`,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
  }

  return appointment;
}