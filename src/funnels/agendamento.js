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
import { isAdmin, enviarRelatorioAdmin, isProvider, enviarAgendaProfissional } from "../flows/admin.js";
import { iniciarReagendamento, processarReagendamento } from "../modules/reagendamento.js";
import { oferecerListaEspera, processarRespostaListaEspera, notificarListaEspera } from "../modules/listaEspera.js";
import { processarAvaliacao } from "../modules/avaliacao.js";
import { analisarSentimento } from "../modules/sentimento.js";
import { extrairEsalvarMemoria } from "../modules/memoriaRica.js";

const STEP_COLETAR_NOME = "agendamento_coletar_nome";
const STEP_ESCOLHER_DIA = "agendamento_escolher_dia";
const STEP_ESCOLHER_HORARIO = "agendamento_escolher_horario";

const TELEFONE_RECEPCAO = "5531999999999";
const LINK_RECEPCAO = "https://wa.me/" + TELEFONE_RECEPCAO;

// Tenta identificar dia mencionado na mensagem
async function identificarDiaNaMensagem(customerMessage, dias) {
  const listaDias = dias.map((d, i) => i + ": " + d.label).join("\n");
  const prompt = "Dias disponiveis:\n" + listaDias + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nO cliente mencionou algum dia especifico? Responda APENAS o indice do dia. Se nao mencionou nenhum dia: nenhum";
  const resposta = await generateResponse({
    systemPrompt: "Voce e um classificador preciso. Responda apenas o numero ou nenhum.",
    conversationHistory: [{ role: "user", content: prompt }]
  });
  if (!resposta || resposta.trim().toLowerCase() === "nenhum") return null;
  const idx = parseInt(resposta.trim(), 10);
  return isNaN(idx) ? null : dias[idx] || null;
}

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;
  const msgUpper = customerMessage.trim().toUpperCase();

  console.log("📞 DE:", customerPhone, "| MSG:", customerMessage);

  if (msgUpper === "ADM") {
    const admin = await isAdmin({ companyId: company.id, customerPhone });
    if (admin) {
      await enviarRelatorioAdmin({ company, customerPhone, adminName: admin.name });
      return;
    }
  }

  if (msgUpper === "AGENDA") {
    const provider = await isProvider({ companyId: company.id, customerPhone });
    if (provider) {
      await enviarAgendaProfissional({ company, customerPhone, provider });
      return;
    }
  }

  if (msgUpper.includes("SIM") || msgUpper.includes("NAO") || msgUpper.includes("NÃO")) {
    const provider = await isProvider({ companyId: company.id, customerPhone });
    if (provider) {
      await processarRespostaProfissional({ company, customerPhone, provider, resposta: msgUpper });
      return;
    }
  }

  const notaAvaliacao = parseInt(customerMessage.trim(), 10);
  if (!isNaN(notaAvaliacao) && notaAvaliacao >= 1 && notaAvaliacao <= 5) {
    const avaliou = await processarAvaliacao({ company, customerPhone, customerMessage });
    if (avaliou) return;
  }

  const lead = await getOrCreateLead({ companyId: company.id, customerPhone });
  const knowledge = loadKnowledge(company.client_key);
  const phase = lead?.stage || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);
  const memoria = await montarMemoriaCliente({ companyId: company.id, customerPhone, leadId: lead?.id });
  const systemPrompt = [knowledge, phaseKnowledge, memoria].filter(Boolean).join("\n\n");
  const estado = await getConversationState({ companyId: company.id, customerPhone });

  if (lead?.id) {
    extrairEsalvarMemoria({ companyId: company.id, customerPhone, customerMessage, leadId: lead.id }).catch(console.error);
  }

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
    await processarCancelamento({ company, customerPhone, customerMessage, estado, systemPrompt, lead });
    return;
  }
  if (estado && (estado.step === "reagendar_escolher_agendamento" || estado.step === "reagendar_escolher_dia" || estado.step === "reagendar_escolher_horario")) {
    await processarReagendamento({ company, customerPhone, customerMessage, estado, systemPrompt, lead });
    return;
  }
  if (estado && estado.step === "lista_espera_aguardando_confirmacao") {
    await processarRespostaListaEspera({ company, customerPhone, customerMessage, estado, systemPrompt });
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
    await responderComIA({ company, customerPhone, customerMessage, systemPrompt, lead });
    return;
  }
  if (intencao === "cancelar") {
    await iniciarCancelamento({ company, customerPhone, systemPrompt });
    return;
  }
  if (intencao === "reagendar") {
    await iniciarReagendamento({ company, customerPhone, systemPrompt });
    return;
  }
  if (intencao === "humano") {
    await direcionarRecepcao({ company, customerPhone, systemPrompt, motivo: "atendimento humano" });
    return;
  }

  const identificacao = await identificarServico({ companyId: company.id, customerMessage });
  if (!identificacao) {
    const servicos = await listarServicos(company.id);
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar mas nao especificou o servico. Liste de forma natural, sem markdown: " + servicos.join(", ") + ". Pergunte qual ele deseja." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const { service, hasProvider, terceirizado } = identificacao;

  if (terceirizado) {
    await direcionarRecepcao({ company, customerPhone, systemPrompt, motivo: "servico especial: " + service.name });
    return;
  }

  if (!hasProvider) {
    await direcionarRecepcao({ company, customerPhone, systemPrompt, motivo: "sem profissional: " + service.name });
    return;
  }

  if (phase === "frio") await advanceStage({ companyId: company.id, customerPhone });

  // Tenta identificar se o cliente já mencionou um dia
  const dias = listarProximosDias(6);
  const diaJaMencionado = await identificarDiaNaMensagem(customerMessage, dias);

  if (lead?.name) {
    if (diaJaMencionado) {
      // Cliente já informou o dia — vai direto para os horários
      const horarios = await horariosDoDia({ serviceId: service.id, companyId: company.id, data: new Date(diaJaMencionado.iso || diaJaMencionado.data) });
      if (horarios.length === 0) {
        await oferecerListaEspera({ company, customerPhone, customerName: lead.name, serviceId: service.id, serviceName: service.name, systemPrompt });
        return;
      }
      const listaHorarios = horarios.map((h) => h.horario + ": " + h.profissionais.map((p) => p.name).join(", ")).join("\n");
      const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar " + service.name + " em " + diaJaMencionado.label + ". Mostre os horarios livres de forma natural, sem markdown:\n" + listaHorarios + "\nPergunte qual horario e profissional ele prefere. Deve informar TANTO o horario QUANTO a profissional." }] });
      await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
      await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_HORARIO, context: { serviceId: service.id, serviceName: service.name, customerName: lead.name, diaLabel: diaJaMencionado.label, horarios: horarios.map((h) => ({ horario: h.horario, horarioISO: h.horarioISO, profissionais: h.profissionais })) } });
    } else {
      await mostrarDias({ company, customerPhone, service, systemPrompt, lead });
    }
  } else {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer agendar " + service.name + ". Antes de mostrar os horarios, peca o nome dele de forma natural e acolhedora." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    await setConversationState({ companyId: company.id, customerPhone, step: STEP_COLETAR_NOME, context: { serviceId: service.id, serviceName: service.name } });
  }
}

async function direcionarRecepcao({ company, customerPhone, systemPrompt, motivo }) {
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente precisa de atendimento especializado (" + motivo + "). Informe de forma calorosa que esse atendimento é feito pela nossa equipe de forma personalizada e direcione para o WhatsApp da recepção: " + LINK_RECEPCAO + ". Seja breve e acolhedora." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}

async function processarRespostaProfissional({ company, customerPhone, provider, resposta }) {
  const { data: agendamento } = await supabase
    .from("tp_appointments")
    .select("id, customer_phone, customer_name, service_id, scheduled_at")
    .eq("company_id", company.id)
    .eq("provider_id", provider.id)
    .eq("status", "aguardando_aprovacao")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (!agendamento) {
    await sendTextMessage({ to: customerPhone, message: "Olá " + provider.name + "! Não encontrei nenhum agendamento pendente para você confirmar.", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const { data: servico } = await supabase.from("tp_services").select("name").eq("id", agendamento.service_id).single();
  const nomeServico = servico?.name || "serviço";
  const cliente = agendamento.customer_name || agendamento.customer_phone;
  const data = new Date(agendamento.scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  const hora = new Date(agendamento.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (resposta.includes("SIM")) {
    await supabase.from("tp_appointments").update({ status: "confirmado" }).eq("id", agendamento.id);
    await sendTextMessage({ to: customerPhone, message: "Ótimo, " + provider.name + "! Agendamento confirmado ✅\n" + nomeServico + " com " + cliente + " em " + data + " às " + hora + ".", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    await sendTextMessage({ to: agendamento.customer_phone, message: "Boa notícia! " + provider.name + " confirmou seu agendamento de " + nomeServico + " para " + data + " às " + hora + ". Te esperamos! 🎉", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  } else {
    await supabase.from("tp_appointments").update({ status: "cancelado" }).eq("id", agendamento.id);
    await sendTextMessage({ to: customerPhone, message: "Entendido, " + provider.name + ". Agendamento cancelado.", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    await sendTextMessage({ to: agendamento.customer_phone, message: "Olá! Infelizmente " + provider.name + " não poderá atender seu agendamento de " + nomeServico + " em " + data + " às " + hora + ". Entre em contato para remarcar. 💙", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    await notificarListaEspera({ company, serviceId: agendamento.service_id, serviceName: nomeServico });
  }
}

async function processarNome({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  await salvarNomeCliente({ leadId: lead.id, name: customerMessage.trim() });
  const service = { id: estado.context.serviceId, name: estado.context.serviceName };
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente informou o nome: " + customerMessage.trim() + ". Confirme o nome de forma calorosa e diga que vai mostrar os dias disponiveis." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await mostrarDias({ company, customerPhone, service, systemPrompt, lead: { ...lead, name: customerMessage.trim() } });
}

async function mostrarDias({ company, customerPhone, service, systemPrompt, lead }) {
  const dias = listarProximosDias(6);
  const listaDias = dias.map((d, i) => (i + 1) + ") " + d.label).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Mostre os proximos dias disponiveis para " + service.name + " de forma natural, sem markdown:\n" + listaDias + "\nPergunte qual dia o cliente prefere." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_DIA, context: { serviceId: service.id, serviceName: service.name, customerName: lead?.name || null, dias: dias.map((d) => ({ iso: d.data.toISOString(), label: d.label })) } });
}

async function processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { serviceId, serviceName, customerName, dias } = estado.context;
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
    await oferecerListaEspera({ company, customerPhone, customerName, serviceId, serviceName, systemPrompt });
    return;
  }

  const listaHorarios = horarios.map((h) => h.horario + ": " + h.profissionais.map((p) => p.name).join(", ")).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente escolheu " + diaEscolhido.label + " para " + serviceName + ". Mostre os horarios livres de forma natural, sem markdown:\n" + listaHorarios + "\nPergunte qual horario e profissional ele prefere. Deixe claro que ele deve informar TANTO o horario QUANTO a profissional." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_HORARIO, context: { serviceId, serviceName, customerName, diaLabel: diaEscolhido.label, horarios: horarios.map((h) => ({ horario: h.horario, horarioISO: h.horarioISO, profissionais: h.profissionais })) } });
}

async function processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  const { serviceId, serviceName, horarios } = estado.context;
  const opcoesPlanas = [];
  horarios.forEach((h) => { h.profissionais.forEach((p) => { opcoesPlanas.push({ horario: h.horario, horarioISO: h.horarioISO, providerId: p.id, providerName: p.name }); }); });
  const listaOpcoes = opcoesPlanas.map((o, i) => i + ": " + o.horario + " com " + o.providerName).join("\n");
  const prompt = "Opcoes disponiveis:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice da opcao escolhida. O cliente DEVE informar um horario especifico. Se informou apenas o nome da profissional SEM horario, responda: nenhum. Se informou horario com ou sem profissional, escolha o indice correspondente (se nao informou profissional, escolha o primeiro indice daquele horario). Responda APENAS o numero ou nenhum.";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero ou nenhum.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente disse \"" + customerMessage + "\" mas nao informou o horario desejado. Peca gentilmente que informe o horario especifico que deseja." }] });
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

  const { data: providerData } = await supabase
    .from("tp_providers")
    .select("phone")
    .eq("id", escolha.providerId)
    .single();

  if (providerData?.phone) {
    const msgProfissional = "Olá " + escolha.providerName + "! Você tem um novo agendamento: " + serviceName + " com " + (customerName || customerPhone) + " em " + estado.context.diaLabel + " às " + escolha.horario + ". Confirma? Responda SIM ou NÃO.";
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
    context: {
      agendamentos: agendamentos.map((a, i) => ({
        indice: i,
        id: a.id,
        service: nomesServicos[a.service_id],
        serviceId: a.service_id,
        serviceName: nomesServicos[a.service_id],
        provider: nomesProviders[a.provider_id],
        providerName: nomesProviders[a.provider_id],
        data: new Date(a.scheduled_at).toLocaleDateString("pt-BR"),
        hora: new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      }))
    }
  });
}

async function processarCancelamento({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  const { agendamentos } = estado.context;
  const listaOpcoes = agendamentos.map((a) => a.indice + ": " + a.service + " com " + a.provider + " em " + a.data).join("\n");
  const prompt = "Agendamentos disponiveis para cancelar:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nO cliente quer cancelar qual(is)? Responda com os indices separados por virgula. Se quiser cancelar TODOS responda: todos. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ficou claro qual agendamento o cliente quer cancelar. Peca que confirme." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  let agendamentosParaCancelar = [];
  if (resposta.trim().toLowerCase() === "todos") {
    agendamentosParaCancelar = agendamentos;
  } else {
    const indices = resposta.trim().split(",").map((s) => parseInt(s.trim(), 10));
    agendamentosParaCancelar = indices.map((i) => agendamentos[i]).filter(Boolean);
  }

  if (agendamentosParaCancelar.length === 0) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar qual cancelar. Pode confirmar?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const idsParaCancelar = agendamentosParaCancelar.map((a) => a.id);
  await supabase.from("tp_appointments").update({ status: "cancelado" }).in("id", idsParaCancelar);

  for (const agendamento of agendamentosParaCancelar) {
    const { data: providerData } = await supabase
      .from("tp_providers")
      .select("phone, name")
      .eq("company_id", company.id)
      .eq("name", agendamento.providerName)
      .limit(1);

    if (providerData && providerData.length > 0 && providerData[0].phone) {
      const msgProfissional = "Olá " + agendamento.providerName + "! O agendamento de " + agendamento.service + " em " + agendamento.data + " às " + agendamento.hora + " foi cancelado pelo cliente.";
      await sendTextMessage({ to: providerData[0].phone, message: msgProfissional, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    }

    await notificarListaEspera({ company, serviceId: agendamento.serviceId, serviceName: agendamento.serviceName });
  }

  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente cancelou " + agendamentosParaCancelar.length + " agendamento(s) com sucesso. Confirme de forma calorosa e pergunte se precisa de mais alguma coisa." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });

  const customerName = lead?.name || null;
  analisarSentimento({ company, customerPhone, customerName, mensagens: [customerMessage] }).catch(console.error);
}

async function responderComIA({ company, customerPhone, customerMessage, systemPrompt, lead }) {
  const resposta = await generateResponse({
    systemPrompt,
    conversationHistory: [{
      role: "user",
      content: "O cliente enviou: \"" + customerMessage + "\". Responda de forma natural e humanizada. NÃO liste serviços, NÃO pergunte o que deseja agendar. Apenas responda o que foi dito de forma acolhedora e simples."
    }]
  });
  if (resposta) await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  const customerName = lead?.name || null;
  analisarSentimento({ company, customerPhone, customerName, mensagens: [customerMessage] }).catch(console.error);
}