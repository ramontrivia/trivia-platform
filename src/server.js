import express from "express";
import fetch from "node-fetch";
import FormData from "form-data";
import OpenAI from "openai";
import { handleIncomingMessage } from "./core/orchestrator.js";
import { enviarLembretes } from "./modules/lembrete.js";
import { enviarPedidosAvaliacao } from "./modules/avaliacao.js";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function transcreverAudio(mediaId, token) {
  const metaRes = await fetch(
    `https://graph.facebook.com/v19.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const metaData = await metaRes.json();
  const audioUrl = metaData.url;

  const audioRes = await fetch(audioUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const audioBuffer = await audioRes.buffer();

  const form = new FormData();
  form.append("file", audioBuffer, {
    filename: "audio.ogg",
    contentType: "audio/ogg",
  });
  form.append("model", "whisper-1");
  form.append("language", "pt");

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
      console.log("🎙️ Áudio recebido, transcrevendo...");
      const token = process.env.WHATSAPP_TOKEN;
      const mediaId = messageData.audio.id;
      textoFinal = await transcreverAudio(mediaId, token);
      console.log("📝 Transcrição:", textoFinal);
    } else {
      textoFinal = messageData.text?.body || "";
    }

    if (!textoFinal) {
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

// -------------------------------------------------------
// POST /lembrete — disparado pelo N8N todo dia às 8h
// -------------------------------------------------------
app.post("/lembrete", async (req, res) => {
  try {
    const token = req.headers["x-trivia-token"];
    if (token !== process.env.VERIFY_TOKEN) {
      return res.status(401).json({ erro: "Token inválido" });
    }
    console.log("⏰ Endpoint /lembrete chamado pelo N8N");
    const resultado = await enviarLembretes();
    res.status(200).json(resultado);
  } catch (error) {
    console.error("Erro no endpoint /lembrete:", error.message);
    res.status(500).json({ erro: error.message });
  }
});

// -------------------------------------------------------
// POST /avaliacao — disparado pelo N8N a cada hora
// -------------------------------------------------------
app.post("/avaliacao", async (req, res) => {
  try {
    const token = req.headers["x-trivia-token"];
    if (token !== process.env.VERIFY_TOKEN) {
      return res.status(401).json({ erro: "Token inválido" });
    }
    console.log("⭐ Endpoint /avaliacao chamado pelo N8N");
    const resultado = await enviarPedidosAvaliacao();
    res.status(200).json(resultado);
  } catch (error) {
    console.error("Erro no endpoint /avaliacao:", error.message);
    res.status(500).json({ erro: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Trivia Platform rodando na porta ${PORT}`);
});