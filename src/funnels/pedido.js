// =====================================================================
// pedido.js
// O molde de funil para qualquer negócio que VENDE PRODUTO PRONTO,
// com carrinho e entrega/retirada (pizzaria, hamburgueria,
// distribuidora, e qualquer cliente futuro do mesmo tipo).
//
// Este arquivo ainda é um ESQUELETO — a lógica completa de pedido
// (cardápio -> carrinho -> endereço -> pagamento -> confirmação)
// será construída com calma quando chegarmos nesse cliente.
// =====================================================================

/**
 * Ponto de entrada chamado pelo orchestrator sempre que uma empresa
 * com business_type = "pedido" recebe uma mensagem.
 *
 * @param {object} params
 * @param {object} params.company - dados da empresa (vindo de companies.js)
 * @param {object} params.incomingMessage - a mensagem recebida do WhatsApp
 */
export async function handleMessage({ company, incomingMessage }) {
  // TODO: construir o fluxo completo de pedido aqui:
  //   1. identificar em que ponto da conversa o cliente está
  //   2. se ainda não viu o cardápio -> mostrar produtos disponíveis
  //   3. se já está montando carrinho -> adicionar itens, calcular total
  //   4. se carrinho fechado -> perguntar entrega/retirada e endereço
  //   5. se endereço definido -> processar pagamento (Mercado Pago)
  //   6. se pago -> confirmar pedido e avisar a cozinha/loja

  console.log(
    `[pedido] Mensagem recebida para empresa "${company.name}": `,
    incomingMessage.text
  );

  // Por enquanto, sem lógica real implementada.
  return;
}