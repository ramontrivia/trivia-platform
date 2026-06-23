import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { loadKnowledge, loadKnowledgePhase } from "../services/knowledge.js";
import { identificarServico } from "../flows/identificarIntencao.js";
import { classificarIntencao } from "../flows/classificarIntencao.js";
import { listarServicos, listarProfissionais } from "../flows/consultarCatalogo.js";
import { buscarDisponibilidade } from "../flows/buscarDisponibilidade.js";
import { criarAgendamento } from "../flows/criarAgendamento.js";
import { getConversationState, setConversationState, clearConversationState } from "../flows/conversationState.js";
import { getOrCreateLead, advanceStage } from "../crm/crmService.js";
import { interpretarPedido, extrairParametrosBusca } from "../flows/interpretarPedido.js";

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

  // Se ja esta no meio de uma escolha de horario
  if (estado && estado.step === STEP_AGUARDANDO_ESCOLHA) {
    const interpretacao = await interpretarPedido(customerMessage);
    if (interpretacao.ehPedidoDeHorario) {
      const params = extrairParametrosBusca(interpretacao);
      await mostrarDisponibilidade({ company, customerPhone, serviceId: estado.context.serviceId, serviceName: estado.context.serviceName, systemPrompt, ...params });
      return;
    }
    await processarEscolha({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }

  // PRIMEIRA CAMADA: classifica a intencao do cliente
  const intencao = await classificarIntencao(customerMessage);

  if (intencao === "listar_servicos") {
    const servicos = await listarServicos(company.id);
    const lista = servicos.join(", ");
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente perguntou quais servicos o salao oferece. Liste estes servicos de forma natural e acolhedora, sem markdown, sem tracos: " + lista + ". Ao final pergunte qual ele gostaria de agendar." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  if (intencao === "listar_profissionais") {
    const profs = await listarProfissionais(company.id);
    const lista = profs.map((p) => p.name).join(", ");
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente perguntou quais profissionais o salao tem. Apresente estas profissionais de forma natural e calorosa, sem markdown, sem tracos: " + lista + ". Ao final pergunte qual servico ele gostaria de agendar." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  if (intencao === "conversar") {
    await responderComIA({ company, customerPhone, customerMessage, systemPrompt });
    return;
  }

  // intencao === "agendar"
  const identificacao = await identificarServico({ companyId: company.id, customerMessage });

  if (!identificacao) {
    // Cliente quer agendar mas nao deu pra saber o servico - lista os servicos
    const servicos = await listarServicos(company.id);
    const lista = servicos.join(", ");
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar mas nao especificou qual servico. Liste os servicos disponiveis de forma natural, sem markdown: " + lista + ". Pergunte qual ele deseja." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const { service, hasProvider } = identificacao;
  if (!hasProvider) {
    await sendTextMessage({ to: customerPhone, message: "Esse servico e realizado por um profissional parceiro. Para agendar, fala com nossa equipe: telefone_provisorio_administrativo", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  if (phase === "frio") await advanceStage({ companyId: company.id, customerPhone });

  const interpretacao = await interpretarPedido(customerMessage);
  const params = extrairParametrosBusca(interpretacao);
  await mostrarDisponibilidade({ company, customerPhone, serviceId: service.id, serviceName: service.name, systemPrompt, ...params });
}

async function mostrarDisponibilidade({ company, customerPhone, serviceId, serviceName, systemPrompt, periodo, dataEspecifica, diasEspecificos }) {
  const disponibilidade = await buscarDisponibilidade({ serviceId, companyId: company.id, periodo, dataEspecifica, diasEspecificos });

  if (disponibilidade.length === 0) {
    await responderComIA({ company, customerPhone, customerMessage: "O cliente perguntou sobre " + serviceName + " mas nao ha horarios no periodo pedido. Responda de forma acolhedora e sugira outros dias ou periodos.", systemPrompt });
    return;
  }

  const resumoOpcoes = disponibilidade.map(({ provider, slots }) => {
    const horarios = slots.slice(0, 4).map((s) => s.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })).join(", ");
    return provider.name + ": " + horarios;
  }).join("\n");

  const promptOpcoes = "O cliente quer agendar " + serviceName + ". Apresente as opcoes abaixo de forma natural, como uma recepcionista humana, sem markdown, sem tracos, sem asteriscos:\n" + resumoOpcoes + "\nPergunte com quem e em qual horario ele prefere.";
  const mensagem = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: promptOpcoes }] });

  await sendTextMessage({ to: customerPhone, message: mensagem, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_AGUARDANDO_ESCOLHA, context: { serviceId, serviceName, opcoes: disponibilidade.map(({ provider, slots }) => ({ providerId: provider.id, providerName: provider.name, slots: slots.map((s) => s.toISOString()) })) } });
}

async function processarEscolha({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { opcoes, serviceId, serviceName } = estado.context;
  const listaOpcoes = opcoes.map((o, i) => i + ": " + o.providerName + " - horarios: " + o.slots.join(", ")).join("\n");
  const prompt = "O cliente recebeu estas opcoes:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice da opcao escolhida e o horario ISO exato. Responda EXATAMENTE: indice|horarioISO\nSe nao identificar com clareza: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o que foi pedido.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const esclarecimento = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao ficou claro qual profissional e horario ele escolheu. Peca gentilmente que confirme a escolha de forma especifica." }] });
    await sendTextMessage({ to: customerPhone, message: esclarecimento, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const [indiceStr, horarioISO] = resposta.trim().split("|");
  const opcaoEscolhida = opcoes[parseInt(indiceStr, 10)];

  if (!opcaoEscolhida || !horarioISO) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar a escolha. Pode confirmar com qual profissional e em qual horario voce quer?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  await criarAgendamento({ company, provider: { id: opcaoEscolhida.providerId, name: opcaoEscolhida.providerName, phone: null }, service: { id: serviceId, name: serviceName }, scheduledAt: new Date(horarioISO), customerPhone });
  await advanceStage({ companyId: company.id, customerPhone });

  const confirmacao = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente confirmou agendamento de " + serviceName + " com " + opcaoEscolhida.providerName + " em " + new Date(horarioISO).toLocaleString("pt-BR") + ". Confirme de forma calorosa, sem emoji, informando que avisara quando a profissional confirmar." }] });
  await sendTextMessage({ to: customerPhone, message: confirmacao, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });
}

async function responderComIA({ company, customerPhone, customerMessage, systemPrompt }) {
  const resposta = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: customerMessage }] });
  if (resposta) await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}
