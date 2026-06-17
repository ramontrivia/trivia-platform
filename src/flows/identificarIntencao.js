// =====================================================================
// identificarIntencao.js
// Descobre qual serviço o cliente quer, a partir da fala natural dele.
// Também checa se esse serviço tem prestador cadastrado (se não tiver,
// é um serviço de parceiro, e precisa ser direcionado para o
// telefone administrativo/comercial).
// =====================================================================

import { supabase } from "../services/supabase.js";
import { generateResponse } from "../services/openai.js";

/**
 * Tenta identificar qual serviço (da tabela tp_services) o cliente
 * está pedindo, a partir do texto da mensagem.
 *
 * @param {object} params
 * @param {number} params.companyId
 * @param {string} params.customerMessage - o texto que o cliente mandou
 * @returns {object|null} { service, hasProvider } ou null se não identificou nada
 */
export async function identificarServico({ companyId, customerMessage }) {
  const { data: services, error } = await supabase
    .from("tp_services")
    .select("*")
    .eq("company_id", companyId);

  if (error || !services || services.length === 0) {
    console.error("Erro ao buscar serviços da empresa:", error?.message);
    return null;
  }

  // Monta a lista de serviços para a IA escolher entre eles
  const listaServicos = services.map((s) => `- ${s.name} (id: ${s.id})`).join("\n");

  const prompt = `
Você recebe a mensagem de um cliente de um salão de beleza e precisa
identificar qual serviço, dentre a lista abaixo, ele está pedindo.

Lista de serviços disponíveis:
${listaServicos}

Mensagem do cliente: "${customerMessage}"

Responda APENAS com o id do serviço identificado (apenas o número).
Se não conseguir identificar nenhum serviço com confiança, responda
exatamente: nenhum
`.trim();

  const resposta = await generateResponse({
    systemPrompt: "Você é um classificador preciso. Responda apenas o que foi pedido, sem explicações.",
    conversationHistory: [{ role: "user", content: prompt }],
  });

  if (!resposta || resposta.trim().toLowerCase() === "nenhum") {
    return null;
  }

  const serviceId = parseInt(resposta.trim(), 10);
  const service = services.find((s) => s.id === serviceId);

  if (!service) {
    return null;
  }

  // Checa se existe algum prestador vinculado a esse serviço
  const { data: vinculos } = await supabase
    .from("tp_provider_services")
    .select("provider_id")
    .eq("service_id", service.id);

  const hasProvider = vinculos && vinculos.length > 0;

  return { service, hasProvider };
}