// =====================================================================
// buscarDisponibilidade.js
// Encontra quais prestadores fazem um serviço, e calcula os horários
// livres de cada um — cruzando o horário de trabalho (tp_working_hours)
// com o que já está ocupado (tp_appointments).
//
// Regra do Espaço Channel: funciona de terça a sábado (nunca domingo
// nem segunda). Por padrão olha os próximos 6 dias; se o cliente pedir
// uma data específica, olha até 30 dias no futuro.
// =====================================================================

import { supabase } from "../services/supabase.js";

const DIAS_FECHADO = [0, 1]; // 0 = domingo, 1 = segunda
const JANELA_PADRAO_DIAS = 6;

/**
 * Busca prestadores que fazem um serviço, com seus horários livres.
 *
 * @param {object} params
 * @param {number} params.serviceId
 * @param {number} params.companyId
 * @param {Date}   [params.dataEspecifica] - se o cliente pediu um dia específico
 * @returns {Array} lista de { provider, slots: [Date, Date, ...] }
 */
export async function buscarDisponibilidade({ serviceId, companyId, dataEspecifica }) {
  const { data: vinculos } = await supabase
    .from("tp_provider_services")
    .select("provider_id")
    .eq("service_id", serviceId);

  if (!vinculos || vinculos.length === 0) {
    return [];
  }

  const providerIds = vinculos.map((v) => v.provider_id);

  const { data: providers } = await supabase
    .from("tp_providers")
    .select("*")
    .in("id", providerIds)
    .eq("active", true);

  if (!providers || providers.length === 0) {
    return [];
  }

  const dias = dataEspecifica
    ? [dataEspecifica]
    : proximosDiasUteis(JANELA_PADRAO_DIAS);

  const resultado = [];

  for (const provider of providers) {
    const slots = await calcularSlotsLivres({ provider, serviceId, dias });
    if (slots.length > 0) {
      resultado.push({ provider, slots });
    }
  }

  return resultado;
}

/**
 * Gera a lista dos próximos N dias úteis (pulando domingo e segunda).
 */
function proximosDiasUteis(quantidade) {
  const dias = [];
  let cursor = new Date();

  while (dias.length < quantidade) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    if (!DIAS_FECHADO.includes(cursor.getDay())) {
      dias.push(new Date(cursor));
    }
  }

  return dias;
}

/**
 * Para um prestador específico, calcula os horários livres dentro
 * dos dias informados, considerando o horário de trabalho dele e
 * os agendamentos que já existem.
 */
async function calcularSlotsLivres({ provider, serviceId, dias }) {
  const { data: service } = await supabase
    .from("tp_services")
    .select("duration_minutes")
    .eq("id", serviceId)
    .single();

  const duracaoMinutos = service?.duration_minutes || 60;

  const { data: workingHours } = await supabase
    .from("tp_working_hours")
    .select("*")
    .eq("provider_id", provider.id);

  const { data: appointments } = await supabase
    .from("tp_appointments")
    .select("scheduled_at")
    .eq("provider_id", provider.id)
    .in("status", ["aguardando_aprovacao", "confirmado", "em_atendimento"]);

  const ocupados = new Set(
    (appointments || []).map((a) => new Date(a.scheduled_at).toISOString())
  );

  const slotsLivres = [];

  for (const dia of dias) {
    if (DIAS_FECHADO.includes(dia.getDay())) continue;

    const horarioDoDia = (workingHours || []).find((wh) => wh.day_of_week === dia.getDay());
    if (!horarioDoDia) continue;

    const [horaInicio, minInicio] = horarioDoDia.start_time.split(":").map(Number);
    const [horaFim, minFim] = horarioDoDia.end_time.split(":").map(Number);

    const inicioDoDia = new Date(dia);
    inicioDoDia.setHours(horaInicio, minInicio, 0, 0);

    const fimDoDia = new Date(dia);
    fimDoDia.setHours(horaFim, minFim, 0, 0);

    let cursor = new Date(inicioDoDia);

    while (cursor.getTime() + duracaoMinutos * 60000 <= fimDoDia.getTime()) {
      const horarioISO = cursor.toISOString();

      if (!ocupados.has(horarioISO)) {
        slotsLivres.push(new Date(cursor));
      }

      cursor = new Date(cursor.getTime() + duracaoMinutos * 60000);
    }
  }

  return slotsLivres;
}