// =====================================================================
// agendamento.js
// O molde de funil para qualquer negócio que VENDE TEMPO MARCADO
// (salão, clínica, dentista, barbearia, e qualquer cliente futuro
// do mesmo tipo).
//
// Ciclo completo:
//   1. identifica o serviço pedido
//   2. busca disponibilidade e oferece opções
//   3. guarda o estado da conversa (aguardando escolha do cliente)
//   4. quando o cliente responde escolhendo, cria o agendamento
//   5. limpa o estado da conversa
// =====================================================================

import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { identificarServico } from "../flows/identificarIntencao.js";
import { buscarDisponibilidade } from "../flows/buscarDisponibilidade.js";
import { criarAgendamento } from "../flows/criarAgendamento.js";
import {
  getConversationState,
  setConversationState,
  clearConversationState,
} from "../flows/conversationState.js";

const STEP_AGUARDANDO_ESCOLHA = "agendamento_aguardando_escolha";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;

  const estado = await getConversationState({
    companyId: company.id,
    customerPhone,
  });

  if (estado && estado.step === STEP_AGUARDANDO_ESCOLHA) {
    await processarEscolha({ company, customerPhone, customerMessage, estado });
    return;
  }

  const identificacao = await identificarServico({
    companyId: company.id,
    customerMessage,
  });

  if (!identificacao) {
    await responderComIA({ company, customerPhone, customerMessage });
    return;
  }

  const { service, hasProvider } = identificacao;

  if (!hasProvider) {
    await sendTextMessage({
      to: customerPhone,
      message: `Esse serviço a gente cuida com um time parceiro! Vou te passar pro nosso contato administrativo, eles te atendem certinho por aqui: telefone_provisorio_administrativo`,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
    return;
  }

  const disponibilidade = await buscarDisponibilidade({
    serviceId: service.id,
    companyId: company.id,
  });

  if (disponibilidade.length === 0) {
    await sendTextMessage({
      to: customerPhone,
      message: `Hmm, não encontrei horário livre pra ${service.name} nos próximos dias. Quer que eu veja uma data específica?`,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
    return;
  }

  const resumoOpcoes = disponibilidade
    .map(({ provider, slots }) => {
      const horarios = slots
        .slice(0, 3)
        .map((s) => s.toLocaleString("pt-BR", { weekday: "short", hour: "2-digit", minute: "2-digit" }))
        .join(", ");
      return `${provider.name}: ${horarios}`;
    })
    .join(" | ");

  await sendTextMessage({
    to: customerPhone,
    message: `Pra ${service.name}, tenho essas opções: ${resumoOpcoes}. Quem você prefere e qual horário fica melhor?`,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token,
  });

  await setConversationState({
    companyId: company.id,
    customerPhone,
    step: STEP_AGUARDANDO_ESCOLHA,
    context: {
      serviceId: service.id,
      serviceName: service.name,
      opcoes: disponibilidade.map(({ provider, slots }) => ({
        providerId: provider.id,
        providerName: provider.name,
        slots: slots.map((s) => s.toISOString()),
      })),
    },
  });
}

async function processarEscolha({ company, customerPhone, customerMessage, estado }) {
  const { opcoes, serviceId, serviceName } = estado.context;

  const listaOpcoes = opcoes
    .map((o, i) => `${i}: ${o.providerName} - horários: ${o.slots.join(", ")}`)
    .join("\n");

  const prompt = `
O cliente recebeu estas opções de profissional e horário:
${listaOpcoes}

Mensagem do cliente: "${customerMessage}"

Identifique o índice da opção de profissional escolhida e qual
horário (no formato ISO) ele escolheu. Responda EXATAMENTE neste
formato, sem mais nada: indice|horarioISO
Se não conseguir identificar com clareza, responda: nenhum
`.trim();

  const resposta = await generateResponse({
    systemPrompt: "Você é um classificador preciso. Responda apenas o que foi pedido.",
    conversationHistory: [{ role: "user", content: prompt }],
  });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    await sendTextMessage({
      to: customerPhone,
      message: "Não consegui entender bem — pode me confirmar qual profissional e qual horário você prefere?",
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
    return;
  }

  const [indiceStr, horarioISO] = resposta.trim().split("|");
  const opcaoEscolhida = opcoes[parseInt(indiceStr, 10)];

  if (!opcaoEscolhida || !horarioISO) {
    await sendTextMessage({
      to: customerPhone,
      message: "Não consegui entender bem — pode me confirmar qual profissional e qual horário você prefere?",
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
    return;
  }

  await criarAgendamento({
    company,
    provider: { id: opcaoEscolhida.providerId, name: opcaoEscolhida.providerName, phone: null },
    service: { id: serviceId, name: serviceName },
    scheduledAt: new Date(horarioISO),
    customerPhone,
  });

  await sendTextMessage({
    to: customerPhone,
    message: `Perfeito! Reservei seu horário com ${opcaoEscolhida.providerName}. Só estou confirmando com ela, te aviso assim que confirmar, tá?`,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token,
  });

  await clearConversationState({ companyId: company.id, customerPhone });
}

async function responderComIA({ company, customerPhone, customerMessage }) {
  const resposta = await generateResponse({
    systemPrompt: "Você é a Ana, atendente do Espaço Channel, um salão de beleza requintado. Responda de forma humana e calorosa.",
    conversationHistory: [{ role: "user", content: customerMessage }],
  });

  if (resposta) {
    await sendTextMessage({
      to: customerPhone,
      message: resposta,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
  }
}
