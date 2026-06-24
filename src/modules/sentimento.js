// =====================================================================
// sentimento.js
// Módulo de análise de sentimento.
// Ao encerrar conversa, classifica: satisfeito, neutro ou frustrado.
// Se frustrado, alerta o dono imediatamente.
// =====================================================================

import { generateResponse } from "../services/openai.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { supabase } from "../services/supabase.js";

const NUMERO_DONO = "553196073905";

export async function analisarSentimento({ company, customerPhone, customerName, mensagens }) {
  if (!mensagens || mensagens.length === 0) return;

  const historico = mensagens.join("\n");

  const prompt = "Analise o sentimento do cliente nessa conversa de WhatsApp com um salão de beleza.\n\nConversa:\n" + historico + "\n\nClassifique o sentimento geral do cliente em UMA palavra: satisfeito, neutro ou frustrado.\n\nResponda APENAS com uma dessas três palavras.";

  const resposta = await generateResponse({
    systemPrompt: "Voce e um classificador preciso de sentimento. Responda apenas com: satisfeito, neutro ou frustrado.",
    conversationHistory: [{ role: "user", content: prompt }]
  });

  if (!resposta) return;

  const sentimento = resposta.trim().toLowerCase();
  console.log("💭 Sentimento detectado:", sentimento, "| Cliente:", customerPhone);

  await supabase
    .from("tp_leads")
    .update({ ultimo_sentimento: sentimento })
    .eq("company_id", company.id)
    .eq("phone", customerPhone);

  if (sentimento === "frustrado") {
    const nomeCliente = customerName || customerPhone;
    const alerta = "⚠️ *ALERTA — CLIENTE FRUSTRADO*\n\n" +
      "Cliente: " + nomeCliente + "\n" +
      "Telefone: " + customerPhone + "\n\n" +
      "Resumo da conversa:\n" + historico.slice(0, 500) + (historico.length > 500 ? "..." : "") +
      "\n\nEntre em contato para resolver! 🙏";

    await sendTextMessage({
      to: NUMERO_DONO,
      message: alerta,
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token
    });

    console.log("🚨 Alerta de cliente frustrado enviado para o dono!");
  }
}