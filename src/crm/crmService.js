// =====================================================================
// orchestrator.js
// O MAESTRO da plataforma TRIVIA.
//
// Função: receber uma mensagem que chegou do WhatsApp, descobrir de qual
// empresa e de qual tipo de negócio ela é, e encaminhar para o funil certo.
//
// Este arquivo é FIXO — igual para todos os clientes. Ele nunca contém
// regra específica de um cliente (isso mora em knowledge/ e nos funnels).
// =====================================================================
import { getCompanyByPhoneNumberId } from "../services/companies.js";
import { registerInteraction } from "../crm/crmService.js";

import * as AgendamentoFunnel from "../funnels/agendamento.js";
import * as PedidoFunnel from "../funnels/pedido.js";
import * as OrcamentoFunnel from "../funnels/orcamento.js";
import * as InformacaoFunnel from "../funnels/informacao.js";

const FUNNEL_BY_BUSINESS_TYPE = {
  agendamento: AgendamentoFunnel,
  pedido: PedidoFunnel,
  orcamento: OrcamentoFunnel,
  informacao: InformacaoFunnel,
};

export async function handleIncomingMessage(incomingMessage, phoneNumberId) {
  // 1. Descobrir de qual empresa é essa mensagem
  const company = await getCompanyByPhoneNumberId(phoneNumberId);
  if (!company) {
    console.error(`Nenhuma empresa encontrada para phoneNumberId: ${phoneNumberId}`);
    return;
  }

  // 2. Registrar a interação no CRM (isso vale para qualquer tipo de negócio)
  await registerInteraction({
    companyId: company.id,
    customerPhone: incomingMessage.from,
    rawMessage: incomingMessage.text,
  });

  // 3. Descobrir qual "molde" de funil essa empresa usa
  const funnel = FUNNEL_BY_BUSINESS_TYPE[company.business_type];
  if (!funnel) {
    console.error(
      `business_type "${company.business_type}" não tem funil correspondente. ` +
      `Empresa: ${company.name}`
    );
    return;
  }

  // 4. Encaminhar a conversa para o funil certo.
  await funnel.handleMessage({
    company,
    incomingMessage,
  });
}
