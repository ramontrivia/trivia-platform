// =====================================================================
// orcamento.js
// O molde de funil para qualquer negócio que VENDE ALGO SOB MEDIDA,
// com aprovação de preço antes de fechar (marcenaria, depósito,
// e qualquer cliente futuro do mesmo tipo).
//
// Este arquivo ainda é um ESQUELETO — a lógica completa de orçamento
// (entender necessidade -> calcular -> aprovar -> virar venda)
// será construída com calma quando chegarmos nesse cliente.
// =====================================================================

/**
 * Ponto de entrada chamado pelo orchestrator sempre que uma empresa
 * com business_type = "orcamento" recebe uma mensagem.
 *
 * @param {object} params
 * @param {object} params.company - dados da empresa (vindo de companies.js)
 * @param {object} params.incomingMessage - a mensagem recebida do WhatsApp
 */
export async function handleMessage({ company, incomingMessage }) {
  // TODO: construir o fluxo completo de orçamento aqui:
  //   1. identificar em que ponto da conversa o cliente está
  //   2. se ainda não descreveu a necessidade -> perguntar detalhes
  //   3. se já descreveu -> calcular ou encaminhar para cálculo humano
  //   4. se orçamento pronto -> enviar e aguardar aprovação
  //   5. se aprovado -> virar venda e avisar a equipe responsável

  console.log(
    `[orcamento] Mensagem recebida para empresa "${company.name}": `,
    incomingMessage.text
  );

  // Por enquanto, sem lógica real implementada.
  return;
}