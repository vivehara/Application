const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
app.use(cors({ origin: "https://your-website.com" })); // Protect to your domain
app.use(express.json());

// Initialize Gemini Client safely using system environment variable
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/agent/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    // Map messages history to Gemini API format
    const contents = messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: "You are Aether AI, the friendly representative. Ground answers with real-time web search.",
        tools: [{ googleSearch: {} }] // Real-time grounding
      }
    });

    res.json({ text: response.text });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(5000, () => console.log('Proxy active on port 5000'));
