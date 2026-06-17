// =====================================================================
// escalonamento.js
// Verifica se um agendamento foi confirmado dentro do prazo (5 min).
// Se não foi, notifica a gerência (Natália, Fernanda) e a secretária
// (Vitória), para que alguma delas resolva manualmente com a
// prestadora.
//
// Este arquivo expõe uma função simples que pode ser chamada de duas
// formas:
//   1) pelo N8n, via uma chamada HTTP, 5 minutos após a criação
//   2) futuramente, por um agendador interno, se preferirmos trazer
//      essa responsabilidade para dentro do próprio código
// =====================================================================

import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

/**
 * Verifica um agendamento específico. Se ainda estiver
 * "aguardando_aprovacao" depois do prazo, notifica a gerência.
 *
 * @param {object} params
 * @param {number} params.appointmentId
 */
export async function verificarConfirmacao({ appointmentId }) {
  const { data: appointment, error } = await supabase
    .from("tp_appointments")
    .select("*, tp_providers(name), tp_services(name)")
    .eq("id", appointmentId)
    .single();

  if (error || !appointment) {
    console.error("Erro ao buscar agendamento para escalonamento:", error?.message);
    return;
  }

  // Se já foi confirmado (ou qualquer outro status), não há nada a fazer.
  if (appointment.status !== "aguardando_aprovacao") {
    return;
  }

  const { data: company } = await supabase
    .from("tp_companies")
    .select("*")
    .eq("id", appointment.company_id)
    .single();

  if (!company) return;

  // TODO: quando os telefones reais da gerência e secretária forem
  // definidos (após a reunião com a Natália), virão de uma tabela de
  // contatos administrativos. Por enquanto, usamos valores provisórios.
  const contatosGerencia = [
    { nome: "Natália", telefone: "telefone_provisorio_natalia" },
    { nome: "Fernanda", telefone: "telefone_provisorio_fernanda" },
    { nome: "Vitória", telefone: "telefone_provisorio_vitoria" },
  ];

  const nomeProfissional = appointment.tp_providers?.name || "a profissional";
  const nomeServico = appointment.tp_services?.name || "o serviço";

  for (const contato of contatosGerencia) {
    await sendTextMessage({
      to: contato.telefone,
      message: `Atenção: ${nomeProfissional} ainda não confirmou o agendamento de ${nomeServico} com o cliente ${appointment.customer_phone}. Pode confirmar ou cobrar diretamente, por favor.`,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
  }
}