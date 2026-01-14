
import React, { useState, useRef, useEffect } from 'react';
import { Message, SearchResult } from '../types';
import { generateResponse } from '../services/geminiService';
import { searchRealDatabase } from '../services/backendSnippet';
import { connectLive, createPcmBlob } from '../services/liveService';

interface ChatInterfaceProps {
  onClose?: () => void;
}

const STORAGE_KEY = 'jewish_data_chat_history';
const BRAND_LOGO_URL = "https://r2-shared.galileo.ai/shared/f5466c1b-689b-4493-9799-d754988775f0.png";
const FRAME_RATE = 1.0; 

const ChatInterface: React.FC<ChatInterfaceProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0); 
  const [userTranscription, setUserTranscription] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  
  const liveSessionRef = useRef<Promise<any> | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const currentAssistantTranscriptionRef = useRef('');
  const currentUserTranscriptionRef = useRef('');

  // Fix: Defined stopVoice function to stop active media tracks and close the live session.
  const stopVoice = () => {
    setIsVoiceActive(false);
    setIsConnecting(false);
    setIsScreenSharing(false);
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }

    if (liveSessionRef.current) {
      liveSessionRef.current.then((s: any) => s.close());
      liveSessionRef.current = null;
    }

    activeSourcesRef.current.forEach(s => s.stop());
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    if (audioCtxRef.current) {
      audioCtxRef.current.input.close();
      audioCtxRef.current.output.close();
      audioCtxRef.current = null;
    }
  };

  useEffect(() => {
    const savedChat = localStorage.getItem(STORAGE_KEY);
    if (savedChat) {
      try {
        setMessages(JSON.parse(savedChat).map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
      } catch (e) {}
    } else {
      setMessages([{ id: '1', role: 'assistant', content: "Welcome! I'm your JewishData research partner. Share your screen or just start talking—I'm ready to help you trace your lineage.", timestamp: new Date() }]);
    }
    // Fix: Clean up voice session on component unmount using stopVoice.
    return () => {
      stopVoice();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Screen frame capture loop for streaming to the Gemini Live API.
  useEffect(() => {
    let interval: any;
    if (isVoiceActive && isScreenSharing) {
      interval = setInterval(() => {
        if (!videoRef.current || !liveSessionRef.current) return;
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob(async (blob) => {
          if (blob && liveSessionRef.current) {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = (reader.result as string).split(',')[1];
              liveSessionRef.current?.then((session: any) => {
                session.sendRealtimeInput({ 
                  media: { data: base64, mimeType: 'image/jpeg' } 
                });
              });
            };
            reader.readAsDataURL(blob);
          }
        }, 'image/jpeg', 0.6);
      }, 1000 / FRAME_RATE);
    }
    return () => clearInterval(interval);
  }, [isVoiceActive, isScreenSharing]);

  const startVoice = async () => {
    try {
      setIsConnecting(true);
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioCtxRef.current = { input: inputCtx, output: outputCtx };

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;

      const sessionPromise = connectLive(
        (buffer) => {
          const source = outputCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(outputCtx.destination);
          const start = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
          source.start(start);
          nextStartTimeRef.current = start + buffer.duration;
          activeSourcesRef.current.add(source);
          source.onended = () => activeSourcesRef.current.delete(source);
        },
        (text, isUser, isTurnComplete) => {
          if (isUser) {
            currentUserTranscriptionRef.current += text;
            setUserTranscription(currentUserTranscriptionRef.current);
          } else {
            currentAssistantTranscriptionRef.current += text;
          }

          if (isTurnComplete) {
            const userMsg = currentUserTranscriptionRef.current.trim();
            const assistantMsg = currentAssistantTranscriptionRef.current.trim();
            
            if (userMsg || assistantMsg) {
              setMessages(prev => [
                ...prev,
                ...(userMsg ? [{ id: Date.now().toString(), role: 'user' as const, content: userMsg, timestamp: new Date() }] : []),
                ...(assistantMsg ? [{ id: (Date.now() + 1).toString(), role: 'assistant' as const, content: assistantMsg, timestamp: new Date() }] : [])
              ]);
            }
            currentUserTranscriptionRef.current = '';
            currentAssistantTranscriptionRef.current = '';
            setUserTranscription('');
          }
        },
        () => {
          activeSourcesRef.current.forEach(s => s.stop());
          activeSourcesRef.current.clear();
          nextStartTimeRef.current = 0;
        },
        searchRealDatabase,
        outputCtx
      );

      liveSessionRef.current = sessionPromise;

      // Pipe Microphone audio data to the Live Session using createScriptProcessor.
      const source = inputCtx.createMediaStreamSource(micStream);
      const processor = inputCtx.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for(let i=0; i<inputData.length; i++) sum += inputData[i] * inputData[i];
        setMicLevel(Math.sqrt(sum / inputData.length));

        const blob = createPcmBlob(inputData);
        sessionPromise.then(s => s.sendRealtimeInput({ media: blob }));
      };
      source.connect(processor);
      processor.connect(inputCtx.destination);

      setIsVoiceActive(true);
      setIsConnecting(false);
    } catch (err) {
      console.error("Failed to start voice mode:", err);
      stopVoice();
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      if (videoRef.current && videoRef.current.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
      setIsScreenSharing(false);
    } else {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = screenStream;
          setIsScreenSharing(true);
          screenStream.getVideoTracks()[0].onended = () => setIsScreenSharing(false);
        }
      } catch (err) {
        console.error("Screen share failed:", err);
      }
    }
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date(),
      status: 'sending'
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    try {
      const history = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));

      const { text, results } = await generateResponse(
        userMessage.content,
        history,
        searchRealDatabase
      );

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: text || "I've explored the records and didn't find a precise match. Should we broaden our search parameters?",
        timestamp: new Date(),
        searchResults: results,
        status: 'done'
      };

      setMessages(prev => prev.map(m => m.id === userMessage.id ? { ...m, status: 'done' } : m).concat(assistantMessage));
    } catch (err) {
      setMessages(prev => prev.map(m => m.id === userMessage.id ? { ...m, status: 'error' } : m));
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border-stone-200">
      <div className="p-4 border-b border-stone-200 flex items-center justify-between bg-stone-50">
        <div className="flex items-center gap-3">
          <img src={BRAND_LOGO_URL} alt="JewishData" className="h-8 w-auto" />
          <div>
            <h1 className="text-sm font-bold text-[#002855]">Research Partner</h1>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isVoiceActive ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`}></span>
              <span className="text-[10px] text-stone-500 uppercase tracking-wider font-semibold">
                {isVoiceActive ? 'Live Researching' : 'Ready'}
              </span>
            </div>
          </div>
        </div>
        <button onClick={onClose} className="text-stone-400 hover:text-stone-600 p-1">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#fcfaf7]">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-3 text-sm shadow-sm ${
              msg.role === 'user' 
                ? 'bg-[#002855] text-white rounded-tr-none' 
                : 'bg-white border border-stone-200 text-stone-800 rounded-tl-none'
            }`}>
              <p className="leading-relaxed">{msg.content}</p>
              
              {msg.searchResults && msg.searchResults.length > 0 && (
                <div className="mt-3 space-y-2 pt-3 border-t border-stone-100">
                  <p className="text-[10px] font-bold text-[#002855] uppercase">Found Records:</p>
                  {msg.searchResults.map((res) => (
                    <div key={res.id} className="bg-stone-50 p-2 rounded border border-stone-200 text-[11px]">
                      <div className="font-bold">{res.givenName} {res.surname}</div>
                      <div className="text-stone-500">{res.location} ({res.year})</div>
                      <div className="text-[#004e92] mt-1">{res.recordType}</div>
                    </div>
                  ))}
                </div>
              )}
              
              <div className={`text-[10px] mt-1 opacity-50 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white border border-stone-200 p-3 rounded-2xl rounded-tl-none shadow-sm">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 bg-stone-300 rounded-full animate-bounce [animation-delay:0.4s]"></span>
              </div>
            </div>
          </div>
        )}
        {userTranscription && (
           <div className="flex justify-end opacity-60">
             <div className="bg-stone-100 text-stone-600 p-2 rounded-lg text-xs italic">
               "{userTranscription}..."
             </div>
           </div>
        )}
      </div>

      {isScreenSharing && (
        <div className="px-4 pb-2">
          <div className="relative rounded-lg overflow-hidden border-2 border-[#002855] bg-black aspect-video">
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain" />
            <div className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-2 py-0.5 rounded font-bold uppercase animate-pulse">
              Live Feed
            </div>
            <button 
              onClick={toggleScreenShare}
              className="absolute top-2 right-2 bg-black/50 text-white p-1 rounded hover:bg-black/70"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <div className="p-4 border-t border-stone-200 bg-white">
        <form onSubmit={handleSendMessage} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isVoiceActive ? "Listening..." : "Search family names..."}
              disabled={isVoiceActive}
              className="w-full pl-4 pr-10 py-2.5 bg-stone-100 border-none rounded-full text-sm focus:ring-2 focus:ring-[#002855] disabled:opacity-50"
            />
            {!isVoiceActive && (
               <button 
                type="submit" 
                disabled={!input.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#002855] disabled:opacity-30 p-1"
               >
                 <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                   <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                 </svg>
               </button>
            )}
          </div>
          
          <div className="flex items-center gap-2">
             <button
              type="button"
              onClick={isVoiceActive ? stopVoice : startVoice}
              disabled={isConnecting}
              className={`p-2.5 rounded-full transition-all shadow-md ${
                isVoiceActive 
                  ? 'bg-red-500 text-white animate-pulse' 
                  : 'bg-[#002855] text-white hover:bg-[#003d82]'
              }`}
            >
              {isConnecting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                  <line x1="12" y1="19" x2="12" y2="23"/>
                  <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
              )}
            </button>

            {isVoiceActive && (
              <button
                type="button"
                onClick={toggleScreenShare}
                className={`p-2.5 rounded-full transition-all shadow-md ${
                  isScreenSharing 
                    ? 'bg-emerald-500 text-white' 
                    : 'bg-stone-200 text-stone-600 hover:bg-stone-300'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
              </button>
            )}
          </div>
        </form>
        {isVoiceActive && (
          <div className="mt-2 flex items-center gap-2">
             <div className="flex-1 h-1 bg-stone-100 rounded-full overflow-hidden">
               <div 
                 className="h-full bg-red-400 transition-all duration-75" 
                 style={{ width: `${Math.min(100, micLevel * 800)}%` }}
               />
             </div>
             <span className="text-[10px] font-bold text-stone-400 uppercase">Live Mic</span>
          </div>
        )}
      </div>
    </div>
  );
};

// Fix: Added the missing default export for the ChatInterface component.
export default ChatInterface;
