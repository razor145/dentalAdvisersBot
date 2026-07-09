require("dotenv").config();
const generateDiagnosticReport = require("./diagnosticReportTest");
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
const puppeteer = require("puppeteer-core");
const chromium = require("@sparticuz/chromium");

const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "uploads");
const isProduction = process.env.NODE_ENV === "production";

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

const PDFDocument = require("pdfkit");
/*
function generatePDF(report, customerData) {
  return new Promise((resolve, reject) => {
    try {
      const fileName = `report-${Date.now()}.pdf`;
      const filePath = path.join(__dirname, "uploads", fileName);

      const doc = new PDFDocument({ margin: 50 });

      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      // 🏷️ HEADER
      doc.fontSize(18).text("SERVICE REQUEST REPORT", { align: "center" });
      doc.moveDown();

      // 👤 CUSTOMER DETAILS
      doc.fontSize(12).text("Customer Details", { underline: true });
      doc.text(`Name: ${customerData.fullName}`);
      doc.text(`Email: ${customerData.email}`);
      doc.text(`Phone: ${customerData.customerPhone}`);
      doc.text(`Postcode: ${customerData.postcode}`);
      doc.moveDown();

      // 📄 REPORT CONTENT
      doc.text("Diagnostic Report", { underline: true });
      doc.moveDown();
      doc.fontSize(11).text(report, {
        align: "left"
      });

      doc.moveDown();

      // 📅 FOOTER
      doc.text(`Generated: ${new Date().toUTCString()}`);
      doc.text("Source: AI WhatsApp Assistant (Hector)");

      doc.end();

      stream.on("finish", () => resolve(filePath));
      stream.on("error", reject);

    } catch (err) {
      reject(err);
    }
  });
}
*/

async function generatePDF(report) {
  const fileName = `report-${Date.now()}.pdf`;
  const filePath = path.join(__dirname, "uploads", fileName);

  let html = fs.readFileSync(
    path.join(__dirname, "template.html"),
    "utf8"
  );
const summaryHTML = buildSummaryHTML(report.summary);
const checkRowsHTML = buildCheckRows(report.checks);
const insightsHTML = buildInsightsHTML(report.insights);
  // ✅ BASIC FIELD INJECTION
  html = html
    .replace(/{{FULL_NAME}}/g, report.name)
    .replace(/{{POSTCODE}}/g, report.postcode)
    .replace(/{{REPORT_DATE}}/g, report.reportDate)
    .replace(/{{REFERENCE}}/g, report.reference)
    .replace(/{{PROPERTY_TYPE}}/g, report.propertyType)
    .replace(/{{BEDROOMS}}/g, report.bedrooms)
    .replace(/{{INSULATION}}/g, report.homeInsulation)
    .replace(/{{HEAT_PUMP_MODEL}}/g, report.heatPumpModel)
    .replace(/{{SUMMARY_BLOCK}}/g, summaryHTML)
    .replace(/{{CHECK_ROWS}}/g, checkRowsHTML)
    .replace(/{{INSIGHTS_BLOCK}}/g, insightsHTML);


  // 🔥 BUILD CHECKS UI (THIS IS THE MAGIC)
  let checksHTML = "";

  report.checks.forEach((check) => {
    let color = "#16a34a"; // green
    if (check.status === "ISSUE") color = "#dc2626"; // red
    if (check.status === "ACTION") color = "#f59e0b"; // amber

    checksHTML += `
      <div style="
        border:1px solid #e5e7eb;
        border-left:6px solid ${color};
        padding:12px;
        margin-bottom:10px;
        border-radius:8px;
        background:#f9fafb;
      ">
        <strong>${check.title}</strong><br/>
        <span style="font-weight:600">${check.label}</span><br/>
        <span style="font-size:13px;color:#555">
          ${check.recommendation}
        </span>
      </div>
    `;
  });

  html = html.replace(/{{CHECKS}}/g, checksHTML);

  // 🚀 GENERATE PDF
const browser = await puppeteer.launch(
  isProduction
    ? {
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless
      }
    : {
        headless: true,
        executablePath:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" // Mac
        // Windows example:
        // "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      }
);

  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });

  await page.pdf({
    path: filePath,
    format: "A4",
    printBackground: true
  });

  await browser.close();

  return filePath;
}

app.post("/pdfdiagnostics", upload.array("photos", 7), async (req, res) => {
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

    // 🤖 AI RETURNS JSON NOW
    const report = await generateDiagnosticReport({
      customerPhone,
      fullName,
      email,
      postcode,
      answers,
      photos
    });

    console.log("🧠 AI JSON Report:", report);

    // 🧾 Generate PDF
    const pdfPath = await generatePDF(report, {
      fullName,
      email,
      postcode,
      customerPhone
    });

    console.log("📄 PDF Generated:", pdfPath);
    
let html = fs.readFileSync(
    path.join(__dirname, "template.html"),
    "utf8"
  );
    // 📧 Email
    await transporter.sendMail({
      from: `"Integrity Heating AI" <${process.env.EMAIL_USER}>`,
      to: "enquiry@integrityheatpumps.co.uk",
      subject: "🧠 New Heat Pump Diagnostic Report (PDF)",
  text: "Please find attached the diagnostic report.",
      attachments: [
        {
          filename: "diagnostic-report.pdf",
          path: pdfPath
        }
      ]
    });

    res.json({
      success: true,
      report, // ✅ JSON now
      pdfPath
    });

  } catch (error) {
    console.error("PDF Diagnostics error:");
    console.error(error.response?.data || error.message || error);

    res.status(500).json({
      error: "PDF diagnostics failed",
      details: error.message
    });
  }
});

function buildSummaryHTML(summary) {
  let bg = "#dcfce7";
  let border = "#166534";

  if (summary.level === "AMBER") {
    bg = "#fef3c7";
    border = "#92400e";
  }

  if (summary.level === "RED") {
    bg = "#fee2e2";
    border = "#991b1b";
  }

  const icon = getSummaryIcon(summary.level);

  return `
  <table cellspacing="0" cellpadding="0" style="width:488.05pt; border:0.75pt solid ${border}; border-collapse:collapse;">
    <tbody>
      <tr>
        <td style="padding:8pt 9.62pt; background-color:${bg};">
          <p style="margin:0; font-size:13pt; display:flex; align-items:center; gap:6px;">
            ${icon}
            <strong style="color:${border};">
              ${summary.level} — ${summary.title}
            </strong>
          </p>
          <p style="margin-top:4pt; font-size:10pt; color:${border};">
            ${summary.message}
          </p>
        </td>
      </tr>
    </tbody>
  </table>
  `;
}

function buildCheckRows(checks) {
  return checks.map((check, index) => {
    const bg = index % 2 === 0 ? "#ffffff" : "#f9fafb";

    const icon = getStatusIcon(check.status);

    return `
      <tr>
        <td style="width:338.85pt; border:0.75pt solid #d1d5db; padding:4pt;">
          <p style="margin:0; font-size:9.5pt; color:#374151;">
            ${check.title}
          </p>
        </td>

        <td style="width:124.45pt; border:0.75pt solid #d1d5db; background:#f3f4f6;">
          <p style="margin:0; text-align:center; font-size:9.5pt; display:flex; align-items:center; justify-content:center; gap:4px;">
            ${icon}
            <strong>${check.label}</strong>
          </p>
        </td>
      </tr>
    `;
  }).join("");
}
function getInsightIcon(type) {
  return `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="#6b21a8">
      <path d="M12 2a7 7 0 00-4 12.9V18a1 1 0 001 1h6a1 1 0 001-1v-3.1A7 7 0 0012 2z"/>
    </svg>
  `;
}

function buildInsightsHTML(insights) {
  if (!insights || insights.length === 0) return "";

  return insights.map((item) => {
    const icon = getInsightIcon(item.type);

    return `
      <table cellspacing="0" cellpadding="0" style="width:488.05pt; border:0.75pt solid #6b21a8; margin-bottom:10px;">
        <tr>
          <td style="padding:7pt; background:#ede9fe;">
            <p style="margin:0; font-size:10.5pt; display:flex; align-items:center; gap:6px;">
              ${icon}
              <strong style="color:#6b21a8;">
                ${item.title}
              </strong>
            </p>
            <p style="margin-top:4px; font-size:9.5pt; color:#374151;">
              ${item.description}
            </p>
          </td>
        </tr>
      </table>
    `;
  }).join("");
}


function getStatusIcon(status) {
  if (status === "OK") {
    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#16a34a">
        <path d="M9 16.2l-3.5-3.5-1.4 1.4L9 19 20.3 7.7l-1.4-1.4z"/>
      </svg>
    `;
  }

  if (status === "ISSUE") {
    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#dc2626">
        <path d="M12 2L2 22h20L12 2zm0 14h-1v-2h2v2zm0-4h-1V8h2v4z"/>
      </svg>
    `;
  }

  if (status === "ACTION") {
    return `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="#f59e0b">
        <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/>
      </svg>
    `;
  }

  return "";
}

function getSummaryIcon(level) {
  if (level === "GREEN") return getStatusIcon("OK");
  if (level === "AMBER") return getStatusIcon("ACTION");
  if (level === "RED") return getStatusIcon("ISSUE");
}


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
console.log("AI Reply:", aiReply);
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
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: text ? text.toString().substring(0, 4000) : "No message"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ WhatsApp message sent:", response.data);
    return response.data;

  } catch (err) {
    console.error("❌ WhatsApp Send FAILED:");
    console.error(err.response?.data || err.message || err);
    throw err; // rethrow so caller can handle if needed
  }
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
  to: email,
  subject: "🧠 Your Heat Pump Diagnostic Report",

  // ✅ THIS IS THE KEY CHANGE
  text: "Please find attached the diagnostic report.",

  // ✅ Optional (keep if you want PDF also)
  attachments: [
    {
      filename: "diagnostic-report.pdf",
      path: pdfPath
    }
  ]
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