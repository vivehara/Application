// js/agent.js
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
// Bind to port 10000 or the dynamically provided port by Render
const PORT = process.env.PORT || 10000;

// Enable CORS so your front-end website can query this backend
app.use(cors());
app.use(express.json());

// Lazy-loaded Gemini Client
let aiClient = null;
function getGeminiClient() {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }
    aiClient = new GoogleGenAI({ apiKey: key });
  }
  return aiClient;
}

// 📚 Document Grounding Cache (PDF uploads expire after 48 hours)
let cachedPdfUpload = null;
const PDF_EXPIRY_MS = 40 * 60 * 60 * 1000; // 40 hours

async function getLocalKnowledgePdf(ai) {
  // Look for knowledge.pdf in current js/ directory or project root
  let pdfPath = path.join(__dirname, "knowledge.pdf");
  if (!fs.existsSync(pdfPath)) {
    const rootPdfPath = path.join(__dirname, "..", "knowledge.pdf");
    if (fs.existsSync(rootPdfPath)) {
      pdfPath = rootPdfPath;
    } else {
      return null;
    }
  }

  const now = Date.now();
  if (cachedPdfUpload && (now - cachedPdfUpload.uploadedAt < PDF_EXPIRY_MS)) {
    return cachedPdfUpload;
  }

  try {
    console.log(`📚 Found local PDF at ${pdfPath}. Uploading to Gemini Files API...`);
    const fileUpload = await ai.files.upload({
      file: pdfPath,
      config: {
        mimeType: "application/pdf"
      }
    });

    cachedPdfUpload = {
      uri: fileUpload.uri,
      mimeType: fileUpload.mimeType,
      name: fileUpload.name,
      uploadedAt: now
    };
    console.log("📚 Local PDF uploaded to Gemini Files API and cached:", fileUpload.uri);
    return cachedPdfUpload;
  } catch (err) {
    console.error("❌ Failed to upload knowledge.pdf to Gemini Files API:", err);
    return null;
  }
}

function getLocalKnowledgeText() {
  try {
    // Check both local directory and root directory for text grounding files
    const possiblePaths = [
      path.join(__dirname, "knowledge.txt"),
      path.join(__dirname, "knowledge.md"),
      path.join(__dirname, "..", "knowledge.txt"),
      path.join(__dirname, "..", "knowledge.md")
    ];

    for (const txtPath of possiblePaths) {
      if (fs.existsSync(txtPath)) {
        console.log(`📚 Found local text grounding at ${txtPath}`);
        return fs.readFileSync(txtPath, "utf-8");
      }
    }
  } catch (err) {
    console.error("❌ Failed to read local text grounding file:", err);
  }
  return "";
}

app.post('/api/agent/chat', async (req, res) => {
  try {
    const { name, role, tone, instructions, searchGrounding, messages, knowledge } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Missing or invalid chat messages." });
    }

    const ai = getGeminiClient();

    // Map messages to the official Google GenAI format (user/model)
    const geminiContents = messages.map(msg => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [{ text: msg.content }]
    }));

    // Combine knowledge from both config and any local files
    let combinedKnowledge = "";
    if (knowledge && typeof knowledge === "string") {
      combinedKnowledge += knowledge.trim();
    }

    const localText = getLocalKnowledgeText();
    if (localText) {
      if (combinedKnowledge) combinedKnowledge += "\n\n";
      combinedKnowledge += `[Local Server Grounding Document]\n${localText.trim()}`;
    }

    // Formulate system instructions
    let systemInstruction = `You are ${name || "ViVeHaRa AI Agent"}, a custom website assistant.
Your role: ${role || "Representative"}
Your tone and style: ${tone || "Warm, professional, helpful"}

Custom Instructions:
${instructions || "You are a helpful website assistant."}

CRITICAL RULES:
1. Speak in your specified character and tone.
2. Under no circumstances break character or refer to yourself as an language model or AI designed by Google.
3. Be friendly, concise, and helpful.`;

    if (combinedKnowledge.trim().length > 0) {
      systemInstruction += `\n\nADDITIONAL Grounded Knowledge Document:
---
${combinedKnowledge.trim()}
---
CRITICAL GROUNDING DIRECTIVE:
You MUST prioritize using the facts, details, and guidelines in the "Grounded Knowledge Document" above to answer the user's questions. 
1. If the answer is in the document, reply strictly and accurately using those facts.
2. If the answer is not contained in the document, you may use your search grounding (if enabled) or general knowledge to answer, but always give high preference to the provided document.`;
    }

    // Check for local PDF grounding
    const pdfCache = await getLocalKnowledgePdf(ai);
    if (pdfCache && geminiContents.length > 0) {
      const firstMsg = geminiContents[0];
      if (firstMsg.role === "user") {
        firstMsg.parts.unshift({
          fileData: {
            fileUri: pdfCache.uri,
            mimeType: pdfCache.mimeType
          }
        });
      } else {
        geminiContents.unshift({
          role: "user",
          parts: [
            {
              fileData: {
                fileUri: pdfCache.uri,
                mimeType: pdfCache.mimeType
              }
            },
            { text: "Authoritative local background document for context." }
          ]
        });
      }
    }

    // Setup Tools (Google Search Grounding)
    const tools = [];
    if (searchGrounding) {
      tools.push({ googleSearch: {} });
    }

    // Generate grounded response
    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: geminiContents,
      config: {
        systemInstruction,
        tools: tools.length > 0 ? tools : undefined
      }
    });

    // Extract search citation links if search grounding was enabled
    let citations = [];
    const metadata = response.candidates?.[0]?.groundingMetadata;
    if (metadata && metadata.groundingChunks) {
      
      citations = metadata.groundingChunks
        .filter(chunk => chunk.web && chunk.web.uri)
        .map(chunk => ({
          title: chunk.web.title || "Source Reference",
          url: chunk.web.uri
        }));
    }

    res.json({
      text: response.text || "",
      citations
    });

  } catch (error) {
    console.error("Error running query:", error);
    res.status(500).json({ error: error.message || "Failed to contact Gemini engine." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Secure Chatbot Proxy listening on port ${PORT}`);
});
