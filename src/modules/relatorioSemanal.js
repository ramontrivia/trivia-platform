// =====================================================================
// relatorioSemanal.js
// Dois relatórios:
// 1. Domingo 14h — balanço da semana que encerrou
// 2. Segunda 18h — prévia da semana que está iniciando
// =====================================================================

import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

async function buscarAdminsEEmpresas() {
  const { data: companies } = await supabase
    .from("tp_companies")
    .select("id, name, phone_number_id, whatsapp_token")
    .eq("active", true);
  return companies || [];
}

// -------------------------------------------------------
// RELATÓRIO 1 — Domingo 14h
// Balanço da semana que encerrou (segunda a sábado)
// -------------------------------------------------------
export async function enviarRelatorioSemanal() {
  console.log("📊 Relatório Semanal (balanço) iniciado...");

  const hoje = new Date();
  const inicioSemana = new Date(hoje);
  inicioSemana.setDate(hoje.getDate() - 6); // segunda passada
  inicioSemana.setHours(0, 0, 0, 0);
  const fimSemana = new Date(hoje);
  fimSemana.setHours(23, 59, 59, 999);

  const companies = await buscarAdminsEEmpresas();
  let totalEnviados = 0;

  for (const company of companies) {
    const { data: admins } = await supabase
      .from("tp_admins")
      .select("phone, name")
      .eq("company_id", company.id);

    if (!admins || admins.length === 0) continue;

    const { data: agendamentos } = await supabase
      .from("tp_appointments")
      .select("id, status, service_id, avaliacao, customer_phone")
      .eq("company_id", company.id)
      .gte("scheduled_at", inicioSemana.toISOString())
      .lte("scheduled_at", fimSemana.toISOString());

    const total = agendamentos?.length || 0;
    const confirmados = agendamentos?.filter((a) => ["confirmado", "concluido"].includes(a.status)).length || 0;
    const cancelados = agendamentos?.filter((a) => a.status === "cancelado").length || 0;

    const avaliacoes = agendamentos?.filter((a) => a.avaliacao > 0).map((a) => a.avaliacao) || [];
    const mediaAvaliacao = avaliacoes.length > 0 ? (avaliacoes.reduce((a, b) => a + b, 0) / avaliacoes.length).toFixed(1) : "N/A";

    const contagem = {};
    const serviceIds = [...new Set((agendamentos || []).map((a) => a.service_id))];
    if (serviceIds.length > 0) {
      const { data: servicos } = await supabase.from("tp_services").select("id, name").in("id", serviceIds);
      const mapaServicos = {};
      (servicos || []).forEach((s) => { mapaServicos[s.id] = s.name; });
      (agendamentos || []).forEach((a) => {
        const nome = mapaServicos[a.service_id] || "Desconhecido";
        contagem[nome] = (contagem[nome] || 0) + 1;
      });
    }
    const topServicos = Object.entries(contagem)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([nome, qtd]) => nome + " (" + qtd + "x)")
      .join(", ");

    const { data: novosLeads } = await supabase
      .from("tp_leads")
      .select("id")
      .eq("company_id", company.id)
      .gte("created_at", inicioSemana.toISOString())
      .lte("created_at", fimSemana.toISOString());

    const { data: listaEspera } = await supabase
      .from("tp_waitlist")
      .select("id")
      .eq("company_id", company.id);

    const novosClientes = novosLeads?.length || 0;
    const emEspera = listaEspera?.length || 0;
    const taxaCancelamento = total > 0 ? ((cancelados / total) * 100).toFixed(0) : "0";

    const dataInicio = inicioSemana.toLocaleDateString("pt-BR");
    const dataFim = hoje.toLocaleDateString("pt-BR");

    const relatorio =
      "📊 *BALANÇO DA SEMANA — Espaço Chanell*\n" +
      "Período: " + dataInicio + " a " + dataFim + "\n\n" +
      "📅 *Agendamentos*\n" +
      "Total: " + total + "\n" +
      "Realizados: " + confirmados + "\n" +
      "Cancelados: " + cancelados + " (" + taxaCancelamento + "%)\n\n" +
      "⭐ *Avaliação média:* " + mediaAvaliacao + (avaliacoes.length > 0 ? " (" + avaliacoes.length + " avaliações)" : "") + "\n\n" +
      (topServicos ? "💇 *Serviços mais pedidos:*\n" + topServicos + "\n\n" : "") +
      "👥 *Clientes novos:* " + novosClientes + "\n" +
      "⏳ *Na lista de espera:* " + emEspera + "\n\n" +
      "Boa semana! 🌸";

    for (const admin of admins) {
      try {
        await sendTextMessage({
          to: admin.phone,
          message: relatorio,
          phoneNumberId: company.phone_number_id,
          whatsappToken: company.whatsapp_token,
        });
        console.log("📊 Balanço semanal enviado para:", admin.phone);
        totalEnviados++;
      } catch (err) {
        console.error("❌ Erro ao enviar balanço:", err.message);
      }
    }
  }

  console.log("📊 Balanço semanal concluído — Enviados:", totalEnviados);
  return { sucesso: true, enviados: totalEnviados };
}

// -------------------------------------------------------
// RELATÓRIO 2 — Segunda 18h
// Prévia da semana que está iniciando (terça a sábado)
// -------------------------------------------------------
export async function enviarPreviaSemanal() {
  console.log("📅 Prévia Semanal iniciada...");

  const hoje = new Date();
  const inicioPrevia = new Date(hoje);
  inicioPrevia.setDate(hoje.getDate() + 1); // amanhã (terça)
  inicioPrevia.setHours(0, 0, 0, 0);
  const fimPrevia = new Date(hoje);
  fimPrevia.setDate(hoje.getDate() + 6); // sábado
  fimPrevia.setHours(23, 59, 59, 999);

  const companies = await buscarAdminsEEmpresas();
  let totalEnviados = 0;

  for (const company of companies) {
    const { data: admins } = await supabase
      .from("tp_admins")
      .select("phone, name")
      .eq("company_id", company.id);

    if (!admins || admins.length === 0) continue;

    const { data: agendamentos } = await supabase
      .from("tp_appointments")
      .select("id, scheduled_at, service_id, provider_id, customer_name")
      .eq("company_id", company.id)
      .in("status", ["aguardando_aprovacao", "confirmado"])
      .gte("scheduled_at", inicioPrevia.toISOString())
      .lte("scheduled_at", fimPrevia.toISOString())
      .order("scheduled_at", { ascending: true });

    const total = agendamentos?.length || 0;

    // Agrupa por dia
    const porDia = {};
    const serviceIds = [...new Set((agendamentos || []).map((a) => a.service_id))];
    const providerIds = [...new Set((agendamentos || []).map((a) => a.provider_id))];

    let mapaServicos = {};
    let mapaProviders = {};

    if (serviceIds.length > 0) {
      const { data: servicos } = await supabase.from("tp_services").select("id, name").in("id", serviceIds);
      (servicos || []).forEach((s) => { mapaServicos[s.id] = s.name; });
    }
    if (providerIds.length > 0) {
      const { data: providers } = await supabase.from("tp_providers").select("id, name").in("id", providerIds);
      (providers || []).forEach((p) => { mapaProviders[p.id] = p.name; });
    }

    (agendamentos || []).forEach((a) => {
      const data = new Date(a.scheduled_at).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
      if (!porDia[data]) porDia[data] = [];
      porDia[data].push({
        hora: new Date(a.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        servico: mapaServicos[a.service_id] || "Serviço",
        profissional: mapaProviders[a.provider_id] || "Profissional",
        cliente: a.customer_name || "Cliente"
      });
    });

    const dataInicio = inicioPrevia.toLocaleDateString("pt-BR");
    const dataFim = fimPrevia.toLocaleDateString("pt-BR");

    let relatorio = "📅 *PRÉVIA DA SEMANA — Espaço Chanell*\n" +
      "Período: " + dataInicio + " a " + dataFim + "\n" +
      "Total de agendamentos: " + total + "\n\n";

    if (total === 0) {
      relatorio += "Nenhum agendamento confirmado para esta semana ainda.";
    } else {
      Object.entries(porDia).forEach(([dia, ags]) => {
        relatorio += "📆 *" + dia.charAt(0).toUpperCase() + dia.slice(1) + "* (" + ags.length + " agendamentos)\n";
        ags.forEach((a) => {
          relatorio += "  " + a.hora + " — " + a.servico + " com " + a.profissional + " (" + a.cliente + ")\n";
        });
        relatorio += "\n";
      });
    }

    relatorio += "Boa semana para toda a equipe! 💪🌸";

    for (const admin of admins) {
      try {
        await sendTextMessage({
          to: admin.phone,
          message: relatorio,
          phoneNumberId: company.phone_number_id,
          whatsappToken: company.whatsapp_token,
        });
        console.log("📅 Prévia semanal enviada para:", admin.phone);
        totalEnviados++;
      } catch (err) {
        console.error("❌ Erro ao enviar prévia:", err.message);
      }
    }
  }

  console.log("📅 Prévia semanal concluída — Enviados:", totalEnviados);
  return { sucesso: true, enviados: totalEnviados };
}