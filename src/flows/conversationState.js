// =====================================================================
// conversationState.js
// O "post-it" da conversa: guarda em que ponto do fluxo o cliente
// está, para que a próxima mensagem dele seja interpretada
// corretamente (ex: como a escolha de profissional/horário, em vez
// de uma nova pergunta).
// =====================================================================

import { supabase } from "../services/supabase.js";

/**
 * Busca o estado atual da conversa de um cliente com uma empresa.
 * Retorna null se não houver nenhum estado salvo (conversa "nova").
 */
export async function getConversationState({ companyId, customerPhone }) {
  const { data } = await supabase
    .from("tp_conversation_state")
    .select("*")
    .eq("company_id", companyId)
    .eq("customer_phone", customerPhone)
    .single();

  return data || null;
}

/**
 * Salva (cria ou atualiza) o estado da conversa.
 *
 * @param {object} params
 * @param {number} params.companyId
 * @param {string} params.customerPhone
 * @param {string} params.step - identificador da etapa atual
 * @param {object} [params.context] - dados extras daquele momento
 */
export async function setConversationState({ companyId, customerPhone, step, context = {} }) {
  const { error } = await supabase
    .from("tp_conversation_state")
    .upsert({
      company_id: companyId,
      customer_phone: customerPhone,
      step,
      context,
      updated_at: new Date().toISOString(),
    }, { onConflict: "company_id,customer_phone" });

  if (error) {
    console.error("Erro ao salvar estado da conversa:", error.message);
  }
}

/**
 * Limpa o estado da conversa (chamado quando um fluxo termina,
 * por exemplo após o agendamento ser criado com sucesso).
 */
export async function clearConversationState({ companyId, customerPhone }) {
  await supabase
    .from("tp_conversation_state")
    .delete()
    .eq("company_id", companyId)
    .eq("customer_phone", customerPhone);
}