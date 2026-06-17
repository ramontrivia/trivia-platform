// =====================================================================
// openai.js
// Tudo relacionado a CONVERSAR com a IA (OpenAI), via axios.
//
// Este arquivo é FIXO — a forma de "perguntar" para a IA é igual
// para todos os clientes. O que muda é o CONTEÚDO do prompt enviado
// (a personalidade, o tom, a postura por temperatura) — isso é
// montado pelo funil específico, usando knowledge/{cliente}/ e o
// manual de postura do crmService.js, e só então passado para esta
// função.
// =====================================================================

import axios from "axios";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/**
 * Envia um prompt completo (já montado com personalidade + postura +
 * contexto da conversa) para a IA, e retorna o texto de resposta.
 *
 * @param {object} params
 * @param {string} params.systemPrompt - instruções de sistema (personalidade, postura, regras)
 * @param {Array}  params.conversationHistory - histórico da conversa, no formato [{ role, content }]
 * @returns {string} a resposta gerada pela IA
 */
export async function generateResponse({ systemPrompt, conversationHistory }) {
  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error(
      "Erro ao gerar resposta da IA:",
      error.response?.data || error.message
    );
    return null;
  }
}