// =====================================================================
// agendamento.js
// Funil para negócios que VENDEM TEMPO MARCADO.
// Integra knowledge do cliente, fase do lead (frio/morno/quente)
// e fluxo completo de agendamento.
// =====================================================================

import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { loadKnowledge, loadKnowledgePhase } from "../services/knowledge.js";
import { identificarServico } from "../flows/identificarIntencao.js";
import { buscarDisponibilidade } from "../flows/buscarDisponibilidade.js";
import { criarAgendamento } from "../flows/criarAgendamento.js";
import {
  getConversationState,
  setConversationState,
  clearConversationState,
} from "../flows/conversationState.js";
import {
  getOrCreateLead,
  advanceStage,
  getPostureForStage,
} from "../crm/crmService.js";

const STEP_AGUARDANDO_ESCOLHA = "agendamento_aguardando_escolha";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;

  // 1. Busca ou cria o lead no CRM
  const lead = await getOrCreateLead({
    companyId: company.id,
    customerPhone,
  });

  // 2. Carrega knowledge base e fase do lead
  const knowledge = loadKnowledge(company.client_key);
  const phase = lead?.stage || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);
  const posture = getPostureForStage(phase);

  // 3. Monta o system prompt completo
  const systemPrompt = [knowledge, phaseKnowledge]
    .filter(Boolean)
    .join("\n\n");

  // 4. Verifica se há estado de conversa em andamento
  const estado = await getConversationState({
    companyId: company.id,
    customerPhone,
  });

  if (estado && estado.step === STEP_AGUARDANDO_ESCOLHA) {
    await processarEscolha({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }

  // 5. Tenta identificar serviço na mensagem
  const identificacao = await identificarServico({
    companyId: company.id,
    customerMessage,
  });

  // 6. Se não identificou serviço — responde com a personalidade da Ana
  // respeitando a fase do lead (frio = acolher, morno = engajar, quente = converter)
  if (!identificacao) {
    await responderComIA({
      company,
      customerPhone,
      customerMessage,
      systemPrompt,
      lead,
      posture,
    });
    return;
  }

  const { service, hasProvider } = identificacao;

  // 7. Serviço de parceiro — direciona pro administrativo
  if (!hasProvider) {
    await sendTextMessage({
      to: customerPhone,
      message: `Esse serviço é realizado por um profissional parceiro especial! Para agendar, fala diretamente com nossa equipe: telefone_provisorio_administrativo`,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
    return;
  }

  // 8. Lead demonstrou intenção de agendar — avança a fase
  if (phase === "frio") {
    await advanceStage({ companyId: company.id, customerPhone });
  }

  // 9. Busca disponibilidade
  const disponibilidade = await buscarDisponibilidade({
    serviceId: service.id,
    companyId: company.id,
  });

  if (disponibilidade.length === 0) {
    await responderComIA({
      company,
      customerPhone,
      customerMessage: `O cliente perguntou sobre ${service.name} mas não há horários disponíveis nos próximos dias. Responda de forma acolhedora e pergunte se ele tem uma data específica em mente.`,
      systemPrompt,
      lead,
      posture,
    });
    return;
  }

  // 10. Monta as opções de forma natural via IA
  const resumoOpcoes = disponibilidade
    .map(({ provider, slots }) => {
      const horarios = slots
        .slice(0, 3)
        .map((s) =>
          s.toLocaleString("pt-BR", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        )
        .join(", ");
      return `${provider.name}: ${horarios}`;
    })
    .join("\n");

  const promptOpcoes = `
O cliente quer agendar: ${service.name}.
Apresente as seguintes opções de profissional e horário de forma natural e acolhedora,
sem usar listas com traços ou asteriscos, sem markdown:
${resumoOpcoes}
Pergunte com quem e em qual horário ele prefere.
`.trim();

  const mensagemOpcoes = await generateResponse({
    systemPrompt,
    conversationHistory: [{ role: "user", content: promptOpcoes }],
  });

  await sendTextMessage({
    to: customerPhone,
    message: mensagemOpcoes,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token,
  });

  // 11. Salva o estado da conversa
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

// =====================================================================
// Processa a escolha do cliente (profissional + horário)
// =====================================================================
async function processarEscolha({ company, customerPhone, customerMessage, estado, systemPrompt }) {
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
    const esclarecimento = await generateResponse({
      systemPrompt,
      conversationHistory: [
        {
          role: "user",
          content: `O cliente disse "${customerMessage}" mas não ficou claro qual profissional e horário ele escolheu. Peça gentilmente que ele confirme a escolha.`,
        },
      ],
    });
    await sendTextMessage({
      to: customerPhone,
      message: esclarecimento,
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
      message: "Não consegui identificar a escolha. Pode me confirmar com qual profissional e em qual horário você quer?",
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

  // Avança lead pra quente ao confirmar agendamento
  await advanceStage({ companyId: company.id, customerPhone });

  const confirmacao = await generateResponse({
    systemPrompt,
    conversationHistory: [
      {
        role: "user",
        content: `O cliente acabou de confirmar agendamento de ${serviceName} com ${opcaoEscolhida.providerName}. Confirme o horário de forma calorosa, informe que está aguardando confirmação da profissional e que avisará assim que confirmado.`,
      },
    ],
  });

  await sendTextMessage({
    to: customerPhone,
    message: confirmacao,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token,
  });

  await clearConversationState({ companyId: company.id, customerPhone });
}

// =====================================================================
// Fallback: responde com a personalidade da Ana + fase do lead
// =====================================================================
async function responderComIA({ company, customerPhone, customerMessage, systemPrompt, lead, posture }) {
  const resposta = await generateResponse({
    systemPrompt,
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