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
