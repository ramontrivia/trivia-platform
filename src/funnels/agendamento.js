// =====================================================================
// agendamento.js
// O molde de funil para qualquer negócio que VENDE TEMPO MARCADO
// (salão, clínica, dentista, barbearia, e qualquer cliente futuro
// do mesmo tipo).
//
// Este arquivo ainda é um ESQUELETO — a lógica completa de agendar
// (escolher serviço -> prestador -> horário -> confirmar -> avisar)
// será construída com calma, passo a passo, nas próximas etapas.
// =====================================================================

/**
 * Ponto de entrada chamado pelo orchestrator sempre que uma empresa
 * com business_type = "agendamento" recebe uma mensagem.
 *
 * @param {object} params
 * @param {object} params.company - dados da empresa (vindo de companies.js)
 * @param {object} params.incomingMessage - a mensagem recebida do WhatsApp
 */
export async function handleMessage({ company, incomingMessage }) {
  // TODO: construir o fluxo completo de agendamento aqui:
  //   1. identificar em que ponto da conversa o cliente está
  //   2. se ainda não escolheu serviço -> mostrar serviços disponíveis
  //   3. se já escolheu serviço -> mostrar prestadores que fazem aquele serviço
  //   4. se já escolheu prestador -> mostrar horários livres
  //   5. se já escolheu horário -> confirmar e avisar prestador + recepção

  console.log(
    `[agendamento] Mensagem recebida para empresa "${company.name}": `,
    incomingMessage.text
  );

  // Por enquanto, sem lógica real implementada.
  return;
}