import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { generateResponse } from "../services/openai.js";
import { setConversationState, clearConversationState } from "../flows/conversationState.js";

export async function oferecerListaEspera({ company, customerPhone, customerName, serviceId, serviceName, systemPrompt }) {
  const msg = await generateResponse({
    systemPrompt,
    conversationHistory: [{
      role: "user",
      content: "Nao ha horarios disponiveis para " + serviceName + " no momento. Ofereça ao cliente entrar na lista de espera de forma acolhedora — quando surgir um horário disponível, ela será a primeira a saber. Pergunte se deseja entrar na lista. Seja breve."
    }]
  });
  await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });

  await setConversationState({
    companyId: company.id,
    customerPhone,
    step: "lista_espera_aguardando_confirmacao",
    context: { serviceId, serviceName, customerName }
  });
}

export async function processarRespostaListaEspera({ company, customerPhone, customerMessage, estado, systemPrompt }) {
  const { serviceId, serviceName, customerName } = estado.context;

  const msgUpper = customerMessage.trim().toUpperCase();
  const quer = msgUpper.includes("SIM") || msgUpper.includes("QUERO") || msgUpper.includes("PODE") || msgUpper.includes("OK") || msgUpper.includes("ISSO") || msgUpper.includes("CLARO") || msgUpper.includes("SIM") || msgUpper === "S";

  if (quer) {
    await supabase.from("tp_waitlist").insert({
      company_id: company.id,
      customer_phone: customerPhone,
      customer_name: customerName,
      service_id: serviceId,
      preferred_date: null
    });

    const msg = await generateResponse({
      systemPrompt,
      conversationHistory: [{
        role: "user",
        content: "O cliente aceitou entrar na lista de espera para " + serviceName + ". Confirme de forma calorosa que assim que surgir um horário disponível ela será avisada imediatamente."
      }]
    });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  } else {
    const msg = await generateResponse({
      systemPrompt,
      conversationHistory: [{
        role: "user",
        content: "O cliente nao quer entrar na lista de espera. Responda de forma acolhedora e pergunte se pode ajudar em mais alguma coisa."
      }]
    });
    await sendTextMessage({ to: customerPhone, message: msg, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  }

  await clearConversationState({ companyId: company.id, customerPhone });
}

export async function notificarListaEspera({ company, serviceId, serviceName }) {
  const { data: fila } = await supabase
    .from("tp_waitlist")
    .select("id, customer_phone, customer_name")
    .eq("company_id", company.id)
    .eq("service_id", serviceId)
    .order("created_at", { ascending: true })
    .limit(1);

  if (!fila || fila.length === 0) return;

  const primeiro = fila[0];
  const nomeCliente = primeiro.customer_name || "cliente";

  const mensagem = "Oi " + nomeCliente + "! 🎉 Boa notícia! Abrimos um horário para " + serviceName + " no Espaço Channel. Quer que eu reserve para você? É só me responder!";

  await sendTextMessage({
    to: primeiro.customer_phone,
    message: mensagem,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token
  });

  await supabase.from("tp_waitlist").delete().eq("id", primeiro.id);

  console.log("✅ Lista de espera: notificado", primeiro.customer_phone, "para", serviceName);
}