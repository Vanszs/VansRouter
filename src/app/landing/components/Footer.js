"use client";

import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-[#3a2f27] bg-[#0f0d1a] pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-6 rounded bg-[#6366f1] flex items-center justify-center text-white">
                <svg viewBox="0 0 32 32" className="w-4 h-4" fill="none">
                  <path d="M16 5L22 14L16 27L10 14L16 5Z" fill="white" opacity="0.9"/>
                  <path d="M10 14L16 27L10 20L6 14H10Z" fill="white" opacity="0.6"/>
                  <path d="M22 14L16 27L22 20L26 14H22Z" fill="white" opacity="0.6"/>
                  <circle cx="16" cy="9" r="2" fill="white"/>
                </svg>
              </div>
              <h3 className="text-white text-lg font-bold">VansAI</h3>
            </div>
            <p className="text-gray-500 text-sm max-w-xs mb-6">
              The unified endpoint for AI generation. Connect, route, and manage your AI providers with ease.
            </p>
            <div className="flex gap-4">
              <a className="text-gray-400 hover:text-white transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">
                <span className="material-symbols-outlined">code</span>
              </a>
            </div>
          </div>
          
          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Product</h4>
            <a className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="#features">Features</a>
            <Link className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="/dashboard">Dashboard</Link>
            <a className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">Changelog</a>
          </div>
          
          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Resources</h4>
            <a className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="https://github.com/decolua/9router#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
          
          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Legal</h4>
            <a className="text-gray-400 hover:text-[#6366f1] text-sm transition-colors" href="https://github.com/decolua/9router/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="border-t border-[#3a2f27] pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-600 text-sm">© 2025 VansAI. All rights reserved.</p>
          <div className="flex gap-6">
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href="https://github.com/decolua/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

