const express = require('express');
const cors = require('cors');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();

// 1. Enable CORS for all incoming requests (crucial for widget.js)
app.use(cors()); 
app.use(express.json());

// 2. Safe/Lazy initialization helper to prevent startup crashes
let ai = null;
function getGeminiClient() {
  if (!ai) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY environment variable. Please add it to your Render Environment settings.");
    }
    ai = new GoogleGenAI({ apiKey: apiKey });
  }
  return ai;
}

// 3. Simple health-check endpoint to verify your server is alive
app.get('/health', (req, res) => {
  res.json({ status: "ok", message: "Aether AI Proxy is online and healthy!" });
});

app.post('/api/agent/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "No messages payload provided." });
    }

    // Get the safely initialized client
    const client = getGeminiClient();
    
    // Map messages history to Gemini API format
    const contents = messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    const response = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: contents,
      config: {
        systemInstruction: "You are Aether AI, the friendly representative. Ground answers with real-time web search.",
        tools: [{ googleSearch: {} }] // Real-time grounding
      }
    });

    res.json({ text: response.text });
  } catch (error) {
    console.error("🔴 Error in chat proxy:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// 4. Use Render's dynamic port variable
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Proxy active on port ${PORT}`));
