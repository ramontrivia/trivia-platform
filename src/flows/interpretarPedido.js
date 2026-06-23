// =====================================================================
// interpretarPedido.js
// Interpreta a mensagem do cliente e extrai:
//   - periodo: "manha" | "tarde" | "todos"
//   - dataEspecifica: Date ou null
//   - diasEspecificos: Date[] ou null
//   - ehNovaBusca: true se o cliente está pedindo novos horários
// =====================================================================

import { generateResponse } from "../services/openai.js";
import { diasDaProximaSemana, diasRestantesDaSemana } from "./buscarDisponibilidade.js";

/**
 * Usa a IA pra interpretar o pedido do cliente e retorna
 * os parâmetros de busca corretos.
 */
export async function interpretarPedido(customerMessage) {
  const hoje = new Date();
  const prompt = `
Hoje é ${hoje.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}.

O cliente de um salão de beleza mandou esta mensagem: "${customerMessage}"

Analise e responda APENAS com um JSON válido, sem explicações, sem markdown:
{
  "ehPedidoDeHorario": true ou false,
  "periodo": "manha" ou "tarde" ou "todos",
  "tipoData": "especifica" ou "essa_semana" ou "proxima_semana" ou "padrao",
  "dataISO": "YYYY-MM-DD" ou null
}

Regras:
- ehPedidoDeHorario: true se o cliente está pedindo pra ver horários disponíveis, uma data diferente, ou um período específico
- periodo: "manha" se mencionar manhã, cedo, antes do almoço. "tarde" se mencionar tarde, após almoço, depois do almoço. "todos" se não especificar
- tipoData: "especifica" se mencionar um dia concreto (ex: sexta, dia 25, quinta-feira). "essa_semana" se falar nessa semana. "proxima_semana" se falar semana que vem. "padrao" se não especificar data
- dataISO: a data específica no formato YYYY-MM-DD se tipoData for "especifica", senão null
`.trim();

  try {
    const resposta = await generateResponse({
      systemPrompt: "Você é um interpretador preciso. Responda apenas com JSON válido.",
      conversationHistory: [{ role: "user", content: prompt }],
    });

    const clean = resposta.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return parsed;
  } catch {
    return {
      ehPedidoDeHorario: false,
      periodo: "todos",
      tipoData: "padrao",
      dataISO: null,
    };
  }
}

/**
 * Converte o resultado do interpretarPedido nos parâmetros
 * que o buscarDisponibilidade espera.
 */
export function extrairParametrosBusca(interpretacao) {
  const params = {
    periodo: interpretacao.periodo || "todos",
    dataEspecifica: null,
    diasEspecificos: null,
  };

  if (interpretacao.tipoData === "especifica" && interpretacao.dataISO) {
    const [ano, mes, dia] = interpretacao.dataISO.split("-").map(Number);
    params.dataEspecifica = new Date(ano, mes - 1, dia);
  } else if (interpretacao.tipoData === "proxima_semana") {
    params.diasEspecificos = diasDaProximaSemana();
  } else if (interpretacao.tipoData === "essa_semana") {
    params.diasEspecificos = diasRestantesDaSemana();
  }

  return params;
}
