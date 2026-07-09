const OpenAI = require("openai");
const fs = require("fs");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function formatDate() {
  const date = new Date();

  const day = date.getDate();

  function getOrdinal(n) {
    if (n > 3 && n < 21) return "th";
    switch (n % 10) {
      case 1: return "st";
      case 2: return "nd";
      case 3: return "rd";
      default: return "th";
    }
  }

  const dayWithSuffix = day + getOrdinal(day);

  const month = date.toLocaleString("en-GB", { month: "long" });
  const year = date.getFullYear();

  return `${dayWithSuffix} ${month} ${year}`;
}

function generateReference() {
  return "REF-" + Math.floor(10000 + Math.random() * 90000);
}

async function generateDiagnosticReport(data) {
  try {
    const {
      fullName,
      postcode,
      answers,
      photos
    } = data;

    // ✅ VALIDATION
    if (!fullName) throw new Error("Full name missing");
    if (!postcode) throw new Error("Postcode missing");
    if (!answers || answers.length !== 10) throw new Error("10 answers required");
    if (!photos || photos.length !== 7) throw new Error("7 images required");

    // 🔥 FORMAT ANSWERS
    const answersBlock = `
Q1 Property Type: ${answers[0]}
Q2 Bedrooms: ${answers[1]}
Q3 Insulation: ${answers[2]}
Q4 Cold Rooms: ${answers[3]}
Q5 Radiator Temp: ${answers[4]}
Q6 High Bill: ${answers[5]}
Q7 Bill Amount: ${answers[6]}
Q8 Heating Struggle: ${answers[7]}
Q9 Overnight Settings: ${answers[8]}
Q10 Fan Behaviour: ${answers[9]}
`;

    const textPrompt = `
You are a senior HVAC heat pump diagnostic engineer.

Analyse:
1) Customer answers
2) 7 uploaded images

Return ONLY valid JSON.

--- CUSTOMER ---
Name: ${fullName}
Postcode: ${postcode}
Report Date: ${formatDate()}

--- ANSWERS ---
${answersBlock}

--- FIELD MAPPING (STRICT) ---
You MUST map:
- propertyType = Q1
- bedrooms = Q2
- homeInsulation = Q3

DO NOT return "Unknown" if values exist.

--- IMAGE ANALYSIS ---
- Image 3 → extract heatPumpModel if visible
- Detect airflow issues, short cycling, ice buildup, pipe faults, radiator issues

--- REQUIRED OUTPUT JSON FORMAT ---

{
  "name": "${fullName}",
  "postcode": "${postcode}",
  "reportDate": "${formatDate()}",
  "reference": "${generateReference()}",
  "propertyType": "",
  "bedrooms": "",
  "homeInsulation": "",
  "heatPumpModel": "",

  "summary": {
    "level": "GREEN | AMBER | RED",
    "title": "",
    "message": ""
  },

  "checks": [
    {
      "title": "Outdoor unit airflow",
      "status": "OK | ISSUE | ACTION",
      "label": "OK | Issue Found | Action Needed",
      "recommendation": ""
    },
    {
      "title": "Outdoor unit cycling",
      "status": "",
      "label": "",
      "recommendation": ""
    },
    {
      "title": "Ice buildup / defrost",
      "status": "",
      "label": "",
      "recommendation": ""
    },
    {
      "title": "Controller settings",
      "status": "",
      "label": "",
      "recommendation": ""
    },
    {
      "title": "Hot water tank",
      "status": "",
      "label": "",
      "recommendation": ""
    },
    {
      "title": "Pipework",
      "status": "",
      "label": "",
      "recommendation": ""
    },
    {
      "title": "Radiators & TRVs",
      "status": "",
      "label": "",
      "recommendation": ""
    }
  ],

  "insights": [
    {
      "type": "system | efficiency | usage",
      "title": "",
      "description": ""
    }
  ]
}

--- SUMMARY RULES ---
GREEN:
- System mostly healthy
- Minor optimisation only

AMBER:
- Some performance issues
- Needs attention

RED:
- Health issues detected
- Immediate action required

--- WORDING RULE ---
- NEVER use the word "major"
- Use neutral, professional phrasing like:
  "Health issues detected"
  "System requires attention"
  "Performance issues identified"

--- INSIGHTS RULES ---
- Generate 0–3 insights
- Focus on efficiency, misuse, or improvements
- Keep concise and professional

--- RULES ---
- MUST use answers + images
- If no issue → status = "OK"
- If problem → ISSUE or ACTION
- Keep recommendations short
- OUTPUT JSON ONLY
`;

    // ✅ Combine text + images
    const content = [
      { type: "text", text: textPrompt },
      ...photos.map((imgPath) => {
        const base64 = fs.readFileSync(imgPath).toString("base64");
        return {
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${base64}`
          }
        };
      })
    ];

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "Return ONLY valid JSON."
        },
        {
          role: "user",
          content
        }
      ],
      max_tokens: 2000,
      response_format: { type: "json_object" }
    });

    let result = JSON.parse(response.choices[0].message.content);

    // ✅ BACKEND SAFETY FALLBACKS
    result.propertyType = result.propertyType || answers[0];
    result.bedrooms = result.bedrooms || answers[1];
    result.homeInsulation = result.homeInsulation || answers[2];

    if (!result.heatPumpModel) {
      result.heatPumpModel = "Unknown";
    }

    // ✅ Cleanup images
    photos.forEach(path => {
      try { fs.unlinkSync(path); } catch (e) {}
    });

    return result;

  } catch (error) {
    console.error("AI Diagnostic Error:", error.response?.data || error.message || error);
    throw error;
  }
}

module.exports = generateDiagnosticReport;