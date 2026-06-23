@'
import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";

export async function criarAgendamento({ company, provider, service, scheduledAt, customerPhone, customerName }) {
  const { data: appointment, error } = await supabase
    .from("tp_appointments")
    .insert({
      company_id: company.id,
      provider_id: provider.id,
      service_id: service.id,
      customer_phone: customerPhone,
      customer_name: customerName || null,
      scheduled_at: scheduledAt.toISOString(),
      status: "aguardando_aprovacao",
    })
    .select()
    .single();

  if (error) {
    console.error("Erro ao criar agendamento:", error.message);
    return null;
  }

  if (provider.phone && provider.phone !== "null" && !provider.phone.includes("provisorio")) {
    const dataFormatada = scheduledAt.toLocaleDateString("pt-BR");
    const horaFormatada = scheduledAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    const nomeCliente = customerName || "Cliente";
    await sendTextMessage({
      to: provider.phone,
      message: nomeCliente + " agendou " + service.name + " para " + dataFormatada + " as " + horaFormatada + ". Confirme respondendo OK.",
      phoneNumberId: company.phone_number_id,
      whatsappToken: company.whatsapp_token,
    });
  }

  return appointment;
}
'@ | Out-File -FilePath "src\flows\criarAgendamento.js" -Encoding utf8