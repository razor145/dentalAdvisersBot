require("dotenv").config();
const generateDiagnosticReport = require("./diagnosticReport");
console.log("TYPE:", typeof generateDiagnosticReport);
console.log("VALUE:", generateDiagnosticReport);
const express = require("express");
const multer = require("multer");
/*
const path = require("path");

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname); // get original extension
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + ext); // save with extension
  }
});
*/

const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "uploads");

// Ensure directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir); // ✅ absolute path
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + "-" + Math.round(Math.random() * 1E9);
    cb(null, uniqueName + ext);
  }
});

const upload = multer({ storage: storage });
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors()); // ✅ THIS FIXES IT
app.use(express.json());


const conversations = {};

const companyKnowledge = require("./knowledge");


const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});



const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

async function sendEmail(subject, message) {
  await transporter.sendMail({
    from: `"Integrity Heating AI" <${process.env.EMAIL_USER}>`,
    to: "info@integrityheatpumps.co.uk",
    subject: subject,
    text: message
  });
}

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



// ----------------------------
// AI Endpoint with auto-book
// ----------------------------
app.post("/ai", async (req, res) => {
  try {
    const { message, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ error: "userId required" });
    }

    // -------------------------
    // Helper to enforce phrases
    // -------------------------
    function ensurePhrase(reply, phrases, fallbackPhrase) {
      const replyLower = reply.toLowerCase();
      const containsRequiredPhrase = phrases.some(p =>
        replyLower.includes(p.toLowerCase())
      );

      if (!containsRequiredPhrase) {
        return reply + `\n\n${fallbackPhrase}`;
      }

      return reply;
    }

    // Initialize conversation
    if (!conversations[userId]) {
      conversations[userId] = [
        {
          role: "system",
          content: `
You are Hector, an AI assistant representing Integrity Heating Company.
Initially when customer greets you, always introduce yourself and company.

Here is company information:
${companyKnowledge}

Always answer using this information.
If question is unrelated to heating services, politely redirect to services.
Respond professionally and clearly.

You diagnose heating issues and determine if a technician visit is required.

IMPORTANT RULES:

If a technician visit is required, you MUST include one of these phrases:
- requires a technician visit
- site visit required
- technician visit required
- engineer visit required
- cannot be resolved remotely
- requires on-site inspection

If an appointment is booked, you MUST include one of these phrases:
- appointment scheduled
- visit scheduled
- technician visit scheduled
- engineer visit scheduled
- appointment booked
- visit booked
- service visit scheduled
- a technician will visit you
- an engineer will visit you

If a visit is required, you MUST confirm the booking.
Do not use phrases like "we will contact you" or "we will escalate".
`
        }
      ];
    }

    // Explicit visit requests
    const visitKeywords = [
      "arrange visit",
      "book appointment",
      "come to my house",
      "need a technician",
      "send someone",
      "send technician",
      "send engineer",
      "i need a visit",
      "book a visit",
      "schedule a visit",
      "schedule appointment"
    ];

    // AI visit detection phrases
    const visitPhrases = [
      "requires a technician visit",
      "site visit required",
      "technician visit required",
      "engineer visit required",
      "cannot be resolved remotely",
      "requires on-site inspection"
    ];

    // AI booking phrases
   const bookingConfirmationPhrases = [
  "appointment scheduled",
  "appointment is scheduled",
  "visit scheduled",
  "technician visit scheduled",
  "engineer visit scheduled",
  "appointment booked",
  "visit booked",
  "service visit scheduled",
  "a technician will visit you",
  "an engineer will visit you"
];

    let appointmentBooked = false;
    let aiReply = "";

    // Check explicit visit request
    const isExplicitVisit = visitKeywords.some(keyword =>
      message.toLowerCase().includes(keyword)
    );

    // -------------------------
    // EXPLICIT VISIT REQUEST
    // -------------------------
    if (isExplicitVisit) {
      appointmentBooked = true;

      console.log("🔥 Explicit Visit Request");
      console.log("User:", userId);

      bookAppointment(userId);

      aiReply = `
Thank you for contacting Integrity Heating.

Visit scheduled.
A technician will visit you shortly.
`;
    }

    // -------------------------
    // AI DIAGNOSIS
    // -------------------------
    else {

      conversations[userId].push({
        role: "user",
        content: message
      });

      // Limit memory
      if (conversations[userId].length > 15) {
        conversations[userId].splice(1, 2);
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: conversations[userId]
      });

      aiReply = response.choices[0].message.content;

      conversations[userId].push({
        role: "assistant",
        content: aiReply
      });

      const replyLower = aiReply.toLowerCase();

      const visitDetected = visitPhrases.some(p =>
        replyLower.includes(p)
      );

      const bookingDetected = bookingConfirmationPhrases.some(p =>
        replyLower.includes(p)
      );

      // -------------------------
      // AUTO BOOKING
      // -------------------------
      if (visitDetected || bookingDetected) {

        appointmentBooked = true;

        console.log("🔥 AI Triggered Booking");
        console.log("User:", userId);
        console.log("Reply:", aiReply);

        bookAppointment(userId);

        // ✅ Enforce required visit phrase
        aiReply = ensurePhrase(
          aiReply,
          visitPhrases,
          "Technician visit required."
        );

        // ✅ Enforce required booking confirmation phrase
        aiReply = ensurePhrase(
          aiReply,
          bookingConfirmationPhrases,
          "Visit scheduled. A technician will visit you shortly."
        );
      }
    }

    res.json({
      reply: aiReply,
      appointmentBooked
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "AI request failed" });
  }
});
// 🔔 Appointment booking function
async function bookAppointment(userId, issue = "Issue not provided", diagnosis = "Requires on-site inspection") {

const emailBody = `
SERVICE REQUEST CREATED

Customer Phone:
${userId}

Issue Summary:
${issue}

AI Diagnosis:
${diagnosis}

Action Required:
Technician visit scheduled.

Date Created:
${new Date().toUTCString()}

Source:
AI WhatsApp Assistant (Hector)

Notes:
Customer may require on-site inspection.
`;

await sendEmail(
  "🔧 New Heat Pump Service Request",
  emailBody
);

console.log("📧 Service request email sent");
}
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

// ✅ Add this to your existing Express app

app.post("/contactus", async (req, res) => {
  try {
    const { fullName, email, phone, homeType, message } = req.body;

    // Basic validation
    if (!fullName || !email || !message) {
      return res.status(400).json({
        success: false,
        error: "Full name, email, and message are required."
      });
    }

    // Compose email body
    const emailBody = `
NEW CONTACT US INQUIRY

Full Name: ${fullName}
Email: ${email}
Phone: ${phone || "Not provided"}
Home Type: ${homeType || "Not provided"}

Message:
${message}

Date Submitted: ${new Date().toUTCString()}
`;

    // Send email using your existing transporter
    await transporter.sendMail({
      from: `"Integrity Heating AI" <${process.env.EMAIL_USER}>`,
      to: "info@integrityheatpumps.co.uk",
      subject: "📩 New Contact Us Inquiry",
      text: emailBody
    });

    console.log("📧 Contact us email sent:", fullName);

    res.json({ success: true, message: "Inquiry sent successfully." });

  } catch (err) {
    console.error("Contact Us endpoint error:", err);
    res.status(500).json({ success: false, error: "Failed to send inquiry." });
  }
});

app.post("/diagnostics", upload.array("photos", 7), async (req, res) => {
  try {
    const {
      customerPhone,
      fullName,
      email,
      postcode,
      phoneOptional
    } = req.body;

    const answers = JSON.parse(req.body.answers || "[]");
    const photos = req.files.map(file => file.path);

    // ✅ Validation
    if (
      !customerPhone ||
      !fullName ||
      !email ||
      !postcode ||
      !answers ||
      answers.length !== 10 ||
      photos.length !== 7
    ) {
      return res.status(400).json({
        error: "Invalid input: require customer info, 10 answers, and 7 images"
      });
    }

    // 🤖 Generate report
    const report = await generateDiagnosticReport({
      customerPhone,
      name: fullName,
      email,
      postcode,
      phoneOptional,
      answers,
      photos
    });

    console.log("Generated Diagnostic Report:");
    console.log({
      fullName,
      email,
      postcode,
      customerPhone,
      answersLength: answers.length,
      photosLength: photos.length
    });

    // 📧 Email body
    const emailBody = `
NEW DIAGNOSTIC REPORT

Customer Details:
Name: ${fullName}
Email: ${email}
Phone: ${customerPhone}
Postcode: ${postcode}

----------------------------------------

DIAGNOSTIC REPORT:
${report}

----------------------------------------

Date: ${new Date().toUTCString()}
`;

    // 📧 Send email (NO attachments)
    await transporter.sendMail({
      from: `"Integrity Heating AI" <${process.env.EMAIL_USER}>`,
      to: "enquiry@integrityheatpumps.co.uk",
      subject: "🧠 New Heat Pump Diagnostic Report",
      text: emailBody
    });

    console.log("📧 Diagnostic report email sent");

    // ✅ Response to frontend
    res.json({
      success: true,
      report
    });

  } catch (error) {
    console.error("Diagnostics endpoint error:");
    console.error(error.response?.data || error.message || error);

    res.status(500).json({
      error: "Diagnostics processing failed",
      details: error.response?.data || error.message
    });
  }
});

//
// ✅ IMPORTANT for Render
//
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);