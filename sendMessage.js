require("dotenv").config();
const axios = require("axios");

const sendMessage = async () => {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: "whatsapp",
        to: "923465777029", // recipient number (no + sign)
        type: "text",
        text: {
          body: "This is my custom test message 🚀"
        }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Message sent:", response.data);
  } catch (error) {
    console.error(
      "Error:",
      error.response ? error.response.data : error.message
    );
  }
};

sendMessage();