import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

export async function enviarLembretes() {
  console.log("⏰ Módulo Lembrete iniciado...");

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  const fimHoje = new Date();
  fimHoje.setHours(23, 59, 59, 999);

  const { data: agendamentos, error } = await supabase
    .from("tp_appointments")
    .select("id, scheduled_at, customer_phone, customer_name, service_id, provider_id, company_id")
    .eq("status", "confirmado")
    .gte("scheduled_at", hoje.toISOString())
    .lte("scheduled_at", fimHoje.toISOString());

  if (error) {
    console.error("Erro ao buscar agendamentos:", error.message);
    return { sucesso: false, erro: error.message };
  }

  if (!agendamentos || agendamentos.length === 0) {
    console.log("✅ Nenhum agendamento confirmado para hoje.");
    return { sucesso: true, enviados: 0 };
  }

  console.log("📋 Agendamentos encontrados:", agendamentos.length);

  const companyIds = [...new Set(agendamentos.map((a) => a.company_id))];
  const servIds = [...new Set(agendamentos.map((a) => a.service_id))];
  const provIds = [...new Set(agendamentos.map((a) => a.provider_id))];

  const { data: companies } = await supabase.from("tp_companies").select("id, phone_number_id, whatsapp_token, name").in("id", companyIds);
  const { data: servs } = await supabase.from("tp_services").select("id, name").in("id", servIds);
  const { data: provs } = await supabase.from("tp_providers").select("id, name").in("id", provIds);

  const mapaEmpresas = {};
  const mapaServicos = {};
  const mapaProviders = {};
  (companies || []).forEach((c) => { mapaEmpresas[c.id] = c; });
  (servs || []).forEach((s) => { mapaServicos[s.id] = s.name; });
  (provs || []).forEach((p) => { mapaProviders[p.id] = p.name; });

  let enviados = 0;
  let erros = 0;

  for (const agendamento of agendamentos) {
    try {
      const empresa = mapaEmpresas[agendamento.company_id];
      if (!empresa) continue;

      const nomeCliente = agendamento.customer_name || "cliente";
      const nomeServico = mapaServicos[agendamento.service_id] || "serviço";
      const nomeProfissional = mapaProviders[agendamento.provider_id] || "profissional";
      const hora = new Date(agendamento.scheduled_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

      const mensagem = `Bom dia, ${nomeCliente}! ☀️ Hoje é dia de se cuidar! 💇‍♀️\n\nSeu ${nomeServico} com ${nomeProfissional} está confirmado para às ${hora}.\n\nEstamos ansiosas para te receber no Espaço Channel! Te esperamos! 🌸`;

      await sendTextMessage({
        to: agendamento.customer_phone,
        message: mensagem,
        phoneNumberId: empresa.phone_number_id,
        whatsappToken: empresa.whatsapp_token,
      });

      console.log("✅ Lembrete enviado para:", agendamento.customer_phone);
      enviados++;
    } catch (err) {
      console.error("❌ Erro ao enviar lembrete para:", agendamento.customer_phone, err.message);
      erros++;
    }
  }

  console.log("⏰ Lembretes concluídos — Enviados:", enviados, "| Erros:", erros);
  return { sucesso: true, enviados, erros };
}
