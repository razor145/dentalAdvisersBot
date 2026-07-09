const OpenAI = require("openai");
const fs = require("fs");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function formatDate() {
  const date = new Date();
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC"
  }) + " UTC";
}

async function generateDiagnosticReport(data) {
  try {
    const { customerPhone, answers, photos } = data;

    // ✅ VALIDATION
    if (!customerPhone) throw new Error("Customer phone missing");
    if (!answers || answers.length !== 10) throw new Error("10 answers required");
    if (!photos || photos.length !== 7) throw new Error("7 images required");

    const questions = [
      "What type of house do you live in?",
      "How many bedrooms do you have?",
      "How would you describe your home's insulation?",
      "Are some rooms in your home often cold, even when the heating is on?",
      "Do your radiators feel hot to the touch, or just pleasantly warm?",
      "Is your monthly electricity bill high in winter?",
      "Approximately how much is your monthly winter electricity bill?",
      "Do you have to turn the heating up high to feel warm, or are some rooms always colder than others?",
      "Do you adjust the heating overnight?",
      "Does the large fan unit outside seem to run constantly, or does it turn on and off frequently?"
    ];

    const formattedAnswers = answers
      .map((a, i) => `Q${i + 1}: ${questions[i]}\nA: ${a}`)
      .join("\n\n");

    const textPrompt = `
You are a senior HVAC heat pump diagnostic engineer.

You MUST analyse BOTH:
1) Customer answers (10 questions)
2) All 7 uploaded images

--- CUSTOMER DETAILS ---
Phone: ${customerPhone}

--- CUSTOMER RESPONSES ---
${formattedAnswers}

--- IMAGE ANALYSIS INSTRUCTIONS ---
You MUST explicitly analyse each image and describe findings:

Image 1: Outdoor unit (front view)
Image 2: Outdoor unit rear / pipe connections
Image 3: Name plate (model / specs)
Image 4: Main controller display
Image 5: Hot water tank (full view)
Image 6: Pipework around tank
Image 7: Largest radiator

For EACH image:
- Describe what you see
- Identify any faults, inefficiencies, or concerns
- If no issue, explicitly say "No visible issue"

--- IMPORTANT RULES ---
- Combine BOTH answers + images
- Do NOT ignore images
- Be specific and technical
- Use real HVAC reasoning
- If uncertain, give best probable diagnosis
- Assign realistic fault probability (%)

--- OUTPUT FORMAT (STRICT) ---

==============================
      SERVICE REQUEST CREATED
==============================

Customer Phone:
${customerPhone}

Issue Summary:

AI Diagnosis:

--------------------------------

Image Analysis:

Image 1 (Outdoor Unit - Front):
Image 2 (Outdoor Unit - Rear / Pipes):
Image 3 (Name Plate):
Image 4 (Controller Display):
Image 5 (Hot Water Tank):
Image 6 (Pipework):
Image 7 (Radiator):

--------------------------------

Priority Level:
(Low / Medium / High / Urgent)

Fault Probability:
(Estimated % likelihood)

Likely Parts Required:

Recommended Next Step:

--------------------------------

Date Created:
${formatDate()}

Source:
AI WhatsApp Assistant (Hector)

--------------------------------

Technician Notes:
`;

    // 🔥 Convert images to base64
    const imageMessages = photos.map((imgPath) => {
      const imageBuffer = fs.readFileSync(imgPath);
      const base64Image = imageBuffer.toString("base64");

      return {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: `data:image/jpeg;base64,${base64Image}`
            }
          }
        ]
      };
    });

    // 🔥 Final messages
    const messages = [
      {
        role: "system",
        content: "You are a professional HVAC heat pump engineer generating detailed service reports."
      },
      {
        role: "user",
        content: [
          { type: "text", text: textPrompt }
        ]
      },
      ...imageMessages
    ];

    // 🔥 Call OpenAI
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 2000
    });

    // ✅ OPTIONAL: cleanup uploaded files (recommended)
    photos.forEach(path => {
      try { fs.unlinkSync(path); } catch (e) {}
    });

    return response.choices[0].message.content;

  } catch (error) {
    console.error("AI Diagnostic Error:", error.response?.data || error.message || error);
    throw error;
  }
}

module.exports = generateDiagnosticReport;