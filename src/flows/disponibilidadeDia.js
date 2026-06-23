import { supabase } from "../services/supabase.js";

// Lista os proximos dias disponiveis (terca a sabado), formatados
export function listarProximosDias(quantidade) {
  const DIAS_FECHADO = [0, 1];
  const nomes = ["domingo", "segunda", "terca", "quarta", "quinta", "sexta", "sabado"];
  const dias = [];
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (dias.length < quantidade) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    if (!DIAS_FECHADO.includes(cursor.getDay())) {
      dias.push({ data: new Date(cursor), label: nomes[cursor.getDay()] + ", " + cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) });
    }
  }
  return dias;
}

// Monta os horarios livres de um dia, AGRUPADOS POR HORARIO
// Retorna: [{ horario: "09:00", horarioISO, profissionais: [{id, name}] }]
export async function horariosDoDia({ serviceId, companyId, data }) {
  const { data: vinculos } = await supabase.from("tp_provider_services").select("provider_id").eq("service_id", serviceId);
  if (!vinculos || vinculos.length === 0) return [];
  const providerIds = vinculos.map((v) => v.provider_id);
  const { data: providers } = await supabase.from("tp_providers").select("*").in("id", providerIds).eq("active", true);
  if (!providers) return [];

  const { data: service } = await supabase.from("tp_services").select("duration_minutes").eq("id", serviceId).single();
  const duracao = service?.duration_minutes || 60;
  const diaSemana = data.getDay();

  const mapa = {};
  for (const provider of providers) {
    const { data: wh } = await supabase.from("tp_working_hours").select("*").eq("provider_id", provider.id).eq("day_of_week", diaSemana).single();
    if (!wh) continue;
    const [hi, mi] = wh.start_time.split(":").map(Number);
    const [hf, mf] = wh.end_time.split(":").map(Number);

    const { data: apts } = await supabase.from("tp_appointments").select("scheduled_at").eq("provider_id", provider.id).in("status", ["aguardando_aprovacao", "confirmado", "em_atendimento"]);
    const ocupados = new Set((apts || []).map((a) => new Date(a.scheduled_at).getTime()));

    const inicio = new Date(data); inicio.setHours(hi, mi, 0, 0);
    const fim = new Date(data); fim.setHours(hf, mf, 0, 0);
    let cursor = new Date(inicio);
    while (cursor.getTime() + duracao * 60000 <= fim.getTime()) {
      if (!ocupados.has(cursor.getTime())) {
        const chave = cursor.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
        if (!mapa[chave]) mapa[chave] = { horario: chave, horarioISO: cursor.toISOString(), profissionais: [] };
        mapa[chave].profissionais.push({ id: provider.id, name: provider.name });
      }
      cursor = new Date(cursor.getTime() + duracao * 60000);
    }
  }
  return Object.values(mapa).sort((a, b) => a.horario.localeCompare(b.horario));
}
