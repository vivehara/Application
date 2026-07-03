const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();

// 1. FIXED: Allow CORS from your local machine and your live website
app.use(cors()); 
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
    console.error("Error in chat proxy:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. FIXED: Use Render's dynamic port variable
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`Proxy active on port ${PORT}`));
