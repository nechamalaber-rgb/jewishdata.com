
import { GoogleGenAI, LiveServerMessage, Modality, Blob, FunctionDeclaration, Type } from '@google/genai';
import { DatabaseQueryParams } from "../types";

const SYSTEM_INSTRUCTION = `
You are the JewishData Voice Assistant.

KNOWLEDGE BASE:
JewishData.com is a leading Jewish genealogy database (1M+ records).
- RECORD TYPES: Cemeteries, tombstones (with photos), life-cycles (birth/marriage/death), immigration, yearbooks.
- KEY FEATURE: Original images of records provided.
- MEMBERSHIP: Access is membership-based; some libraries provide access.

CONVERSATION STYLE (STRICT):
1. ULTRA-BRIEF: Responses must be under 15 words whenever possible.
2. NO PREAMBLE: Do not say "Okay," "I understand," or "Sure." Start answering immediately.
3. SPEED: If the user asks about JewishData, give a 1-sentence highlight.
4. PRIVACY: Ignore any private login/UI data on the user's screen.
5. TOOLS: Use 'search_database' for lookups.
`;

const searchDatabaseDeclaration: FunctionDeclaration = {
  name: "search_database",
  parameters: {
    type: Type.OBJECT,
    properties: {
      surname: { type: Type.STRING },
      givenName: { type: Type.STRING },
      location: { type: Type.STRING },
    },
    required: ['surname'],
  },
};

export const connectLive = async (
  onAudioData: (buffer: AudioBuffer) => void,
  onTranscription: (text: string, isUser: boolean, isTurnComplete: boolean) => void,
  onInterrupted: () => void,
  toolHandler: (args: DatabaseQueryParams) => Promise<any>
) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  
  const sessionPromise = ai.live.connect({
    model: 'gemini-2.5-flash-native-audio-preview-09-2025',
    callbacks: {
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

        const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audio) {
          const buffer = await decodeAudioData(decode(audio), outputCtx, 24000, 1);
          onAudioData(buffer);
        }

        const isTurnComplete = !!message.serverContent?.turnComplete;
        
        if (message.serverContent?.outputTranscription) {
          onTranscription(message.serverContent.outputTranscription.text, false, isTurnComplete);
        } else if (message.serverContent?.inputTranscription) {
          onTranscription(message.serverContent.inputTranscription.text, true, isTurnComplete);
        } else if (isTurnComplete) {
          // Send empty text but signal turn complete to finalize state in component
          onTranscription('', false, true);
        }
      },
      onerror: (e) => console.error('Live API Error:', e),
      onclose: (e) => console.log('Live API Closed:', e),
    },
    config: {
      responseModalities: [Modality.AUDIO],
      thinkingConfig: { thinkingBudget: 0 }, 
      speechConfig: { 
        voiceConfig: { 
          prebuiltVoiceConfig: { voiceName: 'Puck' } 
        } 
      },
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
  const pcm = new Int16Array(data.buffer);
  const frames = pcm.length / channels;
  const buffer = ctx.createBuffer(channels, frames, rate);
  for (let c = 0; c < channels; c++) {
    const channelData = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++) {
      channelData[i] = pcm[i * channels + c] / 32768.0;
    }
  }
  return buffer;
}

export function createPcmBlob(data: Float32Array): Blob {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) int16[i] = data[i] * 32768;
  return { 
    data: encode(new Uint8Array(int16.buffer)), 
    mimeType: 'audio/pcm;rate=16000' 
  };
}
