import React from 'react';
import { Plus, Beaker, ChevronRight } from 'lucide-react';

interface ExperimentItem {
  id: string | number;
  title: string;
  category: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
}

interface ExperimentsPanelProps {
  experiments: ExperimentItem[];
  selectedId?: string | number;
  onAddCustomExperiment: () => void;
  onSelectExperiment: (id: string | number) => void;
}

export const ExperimentsPanel: React.FC<ExperimentsPanelProps> = ({
  experiments,
  selectedId,
  onAddCustomExperiment,
  onSelectExperiment
}) => {
  return (
    <section className="snitch-card snitch-flex-col snitch-w-full" style={{ height: '600px' }}>
      <header className="snitch-card-header snitch-flex snitch-items-center snitch-justify-between">
        <div>
          <h2 className="snitch-text-title snitch-flex snitch-items-center snitch-gap-sm" style={{ marginBottom: 0 }}>
            <Beaker className="snitch-text-brand" style={{ width: '20px', height: '20px' }} />
            Experiments
          </h2>
          <p className="snitch-text-subtitle">Select a template or create your own</p>
        </div>
        
        <button 
          onClick={onAddCustomExperiment}
          className="snitch-btn-icon"
          aria-label="Add Custom Experiment"
          title="Add Custom Experiment"
        >
          <Plus strokeWidth={2.5} />
        </button>
      </header>

      <div style={{ padding: '1rem', borderBottom: '1px solid var(--snitch-border)' }}>
        <button 
          onClick={onAddCustomExperiment}
          className="snitch-btn-primary snitch-w-full"
          style={{ background: 'var(--snitch-bg-dark)' }}
        >
          <Plus style={{ width: '16px', height: '16px' }} /> Add Custom Experiment
        </button>
      </div>

      <div className="snitch-card-body" style={{ flex: 1, overflowY: 'auto', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {experiments.length === 0 ? (
          <div className="snitch-flex snitch-flex-col snitch-items-center snitch-justify-center snitch-h-full" style={{ color: 'var(--snitch-text-muted)' }}>
            <Beaker style={{ width: '32px', height: '32px', marginBottom: '0.75rem', opacity: 0.2 }} />
            <p className="snitch-text-subtitle">No experiments available.</p>
          </div>
        ) : (
          experiments.map((exp) => (
            <div 
              key={exp.id}
              onClick={() => onSelectExperiment(exp.id)}
              className={`snitch-list-item ${selectedId === exp.id ? 'active' : ''}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', textAlign: 'left' }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && onSelectExperiment(exp.id)}
            >
              <div className="snitch-flex-col" style={{ flex: 1, minWidth: 0, alignItems: 'flex-start', textAlign: 'left' }}>
                <h3 className="snitch-text-body" style={{ fontWeight: 'bold', color: selectedId === exp.id ? 'var(--snitch-primary)' : 'var(--snitch-text-main)', textAlign: 'left', width: '100%' }}>
                  {exp.title}
                </h3>
                <div className="snitch-flex snitch-items-center snitch-gap-sm" style={{ marginTop: '0.25rem', justifyContent: 'flex-start', width: '100%' }}>
                  <span style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 'bold', color: 'var(--snitch-text-muted)' }}>
                    {exp.category}
                  </span>
                  <span style={{ width: '4px', height: '4px', borderRadius: '50%', backgroundColor: 'var(--snitch-border)' }} />
                  <span style={{ fontSize: '10px', fontWeight: 'bold', color: exp.difficulty === 'Beginner' ? '#10b981' : exp.difficulty === 'Intermediate' ? '#f59e0b' : '#f43f5e' }}>
                    {exp.difficulty}
                  </span>
                </div>
              </div>
              
              <ChevronRight style={{ width: '16px', height: '16px', flexShrink: 0, color: selectedId === exp.id ? 'var(--snitch-primary)' : 'var(--snitch-border)', marginLeft: '1rem' }} />
            </div>
          ))
        )}
      </div>
    </section>
  );
};
