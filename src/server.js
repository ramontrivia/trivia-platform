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
import fetch from "node-fetch";
import FormData from "form-data";
import OpenAI from "openai";
import { handleIncomingMessage } from "./core/orchestrator.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------------------------------------------------------
// Função: baixa o áudio da Meta e transcreve com Whisper
// -------------------------------------------------------
async function transcreverAudio(mediaId, token) {
  // 1. Pega a URL real do arquivo de áudio
  const metaRes = await fetch(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const metaData = await metaRes.json();
  const audioUrl = metaData.url;

  // 2. Baixa o arquivo de áudio
  const audioRes = await fetch(audioUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const audioBuffer = await audioRes.buffer();

  // 3. Monta o FormData para enviar ao Whisper
  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: "audio.ogg",
    contentType: "audio/ogg",
  });
  form.append("model", "whisper-1");
  form.append("language", "pt");

  // 4. Envia ao Whisper e retorna o texto
  const whisperRes = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        ...form.getHeaders(),
      },
      body: form,
    }
  );
  const whisperData = await whisperRes.json();
  return whisperData.text || "";
}

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
      return res.sendStatus(200);
    }

    let textoFinal = "";

    if (messageData.type === "audio") {
      // Mensagem de áudio — transcreve com Whisper
      console.log("🎙️ Áudio recebido, transcrevendo...");
      const token = process.env.WHATSAPP_TOKEN;
      const mediaId = messageData.audio.id;
      textoFinal = await transcreverAudio(mediaId, token);
      console.log("📝 Transcrição:", textoFinal);
    } else {
      // Mensagem de texto normal
      textoFinal = messageData.text?.body || "";
    }

    if (!textoFinal) {
      // Mensagem sem texto nem áudio reconhecível (ex: imagem, sticker)
      return res.sendStatus(200);
    }

    const incomingMessage = {
      from: messageData.from,
      text: textoFinal,
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