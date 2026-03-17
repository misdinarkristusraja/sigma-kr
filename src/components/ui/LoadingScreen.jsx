import React from 'react';
import { Church } from 'lucide-react';

export default function LoadingScreen({ message = 'Memuat...' }) {
  return (
    <div className="fixed inset-0 bg-white flex flex-col items-center justify-center z-50">
      <div className="flex flex-col items-center gap-4">
        <div className="w-16 h-16 bg-brand-800 rounded-2xl flex items-center justify-center shadow-lg">
          <Church size={28} className="text-white" />
        </div>
        <div className="text-center">
          <div className="font-bold text-xl text-brand-800">SIGMA</div>
          <div className="text-xs text-gray-400 mt-0.5">Misdinar Kristus Raja Solo Baru</div>
        </div>
        <div className="flex gap-1 mt-2">
          {[0,1,2].map(i => (
            <div
              key={i}
              className="w-2 h-2 bg-brand-800 rounded-full animate-bounce"
              style={{ animationDelay: `${i * 0.15}s` }}
            />
          ))}
        </div>
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    </div>
  );
}
