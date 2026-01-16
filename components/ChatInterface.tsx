
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
  const [isConnecting, setIsConnecting] = useState(false);
  
  const [liveUserText, setLiveUserText] = useState('');
  const [liveAssistantText, setLiveAssistantText] = useState('');

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

  const stopVoice = () => {
    setIsVoiceActive(false);
    setIsConnecting(false);
    setIsScreenSharing(false);
    setLiveUserText('');
    setLiveAssistantText('');
    
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
    }

    if (liveSessionRef.current) {
      liveSessionRef.current.then((s: any) => s.close());
      liveSessionRef.current = null;
    }

    activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
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
      setMessages([{ id: 'init', role: 'assistant', content: "Shalom! I'm your research partner. Share your screen and let's explore your history together.", timestamp: new Date() }]);
    }
    return () => stopVoice();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, liveUserText, liveAssistantText]);

  // Capture frames in background only - optimized for "living" video
  useEffect(() => {
    let interval: any;
    if (isVoiceActive && isScreenSharing) {
      interval = setInterval(() => {
        if (!videoRef.current || !liveSessionRef.current) return;
        const canvas = canvasRef.current;
        const video = videoRef.current;
        const ctx = canvas.getContext('2d');
        
        // Ensure video is actually providing content
        if (!ctx || video.readyState < 2 || video.videoWidth === 0) return;
        
        canvas.width = 640; 
        canvas.height = 360;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        // Convert to quality JPG
        const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
        const base64 = dataUrl.split(',')[1];
        liveSessionRef.current?.then((session: any) => {
          session.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } });
        });
      }, 1000 / FRAME_RATE);
    }
    return () => clearInterval(interval);
  }, [isVoiceActive, isScreenSharing]);

  const startVoice = async () => {
    try {
      setIsConnecting(true);
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      await inputCtx.resume();
      await outputCtx.resume();
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
            setLiveUserText(currentUserTranscriptionRef.current);
          } else {
            currentAssistantTranscriptionRef.current += text;
            setLiveAssistantText(currentAssistantTranscriptionRef.current);
          }

          if (isTurnComplete) {
            const userMsg = currentUserTranscriptionRef.current.trim();
            const assistantMsg = currentAssistantTranscriptionRef.current.trim();
            
            if (userMsg || assistantMsg) {
              setMessages(prev => [
                ...prev,
                ...(userMsg ? [{ id: `u-${Date.now()}`, role: 'user' as const, content: userMsg, timestamp: new Date() }] : []),
                ...(assistantMsg ? [{ id: `a-${Date.now()}`, role: 'assistant' as const, content: assistantMsg, timestamp: new Date() }] : [])
              ]);
            }
            currentUserTranscriptionRef.current = '';
            currentAssistantTranscriptionRef.current = '';
            setLiveUserText('');
            setLiveAssistantText('');
          }
        },
        () => {
          activeSourcesRef.current.forEach(s => { try { s.stop(); } catch(e) {} });
          activeSourcesRef.current.clear();
          nextStartTimeRef.current = 0;
        },
        searchRealDatabase,
        outputCtx
      );

      liveSessionRef.current = sessionPromise;

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
      console.error("Voice start failed:", err);
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
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
          video: { frameRate: 5, width: 1280, height: 720 } 
        });
        if (videoRef.current) {
          videoRef.current.srcObject = screenStream;
          setIsScreenSharing(true);
          screenStream.getVideoTracks()[0].onended = () => {
            setIsScreenSharing(false);
          };
        }
      } catch (err: any) {
        setIsScreenSharing(false);
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
      const history = messages.slice(-10).map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }]
      }));

      const { text, results } = await generateResponse(userMessage.content, history, searchRealDatabase);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: text || "I'm still looking through the records for you.",
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
    <div className="flex flex-col h-full bg-white relative font-sans">
      {/* 
        CRITICAL: Render video with slight visibility (0.01) to ensure the browser 
        processes the stream instead of putting it to sleep (which causes black frames).
      */}
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="fixed top-0 left-0 w-8 h-8 opacity-[0.01] pointer-events-none z-[-1]" 
      />
      
      {/* 1. HEADER */}
      <div className="px-5 py-3 flex items-center justify-between border-b bg-white z-40">
        <div className="flex items-center gap-3">
          <img src={BRAND_LOGO_URL} alt="JD" className="w-8 h-8 rounded-full shadow-sm" />
          <div className="flex flex-col">
            <h2 className="font-bold text-[#002855] text-base leading-tight">Zephyr</h2>
            <span className="text-[10px] text-emerald-600 font-bold uppercase tracking-wider">Online Partner</span>
          </div>
        </div>
        <button onClick={onClose} className="text-stone-300 hover:text-stone-600 transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>

      {/* 2. DASHBOARD */}
      <div className="bg-[#002855] text-white p-4 shadow-xl z-30">
        <div className="flex gap-3">
          <button 
            onClick={isVoiceActive ? stopVoice : startVoice} 
            disabled={isConnecting}
            className={`flex-2 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-bold text-sm transition-all ${
              isVoiceActive ? 'bg-red-500 ring-4 ring-red-500/20' : 'bg-white/10 hover:bg-white/20 border border-white/20'
            }`}
          >
            {isConnecting ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <div className={`w-2 h-2 rounded-full ${isVoiceActive ? 'bg-white animate-pulse' : 'bg-white/40'}`} />
                {isVoiceActive ? 'End Call' : 'Talk with Zephyr'}
              </>
            )}
          </button>
          
          <button 
            onClick={toggleScreenShare}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border ${
              isScreenSharing ? 'bg-emerald-600 border-emerald-400 ring-4 ring-emerald-500/20' : 'bg-white/10 hover:bg-white/20 border-white/20'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/></svg>
            {isScreenSharing ? 'Live Screen' : 'Share View'}
          </button>
        </div>

        {isVoiceActive && (
          <div className="flex items-center gap-3 bg-black/30 p-2.5 rounded-xl mt-3 border border-white/5">
             <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden">
               <div className="h-full bg-emerald-400 transition-all duration-75 shadow-[0_0_8px_rgba(52,211,153,0.5)]" style={{ width: `${Math.min(100, micLevel * 1000)}%` }} />
             </div>
             <span className="text-[10px] font-black text-emerald-300 uppercase tracking-widest">Listening</span>
          </div>
        )}
      </div>

      {/* 3. CHAT BODY */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-5 bg-stone-50">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-2xl p-4 text-sm shadow-sm transition-all animate-in fade-in slide-in-from-bottom-2 ${
              msg.role === 'user' ? 'bg-[#002855] text-white rounded-tr-none' : 'bg-white border border-stone-200 text-stone-800 rounded-tl-none'
            }`}>
              <p className="leading-relaxed whitespace-pre-wrap font-medium">{msg.content}</p>
              {msg.searchResults && msg.searchResults.length > 0 && (
                <div className="mt-4 space-y-2 pt-4 border-t border-stone-100">
                  {msg.searchResults.map((res) => (
                    <div key={res.id} className="bg-stone-50 p-3 rounded-xl border border-stone-200 text-[11px] group hover:border-[#002855] transition-colors cursor-default">
                      <div className="font-bold text-[#002855] flex items-center justify-between">
                        <span>{res.givenName} {res.surname}</span>
                        <span className="text-[9px] bg-stone-200 px-1.5 py-0.5 rounded uppercase">{res.year}</span>
                      </div>
                      <div className="text-stone-500 mt-1">{res.location}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {liveUserText && (
          <div className="flex justify-end opacity-50 italic">
             <div className="bg-stone-200 text-stone-600 p-3 rounded-2xl rounded-tr-none text-xs">
               "{liveUserText}"
             </div>
          </div>
        )}
        
        {liveAssistantText && (
          <div className="flex justify-start animate-in fade-in">
             <div className="bg-white border-2 border-[#002855]/10 text-stone-700 p-4 rounded-2xl rounded-tl-none text-sm shadow-xl ring-4 ring-[#002855]/5">
               <div className="flex gap-2 items-center mb-2">
                 <div className="flex gap-0.5">
                    <span className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                    <span className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                    <span className="w-1 h-1 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                 </div>
                 <span className="text-[10px] font-black text-[#002855] uppercase tracking-tighter">Zephyr is responding</span>
               </div>
               <p className="leading-relaxed font-medium">{liveAssistantText}</p>
             </div>
          </div>
        )}
      </div>

      {/* 4. CHAT INPUT */}
      <div className="p-4 bg-white border-t border-stone-200">
        <form onSubmit={handleSendMessage} className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isVoiceActive ? "Tell me a family story..." : "Type a name or town..."}
            className="flex-1 px-5 py-3.5 bg-stone-100 border-none rounded-2xl text-sm focus:ring-2 focus:ring-[#002855] transition-all placeholder:text-stone-400"
          />
          <button 
            type="submit" 
            disabled={!input.trim() || isTyping}
            className="w-12 h-12 bg-[#002855] text-white rounded-2xl flex items-center justify-center disabled:opacity-30 shadow-lg active:scale-95 transition-all"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;
