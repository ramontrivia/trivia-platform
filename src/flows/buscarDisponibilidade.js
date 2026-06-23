// =====================================================================
// buscarDisponibilidade.js
// Encontra prestadores e horários livres, respeitando o pedido do
// cliente (período do dia, data específica, semana específica, etc.)
//
// CASOS COBERTOS:
//   - Sem preferência → próximos 6 dias úteis, todos os horários
//   - "Parte da manhã" → slots entre 09:00 e 12:00
//   - "Parte da tarde" → slots entre 12:00 e 18:00
//   - Data específica → só aquele dia (até 30 dias no futuro)
//   - "Próxima semana" → dias úteis da semana seguinte
//   - "Essa semana" → dias úteis restantes desta semana
//
// REGRA FIXA: salão funciona terça a sábado. Domingo e segunda
// são bloqueados por código, independente do que o cliente pedir.
// =====================================================================

import { supabase } from "../services/supabase.js";

const DIAS_FECHADO = [0, 1]; // 0 = domingo, 1 = segunda-feira
const JANELA_PADRAO_DIAS = 6;
const JANELA_MAXIMA_DIAS = 30;

// Períodos do dia
const PERIODOS = {
  manha: { inicio: 9, fim: 12 },
  tarde: { inicio: 12, fim: 18 },
  todos: { inicio: 0, fim: 24 },
};

/**
 * Busca prestadores que fazem um serviço, com seus horários livres.
 *
 * @param {object} params
 * @param {number} params.serviceId
 * @param {number} params.companyId
 * @param {Date}   [params.dataEspecifica] - data exata pedida pelo cliente
 * @param {string} [params.periodo]        - "manha" | "tarde" | "todos"
 * @param {Date[]} [params.diasEspecificos] - lista de dias (ex: próxima semana)
 * @returns {Array} lista de { provider, slots: [Date, ...] }
 */
export async function buscarDisponibilidade({
  serviceId,
  companyId,
  dataEspecifica,
  periodo = "todos",
  diasEspecificos,
}) {
  // 1. Quem faz esse serviço
  const { data: vinculos } = await supabase
    .from("tp_provider_services")
    .select("provider_id")
    .eq("service_id", serviceId);

  if (!vinculos || vinculos.length === 0) return [];

  const providerIds = vinculos.map((v) => v.provider_id);

  const { data: providers } = await supabase
    .from("tp_providers")
    .select("*")
    .in("id", providerIds)
    .eq("active", true);

  if (!providers || providers.length === 0) return [];

  // 2. Define os dias a verificar
  let dias;
  if (dataEspecifica) {
    // Cliente pediu um dia específico
    const dataValida = validarDataFutura(dataEspecifica);
    if (!dataValida) return [];
    dias = [dataEspecifica];
  } else if (diasEspecificos && diasEspecificos.length > 0) {
    // Lista de dias específicos (ex: próxima semana)
    dias = diasEspecificos.filter((d) => !DIAS_FECHADO.includes(d.getDay()));
  } else {
    // Padrão: próximos N dias úteis
    dias = proximosDiasUteis(JANELA_PADRAO_DIAS);
  }

  // 3. Define o filtro de período do dia
  const filtroPeriodo = PERIODOS[periodo] || PERIODOS.todos;

  // 4. Calcula slots livres por prestador
  const resultado = [];

  for (const provider of providers) {
    const slots = await calcularSlotsLivres({
      provider,
      serviceId,
      dias,
      filtroPeriodo,
    });
    if (slots.length > 0) {
      resultado.push({ provider, slots });
    }
  }

  return resultado;
}

/**
 * Gera os próximos N dias úteis (pulando domingo e segunda).
 */
export function proximosDiasUteis(quantidade) {
  const dias = [];
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (dias.length < quantidade) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    if (!DIAS_FECHADO.includes(cursor.getDay())) {
      dias.push(new Date(cursor));
    }
  }

  return dias;
}

/**
 * Gera os dias úteis da próxima semana (segunda a domingo → filtra terça a sábado).
 */
export function diasDaProximaSemana() {
  const hoje = new Date();
  const diaDaSemana = hoje.getDay();
  const diasAteProximaSegunda = 7 - diaDaSemana + 1;
  const proximaSegunda = new Date(hoje);
  proximaSegunda.setDate(hoje.getDate() + diasAteProximaSegunda);
  proximaSegunda.setHours(0, 0, 0, 0);

  const dias = [];
  for (let i = 0; i < 7; i++) {
    const dia = new Date(proximaSegunda);
    dia.setDate(proximaSegunda.getDate() + i);
    if (!DIAS_FECHADO.includes(dia.getDay())) {
      dias.push(dia);
    }
  }
  return dias;
}

/**
 * Gera os dias úteis restantes desta semana.
 */
export function diasRestantesDaSemana() {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const diaDaSemana = hoje.getDay();
  const diasAteSabado = 6 - diaDaSemana;

  const dias = [];
  for (let i = 1; i <= diasAteSabado; i++) {
    const dia = new Date(hoje);
    dia.setDate(hoje.getDate() + i);
    if (!DIAS_FECHADO.includes(dia.getDay())) {
      dias.push(dia);
    }
  }
  return dias;
}

/**
 * Verifica se uma data está no futuro e dentro da janela de 30 dias.
 */
function validarDataFutura(data) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(hoje.getDate() + JANELA_MAXIMA_DIAS);

  if (data < hoje) return false;
  if (data > limite) return false;
  if (DIAS_FECHADO.includes(data.getDay())) return false;

  return true;
}

/**
 * Calcula slots livres de um prestador nos dias informados,
 * respeitando o horário de trabalho, os agendamentos existentes,
 * e o filtro de período do dia (manhã/tarde/todos).
 */
async function calcularSlotsLivres({ provider, serviceId, dias, filtroPeriodo }) {
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
    // Dupla checagem: nunca domingo ou segunda
    if (DIAS_FECHADO.includes(dia.getDay())) continue;

    const horarioDoDia = (workingHours || []).find(
      (wh) => wh.day_of_week === dia.getDay()
    );
    if (!horarioDoDia) continue;

    const [horaInicio, minInicio] = horarioDoDia.start_time.split(":").map(Number);
    const [horaFim, minFim] = horarioDoDia.end_time.split(":").map(Number);

    // Aplica o filtro de período do dia
    const horaInicioEfetiva = Math.max(horaInicio, filtroPeriodo.inicio);
    const horaFimEfetiva = Math.min(horaFim, filtroPeriodo.fim);

    if (horaInicioEfetiva >= horaFimEfetiva) continue;

    const inicioDoDia = new Date(dia);
    inicioDoDia.setHours(horaInicioEfetiva, minInicio, 0, 0);

    const fimDoDia = new Date(dia);
    fimDoDia.setHours(horaFimEfetiva, minFim === undefined ? 0 : minFim, 0, 0);

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