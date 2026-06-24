// =====================================================================
// memoriaRica.js
// Módulo de memória rica — extrai e salva informações relevantes
// do cliente durante qualquer conversa, passivamente.
// =====================================================================

import { generateResponse } from "../services/openai.js";
import { supabase } from "../services/supabase.js";

export async function extrairEsalvarMemoria({ companyId, customerPhone, customerMessage, leadId }) {
  if (!leadId || !customerMessage) return;

  const prompt = `Analise essa mensagem de um cliente de salão de beleza e extraia informações relevantes para personalizar o atendimento futuro.

Mensagem: "${customerMessage}"

Extraia APENAS se houver informação clara. Responda em JSON com estes campos (deixe null se não houver):
{
  "notas_pessoais": "eventos especiais, ocasiões, contexto pessoal mencionado (ex: casamento em outubro, aniversário semana que vem)",
  "horario_preferido": "horário ou período do dia preferido (ex: manhãs, depois das 14h, sábados)",
  "profissional_favorita": "nome de profissional preferida se mencionada",
  "ultima_observacao": "qualquer observação relevante sobre preferências de serviço, cabelo, etc"
}

Responda APENAS o JSON, sem explicação.`;

  const resposta = await generateResponse({
    systemPrompt: "Voce extrai informacoes de clientes de salao de beleza. Responda apenas JSON valido.",
    conversationHistory: [{ role: "user", content: prompt }]
  });

  if (!resposta) return;

  try {
    const clean = resposta.replace(/```json|```/g, "").trim();
    const dados = JSON.parse(clean);

    const update = {};
    if (dados.notas_pessoais) update.notas_pessoais = dados.notas_pessoais;
    if (dados.horario_preferido) update.horario_preferido = dados.horario_preferido;
    if (dados.profissional_favorita) update.profissional_favorita = dados.profissional_favorita;
    if (dados.ultima_observacao) update.ultima_observacao = dados.ultima_observacao;

    if (Object.keys(update).length > 0) {
      await supabase.from("tp_leads").update(update).eq("id", leadId);
      console.log("🧠 Memória rica atualizada para:", customerPhone, update);
    }
  } catch (err) {
    // JSON inválido — ignora silenciosamente
  }
}