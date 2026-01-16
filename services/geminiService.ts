
import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { DatabaseQueryParams } from "../types";

const SYSTEM_INSTRUCTION = `
# ROLE: Senior Expert Jewish Genealogy Partner

You are the passionate, knowledgeable research partner for JewishData.com. 

## YOUR PERSONA:
- **Partner, not Tool:** You walk alongside the user. If they search for a name, ask them why that person is important to their story.
- **Deeply Empathetic:** You recognize that every record represents a life. Speak with respect and curiosity.
- **Authoritative:** You know the shifting borders of Europe (Poland, Russia, Ukraine) and can guide the user through variations in surname spellings.

## PROTOCOLS:
1. **TOOL USE:** Use 'search_database' for any specific person query.
2. **VISION:** If an image is provided, analyze it as a document expert. Transcribe names and dates immediately.
3. **NO HALLUCINATION:** If results are empty, build a "Research Plan" together. "Since we don't see them here, let's try searching for their siblings or checking ship manifests."
4. **RAPPORT:** Start interactions by getting to know the user's goals. Ask: "Who are we searching for today? Do you have any stories from your elders about them?"
`;

const searchDatabaseDeclaration: FunctionDeclaration = {
  name: "search_database",
  description: "Queries the professional JewishData.com archive. Supports partial matching for surname, given name, and location.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      surname: { type: Type.STRING, description: "The last name (required). Supports partial matches." },
      givenName: { type: Type.STRING, description: "The first name or initial." },
      location: { type: Type.STRING, description: "City, Country, or specific Cemetery name." }
    },
    required: ["surname"]
  }
};

// Helper for retrying 500 errors
const fetchWithRetry = async (fn: () => Promise<any>, retries = 2, delay = 1000): Promise<any> => {
  try {
    return await fn();
  } catch (err: any) {
    if (retries > 0 && (err.status === 500 || err.code === 500)) {
      await new Promise(r => setTimeout(r, delay));
      return fetchWithRetry(fn, retries - 1, delay * 2);
    }
    throw err;
  }
};

export const generateResponse = async (
  prompt: string, 
  history: any[] = [],
  toolHandler: (args: DatabaseQueryParams) => Promise<any>,
  base64Image?: string
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  // Switched to Flash for speed and to avoid the current 500s on the Pro preview endpoint
  const modelName = "gemini-3-flash-preview";
  
  const userParts: any[] = [{ text: prompt }];
  if (base64Image) {
    userParts.push({ inlineData: { data: base64Image.split(',')[1], mimeType: "image/jpeg" } });
  }

  return fetchWithRetry(async () => {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [...history, { role: "user", parts: userParts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: [searchDatabaseDeclaration] }],
        temperature: 0.7,
      }
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      const results = await toolHandler(call.args as any);
      
      const secondResponse = await ai.models.generateContent({
        model: modelName,
        contents: [
          ...history,
          { role: "user", parts: userParts },
          response.candidates[0].content,
          {
            role: "user",
            parts: [{
              functionResponse: { name: "search_database", id: call.id, response: { results: results } }
            }]
          }
        ],
        config: { systemInstruction: SYSTEM_INSTRUCTION }
      });
      
      return { text: secondResponse.text, results };
    }

    return { text: response.text, results: [] };
  });
};
