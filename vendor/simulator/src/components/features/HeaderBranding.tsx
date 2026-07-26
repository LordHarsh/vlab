import React from 'react';
import logo from '../../assets/logo.png';

export const HeaderBranding: React.FC = () => {
  return (
    <div className="snitch-branding flex items-center gap-3" title="DSU Lab">
      <img 
        src={logo} 
        alt="DSU Logo" 
        className="h-10 w-10 object-contain rounded-md border border-slate-900 bg-white shadow-sm p-0.5" 
      />
      <span className="text-xl font-extrabold tracking-wider text-slate-900 dark:text-white" style={{ marginLeft: 0 }}>
        DSU<span className="text-[#FF6B35]">Lab</span>
      </span>
    </div>
  );
};
