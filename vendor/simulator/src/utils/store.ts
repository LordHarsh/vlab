import { create } from 'zustand';
import type { Experiment } from '../types';
import { EXPERIMENTS } from './experimentData';

interface User {
  name: string;
  email: string;
}

interface AppState {
  user: User | null;
  isAuthenticated: boolean;
  experiments: Experiment[];
  login: (email: string, name?: string) => void;
  signup: (name: string, email: string) => void;
  logout: () => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  addExperiment: (title: string, platform: 'Arduino' | 'Raspberry Pi', type: 'circuits' | '3d' | 'codeblocks') => Experiment;
  renameExperiment: (id: number, title: string) => void;
  duplicateExperiment: (id: number) => void;
  deleteExperiment: (id: number) => void;
}

// Load initial state
const getStoredUser = () => {
  try {
    const userStr = localStorage.getItem('circuitlab_user');
    return userStr ? JSON.parse(userStr) : null;
  } catch {
    return null;
  }
};

const getStoredExperiments = () => {
  try {
    const expStr = localStorage.getItem('circuitlab_experiments');
    if (!expStr) return EXPERIMENTS;
    const stored = JSON.parse(expStr);
    
    // Always use the latest codebase definitions for built-in templates (IDs present in EXPERIMENTS)
    // but preserve the user's custom-created experiments.
    const builtInIds = new Set(EXPERIMENTS.map(e => e.id));
    const customs = stored.filter((e: any) => !builtInIds.has(e.id));
    return [...EXPERIMENTS, ...customs];
  } catch {
    return EXPERIMENTS;
  }
};

const getStoredTheme = (): 'light' | 'dark' => {
  try {
    const themeStr = localStorage.getItem('circuitlab_theme') as 'light' | 'dark';
    if (themeStr === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
      return 'dark';
    }
    return 'light';
  } catch {
    return 'light';
  }
};

export const useStore = create<AppState>((set, get) => ({
  user: getStoredUser(),
  isAuthenticated: !!getStoredUser(),
  theme: getStoredTheme(),
  experiments: getStoredExperiments(),

  login: (email, name) => {
    const user = { name: name || email.split('@')[0], email };
    localStorage.setItem('circuitlab_user', JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },

  signup: (name, email) => {
    const user = { name, email };
    localStorage.setItem('circuitlab_user', JSON.stringify(user));
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    localStorage.removeItem('circuitlab_user');
    set({ user: null, isAuthenticated: false });
  },

  toggleTheme: () => {
    const currentTheme = get().theme;
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    localStorage.setItem('circuitlab_theme', newTheme);
    if (newTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.setAttribute('data-theme', 'light');
    }
    set({ theme: newTheme });
  },

  addExperiment: (title, platform, type) => {
    const newId = Math.max(...get().experiments.map(e => e.id), 0) + 1;
    
    // Choose template based on platform
    const template = platform === 'Arduino' 
      ? {
          defaultCode: `// Arduino DSULab Design\nvoid setup() {\n  Serial.begin(9650);\n  Serial.println("DSULab Ready!");\n}\n\nvoid loop() {\n  \n}`,
          defaultComponents: [
            { id: 'uno_1', type: 'arduino', name: 'Arduino Uno R3', x: 50, y: 70, rotation: 0, properties: {} },
            { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 350, y: 70, rotation: 0, properties: {} }
          ],
          defaultWires: []
        }
      : {
          defaultCode: `# Raspberry Pi Pico Design\nimport time\nprint("Pico Design Ready!")\n\nwhile True:\n    time.sleep(1)\n`,
          defaultComponents: [
            { id: 'rpi_1', type: 'raspberry_pi', name: 'Raspberry Pi Pico', x: 50, y: 110, rotation: 0, properties: {} },
            { id: 'breadboard_1', type: 'breadboard', name: 'Breadboard', x: 350, y: 70, rotation: 0, properties: {} }
          ],
          defaultWires: []
        };

    const newExp: Experiment = {
      id: newId,
      title,
      description: `Custom ${platform} ${type === 'circuits' ? 'Circuit Design' : type === '3d' ? '3D Design' : 'Code Block'}`,
      category: platform === 'Arduino' ? 'arduino' : 'raspberry-pi',
      platform,
      keyComponents: [platform === 'Arduino' ? 'Arduino Uno' : 'Raspberry Pi Pico', 'Breadboard'],
      ...template,
      tips: ['Use the Component Library in the left sidebar to add devices.', 'Connect pins by clicking on them to route wires.'],
      buildSteps: ['Add components and route wires to assemble your custom circuit.']
    };

    const updated = [newExp, ...get().experiments];
    localStorage.setItem('circuitlab_experiments', JSON.stringify(updated));
    set({ experiments: updated });
    return newExp;
  },

  renameExperiment: (id, title) => {
    const updated = get().experiments.map(e => e.id === id ? { ...e, title } : e);
    localStorage.setItem('circuitlab_experiments', JSON.stringify(updated));
    set({ experiments: updated });
  },

  duplicateExperiment: (id) => {
    const source = get().experiments.find(e => e.id === id);
    if (!source) return;

    const newId = Math.max(...get().experiments.map(e => e.id), 0) + 1;
    const copy: Experiment = {
      ...source,
      id: newId,
      title: `${source.title} (Copy)`,
    };

    const updated = [copy, ...get().experiments];
    localStorage.setItem('circuitlab_experiments', JSON.stringify(updated));
    set({ experiments: updated });
  },

  deleteExperiment: (id) => {
    const updated = get().experiments.filter(e => e.id !== id);
    localStorage.setItem('circuitlab_experiments', JSON.stringify(updated));
    set({ experiments: updated });
  }
}));
