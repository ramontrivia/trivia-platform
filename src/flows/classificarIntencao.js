import { generateResponse } from "../services/openai.js";

export async function classificarIntencao(customerMessage) {
  const prompt = [
    "Voce classifica a mensagem de um cliente de salao de beleza em UMA categoria.",
    "",
    "Mensagem do cliente: \"" + customerMessage + "\"",
    "",
    "Categorias e exemplos:",
    "- listar_servicos: 'quais servicos voces tem?', 'o que voces fazem?'",
    "- listar_profissionais: 'quais profissionais tem?', 'quem trabalha ai?'",
    "- agendar: 'quero agendar', 'quero marcar um horario', 'quero fazer escova'",
    "- cancelar: 'quero cancelar', 'cancela meu horario'",
    "- reagendar: 'quero remarcar', 'quero reagendar', 'preciso mudar meu horario', 'quero trocar meu horario', 'preciso alterar meu agendamento'",
    "- humano: 'quero falar com alguem', 'me passa para um atendente', 'quero falar com uma pessoa'",
    "- conversar: saudacao, agradecimento, duvida geral ou qualquer outra coisa",
    "",
    "IMPORTANTE: se o cliente mencionar remarcar, reagendar, mudar ou trocar um horario JA EXISTENTE, classifique como reagendar.",
    "Responda APENAS com o nome da categoria, sem explicacao.",
  ].join("\n");

  const resposta = await generateResponse({
    systemPrompt: "Voce e um classificador preciso. Responda apenas com o nome da categoria.",
    conversationHistory: [{ role: "user", content: prompt }],
  });

  if (!resposta) return "conversar";
  const intencao = resposta.trim().toLowerCase();
  const validas = ["listar_servicos", "listar_profissionais", "agendar", "cancelar", "reagendar", "humano", "conversar"];
  return validas.includes(intencao) ? intencao : "conversar";
}