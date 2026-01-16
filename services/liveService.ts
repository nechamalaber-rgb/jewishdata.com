
import { GoogleGenAI, LiveServerMessage, Modality, Blob, FunctionDeclaration, Type } from '@google/genai';
import { DatabaseQueryParams } from "../types";

const SYSTEM_INSTRUCTION = `
# ROLE: Human-First Genealogy Research Partner (JewishData.com)

You are NOT a chatbot. You are a Senior Historian and Family Researcher named Zephyr. You are sitting next to the user, looking at their screen on JewishData.com.

## CONVERSATION RULES (IMPORTANT):
1. **NO BOT-SPEAK:** Never ask "How can I help you today?" or "What names are we looking for?" or "Is there a location you'd like to explore?". These sound like a robot.
2. **BE REACTIVE:** Comment on what the user is doing. If they are silent, share a historical fact about Jewish genealogy or the specific region visible on their screen.
3. **USE INTERJECTIONS:** Use natural human sounds like "Hmm," "Oh, wait," "Look at that name," or "That's a fascinating record."
4. **ASSUME VISION:** You can see the screen. If you see a document, describe it. "I see we've pulled up the 1905 census. The handwriting on these manifests is always so tricky, isn't it?"
5. **STORYTELLING:** If a name is mentioned, don't just search it—ask about the person. "Your great-grandfather Mendel? What a strong name. Do you know if he came through Ellis Island or maybe via Baltimore?"

## VISION PROTOCOL:
- If you see a "Black Screen" or nothing, DO NOT mention it. Mentioning technical issues breaks the immersion. Just talk to the user like a friend.
- If you see a record, analyze it immediately. "I see a birth record from the Warsaw archives. The date looks like 1884."

## TOOLS:
- Use 'search_database' only when a specific research path is clear.
`;

const searchDatabaseDeclaration: FunctionDeclaration = {
  name: "search_database",
  description: "Queries the professional JewishData.com archive for records.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      surname: { type: Type.STRING, description: "The last name (required)." },
      givenName: { type: Type.STRING, description: "The first name." },
      location: { type: Type.STRING, description: "City, Cemetery, or Region." },
    },
    required: ['surname'],
  },
};

export const connectLive = async (
  onAudioData: (buffer: AudioBuffer) => void,
  onTranscription: (text: string, isUser: boolean, isTurnComplete: boolean) => void,
  onInterrupted: () => void,
  toolHandler: (args: DatabaseQueryParams) => Promise<any>,
  outputCtx: AudioContext
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const sessionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
    callbacks: {
      onopen: () => {
        // We let the user speak first or wait for the first frame to trigger a reaction
      },
      onmessage: async (message: LiveServerMessage) => {
        if (message.serverContent?.interrupted) {
          onInterrupted();
        }

        if (message.toolCall) {
          for (const fc of message.toolCall.functionCalls) {
            const results = await toolHandler(fc.args as any);
            sessionPromise.then(s => s.sendToolResponse({
              functionResponses: { id: fc.id, name: fc.name, response: { result: results } }
            }));
          }
        }

        const parts = message.serverContent?.modelTurn?.parts || [];
        for (const part of parts) {
          if (part.inlineData?.data) {
            const buffer = await decodeAudioData(decode(part.inlineData.data), outputCtx, 24000, 1);
            onAudioData(buffer);
          }
        }

        const isTurnComplete = !!message.serverContent?.turnComplete;
        if (message.serverContent?.outputTranscription) {
          onTranscription(message.serverContent.outputTranscription.text, false, isTurnComplete);
        } else if (message.serverContent?.inputTranscription) {
          onTranscription(message.serverContent.inputTranscription.text, true, isTurnComplete);
        }
      },
    },
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
      systemInstruction: SYSTEM_INSTRUCTION,
      tools: [{ functionDeclarations: [searchDatabaseDeclaration] }],
      outputAudioTranscription: {},
      inputAudioTranscription: {},
    },
  });

  return sessionPromise;
};

function decode(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, rate: number, channels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer, data.byteOffset, data.length / 2);
  const frameCount = dataInt16.length / channels;
  const buffer = ctx.createBuffer(channels, frameCount, rate);
  for (let channel = 0; channel < channels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * channels + channel] / 32768.0;
    }
  }
  return buffer;
}

export function createPcmBlob(data: Float32Array): Blob {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
}
