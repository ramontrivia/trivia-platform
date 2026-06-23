async function responderComIA({ company, customerPhone, customerMessage, systemPrompt }) {
  const resposta = await generateResponse({ 
    systemPrompt, 
    conversationHistory: [{ 
      role: "user", 
      content: "O cliente enviou: \"" + customerMessage + "\". Responda de forma natural e humanizada. NÃO liste serviços, NÃO pergunte o que deseja agendar. Apenas responda o que foi dito de forma acolhedora e simples."
    }] 
  });
  if (resposta) await sendTextMessage({ to: customerPhone, message: resposta, phoneNumberId: company.phone_number_id, whatsappToken: company.whatsapp_token });
}