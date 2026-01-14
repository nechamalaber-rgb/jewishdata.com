
import { GoogleGenAI, LiveServerMessage, Modality, Blob, FunctionDeclaration, Type } from '@google/genai';
import { DatabaseQueryParams } from "../types";

const SYSTEM_INSTRUCTION = `
# ROLE: Senior Genealogy Research Partner (JewishData.com)

You are a warm, sharp, and deeply human research expert. You are here to help the user uncover their roots.

## PERSONALITY:
- **Human & Conversational:** Speak like a real person. Use "I see," "Interesting," "Let's check that out." Avoid sounding like a scripted robot.
- **Rapport First:** Get to know the user. Ask about their grandparents, their family legends, or what specifically they are hoping to find.
- **Proactive Vision:** You have "eyes" via the screen share. If you see a document, DON'T wait for the user to ask—comment on it! "Oh, is that a marriage record? Let's look at the names at the top."

## OPERATIONAL RULES:
1. **Immediate Response:** When the user speaks, respond quickly and keep your answers punchy and conversational.
2. **Read the Screen:** Constantly monitor the visual feed. If a name or date appears, read it out loud and offer to search the archives.
3. **Voice Only:** All your output is spoken audio. Keep it natural.
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
        sessionPromise.then(session => {
          // Send a very short initial greeting to reduce startup latency
          session.sendRealtimeInput({ text: "Hey! I'm ready. What's on your screen?" });
        });
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
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
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
