
import React, { useState, useEffect } from 'react';
import ChatInterface from './components/ChatInterface';

const BRAND_LOGO_URL = "https://r2-shared.galileo.ai/shared/f5466c1b-689b-4493-9799-d754988775f0.png";

const App: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
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
      <div className="fixed bottom-6 right-6 z-50">
        <button 
          onClick={handleOpenKeySelector}
          className="bg-[#002855] text-white px-6 py-4 rounded-full font-bold shadow-2xl hover:scale-105 transition-transform flex items-center gap-2"
        >
          <span>Enable AI Research</span>
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Widget Container */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-[400px] h-[600px] bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-stone-200 z-50 animate-in slide-in-from-bottom-4 duration-200">
          <ChatInterface onClose={() => setIsOpen(false)} />
        </div>
      )}

      {/* Launcher Button */}
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-[#002855] text-white rounded-full shadow-xl hover:scale-110 active:scale-95 transition-all z-50 flex items-center justify-center group"
      >
        {isOpen ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        ) : (
          <div className="relative">
             <img src={BRAND_LOGO_URL} alt="AI" className="w-8 h-8 object-contain" />
             <span className="absolute top-0 right-0 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 border-[#002855]"></span>
          </div>
        )}
      </button>
    </>
  );
};

export default App;
