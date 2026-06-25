import { supabase } from "../services/supabase.js";
import { generateResponse } from "../services/openai.js";

export async function identificarServico({ companyId, customerMessage }) {
  const { data: services, error } = await supabase
    .from("tp_services")
    .select("*")
    .eq("company_id", companyId);

  if (error || !services || services.length === 0) {
    console.error("Erro ao buscar serviços da empresa:", error?.message);
    return null;
  }

  const listaServicos = services.map((s) => `- ${s.name} (id: ${s.id})`).join("\n");

  const prompt = `
Você é um especialista em salões de beleza brasileiro. Um cliente enviou uma mensagem e você precisa identificar qual serviço ele deseja.

IMPORTANTE: Clientes falam de formas muito variadas. Use seu conhecimento para interpretar:
- "quero cortar o cabelo", "tirar dois dedos", "dar uma aparada", "fazer um corte", "quero um cortinho" → Corte
- "fazer as unhas", "fazer a mão", "quero uma manicure", "pintar as unhas das mãos" → Mão
- "fazer o pé", "pedicure", "pintar as unhas dos pés" → Pé
- "mão e pé", "fazer as unhas todas", "manicure e pedicure" → Pé e Mão
- "fazer as sobrancelhas", "dar um jeito nas sobrancelhas", "sobrancelha" → Sobrancelha
- "fazer escova", "alisar o cabelo", "quero uma escova" → Escova
- "fazer um penteado", "arrumar o cabelo", "quero um penteado especial" → Penteado
- "colorir o cabelo", "tingir", "pintar o cabelo", "quero mudar a cor" → Coloração
- "fazer mechas", "luzes", "californianas" → Mechas
- "fazer progressiva", "progressiva brasileira", "alisar definitivo" → Progressiva
- "fazer botox capilar", "botox no cabelo" → Botox
- "fazer selagem", "selagem capilar" → Selagem
- "quero um tratamento no cabelo", "hidratação" → Tratamento Capilar
- "fazer depilação da perna", "depilar as pernas" → Perna
- "depilar a virilha", "depilação íntima" → Virilha
- "depilação corporal", "depilar o corpo" → Corporal
- "fazer maquiagem", "quero me maquiar", "make" → Maquiagem
- "fazer facial", "limpeza de pele", "cuidar da pele do rosto" → Facial
- "fazer buco", "buço", "depilação do buço" → Buco
- "prime liss", "primeliss" → Prime Liss

Lista de serviços disponíveis neste salão:
${listaServicos}

Mensagem do cliente: "${customerMessage}"

Responda APENAS com o id do serviço identificado (apenas o número).
Se não conseguir identificar nenhum serviço com confiança, responda exatamente: nenhum
`.trim();

  const resposta = await generateResponse({
    systemPrompt: "Você é um classificador preciso de serviços de salão de beleza. Responda apenas o número do id ou nenhum.",
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

  if (service.terceirizado) {
    return { service, hasProvider: false, terceirizado: true };
  }

  const { data: vinculos } = await supabase
    .from("tp_provider_services")
    .select("provider_id")
    .eq("service_id", service.id);

  const hasProvider = vinculos && vinculos.length > 0;

  return { service, hasProvider, terceirizado: false };
}