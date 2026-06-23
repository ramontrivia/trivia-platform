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
import { montarMemoriaCliente, salvarNomeCliente } from "../flows/memoriaCliente.js";
import { supabase } from "../services/supabase.js";
import { isAdmin, enviarRelatorioAdmin } from "../flows/admin.js";

const STEP_COLETAR_NOME = "agendamento_coletar_nome";
const STEP_ESCOLHER_DIA = "agendamento_escolher_dia";
const STEP_ESCOLHER_HORARIO = "agendamento_escolher_horario";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;

  // Verifica se é um admin enviando o comando ADM
  if (customerMessage.trim().toUpperCase() === "ADM") {
    const admin = await isAdmin({ companyId: company.id, customerPhone });
    if (admin) {
      await enviarRelatorioAdmin({ company, customerPhone, adminName: admin.name });
      return;
    }
  }

  const lead = await getOrCreateLead({ companyId: company.id, customerPhone });
  const knowledge = loadKnowledge(company.client_key);
  const phase = lead?.stage || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);
  const memoria = await montarMemoriaCliente({ companyId: company.id, customerPhone, leadId: lead?.id });
  const systemPrompt = [knowledge, phaseKnowledge, memoria].filter(Boolean).join("\n\n");
  const estado = await getConversationState({ companyId: company.id, customerPhone });

  if (estado && estado.step === STEP_COLETAR_NOME) {
    await processarNome({ company, customerPhone, customerMessage, estado, systemPrompt, lead });
    return;
  }
  if (estado && estado.step === STEP_ESCOLHER_DIA) {
    await processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }
  if (estado && estado.step === STEP_ESCOLHER_HORARIO) {
    await processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt, lead });
    return;
  }
  if (estado && estado.step === "agendamento_cancelar") {
    await processarCancelamento({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }

  const intencao = await classificarIntencao(customerMessage);

  if (intencao === "listar_servicos") {
    const servicos = await listarServicos(company.id);
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente perguntou quais servicos o salao oferece. Liste de forma natural, sem markdown: " + servicos.join(", ") + ". Ao final pergunte qual ele gostaria de agendar." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }
  if (intencao === "listar_profissionais") {
    const profs = await listarProfissionais(company.id);
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente perguntou quais profissionais existem. Apresente de forma calorosa, sem markdown: " + profs.map((p) => p.name).join(", ") + ". Ao final pergunte qual servico ele gostaria de agendar." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }
  if (intencao === "conversar") {
    await responderComIA({ company, customerPhone, customerMessage, systemPrompt });
    return;
  }
  if (intencao === "cancelar") {
    await iniciarCancelamento({ company, customerPhone, systemPrompt });
    return;
  }

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

  if (lead?.name) {
    await mostrarDias({ company, customerPhone, service, systemPrompt });
  } else {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar " + service.name + ". Antes de mostrar os horarios, peca o nome dele de forma natural e acolhedora." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    await setConversationState({ companyId: company.id, customerPhone, step: STEP_COLETAR_NOME, context: { serviceId: service.id, serviceName: service.name } });
  }
}

async function processarNome({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  await salvarNomeCliente({ leadId: lead.id, name: customerMessage.trim() });
  const service = { id: estado.context.serviceId, name: estado.context.serviceName };
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente informou o nome: " + customerMessage.trim() + ". Confirme o nome de forma calorosa e diga que vai mostrar os dias disponiveis." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await mostrarDias({ company, customerPhone, service, systemPrompt });
}

async function mostrarDias({ company, customerPhone, service, systemPrompt }) {
  const dias = listarProximosDias(6);
  const listaDias = dias.map((d, i) => (i + 1) + ") " + d.label).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Mostre os proximos dias disponiveis para " + service.name + " de forma natural, sem markdown:\n" + listaDias + "\nPergunte qual dia o cliente prefere." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_DIA, context: { serviceId: service.id, serviceName: service.name, dias: dias.map((d) => ({ iso: d.data.toISOString(), label: d.label })) } });
}

async function processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { serviceId, serviceName, dias } = estado.context;
  const listaDias = dias.map((d, i) => i + ": " + d.label).join("\n");
  const prompt = "Dias oferecidos:\n" + listaDias + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice do dia escolhido. Responda APENAS o numero. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao ficou claro qual dia. Peca gentilmente que escolha um dos dias." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const diaEscolhido = dias[parseInt(resposta.trim(), 10)];
  if (!diaEscolhido) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar o dia. Pode me dizer qual prefere?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const horarios = await horariosDoDia({ serviceId, companyId: company.id, data: new Date(diaEscolhido.iso) });
  if (horarios.length === 0) {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ha horarios em " + diaEscolhido.label + " para " + serviceName + ". Avise de forma acolhedora e pergunte se quer outro dia." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const listaHorarios = horarios.map((h) => h.horario + ": " + h.profissionais.map((p) => p.name).join(", ")).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente escolheu " + diaEscolhido.label + " para " + serviceName + ". Mostre os horarios livres de forma natural, sem markdown:\n" + listaHorarios + "\nPergunte qual horario e profissional ele prefere." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_HORARIO, context: { serviceId, serviceName, diaLabel: diaEscolhido.label, horarios: horarios.map((h) => ({ horario: h.horario, horarioISO: h.horarioISO, profissionais: h.profissionais })) } });
}

async function processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  const { serviceId, serviceName, horarios } = estado.context;
  const opcoesPlanas = [];
  horarios.forEach((h) => { h.profissionais.forEach((p) => { opcoesPlanas.push({ horario: h.horario, horarioISO: h.horarioISO, providerId: p.id, providerName: p.name }); }); });
  const listaOpcoes = opcoesPlanas.map((o, i) => i + ": " + o.horario + " com " + o.providerName).join("\n");
  const prompt = "Opcoes disponiveis:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice da opcao escolhida. Responda APENAS o numero. Se escolheu so horario sem profissional, escolha o primeiro indice daquele horario. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao ficou claro a escolha. Peca gentilmente que confirme horario e profissional." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const escolha = opcoesPlanas[parseInt(resposta.trim(), 10)];
  if (!escolha) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar. Pode confirmar o horario e a profissional?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const customerName = lead?.name || null;
  await criarAgendamento({ company, provider: { id: escolha.providerId, name: escolha.providerName, phone: null }, service: { id: serviceId, name: serviceName }, scheduledAt: new Date(escolha.horarioISO), customerPhone, customerName });
  await advanceStage({ companyId: company.id, customerPhone });

  // Notifica a profissional
  const { data: providerData } = await supabase
    .from("tp_providers")
    .select("phone")
    .eq("id", escolha.providerId)
    .single();

  if (providerData?.phone) {
    const msgProfissional = `Olá ${escolha.providerName}! Você tem um novo agendamento: ${serviceName} com ${customerName || customerPhone} em ${estado.context.diaLabel} às ${escolha.horario}. Confirma? Responda SIM ou NÃO.`;
    await sendTextMessage({ to: providerData.phone, message: msgProfissional, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  }

  const confirmacao = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente " + (customerName || "") + " confirmou agendamento de " + serviceName + " com " + escolha.providerName + " as " + escolha.horario + " em " + estado.context.diaLabel + ". Confirme de forma calorosa, sem cumprimento inicial, sem emoji excessivo, informando que avisara quando a profissional confirmar." }] });
  await sendTextMessage({ to: customerPhone, message: confirmacao, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });
}

async function iniciarCancelamento({ company, customerPhone, systemPrompt }) {
  const { data: agendamentos } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, status, service_id, provider_id")
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone)
    .in("status", ["aguardando_aprovacao", "confirmado"])
    .order("scheduled_at", { ascending: true });

  if (!agendamentos || agendamentos.length === 0) {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer cancelar agendamentos mas nao tem nenhum agendamento ativo. Informe de forma acolhedora." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
  const provIds = [...new Set(agendamentos.map((a) => a.provider_id))];
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);
  const nomesServicos = {};
  const nomesProviders = {};
  (servs || []).forEach((s) => { nomesServicos[s.id] = s.name; });
  (provs || []).forEach((p) => { nomesProviders[p.id] = p.name; });

  const listaFormatada = agendamentos.map((a, i) => {
    const serv = nomesServicos[a.service_id] || "servico";
    const prov = nomesProviders[a.provider_id] || "profissional";
    const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR");
    const hora = new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return (i + 1) + ") " + serv + " com " + prov + " em " + data + " as " + hora;
  }).join("\n");

  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer cancelar agendamentos. Liste os agendamentos ativos abaixo de forma natural, sem markdown, e pergunte qual ele quer cancelar (pode ser um especifico ou todos):\n" + listaFormatada }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({
    companyId: company.id, customerPhone,
    step: "agendamento_cancelar",
    context: { agendamentos: agendamentos.map((a, i) => ({ indice: i, id: a.id, service: nomesServicos[a.service_id], provider: nomesProviders[a.provider_id], data: new Date(a.scheduled_at).toLocaleDateString("pt-BR") })) }
  });
}

async function processarCancelamento({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { agendamentos } = estado.context;
  const listaOpcoes = agendamentos.map((a) => a.indice + ": " + a.service + " com " + a.provider + " em " + a.data).join("\n");
  const prompt = "Agendamentos disponiveis para cancelar:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nO cliente quer cancelar qual(is)? Responda com os indices separados por virgula. Se quiser cancelar TODOS responda: todos. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ficou claro qual agendamento o cliente quer cancelar. Peca que confirme." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  let idsParaCancelar = [];
  if (resposta.trim().toLowerCase() === "todos") {
    idsParaCancelar = agendamentos.map((a) => a.id);
  } else {
    const indices = resposta.trim().split(",").map((s) => parseInt(s.trim(), 10));
    idsParaCancelar = indices.map((i) => agendamentos[i]?.id).filter(Boolean);
  }

  if (idsParaCancelar.length === 0) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar qual cancelar. Pode confirmar?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  await supabase.from("tp_appointments").update({ status: "cancelado" }).in("id", idsParaCancelar);

  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente cancelou " + idsParaCancelar.length + " agendamento(s) com sucesso. Confirme de forma calorosa e pergunte se precisa de mais alguma coisa." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });
}

async function responderComIA({ company, customerPhone, customerMessage, systemPrompt }) {
  const resposta = await generateResponse({
    systemPrompt,
    conversationHistory: [{
      role: "user",
      content: "O cliente enviou: \"" + customerMessage + "\". Responda de forma natural e humanizada. NÃO liste serviços, NÃO pergunte o que deseja agendar. Apenas responda o que foi dito de forma acolhedora e simples."
    }]
  });
  if (resposta) await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}