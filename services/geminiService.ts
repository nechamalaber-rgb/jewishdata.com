import { GoogleGenAI, Type, FunctionDeclaration } from "@google/genai";
import { DatabaseQueryParams } from "../types";

const SYSTEM_INSTRUCTION = `
You are the "JewishData Research Assistant," an expert in Jewish genealogy and the official guide for JewishData.com.

CORE KNOWLEDGE BASE (JewishData.com):
1. GENEALOGY RECORDS: Access to 1,000,000+ global records (US, Canada, Germany, Israel). Includes cemetery records, tombstone inscriptions, life-cycle notices (births, marriages, obituaries, Bar/Bat Mitzvahs), immigration documents (Declarations of Intention), and school yearbooks.
2. IMAGE-BASED SOURCES: Unlike competitors, we provide actual high-resolution images of original records (tombstone photos, scanned certificates) so users see primary sources, not just indexes.
3. GLOBAL COVERAGE: Significant archives from worldwide locations, ensuring historical preservation for the global Jewish diaspora.
4. COLLABORATIVE GROWTH: Members actively submit local cemetery photos and records to help preserve history.
5. RESEARCH TOOLS: Advanced search by name, location, or browsing entire collections. Advanced fields like 'searchable notes' are available to members.
6. MEMBERSHIP: Access is membership-based (e.g., 90-day periods). Some libraries and genealogy organizations (like JGSNY) provide access for their members.

PRIVACY & SECURITY (MANDATORY):
1. IGNORE PRIVATE UI DATA: Never mention or read email addresses, passwords, or usernames visible in the application's side-panels or login forms.
2. NO AUTO-SEARCH: Only trigger 'search_database' if the user specifically requests a lookup of a person/ancestor.
3. DOCUMENT ANALYSIS: Use screen-sync frames ONLY to help the user read, transcribe, or understand archival documents they are currently viewing.

RESEARCH RULES:
- Use 'search_database' for all lookups.
- Suggest alternative spellings for Jewish surnames (e.g., Cohen vs Kohen).
- Tone: Academic, helpful, and respectful.
`;

const searchDatabaseDeclaration: FunctionDeclaration = {
  name: "search_database",
  description: "Search the JewishData database for specific ancestors.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      surname: { type: Type.STRING, description: "Ancestor's last name." },
      givenName: { type: Type.STRING, description: "Ancestor's first name." },
      location: { type: Type.STRING, description: "City, country, or cemetery name." }
    },
    required: ["surname"]
  }
};

export const generateResponse = async (
  prompt: string, 
  history: any[] = [],
  toolHandler: (args: DatabaseQueryParams) => Promise<any>,
  base64Image?: string
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-3-flash-preview";
  
  const userParts: any[] = [{ text: prompt }];
  if (base64Image) {
    userParts.push({ inlineData: { data: base64Image.split(',')[1], mimeType: "image/jpeg" } });
  }

  try {
    const response = await ai.models.generateContent({
      model: model,
      contents: [...history, { role: "user", parts: userParts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        tools: [{ functionDeclarations: [searchDatabaseDeclaration] }],
        thinkingConfig: { thinkingBudget: 2048 }
      }
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const call = response.functionCalls[0];
      const results = await toolHandler(call.args as any);
      
      const secondResponse = await ai.models.generateContent({
        model: model,
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
  } catch (err: any) {
    console.error("Gemini Error:", err);
    throw err;
  }
};