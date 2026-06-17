// =====================================================================
// whatsapp.js
// Tudo relacionado a ENVIAR mensagens de volta para o WhatsApp,
// via API da Meta (Graph API).
//
// Este arquivo é FIXO — a forma de enviar mensagem é igual para
// todos os clientes. O que muda é qual empresa.whatsapp_token e
// empresa.phone_number_id são usados em cada chamada (isso vem do
// banco, não está escrito aqui).
// =====================================================================

import axios from "axios";

const GRAPH_VERSION = process.env.GRAPH_VERSION || "v19.0";

/**
 * Envia uma mensagem de texto simples para um cliente no WhatsApp.
 *
 * @param {object} params
 * @param {string} params.to - telefone do cliente que vai receber (com código do país)
 * @param {string} params.message - o texto da mensagem
 * @param {string} params.phoneNumberId - o número da empresa que está enviando (vem de company.phone_number_id)
 * @param {string} params.whatsappToken - o token daquela empresa (vem de company.whatsapp_token)
 */
export async function sendTextMessage({ to, message, phoneNumberId, whatsappToken }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`;

  try {
    await axios.post(
      url,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: message },
      },
      {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error(
      "Erro ao enviar mensagem WhatsApp:",
      error.response?.data || error.message
    );
  }
}