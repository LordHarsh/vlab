import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Plus, MoreVertical, Trash2, Copy, Edit3, LogOut, Cpu, Eye, CircuitBoard, FolderGit2, Moon, Sun, Lock, Loader2 } from 'lucide-react';
import { useStore } from '../utils/store';
import { useAuth } from '../utils/useAuth';
import { useCircuitSync } from '../database/useCircuitSync';
import type { Experiment } from '../types';
import { EXPERIMENTS } from '../utils/experimentData';
import { learnTutorials } from '../utils/learnData';

import { HeaderBranding } from './features/HeaderBranding';
import { ExperimentsPanel } from './features/ExperimentsPanel';
import { SyntaxCodeViewer } from './features/SyntaxCodeViewer';

// Set of built-in experiment IDs — these are READ-ONLY templates
const BUILTIN_IDS = new Set(EXPERIMENTS.map(e => e.id));
export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user: supabaseUser, signOut } = useAuth();
  const { experiments, addExperiment, duplicateExperiment, deleteExperiment, renameExperiment, theme, toggleTheme } = useStore();
  const { createCircuit, deleteCircuit, renameCircuit, isSaving } = useCircuitSync();

  // Supabase user circuits indexed by UUID string id (stored in localStore as negative IDs or separately)
  const [supabaseCircuitMap, setSupabaseCircuitMap] = useState<Record<string, string>>({}); // title -> uuid
  const [dbActionLoading, setDbActionLoading] = useState<string | null>(null); // id of row being acted on

  // Search & Navigation Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [activeHeaderTab, setActiveHeaderTab] = useState<'Experiments' | 'Code Blocks' | 'Learn' | 'Classroom'>('Experiments');
  const [codeBlocksFilter, ] = useState<'All' | 'Circuits' | '3D Designs' | 'Code Blocks'>('All');
  
  // Track selected experiment for code preview in the Designs tab
  const [selectedPreviewId, setSelectedPreviewId] = useState<number | null>(experiments.length > 0 ? experiments[0].id : null);
  
  // Dropdown card menu tracking
  const [activeMenuId, setActiveMenuId] = useState<number | null>(null);
  
  // Create New Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPlatform, setNewPlatform] = useState<'Arduino' | 'Raspberry Pi'>('Arduino');

  // Rename Modal
  const [renameId, setRenameId] = useState<number | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  // Dropdown ref for closing outside clicks
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setActiveMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  // Filter experiments based on search query (used by Experiments grid)
  const filteredExperiments = useMemo(() => experiments.filter(exp => {
    return exp.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
           exp.description.toLowerCase().includes(searchTerm.toLowerCase());
  }), [experiments, searchTerm]);

  // Filter experiments based on local Code Blocks filter
  const codeBlocksExperiments = useMemo(() => experiments.filter(exp => {
    if (codeBlocksFilter === 'Circuits') {
      return !exp.title.includes('3D') && !exp.title.includes('Block');
    }
    if (codeBlocksFilter === '3D Designs') {
      return exp.title.includes('3D');
    }
    if (codeBlocksFilter === 'Code Blocks') {
      return exp.title.includes('Block');
    }
    return true; // 'All'
  }), [experiments, codeBlocksFilter]);

  // Filter code block experiments based on search query
  const filteredCodeBlocks = useMemo(() => {
    return codeBlocksExperiments.filter(exp => 
      exp.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      exp.description.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [codeBlocksExperiments, searchTerm]);

  // Filter Learn tutorials based on search query
  const filteredLearnTutorials = useMemo(() => {
    return learnTutorials.filter(tutorial => 
      tutorial.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tutorial.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      tutorial.platform.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm]);

  // Group experiments into exactly 2 sections
  const groupedExperiments = useMemo(() => {
    return filteredExperiments.reduce(
      (acc, exp) => {
        let category = exp.category;
        
        // Fallback / Fuzzy Matching logic for legacy entries
        if (!category) {
          const searchString = `${exp.title} ${exp.description}`.toLowerCase();
          if (searchString.includes('raspberry pi') || searchString.includes('rpi') || searchString.includes('pico') || exp.platform === 'Raspberry Pi') {
            category = 'raspberry-pi';
          } else {
            category = 'arduino';
          }
        }

        if (category === 'raspberry-pi') {
          acc['raspberry-pi'].push(exp);
        } else {
          acc['arduino'].push(exp);
        }
        return acc;
      },
      { 'arduino': [], 'raspberry-pi': [] } as Record<string, Experiment[]>
    );
  }, [filteredExperiments]);

  const SECTIONS = [
    {
      id: 'arduino',
      title: 'Arduino Experiments',
      description: 'Hardware and microcontroller based circuits',
      accentColor: 'text-emerald-500',
      bgAccent: 'bg-emerald-500/10',
      borderAccent: 'border-emerald-500/30',
      hoverBorder: 'hover:border-emerald-500/40',
      icon: <CircuitBoard className="w-5 h-5 text-emerald-500" />,
      items: groupedExperiments['arduino']
    },
    {
      id: 'raspberry-pi',
      title: 'Raspberry Pi Experiments',
      description: 'Single-board computer & Python based projects',
      accentColor: 'text-rose-500',
      bgAccent: 'bg-rose-500/10',
      borderAccent: 'border-rose-500/30',
      hoverBorder: 'hover:border-rose-500/40',
      icon: <Cpu className="w-5 h-5 text-rose-500" />,
      items: groupedExperiments['raspberry-pi']
    }
  ];

  const handleCreateNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setDbActionLoading('creating');

    // 1. Create circuit row in Supabase → get UUID
    const { circuitId, error } = await createCircuit(newTitle.trim());

    if (error || !circuitId) {
      // Fallback: create locally if Supabase fails
      console.warn('Supabase create failed, falling back to local:', error);
      const type = 'circuits';
      const created = addExperiment(newTitle.trim(), newPlatform, type);
      setShowCreateModal(false);
      setNewTitle('');
      setDbActionLoading(null);
      navigate(`/simulator/${created.id}`);
      return;
    }

    // 2. Also add to local store (as a bridge so existing routing works)
    const type = 'circuits';
    const created = addExperiment(newTitle.trim(), newPlatform, type);

    // 3. Map local numeric ID → Supabase UUID for later sync
    setSupabaseCircuitMap(prev => ({ ...prev, [String(created.id)]: circuitId }));

    setShowCreateModal(false);
    setNewTitle('');
    setDbActionLoading(null);

    // Navigate with UUID so SimulatorWorkspace can auto-save
    navigate(`/simulator/${circuitId}`);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameId || !renameTitle.trim()) return;

    // Always update locally
    renameExperiment(renameId, renameTitle.trim());

    // If this is a user-created circuit, also rename in Supabase
    const uuid = supabaseCircuitMap[String(renameId)];
    if (uuid) {
      await renameCircuit(uuid, renameTitle.trim());
    }

    setRenameId(null);
    setRenameTitle('');
  };

  const handleDeleteExperiment = async (expId: number) => {
    // Built-in templates cannot be deleted
    if (BUILTIN_IDS.has(expId)) return;

    setDbActionLoading(String(expId));

    // Delete from local store
    deleteExperiment(expId);

    // Delete from Supabase if we have the UUID
    const uuid = supabaseCircuitMap[String(expId)];
    if (uuid) {
      await deleteCircuit(uuid);
      setSupabaseCircuitMap(prev => {
        const next = { ...prev };
        delete next[String(expId)];
        return next;
      });
    }

    setDbActionLoading(null);
    setActiveMenuId(null);
  };

  // Derive display name from Supabase user
  const displayName = supabaseUser?.user_metadata?.username
    || supabaseUser?.email?.split('@')[0]
    || 'User';

  // Get User Initials
  const getInitials = () => {
    return displayName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#020617] text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none transition-colors duration-200">
      
      {/* 1. Header Toolbar */}
      <header className="bg-white dark:bg-[#0f172a] border-b border-slate-300/80 dark:border-slate-700/80 px-6 py-4 flex items-center justify-between sticky top-0 z-40 shadow-sm transition-colors duration-200">
        
        {/* Logo and tabs */}
        <div className="flex items-center space-x-8">
          <HeaderBranding />

          {/* Header tabs navigation */}
          <nav className="hidden md:flex space-x-1">
            {(['Experiments', 'Code Blocks', 'Learn', 'Classroom'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveHeaderTab(tab)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  activeHeaderTab === tab
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-800/5 dark:hover:bg-slate-100/10'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* User profile avatar, Add button, Log out */}
        <div className="flex items-center space-x-4">
          <button
            onClick={toggleTheme}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
            title="Toggle Dark Mode"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <button 
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-[#FF6B35] hover:bg-[#ff804d] text-slate-900 font-bold rounded-xl text-xs transition-all shadow-[0_4px_15px_rgba(255,107,53,0.25)] flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[3px]" /> New Design
          </button>

          {/* Avatar details */}
          <div className="flex items-center space-x-2 bg-slate-100/40 dark:bg-slate-800/40 border border-slate-300 dark:border-slate-700 px-3 py-1.5 rounded-xl">
            <div className="w-6 h-6 rounded-full bg-[#FF6B35] text-slate-900 text-[10px] font-extrabold flex items-center justify-center">
              {getInitials()}
            </div>
            <span className="hidden sm:inline text-xs font-bold text-slate-700 max-w-[80px] truncate">{displayName}</span>
            <button 
              onClick={handleLogout} 
              className="text-slate-600 hover:text-rose-400 transition-colors p-1" 
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main layout container */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Content Panel Area */}
        <main className="flex-1 overflow-y-auto p-6 md:p-10">
          
          {/* Header titles & Search Bar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-10">
            <div>
              <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">{activeHeaderTab} Dashboard</h1>
              <p className="text-sm text-slate-500 mt-1">Manage, clone, and launch your electronics simulation projects.</p>
            </div>

            {/* Search Input bar */}
            {activeHeaderTab !== 'Classroom' && (
              <div className="relative w-full md:w-80">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                <input 
                  type="text" 
                  placeholder={
                    activeHeaderTab === 'Learn'
                      ? "Search video tutorials..."
                      : activeHeaderTab === 'Code Blocks'
                        ? "Search code templates..."
                        : "Search circuit templates..."
                  } 
                  value={searchTerm} 
                  onChange={(e) => setSearchTerm(e.target.value)} 
                  className="w-full bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl py-2.5 pl-10 pr-4 text-sm text-slate-700 dark:text-slate-300 focus:outline-none focus:border-[#FF6B35] focus:ring-2 focus:ring-[#FF6B35]/20 transition-all shadow-sm" 
                />
              </div>
            )}
          </div>

          {/* Render Sections */}
          {activeHeaderTab === 'Experiments' && (
            <div className="space-y-12 pb-10">
            {SECTIONS.map((section) => (
              <section key={section.id} className="relative">
                {/* Section Header */}
                <div className="flex items-end justify-between mb-6">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl border ${section.bgAccent} ${section.borderAccent}`}>
                      {section.icon}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-slate-800 dark:text-white flex items-center gap-3">
                        {section.title}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border bg-white ${section.accentColor} ${section.borderAccent}`}>
                          {section.items.length} ITEMS
                        </span>
                      </h2>
                      <p className="text-xs text-slate-500 mt-0.5">{section.description}</p>
                    </div>
                  </div>
                </div>

                {/* Section Content */}
                {section.items.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                    {section.items.map(exp => (
                      <div 
                        key={exp.id} 
                        className={`group relative bg-white border border-slate-300 rounded-2xl p-4 flex flex-col justify-between hover:shadow-xl transition-all duration-300 hover:-translate-y-1 cursor-pointer ${section.hoverBorder}`}
                        onClick={() => navigate(`/simulator/${exp.id}`)}
                      >
                        
                        {/* Thumbnail Mock Card Box */}
                        <div className={`aspect-[16/9] rounded-xl mb-4 flex items-center justify-center relative overflow-hidden transition-colors ${section.bgAccent}`}>
                          {/* SVG grid lines for schematic tech feel */}
                          <div className="absolute inset-0 grid-bg opacity-[0.08]" />
                          
                          <div className="absolute flex flex-col items-center justify-center p-4 text-center z-10">
                            <div className={`w-10 h-10 rounded-full border bg-white flex items-center justify-center mb-1 shadow-sm ${section.borderAccent}`}>
                              {section.id === 'arduino' ? <CircuitBoard className={`w-5 h-5 ${section.accentColor}`} /> :
                               <Cpu className={`w-5 h-5 ${section.accentColor}`} />}
                            </div>
                            <span className={`text-[10px] uppercase font-bold tracking-widest ${section.accentColor}`}>{exp.platform}</span>
                          </div>

                          <div className="absolute top-2 left-2 px-2 py-0.5 bg-white/80 backdrop-blur border border-slate-200 text-slate-600 rounded-md text-[8px] font-mono font-bold shadow-sm">
                            ID: {exp.id}
                          </div>
                          <div 
                            className="absolute top-2 right-2 px-2 py-0.5 bg-white/80 backdrop-blur border border-slate-200 rounded-md text-[8px] font-bold shadow-sm"
                            style={{ 
                              color: exp.difficulty === 'Beginner' ? '#10b981' : exp.difficulty === 'Intermediate' ? '#f59e0b' : '#f43f5e' 
                            }}
                          >
                            {exp.difficulty || 'Beginner'}
                          </div>
                        </div>

                        {/* Card Content Details */}
                        <div className="flex-1">
                          <div className="flex justify-between items-start">
                            <h3 className={`font-bold text-slate-800 text-sm line-clamp-1 transition-colors ${section.accentColor.replace('text-', 'group-hover:text-')}`}>
                              {exp.title}
                            </h3>
                            
                            {/* Three dot actions dropdown */}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveMenuId(activeMenuId === exp.id ? null : exp.id);
                                }}
                                className="p-1 -mr-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                              
                              {activeMenuId === exp.id && (
                                <div 
                                  ref={dropdownRef}
                                  className="absolute right-0 top-7 w-36 bg-white border border-slate-200 rounded-xl shadow-xl z-20 py-1.5 text-xs text-slate-700 flex flex-col overflow-hidden"
                                >
                                  {/* Rename — only for user circuits */}
                                  {!BUILTIN_IDS.has(exp.id) && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRenameId(exp.id);
                                        setRenameTitle(exp.title);
                                        setActiveMenuId(null);
                                      }}
                                      className="px-3 py-2 hover:bg-slate-50 hover:text-[#FF6B35] text-left flex items-center gap-2 font-medium"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" /> Rename
                                    </button>
                                  )}
                                  {/* Duplicate — available for all */}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      duplicateExperiment(exp.id);
                                      setActiveMenuId(null);
                                    }}
                                    className="px-3 py-2 hover:bg-slate-50 hover:text-[#FF6B35] text-left flex items-center gap-2 font-medium"
                                  >
                                    <Copy className="w-3.5 h-3.5" /> Duplicate
                                  </button>

                                  {/* Delete — only for user-created circuits, with loading guard */}
                                  {!BUILTIN_IDS.has(exp.id) && (
                                    <>
                                      <hr className="border-slate-100 my-1" />
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteExperiment(exp.id);
                                        }}
                                        disabled={dbActionLoading === String(exp.id)}
                                        className="px-3 py-2 hover:bg-rose-50 text-rose-600 text-left flex items-center gap-2 font-medium disabled:opacity-50"
                                      >
                                        {dbActionLoading === String(exp.id)
                                          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                          : <Trash2 className="w-3.5 h-3.5" />}
                                        Delete
                                      </button>
                                    </>
                                  )}

                                  {/* Lock badge for built-in templates */}
                                  {BUILTIN_IDS.has(exp.id) && (
                                    <div className="px-3 py-2 text-slate-400 text-left flex items-center gap-2 font-medium select-none">
                                      <Lock className="w-3.5 h-3.5" /> Read-Only
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>

                          <p className="text-[11px] text-slate-500 line-clamp-2 mt-1.5 leading-relaxed">
                            {exp.description}
                          </p>
                        </div>

                        {/* Open & details footer strip */}
                        <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
                          {BUILTIN_IDS.has(exp.id)
                            ? <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1"><Lock className="w-3 h-3" /> Template</span>
                            : <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-500">My Circuit</span>
                          }
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // User circuits navigated by UUID if mapped, else by numeric id
                              const uuid = supabaseCircuitMap[String(exp.id)];
                              navigate(uuid ? `/simulator/${uuid}` : `/simulator/${exp.id}`);
                            }}
                            className={`px-3 py-1.5 bg-slate-50 hover:bg-white border border-slate-200 text-slate-600 font-bold rounded-lg text-[10px] transition-all flex items-center gap-1.5 shadow-sm ${section.hoverBorder}`}
                          >
                            <Eye className="w-3 h-3" /> Open
                          </button>
                        </div>

                      </div>
                    ))}
                  </div>
                ) : (
                  // Local Empty State
                  <div className="py-12 px-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 flex flex-col items-center justify-center text-center">
                    <div className={`w-12 h-12 rounded-full border flex items-center justify-center mb-3 bg-white shadow-sm ${section.borderAccent}`}>
                      {section.icon}
                    </div>
                    <h3 className="font-bold text-slate-700 text-sm">No {section.title} found</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                      {searchTerm ? `No matching designs found for "${searchTerm}".` : 'You haven\'t created any projects in this category yet.'}
                    </p>
                    {!searchTerm && (
                      <button
                        onClick={() => setShowCreateModal(true)}
                        className={`mt-4 px-4 py-2 bg-white border shadow-sm font-bold rounded-xl text-xs transition-all flex items-center gap-2 ${section.borderAccent} ${section.accentColor} hover:bg-slate-50`}
                      >
                        <Plus className="w-3.5 h-3.5" /> Create New
                      </button>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>
          )}

          {/* Learn Tab Content */}
          {activeHeaderTab === 'Learn' && (
            <div className="max-w-6xl mx-auto space-y-8">
              <div className="text-center space-y-2 mb-10">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Learn Electronics & Coding</h2>
                <p className="text-slate-500 dark:text-slate-400">Watch comprehensive video tutorials to master virtual circuits.</p>
              </div>
              {filteredLearnTutorials.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-12 text-center text-slate-500 dark:text-slate-400 border border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-800 shadow-sm max-w-xl mx-auto">
                  <Search className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                  <h3 className="font-bold text-lg text-slate-700 dark:text-slate-300 mb-1">No matching tutorials found</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">We couldn't find any video tutorials matching "{searchTerm}". Try checking your spelling or using a different keyword.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {/* Embedded YouTube Videos Mapping */}
                  {filteredLearnTutorials.map((tutorial, idx) => {
                    const youtubeId = tutorial.video_url.split('v=')[1]?.split('&')[0];
                    
                    return (
                      <div key={idx} className="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col hover:shadow-lg transition-all group">
                        <div className="aspect-video bg-slate-100 dark:bg-slate-900 relative">
                          <iframe 
                            className="absolute inset-0 w-full h-full"
                            src={`https://www.youtube.com/embed/${youtubeId}`} 
                            title={tutorial.title}
                            frameBorder="0" 
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                            allowFullScreen
                          ></iframe>
                        </div>
                        <div className="p-5 flex-1 flex flex-col">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex gap-1.5">
                              <div className={`inline-flex items-center px-2.5 py-1 text-[10px] font-bold rounded-full ${
                                tutorial.platform === 'Arduino' 
                                  ? 'bg-[#00979D]/10 text-[#00979D]' 
                                  : tutorial.platform === 'Raspberry Pi'
                                    ? 'bg-[#C51A4A]/10 text-[#C51A4A]'
                                    : 'bg-purple-500/10 text-purple-600'
                              }`}>
                                {tutorial.platform}
                              </div>
                              {tutorial.difficulty && (
                                <div 
                                  className="inline-flex items-center px-2.5 py-1 text-[10px] font-bold rounded-full"
                                  style={{ 
                                    backgroundColor: tutorial.difficulty === 'Beginner' ? '#10b98115' : tutorial.difficulty === 'Intermediate' ? '#f59e0b15' : '#f43f5e15',
                                    color: tutorial.difficulty === 'Beginner' ? '#10b981' : tutorial.difficulty === 'Intermediate' ? '#f59e0b' : '#f43f5e' 
                                  }}
                                >
                                  {tutorial.difficulty}
                                </div>
                              )}
                            </div>
                            <div className="text-[10px] font-semibold text-slate-400">
                              Exp {tutorial.id}
                            </div>
                          </div>
                          <h3 className="font-bold text-slate-800 dark:text-slate-100 mb-2 leading-snug group-hover:text-[#FF6B35] transition-colors">{tutorial.title}</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 flex-1">{tutorial.description}</p>
                          
                          <a 
                            href={tutorial.video_url} 
                            target="_blank" 
                            rel="noreferrer"
                            className="inline-flex items-center justify-center gap-2 w-full py-2 px-4 bg-slate-50 hover:bg-slate-100 dark:bg-slate-700/50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors mt-auto"
                          >
                            <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                            </svg>
                            Watch on YouTube
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Classroom Tab Content */}
          {activeHeaderTab === 'Classroom' && (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center max-w-2xl mx-auto">
              <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight">Virtual Classroom</h2>
              <p className="text-lg text-slate-500 mb-10">Collaborate with your students or join an existing session to start experimenting together in real-time.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full">
                <button className="group relative p-8 bg-white border border-slate-200 rounded-3xl hover:border-[#FF6B35] hover:shadow-[0_8px_30px_rgba(255,107,53,0.15)] transition-all flex flex-col items-center gap-4 text-center cursor-pointer overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-[#FF6B35]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="w-16 h-16 rounded-2xl bg-[#FF6B35]/10 text-[#FF6B35] flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Plus className="w-8 h-8 stroke-[2.5px]" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Create Class</h3>
                    <p className="text-sm text-slate-500">Start a new session for your students</p>
                  </div>
                </button>
                <button className="group relative p-8 bg-white border border-slate-200 rounded-3xl hover:border-blue-500 hover:shadow-[0_8px_30px_rgba(59,130,246,0.15)] transition-all flex flex-col items-center gap-4 text-center cursor-pointer overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="w-16 h-16 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <FolderGit2 className="w-8 h-8 stroke-[2.5px]" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800 mb-2">Join Class</h3>
                    <p className="text-sm text-slate-500">Enter a code to join an existing session</p>
                  </div>
                </button>
              </div>
            </div>
          )}

          {/* Code Blocks Tab Content (Previously Designs) */}
          {activeHeaderTab === 'Code Blocks' && (
            <div className="space-y-6">


              <div className="snitch-grid-cols-3 snitch-container">
                <div>
                  <ExperimentsPanel 
                    experiments={filteredCodeBlocks.map(exp => ({ id: exp.id, title: exp.title, category: exp.category || 'arduino', difficulty: exp.difficulty || 'Beginner' }))} 
                    selectedId={selectedPreviewId || undefined}
                    onAddCustomExperiment={() => setShowCreateModal(true)}
                    onSelectExperiment={(id) => setSelectedPreviewId(id as number)}
                  />
                </div>
                <div className="snitch-flex-col snitch-gap-md">
                  <div className="snitch-card snitch-h-full snitch-flex-col">
                    <div className="snitch-card-header snitch-flex snitch-items-center snitch-justify-between">
                      <div>
                        <h2 className="snitch-text-title" style={{ marginBottom: 0 }}>Experiment Source Code</h2>
                        <p className="snitch-text-subtitle">Review the hardware configuration and execution logic for the selected experiment.</p>
                      </div>
                      {selectedPreviewId && (
                        <button
                          onClick={() => navigate(`/simulator/${selectedPreviewId}`)}
                          className="snitch-btn-primary"
                          style={{ padding: '0.5rem 1rem', fontSize: '0.875rem' }}
                        >
                          <Eye style={{ width: '16px', height: '16px' }} /> Open in Simulator
                        </button>
                      )}
                    </div>
                    
                    {selectedPreviewId ? (
                      <div className="snitch-card-body snitch-h-full" style={{ padding: 0 }}>
                        <SyntaxCodeViewer 
                          code={experiments.find(e => e.id === selectedPreviewId)?.defaultCode || '// No code available for this experiment'}
                          language={experiments.find(e => e.id === selectedPreviewId)?.platform === 'Raspberry Pi' ? 'python' : 'cpp'}
                          fileName={experiments.find(e => e.id === selectedPreviewId)?.platform === 'Raspberry Pi' ? 'main.py' : 'main.ino'}
                        />
                      </div>
                    ) : (
                      <div className="snitch-card-body snitch-flex snitch-items-center snitch-justify-center snitch-h-full" style={{ color: 'var(--snitch-text-muted)' }}>
                        <p>Select an experiment to view its source code.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Create New Design Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-7 w-full max-w-md shadow-2xl relative animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold text-slate-900 mb-1">Create New Design</h2>
            <p className="text-sm text-slate-500 mb-6">Choose a board and name your workspace template.</p>
            
            <form onSubmit={handleCreateNew} className="space-y-5">
              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Design Name</label>
                <input
                  type="text"
                  placeholder="e.g. Smart Alarm Circuit"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-[#FF6B35] focus:ring-4 focus:ring-[#FF6B35]/10 transition-all shadow-sm"
                  required
                />
              </div>

              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Target Microcontroller</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewPlatform('Arduino')}
                    className={`py-4 border rounded-2xl flex flex-col items-center justify-center gap-2 transition-all shadow-sm ${
                      newPlatform === 'Arduino'
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-600 ring-4 ring-emerald-500/10'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <CircuitBoard className={`w-6 h-6 ${newPlatform === 'Arduino' ? 'text-emerald-500' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold">Arduino Uno</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewPlatform('Raspberry Pi')}
                    className={`py-4 border rounded-2xl flex flex-col items-center justify-center gap-2 transition-all shadow-sm ${
                      newPlatform === 'Raspberry Pi'
                        ? 'bg-rose-50 border-rose-500 text-rose-600 ring-4 ring-rose-500/10'
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <Cpu className={`w-6 h-6 ${newPlatform === 'Raspberry Pi' ? 'text-rose-500' : 'text-slate-400'}`} />
                    <span className="text-xs font-bold">RPi Pico</span>
                  </button>
                </div>
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewTitle('');
                  }}
                  className="flex-1 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-bold transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-[#FF6B35] hover:bg-[#ff804d] text-white rounded-xl text-sm font-bold transition-all shadow-[0_4px_15px_rgba(255,107,53,0.3)]"
                >
                  Create &amp; Open
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
          <div className="bg-white border border-slate-200 rounded-3xl p-7 w-full max-w-md shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold text-slate-900 mb-1">Rename Design</h2>
            <p className="text-sm text-slate-500 mb-6">Enter a new name for this circuit design template.</p>
            
            <form onSubmit={handleRenameSubmit} className="space-y-5">
              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">New Name</label>
                <input
                  type="text"
                  value={renameTitle}
                  onChange={(e) => setRenameTitle(e.target.value)}
                  className="bg-white border border-slate-300 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-[#FF6B35] focus:ring-4 focus:ring-[#FF6B35]/10 transition-all shadow-sm"
                  required
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setRenameId(null);
                    setRenameTitle('');
                  }}
                  className="flex-1 py-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-bold transition-all shadow-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-3 bg-[#FF6B35] hover:bg-[#ff804d] text-white rounded-xl text-sm font-bold transition-all shadow-[0_4px_15px_rgba(255,107,53,0.3)]"
                >
                  Save Name
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
