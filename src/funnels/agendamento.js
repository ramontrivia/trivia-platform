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

const STEP_COLETAR_NOME = "agendamento_coletar_nome";
const STEP_ESCOLHER_DIA = "agendamento_escolher_dia";
const STEP_ESCOLHER_HORARIO = "agendamento_escolher_horario";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;
  const msgUpper = customerMessage.trim().toUpperCase();

  console.log("📞 DE:", customerPhone, "| MSG:", customerMessage);

  // Comando ADM — painel da gerência
  if (msgUpper === "ADM") {
    const admin = await isAdmin({ companyId: company.id, customerPhone });
    if (admin) {
      await enviarRelatorioAdmin({ company, customerPhone, adminName: admin.name });
      return;
    }
  }

  // Comando AGENDA — agenda da profissional
  if (msgUpper === "AGENDA") {
    const provider = await isProvider({ companyId: company.id, customerPhone });
    if (provider) {
      await enviarAgendaProfissional({ company, customerPhone, provider });
      return;
    }
  }

  // Resposta SIM/NÃO de profissional confirmando agendamento
  if (msgUpper.includes("SIM") || msgUpper.includes("NAO") || msgUpper.includes("NÃO")) {
    const provider = await isProvider({ companyId: company.id, customerPhone });
    if (provider) {
      await processarRespostaProfissional({ company, customerPhone, provider, resposta: msgUpper });
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
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente escolheu " + diaEscolhido.label + " para " + serviceName + ". Mostre os horarios livres de forma natural, sem markdown:\n" + listaHorarios + "\nPergunte qual horario e profissional ele prefere. Deixe claro que ele deve informar TANTO o horario QUANTO a profissional." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await setConversationState({ companyId: company.id, customerPhone, step: STEP_ESCOLHER_HORARIO, context: { serviceId, serviceName, diaLabel: diaEscolhido.label, horarios: horarios.map((h) => ({ horario: h.horario, horarioISO: h.horarioISO, profissionais: h.profissionais })) } });
}

async function processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  const { serviceId, serviceName, horarios } = estado.context;
  const opcoesPlanas = [];
  horarios.forEach((h) => { h.profissionais.forEach((p) => { opcoesPlanas.push({ horario: h.horario, horarioISO: h.horarioISO, providerId: p.id, providerName: p.name }); }); });
  const listaOpcoes = opcoesPlanas.map((o, i) => i + ": " + o.horario + " com " + o.providerName).join("\n");
  const prompt = "Opcoes disponiveis:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice da opcao escolhida. O cliente DEVE informar um horario especifico. Se informou apenas o nome da profissional SEM horario, responda: nenhum. Se informou horario com ou sem profissional, escolha o indice correspondente (se nao informou profissional, escolha o primeiro indice daquele horario). Responda APENAS o numero ou nenhum.";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero ou nenhum.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: