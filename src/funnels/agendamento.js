import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { loadKnowledge, loadKnowledgePhase } from "../services/knowledge.js";
import { identificarServico } from "../flows/identificarIntencao.js";
import { buscarDisponibilidade } from "../flows/buscarDisponibilidade.js";
import { criarAgendamento } from "../flows/criarAgendamento.js";
import { getConversationState, setConversationState, clearConversationState } from "../flows/conversationState.js";
import { getOrCreateLead, advanceStage, getPostureForStage } from "../crm/crmService.js";

const STEP_AGUARDANDO_ESCOLHA = "agendamento_aguardando_escolha";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;
  const lead = await getOrCreateLead({ companyId: company.id, customerPhone });
  const knowledge = loadKnowledge(company.client_key);
  const phase = lead?.stage || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);
  const systemPrompt = [knowledge, phaseKnowledge].filter(Boolean).join("\n\n");
  const estado = await getConversationState({ companyId: company.id, customerPhone });
  if (estado && estado.step === STEP_AGUARDANDO_ESCOLHA) {
    await processarEscolha({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }
  const identificacao = await identificarServico({ companyId: company.id, customerMessage });
  if (!identificacao) {
    await responderComIA({ company, customerPhone, customerMessage, systemPrompt });
    return;
  }
  const { service, hasProvider } = identificacao;
  if (!hasProvider) {
    await sendTextMessage({ to: customerPhone, message: "Esse servico e realizado por um profissional parceiro! Para agendar, fala com nossa equipe: telefone_provisorio_administrativo", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }
  if (phase === "frio") await advanceStage({ companyId: company.id, customerPhone });
  const disponibilidade = await buscarDisponibilidade({ serviceId: service.id, companyId: company.id });
  if (disponibilidade.length === 0) {
    await responderComIA({ company, customerPhone, customerMessage: `O cliente perguntou sobre ${service.name} mas nao ha horarios disponiveis. Responda de forma acolhedora e pergunte se tem data especifica.`, systemPrompt });
    return;
  }
  const resumoOpcoes = disponibilidade.map(({ provider, slots }) => {
    const horarios = slots.slice(0, 3).map((s) => s.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })).join(", ");
    return provider.name + ": " + horarios;
  }).join("\n");
  const promptOpcoes = "O cliente quer agendar: " + service.name + ". Apresente as opcoes de forma natural e acolhedora, sem markdown:\n" + resumoOpcoes + "\nPergunte com quem e em qual horario ele prefere.";
  const mensagemOpcoes = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: promptOpcoes }] });
  await sendTextMessage({ to: customerPhone, message: mensagemOpcoes, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_AGUARDANDO_ESCOLHA, context: { serviceId: service.id, serviceName: service.name, opcoes: disponibilidade.map(({ provider, slots }) => ({ providerId: provider.id, providerName: provider.name, slots: slots.map((s) => s.toISOString()) })) } });
}

async function processarEscolha({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { opcoes, serviceId, serviceName } = estado.context;
  const listaOpcoes = opcoes.map((o, i) => i + ": " + o.providerName + " - horarios: " + o.slots.join(", ")).join("\n");
  const prompt = "O cliente recebeu estas opcoes:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice da opcao escolhida e o horario ISO. Responda EXATAMENTE: indice|horarioISO\nSe nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o que foi pedido.", conversationHistory: [{ role: "user", content: prompt }] });
  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const esclarecimento = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao ficou claro a escolha. Peca gentilmente que confirme." }] });
    await sendTextMessage({ to: customerPhone, message: esclarecimento, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }
  const [indiceStr, horarioISO] = resposta.trim().split("|");
  const opcaoEscolhida = opcoes[parseInt(indiceStr, 10)];
  if (!opcaoEscolhida || !horarioISO) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar a escolha. Pode confirmar com qual profissional e em qual horario?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }
  await criarAgendamento({ company, provider: { id: opcaoEscolhida.providerId, name: opcaoEscolhida.providerName, phone: null }, service: { id: serviceId, name: serviceName }, scheduledAt: new Date(horarioISO), customerPhone });
  await advanceStage({ companyId: company.id, customerPhone });
  const confirmacao = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente confirmou agendamento de " + serviceName + " com " + opcaoEscolhida.providerName + ". Confirme de forma calorosa e informe que avisara quando a profissional confirmar." }] });
  await sendTextMessage({ to: customerPhone, message: confirmacao, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });
}

async function responderComIA({ company, customerPhone, customerMessage, systemPrompt }) {
  const resposta = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: customerMessage }] });
  if (resposta) await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}
