// crmService.js
import { supabase } from "../services/supabase.js";

export const STAGES = {
  FRIO: "frio",
  MORNO: "morno",
  QUENTE: "quente",
};

export const POSTURE_BY_STAGE = {
  [STAGES.FRIO]: {
    persona: "anfitria",
    objetivo: "reduzir defesa e ganhar a primeira micro-confianca",
    pode: ["gerar valor gratuito", "fazer perguntas leves", "espelhar o tom do lead"],
    proibido: ["falar preco", "mandar link de pagamento", "criar urgencia", "pressionar agendamento"],
  },
  [STAGES.MORNO]: {
    persona: "consultora",
    objetivo: "transformar interesse em desejo, construir autoridade",
    pode: ["diagnosticar antes de sugerir", "usar prova social", "pintar o resultado desejado"],
    proibido: ["fechar na marra", "despejar todas as opcoes de uma vez", "sumir depois de gerar interesse"],
  },
  [STAGES.QUENTE]: {
    persona: "fechadora",
    objetivo: "facilitar o sim e remover atrito",
    pode: ["oferecer caminho direto (A ou B)", "usar escassez real", "reduzir risco percebido"],
    proibido: ["reabrir explicacao longa", "dar opcoes demais", "demorar para responder"],
  },
};

/**
 * Busca um lead existente pelo telefone + empresa, ou cria um novo.
 */
export async function getOrCreateLead({ companyId, customerPhone }) {
  const { data: existingLead } = await supabase
    .from("tp_leads")
    .select("*")
    .eq("company_id", companyId)
    .eq("phone", customerPhone)
    .single();

  if (existingLead) return existingLead;

  const { data: newLead, error } = await supabase
    .from("tp_leads")
    .insert({ company_id: companyId, phone: customerPhone, stage: STAGES.FRIO })
    .select()
    .single();

  if (error) { console.error("Erro ao criar novo lead:", error.message); return null; }
  return newLead;
}

/**
 * Registra a mensagem do cliente com role: "user".
 */
export async function registerInteraction({ companyId, customerPhone, rawMessage }) {
  const lead = await getOrCreateLead({ companyId, customerPhone });
  if (!lead) { console.error("Nao foi possivel registrar interacao: lead nao encontrado/criado."); return; }

  await supabase.from("tp_lead_interactions").insert({
    lead_id: lead.id,
    message: rawMessage,
    role: "user",
  });

  return lead;
}

/**
 * Salva a resposta gerada pela IA com role: "assistant".
 */
export async function saveAiResponse({ leadId, response }) {
  if (!leadId || !response) return;
  await supabase.from("tp_lead_interactions").insert({
    lead_id: leadId,
    message: response,
    role: "assistant",
  });
}

/**
 * Move o lead para o proximo estagio.
 */
export async function advanceStage({ companyId, customerPhone }) {
  const lead = await getOrCreateLead({ companyId, customerPhone });
  if (!lead) return;
  const stages = [STAGES.FRIO, STAGES.MORNO, STAGES.QUENTE];
  const currentIndex = stages.indexOf(lead.stage);
  const nextStage = stages[Math.min(currentIndex + 1, stages.length - 1)];
  const { error } = await supabase.from("tp_leads").update({ stage: nextStage }).eq("id", lead.id);
  if (error) console.error("Erro ao avancar estagio do lead:", error.message);
}

/**
 * Retorna o manual de postura para o estagio atual.
 */
export function getPostureForStage(stage) {
  return POSTURE_BY_STAGE[stage] || POSTURE_BY_STAGE[STAGES.FRIO];
}

/**
 * Trava de seguranca — impede acoes de risco fora de hora.
 */
export function podeExecutarAcao(stage, actionType) {
  const ACOES_DE_RISCO = ["enviar_preco", "enviar_link_pagamento", "fechar_proposta"];
  if (!ACOES_DE_RISCO.includes(actionType)) return true;
  return stage === STAGES.QUENTE;
}
