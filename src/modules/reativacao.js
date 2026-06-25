// =====================================================================
// reativacao.js
// Módulo de reativação de clientes inativos.
// Disparado toda segunda-feira via N8N.
// Clientes sem agendamento há 30+ dias recebem mensagem calorosa.
// =====================================================================

import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

export async function reativarClientesInativos() {
  console.log("🔄 Módulo Reativação iniciado...");

  const trintaDiasAtras = new Date();
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

  // Busca todas as empresas ativas
  const { data: companies } = await supabase
    .from("tp_companies")
    .select("id, name, phone_number_id, whatsapp_token")
    .eq("active", true);

  if (!companies || companies.length === 0) {
    console.log("✅ Nenhuma empresa ativa encontrada.");
    return { sucesso: true, enviados: 0 };
  }

  let totalEnviados = 0;

  for (const company of companies) {
    // Busca leads ativos com pelo menos um agendamento anterior
    const { data: leads } = await supabase
      .from("tp_leads")
      .select("id, name, phone")
      .eq("company_id", company.id)
      .not("name", "is", null);

    if (!leads || leads.length === 0) continue;

    for (const lead of leads) {
      // Verifica último agendamento do cliente
      const { data: ultimoAgendamento } = await supabase
        .from("tp_appointments")
        .select("scheduled_at")
        .eq("company_id", company.id)
        .eq("customer_phone", lead.phone)
        .in("status", ["confirmado", "concluido"])
        .order("scheduled_at", { ascending: false })
        .limit(1)
        .single();

      if (!ultimoAgendamento) continue;

      const dataUltimo = new Date(ultimoAgendamento.scheduled_at);

      // Só reativa se o último agendamento foi há 30+ dias
      if (dataUltimo > trintaDiasAtras) continue;

      // Verifica se já tem agendamento futuro ativo
      const { data: agendamentoFuturo } = await supabase
        .from("tp_appointments")
        .select("id")
        .eq("company_id", company.id)
        .eq("customer_phone", lead.phone)
        .in("status", ["aguardando_aprovacao", "confirmado"])
        .gte("scheduled_at", new Date().toISOString())
        .limit(1)
        .single();

      if (agendamentoFuturo) continue;

      const nomeCliente = lead.name || "cliente";
      const diasInativo = Math.floor((new Date() - dataUltimo) / (1000 * 60 * 60 * 24));

      const mensagem = "Oi " + nomeCliente + "! 💇‍♀️ Sentimos sua falta no Espaço Chanell!\n\nFaz " + diasInativo + " dias que você não nos visita... Que tal agendar um horário e se cuidar um pouco? 🌸\n\nEstamos com a agenda aberta e a equipe pronta para te receber com todo carinho. É só me chamar aqui!";

      try {
        await sendTextMessage({
          to: lead.phone,
          message: mensagem,
          phoneNumberId: company.phone_number_id,
          whatsappToken: company.whatsapp_token,
        });

        console.log("🔄 Reativação enviada para:", lead.phone, "| Inativo há", diasInativo, "dias");
        totalEnviados++;
      } catch (err) {
        console.error("❌ Erro ao reativar:", lead.phone, err.message);
      }
    }
  }

  console.log("🔄 Reativação concluída — Enviados:", totalEnviados);
  return { sucesso: true, enviados: totalEnviados };
}