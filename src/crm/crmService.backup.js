// =====================================================================
// crmService.js
// O "termÃ´metro" do lead + o "manual de postura" por temperatura.
// Funciona igual para QUALQUER atendente (Mel, ou a atendente de
// qualquer cliente futuro) e qualquer tipo de negÃ³cio â€” por isso vive
// aqui em src/crm/, fora dos funnels e fora do knowledge de cada cliente.
//
// O QUE MORA AQUI (fixo, universal):
//   - a rÃ©gua frio -> morno -> quente
//   - a postura esperada em cada fase (AnfitriÃ£ / Consultora / Fechadora)
//   - a trava de seguranÃ§a que impede aÃ§Ãµes de risco fora de hora
//
// O QUE NÃƒO MORA AQUI (varia por cliente, vive em knowledge/{cliente}/):
//   - o nome da atendente (Mel, ou outro nome)
//   - as frases exatas, gÃ­rias, exemplos especÃ­ficos do negÃ³cio
// =====================================================================

import { supabase } from "../services/supabase.js";

export const STAGES = {
  FRIO: "frio",
  MORNO: "morno",
  QUENTE: "quente",
};

// O "manual de postura" â€” universal, baseado no princÃ­pio mestre:
// temperatura = nÃ­vel de confianÃ§a + nÃ­vel de consciÃªncia do problema.
export const POSTURE_BY_STAGE = {
  [STAGES.FRIO]: {
    persona: "anfitriÃ£",
    objetivo: "reduzir defesa e ganhar a primeira micro-confianÃ§a",
    pode: ["gerar valor gratuito", "fazer perguntas leves", "espelhar o tom do lead"],
    proibido: ["falar preÃ§o", "mandar link de pagamento", "criar urgÃªncia", "pressionar agendamento"],
  },
  [STAGES.MORNO]: {
    persona: "consultora",
    objetivo: "transformar interesse em desejo, construir autoridade",
    pode: ["diagnosticar antes de sugerir", "usar prova social", "pintar o resultado desejado"],
    proibido: ["fechar na marra", "despejar todas as opÃ§Ãµes de uma vez", "sumir depois de gerar interesse"],
  },
  [STAGES.QUENTE]: {
    persona: "fechadora",
    objetivo: "facilitar o sim e remover atrito",
    pode: ["oferecer caminho direto (A ou B)", "usar escassez real", "reduzir risco percebido"],
    proibido: ["reabrir explicaÃ§Ã£o longa", "dar opÃ§Ãµes demais", "demorar para responder"],
  },
};

/**
 * Busca um lead existente pelo telefone + empresa, ou cria um novo
 * caso seja a primeira vez que esse telefone fala com essa empresa.
 */
export async function getOrCreateLead({ companyId, customerPhone }) {
  const { data: existingLead } = await supabase
    .from("tp_leads")
    .select("*")
    .eq("company_id", companyId)
    .eq("phone", customerPhone)
    .single();

  if (existingLead) {
    return existingLead;
  }

  const { data: newLead, error } = await supabase
    .from("tp_leads")
    .insert({
      company_id: companyId,
      phone: customerPhone,
      stage: STAGES.FRIO,
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar novo lead:", error.message);
    return null;
  }

  return newLead;
}

/**
 * Registra que uma interaÃ§Ã£o aconteceu. Chamado pelo orchestrator
 * toda vez que uma mensagem chega, independente do tipo de negÃ³cio.
 */
export async function registerInteraction({ companyId, customerPhone, rawMessage }) {
  const lead = await getOrCreateLead({ companyId, customerPhone });

  if (!lead) {
    console.error("NÃ£o foi possÃ­vel registrar interaÃ§Ã£o: lead nÃ£o encontrado/criado.");
    return;
  }

  await supabase.from("tp_lead_interactions").insert({
    lead_id: lead.id,
    message: rawMessage,
  });

  // TODO: regra de quando avanÃ§ar de estÃ¡gio (frio -> morno -> quente)
  // serÃ¡ refinada conforme observarmos o comportamento real dos clientes.

  return lead;
}

/**
 * Move o lead para um novo estÃ¡gio (chamado pelos funnels quando algo
 * importante acontece â€” ex: cliente confirmou um agendamento).
 */
export async function advanceStage({ leadId, newStage }) {
  const { error } = await supabase
    .from("tp_leads")
    .update({ stage: newStage })
    .eq("id", leadId);

  if (error) {
    console.error("Erro ao avanÃ§ar estÃ¡gio do lead:", error.message);
  }
}

/**
 * Retorna o "manual de postura" daquele estÃ¡gio â€” usado para montar
 * o prompt da IA junto com o knowledge especÃ­fico do cliente.
 */
export function getPostureForStage(stage) {
  return POSTURE_BY_STAGE[stage] || POSTURE_BY_STAGE[STAGES.FRIO];
}

/**
 * TRAVA DE SEGURANÃ‡A.
 * Verifica se uma aÃ§Ã£o de risco (ex: mandar preÃ§o, link de pagamento,
 * proposta fechada) Ã© permitida para a temperatura atual do lead.
 *
 * Isso NÃƒO depende da IA lembrar a regra â€” Ã© uma barreira de cÃ³digo,
 * para o "erro fatal" que tratar lead frio como quente representa.
 *
 * @param {string} stage - a temperatura atual do lead
 * @param {string} actionType - ex: "enviar_preco", "enviar_link_pagamento", "fechar_proposta"
 * @returns {boolean}
 */
export function podeExecutarAcao(stage, actionType) {
  const ACOES_DE_RISCO = ["enviar_preco", "enviar_link_pagamento", "fechar_proposta"];

  if (!ACOES_DE_RISCO.includes(actionType)) {
    return true;
  }

  return stage === STAGES.QUENTE;
}
