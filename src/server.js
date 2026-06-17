// =====================================================================
// server.js
// O "porteiro" da plataforma. Recebe os avisos da Meta (WhatsApp)
// pela internet, confere se são legítimos, e entrega para o
// orchestrator cuidar do resto.
//
// Este arquivo é FIXO — nunca contém lógica de negócio, só a parte
// de "atender a porta" e validar o que chega.
// =====================================================================

import express from "express";
import { handleIncomingMessage } from "./core/orchestrator.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// A Meta usa este endpoint (GET) só para confirmar, na primeira vez,
// que esta URL realmente pertence a você. É uma verificação única.
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Este é o endpoint (POST) que recebe as mensagens de verdade,
// toda vez que alguém escreve no WhatsApp de um cliente.
app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    const phoneNumberId = value?.metadata?.phone_number_id;
    const messageData = value?.messages?.[0];

    if (!phoneNumberId || !messageData) {
      // Pode ser um evento que não é mensagem (ex: status de entrega).
      // Não é erro, só não há nada a fazer aqui.
      return res.sendStatus(200);
    }

    const incomingMessage = {
      from: messageData.from,
      text: messageData.text?.body || "",
    };

    await handleIncomingMessage(incomingMessage, phoneNumberId);

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro ao processar webhook:", error.message);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Trivia Platform rodando na porta ${PORT}`);
});