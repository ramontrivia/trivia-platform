import { supabase } from "../services/supabase.js";
import { sendTextMessage } from "../services/whatsapp.js";
import { generateResponse } from "../services/openai.js";

const TELEFONE_RECEPCAO = "553196073905";

export async function verificarEscalada({ company, customerPhone }) {
  const { data: lead } = await supabase
    .from("tp_leads")
    .select("ultimo_sentimento, name")
    .eq("company_id", company.id)
    .eq("phone", customerPhone)
    .single();

  if (!lead || lead.ultimo_sentimento !== "frustrado") return false;

  const trintaMinAtras = new Date(Date.now() - 30 * 60 * 1000);
  const { data: agendamentoRecente } = await supabase
    .from("tp_appointments")
    .select("id")
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone)
    .gte("created_at", trintaMinAtras.toISOString())
    .limit(1)
    .single();

  if (agendamentoRecente) return false;

  return { escalar: true, nomeCliente: lead.name };
}

export async function escalarParaHumano({ company, customerPhone, customerName, systemPrompt }) {
  console.log("🚨 Escalando para humano:", customerPhone);

  // Busca histórico recente
  const { data: interacoes } = await supabase
    .from("tp_lead_interactions")
    .select("message, created_at")
    .eq("company_id", company.id)
    .eq("customer_phone", customerPhone)
    .order("created_at", { ascending: false })
    .limit(6);

  const historico = (interacoes || [])
    .reverse()
    .map((i) => i.message)
    .filter(Boolean)
    .join("\n");

  // Avisa o cliente
  const msgCliente = await generateResponse({
    systemPrompt,
    conversationHistory: [{
      role: "user",
      content: "O cliente está com dificuldade e precisa de atendimento humano. Avise de forma calorosa que nossa equipe vai entrar em contato em breve para resolver. Seja breve e acolhedora."
    }]
  });

  await sendTextMessage({
    to: customerPhone,
    message: msgCliente,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token
  });

  const nomeCliente = customerName || customerPhone;
  const msgAlerta = "🚨 *ESCALADA PARA HUMANO*\n\n" +
    "Cliente: " + nomeCliente + "\n" +
    "Telefone: " + customerPhone + "\n\n" +
    "Últimas mensagens:\n" + historico + "\n\n" +
    "Entre em contato agora! 📞";

  // Envia para recepção
  await sendTextMessage({
    to: TELEFONE_RECEPCAO,
    message: msgAlerta,
    phoneNumberId: company.phone_number_id,
    whatsappToken: company.whatsapp_token
  });

  // Busca telefones da Fernanda e Natália
  const { data: gerentes } = await supabase
    .from("tp_providers")
    .select("name, phone")
    .eq("company_id", company.id)
    .in("name", ["Fernanda", "Natalia"]);

  for (const gerente of (gerentes || [])) {
    if (gerente.phone) {
      await sendTextMessage({
        to: gerente.phone,
        message: msgAlerta,
        phoneNumberId: company.phone_number_id,
        whatsappToken: company.whatsapp_token
      });
      console.log("🚨 Alerta enviado para gerente:", gerente.name);
    }
  }

  // Reseta sentimento para não escalar de novo
  await supabase
    .from("tp_leads")
    .update({ ultimo_sentimento: "escalado" })
    .eq("company_id", company.id)
    .eq("phone", customerPhone);

  console.log("✅ Escalada concluída para:", customerPhone);
  return true;
}