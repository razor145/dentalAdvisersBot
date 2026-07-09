require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());


const conversations = {};

const companyKnowledge = require("./knowledge");


const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

//
// ✅ Health check route (important for Render)
//
app.get("/", (req, res) => {
  res.send("WhatsApp API running 🚀");
});

//
// ✅ Webhook verification (Meta requirement)
//
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

//
// ✅ Receive messages + auto reply
//
/*
app.post("/webhook", async (req, res) => {
  try {
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const userText = message.text?.body;

      console.log("Incoming:", userText);

      await sendWhatsAppMessage(
        from,
        `You said: ${userText}`
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error(
      error.response?.data || error.message
    );
    res.sendStatus(500);
  }
});
*/

//
// ✅ Receive messages + AI reply
//
app.post("/webhook", async (req, res) => {
  try {
     console.log("=== Incoming Webhook ===");
    console.log(JSON.stringify(req.body, null, 2)); // Full payload

    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const userText = message.text?.body;

    console.log("Incoming:", userText);

    // 🧠 Initialize memory for user
    if (!conversations[from]) {
      conversations[from] = [
        {
          role: "system",
          content: `
You are Hector, an AI assistant representing Integrity Heating Company.
Initially when customer greets you, you should always introduce yourself and company.
Here is company information:
${companyKnowledge}
Always answer using this information.
If question is unrelated to heating services, politely redirect to services.
Respond professionally and clearly.
You are a customer agent that asks diagnostic questions and determines
if issue can be solved remotely or requires site visit.
`
        }
      ];
    }

    // Add user message
    conversations[from].push({
      role: "user",
      content: userText
    });

    // Limit memory (cost control)
    if (conversations[from].length > 15) {
      conversations[from].splice(1, 2);
    }

    // 🤖 Call OpenAI
    const aiResponse = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[from]
    });

    const aiReply = aiResponse.choices[0].message.content;

    // Save AI reply
    conversations[from].push({
      role: "assistant",
      content: aiReply
    });

    // 📤 Send AI reply to WhatsApp
    await sendWhatsAppMessage(from, aiReply);

    res.sendStatus(200);

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

//

// 🤖 OpenAI Text Endpoint WITH MEMORY
//
app.post("/ai", async (req, res) => {
  try {
    const { message, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // Initialize conversation for this user
    if (!conversations[userId]) {
      conversations[userId] = [
        {
          role: "system",
          content: `
You are Hector, an AI assistant representing Integrity Heating Company.
Initially when customer greets you, you should always introduce yourself and company.
Here is company information:
${companyKnowledge}

Always answer using this information.
If question is unrelated to heating services, politely redirect to services.
Respond professionally and clearly.
You are a customer agent that asks diagnostic questions and determines
if issue can be solved remotely or requires site visit.
`
        }
      ];
    }

    // Add user message
    conversations[userId].push({
      role: "user",
      content: message
    });

    // Limit memory to last 15 messages (cost control)
    if (conversations[userId].length > 15) {
      conversations[userId].splice(1, 2);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: conversations[userId]
    });

    const aiReply = response.choices[0].message.content;

    // Save assistant reply
    conversations[userId].push({
      role: "assistant",
      content: aiReply
    });

    res.json({ reply: aiReply });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI request failed" });
  }
});
//
// ✅ Reusable Send Function
//
async function sendWhatsAppMessage(to, text) {
  await axios.post(
    `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}


// 🤖 OpenAI Vision Endpoint WITH MEMORY
//
app.post("/vision", async (req, res) => {
  try {
    const { imageUrl, userId, instruction } = req.body;

    if (!userId || !imageUrl) {
      return res.status(400).json({ error: "userId and imageUrl are required" });
    }

    // Initialize conversation memory
    if (!conversations[userId]) {
      conversations[userId] = [
        {
          role: "system",
          content: "You are Hector, an AI assistant representing Integrity Heating Company. Analyze images and respond professionally."
        }
      ];
    }

    // Build messages array
    const messages = conversations[userId].map(msg => ({
      role: msg.role,
      content: [
        { type: "text", text: msg.content }
      ]
    }));

    // Add current user message + image (wrap URL in object)
    messages.push({
      role: "user",
      content: [
        { type: "text", text: instruction || "Analyze this image" },
        { type: "image_url", image_url: { url: imageUrl } }  // ✅ correct object format
      ]
    });

    // Call GPT-4o (vision capable)
    const response = await openai.chat.completions.create({
      model: "gpt-4o",  // or "gpt-4o-mini"
      messages
    });

    const aiReply = response.choices[0].message.content;

    // Save assistant reply
    conversations[userId].push({
      role: "assistant",
      content: aiReply
    });

    res.json({ reply: aiReply });

  } catch (error) {
    console.error("Vision error:", error.response?.data || error.message || error);
    res.status(500).json({ error: "Vision API request failed" });
  }
});

//
// ✅ IMPORTANT for Render
//
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);