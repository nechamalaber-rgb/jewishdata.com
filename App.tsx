
import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';

const BRAND_LOGO_URL = "https://r2-shared.galileo.ai/shared/f5466c1b-689b-4493-9799-d754988775f0.png";

const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(true);
  const [hasKey, setHasKey] = useState<boolean | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      } else {
        setHasKey(true);
      }
    };
    checkKey();
  }, []);

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  if (hasKey === false) {
    return (
      <div className="min-h-screen bg-[#002855] flex items-center justify-center p-6 text-white text-center">
        <div className="max-w-md space-y-6">
          <div className="w-24 h-24 bg-white rounded-full mx-auto overflow-hidden border-4 border-blue-400 p-2">
             <img src={BRAND_LOGO_URL} alt="JewishData" className="w-full h-full object-contain" />
          </div>
          <h1 className="text-3xl font-serif">Research Assistant</h1>
          <p className="text-blue-100 opacity-80 leading-relaxed">To access the JewishData 1,000,000+ record archive, please select a valid API key with billing enabled.</p>
          <button 
            onClick={handleOpenKeySelector}
            className="bg-white text-[#002855] px-8 py-3 rounded-xl font-bold hover:bg-blue-50 transition-all shadow-xl active:scale-95"
          >
            Select API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 font-sans">
      {isOpen ? (
        <div className="fixed inset-0 md:inset-auto md:bottom-6 md:right-6 md:w-[480px] md:h-[800px] md:max-h-[92vh] bg-white md:rounded-[32px] shadow-[0_20px_60px_-15px_rgba(0,0,0,0.3)] border border-stone-200 flex flex-col overflow-hidden z-50 transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)]">
          <ChatInterface onClose={() => setIsOpen(false)} />
          
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[100] pointer-events-none">
            <div id="sync-indicator" className="hidden px-4 py-1.5 bg-red-500 text-white text-[10px] font-black uppercase tracking-[0.25em] rounded-full shadow-lg border border-white/20 animate-pulse">
              Live Vision Sync
            </div>
          </div>
        </div>
      ) : (
        <button 
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-[#002855] rounded-full shadow-2xl flex items-center justify-center hover:scale-110 hover:-translate-y-1 active:scale-95 transition-all duration-300 group z-50 border-4 border-white"
          title="Open Assistant"
        >
          <div className="w-8 h-8 rounded-full bg-white overflow-hidden p-0.5">
            <img src={BRAND_LOGO_URL} alt="JewishData" className="w-full h-full object-contain" />
          </div>
          <div className="absolute -top-1 -right-1 w-4 h-4 bg-emerald-400 rounded-full border-2 border-white shadow-sm"></div>
        </button>
      )}
      
      {/* Background canvas context */}
      <div className="flex flex-col items-center justify-center h-screen text-stone-300 select-none bg-[#F5F5F3]">
        <div className="text-center opacity-60">
          <p className="text-4xl font-serif italic mb-2 text-stone-400 tracking-tight">JewishData.com</p>
          <p className="text-[10px] uppercase tracking-[0.5em] font-black">Archive Gateway</p>
          <div className="mt-10 flex gap-6 justify-center">
            {[1, 2, 3].map(i => <div key={i} className="w-16 h-0.5 bg-stone-200 rounded-full"></div>)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
