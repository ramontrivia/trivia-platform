// =====================================================================
// informacao.js
// Funil para empresas do tipo "informacao" — como a TRÍVIA.
// A Mel recebe a mensagem, carrega o knowledge do cliente,
// e responde de forma humanizada usando a IA.
// =====================================================================

import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { loadKnowledge, loadKnowledgePhase } from "../services/knowledge.js";

export async function handleMessage({ company, incomingMessage }) {
  const customerPhone = incomingMessage.from;
  const customerMessage = incomingMessage.text;

  // Carrega o knowledge base do cliente (ex: knowledge/trivia/)
  const knowledge = loadKnowledge(company.client_key);

  // Carrega a fase do lead (frio/morno/quente) — padrão: frio
  const phase = company.lead_phase || "frio";
  const phaseKnowledge = loadKnowledgePhase(company.client_key, phase);

  // Monta o system prompt completo
  const systemPrompt = [knowledge, phaseKnowledge]
    .filter(Boolean)
    .join("\n\n");

  // Gera a resposta com a IA
  const resposta = await generateResponse({
    systemPrompt,
    conversationHistory: [{ role: "user", content: customerMessage }],
  });

  if (resposta) {
    await sendTextMessage({
      to: customerPhone,
      message: resposta,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
  }
}