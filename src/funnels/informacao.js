import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { loadKnowledge, loadKnowledgePhase } from "../services/knowledge.js";
import { getOrCreateLead } from "../crm/crmService.js";
import { montarMemoriaCliente } from "../flows/memoriaCliente.js";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;
  const lead = await getOrCreateLead({ companyId: company.id, customerPhone });
  const knowledge = loadKnowledge(company.client_key);
  const phase = lead?.stage || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);
  const memoria = await montarMemoriaCliente({ companyId: company.id, customerPhone, leadId: lead?.id });
  const systemPrompt = [knowledge, phaseKnowledge, memoria].filter(Boolean).join("\n\n");
  const resposta = await generateResponse({ systemPrompt, conversationHistory: [{ role: "user", content: customerMessage }] });
  if (resposta) {
    await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
  }
}
