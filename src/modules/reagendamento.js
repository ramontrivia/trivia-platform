import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { generateResponse } from "../services/openai.js";
import { listarProximosDias, horariosDoDia } from "../flows/disponibilidadeDia.js";
import { criarAgendamento } from "../flows/criarAgendamento.js";
import { setConversationState, clearConversationState } from "../flows/conversationState.js";

const STEP_REAGENDAR_ESCOLHER = "reagendar_escolher_agendamento";
const STEP_REAGENDAR_DIA = "reagendar_escolher_dia";
const STEP_REAGENDAR_HORARIO = "reagendar_escolher_horario";

export async function iniciarReagendamento({ company, customerPhone, systemPrompt }) {
  const { data: agendamentos } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, status, service_id, provider_id")
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone)
    .in("status", ["aguardando_aprovacao", "confirmado"])
    .order("scheduled_at", { ascending: true });

  if (!agendamentos || agendamentos.length === 0) {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer remarcar mas nao tem agendamentos ativos. Informe de forma acolhedora." }] });
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

  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer remarcar um agendamento. Liste os agendamentos ativos abaixo de forma natural, sem markdown, e pergunte qual ele quer remarcar:\n" + listaFormatada }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  await setConversationState({
    companyId: company.id, customerPhone,
    step: STEP_REAGENDAR_ESCOLHER,
    context: {
      agendamentos: agendamentos.map((a, i) => ({
        indice: i,
        id: a.id,
        serviceId: a.service_id,
        serviceName: nomesServicos[a.service_id] || "servico",
        providerId: a.provider_id,
        providerName: nomesProviders[a.provider_id] || "profissional",
        data: new Date(a.scheduled_at).toLocaleDateString("pt-BR"),
        hora: new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
      }))
    }
  });
}

export async function processarReagendamento({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  const { step } = estado;
  if (step === STEP_REAGENDAR_ESCOLHER) {
    await processarEscolhaAgendamento({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }
  if (step === STEP_REAGENDAR_DIA) {
    await processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt });
    return;
  }
  if (step === STEP_REAGENDAR_HORARIO) {
    await processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt, lead });
    return;
  }
}

async function processarEscolhaAgendamento({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { agendamentos } = estado.context;
  const listaOpcoes = agendamentos.map((a) => a.indice + ": " + a.serviceName + " com " + a.providerName + " em " + a.data + " as " + a.hora).join("\n");
  const prompt = "Agendamentos disponiveis:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nQual agendamento o cliente quer remarcar? Responda APENAS o indice (numero). Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero ou nenhum.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ficou claro qual agendamento o cliente quer remarcar. Peca que confirme." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const agendamento = agendamentos[parseInt(resposta.trim(), 10)];
  if (!agendamento) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar. Pode confirmar qual horario quer remarcar?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const dias = listarProximosDias(6);
  const listaDias = dias.map((d, i) => (i + 1) + ") " + d.label).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente quer remarcar " + agendamento.serviceName + " com " + agendamento.providerName + ". Mostre os proximos dias disponiveis de forma natural, sem markdown:\n" + listaDias + "\nPergunte qual dia prefere." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  await setConversationState({
    companyId: company.id, customerPhone,
    step: STEP_REAGENDAR_DIA,
    context: { agendamento, dias: dias.map((d) => ({ iso: d.data.toISOString(), label: d.label })) }
  });
}

async function processarEscolhaDia({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { agendamento, dias } = estado.context;
  const listaDias = dias.map((d, i) => i + ": " + d.label).join("\n");
  const prompt = "Dias oferecidos:\n" + listaDias + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nIdentifique o indice do dia escolhido. Responda APENAS o numero. Se nao identificar: nenhum";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ficou claro qual dia. Peca gentilmente que escolha um dos dias." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const diaEscolhido = dias[parseInt(resposta.trim(), 10)];
  if (!diaEscolhido) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar o dia. Pode me dizer qual prefere?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const horarios = await horariosDoDia({ serviceId: agendamento.serviceId, companyId: company.id, data: new Date(diaEscolhido.iso) });
  if (horarios.length === 0) {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "Nao ha horarios em " + diaEscolhido.label + " para " + agendamento.serviceName + ". Avise de forma acolhedora e pergunte se quer outro dia." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const listaHorarios = horarios.map((h) => h.horario + ": " + h.profissionais.map((p) => p.name).join(", ")).join("\n");
  const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente escolheu " + diaEscolhido.label + " para remarcar " + agendamento.serviceName + ". Mostre os horarios livres de forma natural, sem markdown:\n" + listaHorarios + "\nPergunte qual horario e profissional prefere. Deixe claro que deve informar TANTO o horario QUANTO a profissional." }] });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  await setConversationState({
    companyId: company.id, customerPhone,
    step: STEP_REAGENDAR_HORARIO,
    context: { agendamento, diaLabel: diaEscolhido.label, horarios: horarios.map((h) => ({ horario: h.horario, horarioISO: h.horarioISO, profissionais: h.profissionais })) }
  });
}

async function processarEscolhaHorario({ company, customerPhone, customerMessage, estado, systemPrompt, lead }) {
  const { agendamento, diaLabel, horarios } = estado.context;
  const opcoesPlanas = [];
  horarios.forEach((h) => { h.profissionais.forEach((p) => { opcoesPlanas.push({ horario: h.horario, horarioISO: h.horarioISO, providerId: p.id, providerName: p.name }); }); });
  const listaOpcoes = opcoesPlanas.map((o, i) => i + ": " + o.horario + " com " + o.providerName).join("\n");
  const prompt = "Opcoes disponiveis:\n" + listaOpcoes + "\n\nMensagem do cliente: \"" + customerMessage + "\"\n\nO cliente DEVE informar um horario especifico. Se informou apenas profissional SEM horario, responda: nenhum. Se informou horario, escolha o indice correspondente. Responda APENAS o numero ou nenhum.";
  const resposta = await generateResponse({ systemPrompt: "Voce e um classificador preciso. Responda apenas o numero ou nenhum.", conversationHistory: [{ role: "user", content: prompt }] });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    const msg = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente nao informou o horario desejado. Peca gentilmente que informe o horario especifico." }] });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  const escolha = opcoesPlanas[parseInt(resposta.trim(), 10)];
  if (!escolha) {
    await sendTextMessage({ to: customerPhone, message: "Nao consegui identificar. Pode confirmar o horario e a profissional?", phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
    return;
  }

  await supabase.from("tp_appointments").update({ status: "cancelado" }).eq("id", agendamento.id);

  const customerName = lead?.name || null;
  await criarAgendamento({
    company,
    provider: { id: escolha.providerId, name: escolha.providerName, phone: null },
    service: { id: agendamento.serviceId, name: agendamento.serviceName },
    scheduledAt: new Date(escolha.horarioISO),
    customerPhone,
    customerName
  });

  const { data: providerData } = await supabase
    .from("tp_providers")
    .select("phone")
    .eq("id", escolha.providerId)
    .single();

  if (providerData?.phone) {
    const msgProfissional = "Ola " + escolha.providerName + "! Houve um reagendamento: " + agendamento.serviceName + " com " + (customerName || customerPhone) + " foi remarcado para " + diaLabel + " as " + escolha.horario + ". Confirma? Responda SIM ou NAO.";
    await sendTextMessage({ to: providerData.phone, message: msgProfissional, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  }

  const confirmacao = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: "O cliente remarcou " + agendamento.serviceName + " com " + escolha.providerName + " para " + diaLabel + " as " + escolha.horario + ". Confirme de forma calorosa que o horario foi remarcado e que avisara quando a profissional confirmar." }] });
  await sendTextMessage({ to: customerPhone, message: confirmacao, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  await clearConversationState({ companyId: company.id, customerPhone });
}