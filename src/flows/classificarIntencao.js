import { generateResponse } from "../services/openai.js";

export async function classificarIntencao(customerMessage) {
  const prompt = [
    "Voce classifica a mensagem de um cliente de salao de beleza em UMA categoria.",
    "",
    "Mensagem do cliente: \"" + customerMessage + "\"",
    "",
    "Categorias possiveis:",
    "- listar_servicos: o cliente quer saber QUAIS servicos o salao oferece (ex: o que voces fazem, quais servicos tem, que tipo de servico)",
    "- listar_profissionais: o cliente quer saber QUAIS profissionais existem (ex: quais profissionais tem, quem sao as profissionais, me fala os nomes)",
    "- agendar: o cliente quer marcar ou fazer um servico especifico (ex: quero cortar o cabelo, fazer as unhas, agendar manicure, depilacao)",
    "- conversar: saudacao, agradecimento, duvida geral ou qualquer outra coisa",
    "",
    "Responda APENAS com o nome da categoria, sem explicacao. Exemplo: agendar",
  ].join("\n");

  const resposta = await generateResponse({
    systemPrompt: "Voce e um classificador preciso. Responda apenas com o nome da categoria.",
    conversationHistory: [{ role: "user", content: prompt }],
  });

  if (!resposta) return "conversar";
  const intencao = resposta.trim().toLowerCase();
  const validas = ["listar_servicos", "listar_profissionais", "agendar", "conversar"];
  return validas.includes(intencao) ? intencao : "conversar";
}
