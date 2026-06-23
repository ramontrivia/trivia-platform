import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { loadKnowledge, loadKnowledgePhase } from "../services/knowledge.js";
import { identificarServico } from "../flows/identificarIntencao.js";
import { classificarIntencao } from "../flows/classificarIntencao.js";
import { listarServicos, listarProfissionais } from "../flows/consultarCatalogo.js";
import { listarProximosDias, horariosDoDia } from "../flows/disponibilidadeDia.js";
import { criarAgendamento } from "../flows/criarAgendamento.js";
import { getConversationState, setConversationState, clearConversationState } from "../flows/conversationState.js";
import { getOrCreateLead, advanceStage } from "../crm/crmService.js";

const STEP_ESCOLHER_DIA = "agendamento_escolher_dia";
const STEP_ESCOLHER_HORARIO = "agendamento_escolher_horario";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;
  const lead = await getOrCreateLead({ companyId: company.id, customerPhone });
  const knowledge = loadKnowledge(company.client_key);
  const phase = lead?.stage || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);
  const systemPrompt = [knowledge, phaseKnowledge].filter(Boolean).join("\n\n");
  const estado = await getConversationState({ companyId: company.id, customerPhone });

  // ETAPA: cliente esta escolhendo o DIA
  if (estado && estado.step === STEP_ESCOLHER_DIA) {
    await processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }

  // ETAPA: cliente esta escolhendo HORARIO + PROFISSIONAL
  if (estado && estado.step === STEP_ESCOLHER_HORARIO) {
    await processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }

  // CLASSIFICA a intencao
  const intencao = await classificarIntencao(customerMessage);

  if (intencao === "listar_servicos") {
    const servicos = await listarServicos(company.id);
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente perguntou quais servicos o salao oferece. Liste de forma natural e acolhedora, sem markdown, sem tracos: " + servicos.join(", ") + ". Ao final pergunte qual ele gostaria de agendar." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  if (intencao === "listar_profissionais") {
    const profs = await listarProfissionais(company.id);
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente perguntou quais profissionais existem. Apresente de forma calorosa, sem markdown, sem tracos: " + profs.map((p) => p.name).join(", ") + ". Ao final pergunte qual servico ele gostaria de agendar." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  if (intencao === "conversar") {
    await responderComIA({ company, customerPhone, customerMessage, systemPrompt });
    return;
  }

  // intencao === agendar
  const identificacao = await identificarServico({ companyId: company.id, customerMessage });
  if (!identificacao) {
    const servicos = await listarServicos(company.id);
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar mas nao especificou o servico. Liste de forma natural, sem markdown: " + servicos.join(", ") + ". Pergunte qual ele deseja." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const { service, hasProvider } = identificacao;
  if (!hasProvider) {
    await sendTextMessage({ to: customerPhone, message: "Esse servico e realizado por um profissional parceiro. Para agendar, fala com nossa equipe: telefone_provisorio_administrativo", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  if (phase === "frio") await advanceStage({ companyId: company.id, customerPhone });

  // Mostra os proximos dias e pede pro cliente escolher
  await mostrarDias({ company, customerPhone, service, systemPrompt });
}

async function mostrarDias({ company, customerPhone, service, systemPrompt }) {
  const dias = listarProximosDias(6);
  const listaDias = dias.map((d, i) => (i + 1) + ") " + d.label).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar " + service.name + ". Apresente os proximos dias disponiveis de forma natural, sem markdown, sem tracos, e pergunte qual dia ele prefere:\n" + listaDias }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_DIA, context: { serviceId: service.id, serviceName: service.name, dias: dias.map((d) => ({ iso: d.data.toISOString(), label: d.label })) } });
}

async function processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { serviceId, serviceName, dias } = estado.context;
  const listaDias = dias.map((d, i) => i + ": " + d.label).join("\n");
  const prompt = "Dias oferecidos:\n" + listaDias + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice (numero) do dia escolhido. Responda APENAS o numero. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao ficou claro qual dia. Peca gentilmente que escolha um dos dias oferecidos." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const diaEscolhido = dias[parseInt(resposta.trim(), 10)];
  if (!diaEscolhido) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar o dia. Pode me dizer qual dos dias voce prefere?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const horarios = await horariosDoDia({ serviceId, companyId: company.id, data: new Date(diaEscolhido.iso) });
  if (horarios.length === 0) {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ha horarios livres em " + diaEscolhido.label + " para " + serviceName + ". Avise o cliente de forma acolhedora e pergunte se quer ver outro dia." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const listaHorarios = horarios.map((h) => h.horario + ": " + h.profissionais.map((p) => p.name).join(", ")).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente escolheu " + diaEscolhido.label + " para " + serviceName + ". Apresente os horarios livres do dia de forma natural, sem markdown, sem tracos, mostrando cada horario com as profissionais disponiveis:\n" + listaHorarios + "\nPergunte qual horario e qual profissional ele prefere." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_HORARIO, context: { serviceId, serviceName, diaLabel: diaEscolhido.label, horarios: horarios.map((h) => ({ horario: h.horario, horarioISO: h.horarioISO, profissionais: h.profissionais })) } });
}

async function processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { serviceId, serviceName, horarios } = estado.context;
  const opcoesPlanas = [];
  horarios.forEach((h) => { h.profissionais.forEach((p) => { opcoesPlanas.push({ horario: h.horario, horarioISO: h.horarioISO, providerId: p.id, providerName: p.name }); }); });
  const listaOpcoes = opcoesPlanas.map((o, i) => i + ": " + o.horario + " com " + o.providerName).join("\n");
  const prompt = "Opcoes disponiveis:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice da opcao escolhida (horario + profissional). Responda APENAS o numero. Se o cliente escolheu so o horario sem profissional, escolha o primeiro indice daquele horario. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao ficou claro o horario e a profissional. Peca gentilmente que confirme." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const escolha = opcoesPlanas[parseInt(resposta.trim(), 10)];
  if (!escolha) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar. Pode confirmar o horario e a profissional que voce prefere?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  await criarAgendamento({ company, provider: { id: escolha.providerId, name: escolha.providerName, phone: null }, service: { id: serviceId, name: serviceName }, scheduledAt: new Date(escolha.horarioISO), customerPhone });
  await advanceStage({ companyId: company.id, customerPhone });

  const confirmacao = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente confirmou agendamento de " + serviceName + " com " + escolha.providerName + " as " + escolha.horario + " em " + estado.context.diaLabel + ". Confirme de forma calorosa, sem emoji, informando que avisara quando a profissional confirmar." }] });
  await sendTextMessage({ to: customerPhone, message: confirmacao, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });
}

async function responderComIA({ company, customerPhone, customerMessage, systemPrompt }) {
  const resposta = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: customerMessage }] });
  if (resposta) await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}
