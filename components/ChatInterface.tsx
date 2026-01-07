
import React, { useState, useRef, useEffect } from 'react';
import { Message, SearchResult } from '../types';
import { generateResponse } from '../services/geminiService';
import { searchRealDatabase } from '../services/backendSnippet';
import { connectLive, createPcmBlob } from '../services/liveService';

interface ChatInterfaceProps {
  onClose?: () => void;
}

const STORAGE_KEY = 'jewish_data_chat_history';
const LOG_KEY = 'jewish_data_research_log';
const BRAND_LOGO_URL = "https://r2-shared.galileo.ai/shared/f5466c1b-689b-4493-9799-d754988775f0.png";

const ChatInterface: React.FC<ChatInterfaceProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [researchLog, setResearchLog] = useState<SearchResult[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<'online' | 'offline' | 'checking'>('checking');
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  
  const currentAssistantTranscriptionRef = useRef('');
  const currentUserTranscriptionRef = useRef('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  
  const liveSessionRef = useRef<any>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const outputCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const savedChat = localStorage.getItem(STORAGE_KEY);
    if (savedChat) {
      try {
        const parsed = JSON.parse(savedChat);
        setMessages(parsed.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })));
      } catch (e) { console.error(e); }
    } else {
      setMessages([{ 
        id: '1', 
        role: 'assistant', 
        content: 'Shalom! I am your Research Assistant. I have indexed over 1,000,000 records. How can I assist your family tree search today?', 
        timestamp: new Date() 
      }]);
    }
    const savedLog = localStorage.getItem(LOG_KEY);
    if (savedLog) setResearchLog(JSON.parse(savedLog));
    checkBridge();

    return () => {
      stopVoice();
    };
  }, []);

  const checkBridge = async () => {
    setBridgeStatus('checking');
    try {
      const res = await fetch('http://localhost:3000/api/search', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ surname: 'ping' })
      });
      setBridgeStatus(res.ok ? 'online' : 'offline');
    } catch {
      setBridgeStatus('offline');
    }
  };

  useEffect(() => {
    if (messages.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    if (researchLog.length > 0) localStorage.setItem(LOG_KEY, JSON.stringify(researchLog));
  }, [messages, researchLog]);

  useEffect(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, isTyping]);

  const addToLog = (result: SearchResult) => {
    if (!researchLog.find(r => r.id === result.id)) {
      setResearchLog(prev => [...prev, result]);
    }
  };

  const stopVoice = () => {
    // 1. Stop all outgoing audio
    activeSourcesRef.current.forEach(source => { try { source.stop(); } catch (e) {} });
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;

    // 2. Close the Live Session
    if (liveSessionRef.current) {
      liveSessionRef.current.then((session: any) => session.close());
      liveSessionRef.current = null;
    }

    // 3. Stop Mic and Contexts
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
      micStreamRef.current = null;
    }
    if (inputCtxRef.current) {
      inputCtxRef.current.close();
      inputCtxRef.current = null;
    }

    setIsVoiceActive(false);
    currentUserTranscriptionRef.current = '';
    currentAssistantTranscriptionRef.current = '';
  };

  const startVoice = async () => {
    setPermissionError(null);
    try {
      if (!outputCtxRef.current) {
        outputCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      }
      if (outputCtxRef.current.state === 'suspended') await outputCtxRef.current.resume();

      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      
      const inputCtx = new AudioContext({ sampleRate: 16000 });
      inputCtxRef.current = inputCtx;

      liveSessionRef.current = connectLive(
        (buffer) => {
          if (!outputCtxRef.current) return;
          const source = outputCtxRef.current.createBufferSource();
          source.buffer = buffer;
          source.connect(outputCtxRef.current.destination);
          const now = outputCtxRef.current.currentTime;
          if (nextStartTimeRef.current < now) nextStartTimeRef.current = now + 0.05;
          source.start(nextStartTimeRef.current);
          nextStartTimeRef.current += buffer.duration;
          activeSourcesRef.current.add(source);
          source.onended = () => activeSourcesRef.current.delete(source);
        },
        (text, isUser, isTurnComplete) => {
          if (isUser) {
            currentUserTranscriptionRef.current += text;
          } else {
            currentAssistantTranscriptionRef.current += text;
          }
          
          if (isTurnComplete) {
            const userMsg = currentUserTranscriptionRef.current.trim();
            const assistantMsg = currentAssistantTranscriptionRef.current.trim();
            
            if (userMsg || assistantMsg) {
              setMessages(prev => [
                ...prev,
                ...(userMsg ? [{ id: `u-${Date.now()}`, role: 'user', content: userMsg, timestamp: new Date() } as Message] : []),
                ...(assistantMsg ? [{ id: `a-${Date.now()}`, role: 'assistant', content: assistantMsg, timestamp: new Date() } as Message] : [])
              ]);
            }
            currentUserTranscriptionRef.current = '';
            currentAssistantTranscriptionRef.current = '';
          }
        },
        () => {
          activeSourcesRef.current.forEach(s => s.stop());
          activeSourcesRef.current.clear();
          nextStartTimeRef.current = 0;
        },
        searchRealDatabase
      );

      const source = inputCtx.createMediaStreamSource(micStream);
      const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
      scriptProcessor.onaudioprocess = (e) => {
        if (!liveSessionRef.current) return;
        liveSessionRef.current.then((session: any) => {
          session.sendRealtimeInput({ media: createPcmBlob(e.inputBuffer.getChannelData(0)) });
        });
      };
      source.connect(scriptProcessor);
      scriptProcessor.connect(inputCtx.destination);
      setIsVoiceActive(true);
    } catch (err: any) { 
      setPermissionError(err.message); 
      stopVoice();
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
      setIsScreenSharing(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        if (videoRef.current) videoRef.current.srcObject = stream;
        setIsScreenSharing(true);
        stream.getVideoTracks()[0].onended = () => setIsScreenSharing(false);
      } catch (err: any) { setPermissionError(err.message); }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isTyping) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    let screenShot = null;
    if (isScreenSharing && videoRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      canvasRef.current.width = 1024; canvasRef.current.height = 768;
      ctx?.drawImage(videoRef.current, 0, 0, 1024, 768);
      screenShot = canvasRef.current.toDataURL('image/jpeg', 0.8);
    }

    try {
      const res = await generateResponse(userMessage.content, messages.slice(-5).map(m => ({
        role: m.role === 'assistant' ? 'model' : m.role,
        parts: [{ text: m.content }]
      })), searchRealDatabase, screenShot || undefined);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'assistant', content: res.text || '', timestamp: new Date(), searchResults: res.results }]);
    } catch (err: any) { 
      setPermissionError(err.message); 
    } finally { 
      setIsTyping(false); 
    }
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <video ref={videoRef} autoPlay className="hidden" />
      
      {/* Premium Header */}
      <div className="bg-[#002855] px-5 py-4 text-white flex justify-between items-center shadow-md shrink-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-full bg-white overflow-hidden border-2 border-white/20 flex-shrink-0">
            <img 
              src={BRAND_LOGO_URL} 
              alt="Logo" 
              className="w-full h-full object-contain scale-[1.5] translate-x-[-1px]" 
            />
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-base tracking-tight leading-none mb-1">JewishData AI</span>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${bridgeStatus === 'online' ? 'bg-emerald-400' : bridgeStatus === 'offline' ? 'bg-amber-400' : 'bg-stone-400 animate-pulse'}`}></span>
              <span className="text-[9px] font-bold opacity-80 uppercase tracking-widest leading-none">
                {bridgeStatus === 'online' ? 'System Online' : 'Local Archive Offline'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowLog(!showLog)} 
            className="text-[10px] font-black uppercase tracking-wider bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-full transition-all border border-white/5"
          >
            Log ({researchLog.length})
          </button>
          {onClose && (
            <button 
              onClick={onClose} 
              className="p-1 hover:bg-white/10 rounded-full transition-colors opacity-70 hover:opacity-100"
              title="Minimize Assistant"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      </div>

      {/* Research Log View */}
      {showLog && (
        <div className="absolute inset-x-0 top-[72px] bottom-0 bg-white z-50 flex flex-col animate-in slide-in-from-right duration-300">
          <div className="p-4 border-b flex justify-between items-center bg-stone-50">
            <h3 className="font-bold text-stone-800">Research Log</h3>
            <button onClick={() => setShowLog(false)} className="text-stone-400 text-xl hover:text-stone-600 transition-colors">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {researchLog.length === 0 ? (
              <div className="text-center py-20 text-stone-400 italic text-sm px-10 leading-relaxed">
                No records saved yet. Search for ancestors and click "+ Save to Log" to track your findings here.
              </div>
            ) : (
              researchLog.map(r => (
                <div key={r.id} className="p-3 border rounded-xl bg-white shadow-sm flex justify-between items-center hover:border-blue-200 transition-colors">
                  <div>
                    <div className="font-bold text-stone-900 text-sm">{r.surname}, {r.givenName}</div>
                    <div className="text-[11px] text-stone-500">{r.location} • {r.year}</div>
                  </div>
                  <button onClick={() => setResearchLog(prev => prev.filter(x => x.id !== r.id))} className="text-red-400 text-[10px] font-bold uppercase tracking-wider hover:text-red-600 transition-colors px-2 py-1">Remove</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Dynamic Status / Alerts */}
      {bridgeStatus === 'offline' && !permissionError && (
        <div className="bg-amber-50 px-4 py-2 text-[10px] text-amber-800 border-b border-amber-100 flex justify-between items-center shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-black uppercase tracking-widest">Notice:</span>
            <span>Local database bridge is disconnected. Using cloud index.</span>
          </div>
          <button onClick={() => checkBridge()} className="font-black underline uppercase tracking-tighter">Retry Sync</button>
        </div>
      )}

      {permissionError && (
        <div className="bg-red-50 p-3 text-[10px] text-red-700 flex justify-between items-center border-b border-red-100 shrink-0">
          <span className="leading-tight font-medium">{permissionError}</span>
          <button onClick={() => setPermissionError(null)} className="font-black text-lg ml-3">✕</button>
        </div>
      )}

      {/* Controls */}
      <div className="px-4 py-3 border-b bg-stone-50 flex gap-3 shrink-0">
        <button 
          onClick={isVoiceActive ? stopVoice : startVoice} 
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm border ${isVoiceActive ? 'bg-red-500 text-white border-red-400 animate-pulse hover:bg-red-600' : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-100 hover:scale-[1.02]'}`}
        >
          <span className="text-sm">{isVoiceActive ? '⏹' : '🎙️'}</span>
          {isVoiceActive ? 'Stop Assistant' : 'Voice Search'}
        </button>
        <button 
          onClick={toggleScreenShare} 
          className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-sm border ${isScreenSharing ? 'bg-blue-600 text-white border-blue-500' : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-100 hover:scale-[1.02]'}`}
        >
          <span className="text-sm">🖥️</span>
          {isScreenSharing ? 'Sharing Active' : 'Sync Screen'}
        </button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-8 bg-[#F8F9FA]">
        {messages.map(m => (
          <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm text-sm leading-relaxed ${m.role === 'user' ? 'bg-[#002855] text-white rounded-tr-none' : 'bg-white border border-stone-200/50 text-stone-800 rounded-tl-none shadow-[0_2px_10px_-4px_rgba(0,0,0,0.1)]'}`}>
              <div className="whitespace-pre-wrap font-medium">{m.content}</div>
              {m.searchResults?.map(r => (
                <div key={r.id} className="mt-4 p-4 bg-stone-50 border border-stone-200 rounded-xl relative group shadow-inner hover:border-blue-300 transition-colors">
                  <div className="flex justify-between items-start">
                    <div>
                      <b className="text-[#002855] text-sm block font-bold">{r.surname}, {r.givenName}</b>
                      <span className="text-[9px] text-stone-400 font-mono tracking-widest mt-0.5 block uppercase">UID: {r.id.slice(0, 8)}</span>
                    </div>
                    <button 
                      onClick={() => addToLog(r)}
                      className="text-[10px] bg-white border border-stone-200 px-3 py-1.5 rounded-lg hover:bg-[#002855] hover:text-white font-bold shadow-sm transition-all"
                    >
                      {researchLog.find(x => x.id === r.id) ? 'Saved ✓' : '+ Add to Log'}
                    </button>
                  </div>
                  <div className="mt-3 text-[12px] flex items-center gap-3 text-stone-600 font-semibold">
                    <span className="bg-stone-200 px-2 py-0.5 rounded text-[10px]">{r.year}</span>
                    <span className="w-1.5 h-1.5 bg-stone-300 rounded-full"></span>
                    <span>{r.location}</span>
                  </div>
                  <div className="mt-3 pt-3 border-t border-stone-200/50 text-stone-500 italic text-[11px] leading-relaxed">
                    "{r.details}"
                  </div>
                </div>
              ))}
              <div className={`text-[9px] mt-3 opacity-50 uppercase tracking-[0.1em] font-bold ${m.role === 'user' ? 'text-right text-blue-100' : 'text-stone-400'}`}>
                {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex items-center gap-3 px-2 text-stone-400">
             <div className="flex space-x-1.5">
               <div className="w-2 h-2 bg-stone-300 rounded-full animate-pulse"></div>
               <div className="w-2 h-2 bg-stone-300 rounded-full animate-pulse [animation-delay:0.2s]"></div>
               <div className="w-2 h-2 bg-stone-300 rounded-full animate-pulse [animation-delay:0.4s]"></div>
             </div>
             <span className="text-[10px] font-black uppercase tracking-[0.2em] animate-pulse">Consulting Archives...</span>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      {/* Modern sticky input */}
      <div className="p-4 bg-white border-t border-stone-100 shadow-[0_-10px_20px_-15px_rgba(0,0,0,0.1)] shrink-0">
        <form onSubmit={handleSubmit} className="flex gap-2 bg-stone-100 rounded-2xl p-1.5 border border-stone-200 focus-within:border-blue-400 focus-within:ring-4 focus-within:ring-blue-400/10 transition-all">
          <input 
            type="text" 
            value={input} 
            onChange={e => setInput(e.target.value)} 
            placeholder={isVoiceActive ? "Speak to the assistant..." : "Search for Cohen, Levy, etc..."} 
            className="flex-1 bg-transparent px-4 py-2.5 text-sm focus:outline-none placeholder:text-stone-400 placeholder:font-medium font-medium" 
          />
          <button 
            type="submit" 
            disabled={isTyping || !input.trim()} 
            className="w-10 h-10 bg-[#002855] text-white rounded-xl flex items-center justify-center hover:bg-[#003a7c] disabled:bg-stone-300 disabled:opacity-100 shadow-md active:scale-95 transition-all flex-shrink-0"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="translate-x-0.5"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ChatInterface;
