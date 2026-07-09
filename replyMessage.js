require("dotenv").config();
const axios = require("axios");

const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const TOKEN = process.env.WHATSAPP_TOKEN;

// 🔁 Reply function
const replyMessage = async (to, messageText) => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: {
          body: messageText
        }
      },
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Reply sent:", response.data);
  } catch (error) {
    console.error(
      "Reply Error:",
      error.response ? error.response.data : error.message
    );
  }
};

