import React, { useState, useEffect, useRef, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import type { Monaco } from '@monaco-editor/react';
import { Play, Square, Pause, StepForward, Trash2, Download, ArrowLeft, Layers, FileSpreadsheet, Eye, Sliders, Server, Search, LayoutGrid, ChevronRight, Cpu, Sun, Moon, Loader2 } from 'lucide-react';
import type { ComponentInstance, WireConnection, Experiment, SimulationState } from '../types';
import { COMPONENT_DEFINITIONS } from '../utils/componentDefinitions';
import { ComponentSVGs } from './ComponentSVGs';
import { CircuitInterpreter } from '../utils/interpreter';
import { getSchematicDimensions, getSchematicPinCoords, getManhattanPath, getBezierPath } from '../utils/schematicLayout';
import { Wire } from './features/Wire';
import { useCircuitSync } from '../database/useCircuitSync';
import { SaveIndicator } from './features/SaveIndicator';

const STARTER_DEFINITIONS: Record<string, { name: string; description: string; type: string; width: number; height: number; defaultProperties: any }> = {
  breadboard_only: { type: 'breadboard_only', name: 'Breadboard Only', description: 'A blank half breadboard starter template.', width: 60, height: 40, defaultProperties: {} },
  led_resistor: { type: 'led_resistor', name: 'LED + Resistor', description: 'An LED with a current-limiting resistor pre-wired.', width: 60, height: 40, defaultProperties: {} },
  button_led: { type: 'button_led', name: 'Button + LED', description: 'A tactile button controlling an LED.', width: 60, height: 40, defaultProperties: {} },
  arduino_breadboard: { type: 'arduino_breadboard', name: 'Arduino + Breadboard', description: 'An Arduino Uno R3 and a half breadboard.', width: 60, height: 40, defaultProperties: {} },
  blink_starter: { type: 'blink_starter', name: 'Blink Starter', description: 'Classic Arduino LED blink circuit.', width: 60, height: 40, defaultProperties: {} },
  traffic_light: { type: 'traffic_light', name: 'Traffic Light', description: 'Red, yellow, green traffic light starter.', width: 60, height: 40, defaultProperties: {} },
  button_input: { type: 'button_input', name: 'Button Input', description: 'Tactile push button input to Arduino.', width: 60, height: 40, defaultProperties: {} },
  pwm_dimmer: { type: 'pwm_dimmer', name: 'PWM Dimmer', description: 'Potentiometer analog input dimming an LED.', width: 60, height: 40, defaultProperties: {} },
  microbit_board: { type: 'microbit_board', name: 'Micro:Bit Board', description: 'A standalone micro:bit board.', width: 60, height: 40, defaultProperties: {} },
  microbit_breadboard: { type: 'microbit_breadboard', name: 'Micro:Bit + Breadboard', description: 'Micro:bit connected to a breadboard.', width: 60, height: 40, defaultProperties: {} },
  microbit_button: { type: 'microbit_button', name: 'Micro:Bit Button LED', description: 'Micro:bit button controlling an LED.', width: 60, height: 40, defaultProperties: {} },
  h_bridge: { type: 'h_bridge', name: 'H-Bridge Driver', description: 'H-Bridge motor driver starter circuit.', width: 60, height: 40, defaultProperties: {} },
  ir_receiver_circuit: { type: 'ir_receiver_circuit', name: 'IR Receiver Circuit', description: 'IR receiver connected to Arduino.', width: 60, height: 40, defaultProperties: {} },
  voltage_divider: { type: 'voltage_divider', name: 'Voltage Divider', description: 'Two 10k resistors forming a voltage divider.', width: 60, height: 40, defaultProperties: {} },
  rc_filter: { type: 'rc_filter', name: 'RC Low-Pass Filter', description: 'RC low pass filter circuit.', width: 60, height: 40, defaultProperties: {} },
  wheatstone_bridge: { type: 'wheatstone_bridge', name: 'Wheatstone Bridge', description: 'Four resistors forming a Wheatstone bridge.', width: 60, height: 40, defaultProperties: {} }
};

const CATEGORIZED_ITEMS: Record<string, { type: 'component' | 'starter', id: string }[]> = {
  'COMPONENTS > Basic': [
    { type: 'component', id: 'resistor' },
    { type: 'component', id: 'capacitor' },
    { type: 'component', id: 'capacitor_ceramic' },
    { type: 'component', id: 'inductor' },
    { type: 'component', id: 'led' },
    { type: 'component', id: 'diode' },
    { type: 'component', id: 'zener_diode' },
    { type: 'component', id: 'npn_transistor' },
    { type: 'component', id: 'pnp_transistor' },
    { type: 'component', id: 'mosfet' },
    { type: 'component', id: 'push_button' },
    { type: 'component', id: 'slide_switch' },
    { type: 'component', id: 'dip_switch' },
    { type: 'component', id: 'toggle_switch' },
    { type: 'component', id: 'potentiometer' },
    { type: 'component', id: 'photoresistor' },
    { type: 'component', id: 'thermistor' },
    { type: 'component', id: 'battery_9v' },
    { type: 'component', id: 'battery_aa' },
    { type: 'component', id: 'power_supply_5v' },
    { type: 'component', id: 'buzzer' },
    { type: 'component', id: 'buzzer_passive' },
    { type: 'component', id: 'speaker' },
    { type: 'component', id: 'relay' },
    { type: 'component', id: 'fuse' }
  ],
  'COMPONENTS > All': [
    { type: 'component', id: 'resistor' },
    { type: 'component', id: 'capacitor' },
    { type: 'component', id: 'capacitor_ceramic' },
    { type: 'component', id: 'inductor' },
    { type: 'component', id: 'led' },
    { type: 'component', id: 'diode' },
    { type: 'component', id: 'zener_diode' },
    { type: 'component', id: 'npn_transistor' },
    { type: 'component', id: 'pnp_transistor' },
    { type: 'component', id: 'mosfet' },
    { type: 'component', id: 'push_button' },
    { type: 'component', id: 'slide_switch' },
    { type: 'component', id: 'dip_switch' },
    { type: 'component', id: 'toggle_switch' },
    { type: 'component', id: 'potentiometer' },
    { type: 'component', id: 'photoresistor' },
    { type: 'component', id: 'thermistor' },
    { type: 'component', id: 'battery_9v' },
    { type: 'component', id: 'battery_aa' },
    { type: 'component', id: 'power_supply_5v' },
    { type: 'component', id: 'buzzer' },
    { type: 'component', id: 'buzzer_passive' },
    { type: 'component', id: 'speaker' },
    { type: 'component', id: 'relay' },
    { type: 'component', id: 'fuse' },
    { type: 'component', id: 'shift_register_74hc595' },
    { type: 'component', id: 'hex_inverter_74hc04' },
    { type: 'component', id: 'gate_nand_74hc00' },
    { type: 'component', id: 'timer_ic_555' },
    { type: 'component', id: 'opamp_lm741' },
    { type: 'component', id: 'voltage_reg_7805' },
    { type: 'component', id: 'seven_segment' },
    { type: 'component', id: 'lcd' },
    { type: 'component', id: 'oled' },
    { type: 'component', id: 'led_rgb' },
    { type: 'component', id: 'led_matrix' },
    { type: 'component', id: 'neopixel' }
  ],
  'STARTERS > Basic': [
    { type: 'starter', id: 'breadboard_only' },
    { type: 'starter', id: 'led_resistor' },
    { type: 'starter', id: 'button_led' }
  ],
  'STARTERS > Arduino': [
    { type: 'starter', id: 'arduino_breadboard' },
    { type: 'starter', id: 'blink_starter' },
    { type: 'starter', id: 'traffic_light' },
    { type: 'starter', id: 'button_input' },
    { type: 'starter', id: 'pwm_dimmer' }
  ],
  'STARTERS > Micro:Bit': [
    { type: 'starter', id: 'microbit_board' },
    { type: 'starter', id: 'microbit_breadboard' },
    { type: 'starter', id: 'microbit_button' }
  ],
  'STARTERS > Circuit Assemblies': [
    { type: 'starter', id: 'h_bridge' },
    { type: 'starter', id: 'ir_receiver_circuit' },
    { type: 'starter', id: 'voltage_divider' },
    { type: 'starter', id: 'rc_filter' },
    { type: 'starter', id: 'wheatstone_bridge' }
  ],
  'STARTERS > All': [
    { type: 'starter', id: 'breadboard_only' },
    { type: 'starter', id: 'led_resistor' },
    { type: 'starter', id: 'button_led' },
    { type: 'starter', id: 'arduino_breadboard' },
    { type: 'starter', id: 'blink_starter' },
    { type: 'starter', id: 'traffic_light' },
    { type: 'starter', id: 'button_input' },
    { type: 'starter', id: 'pwm_dimmer' },
    { type: 'starter', id: 'microbit_board' },
    { type: 'starter', id: 'microbit_breadboard' },
    { type: 'starter', id: 'microbit_button' },
    { type: 'starter', id: 'h_bridge' },
    { type: 'starter', id: 'ir_receiver_circuit' },
    { type: 'starter', id: 'voltage_divider' },
    { type: 'starter', id: 'rc_filter' },
    { type: 'starter', id: 'wheatstone_bridge' }
  ]
};

const getStarterIconType = (sType: string): string => {
  switch (sType) {
    case 'breadboard_only': return 'breadboard';
    case 'led_resistor': return 'led';
    case 'button_led': return 'push_button';
    case 'arduino_breadboard': return 'arduino';
    case 'blink_starter': return 'arduino';
    case 'traffic_light': return 'led';
    case 'button_input': return 'push_button';
    case 'pwm_dimmer': return 'potentiometer';
    case 'microbit_board': return 'microbit';
    case 'microbit_breadboard': return 'microbit';
    case 'microbit_button': return 'microbit';
    case 'h_bridge': return 'dc_motor';
    case 'ir_receiver_circuit': return 'ir_sensor';
    case 'voltage_divider': return 'resistor';
    case 'rc_filter': return 'capacitor';
    case 'wheatstone_bridge': return 'resistor';
    default: return 'arduino';
  }
};



// ─── Grid Constants ──────────────────────────────────────────────────────────
// BREADBOARD_PITCH: the pixel distance between adjacent holes on the breadboard.
// This MUST match componentDefinitions.ts colSpacing (15) and rowSpacing (15).
const BREADBOARD_PITCH = 15;

// The breadboard's first hole column starts at startX=50 within the component.
// So absolute hole X positions = breadboard.x + 50 + col * 15.
// For a free-canvas component pin to land on a hole, we snap its absolute pin
// position to the nearest (breadboard.x + 50 + N * 15) grid.
const snapToGrid = (value: number, pitch: number, offset: number = 0): number => {
  return Math.round((value - offset) / pitch) * pitch + offset;
};

const snapComponentPosition = (
  type: string,
  targetX: number,
  targetY: number,
  rotation: number,
  allComponents: ComponentInstance[]
): { x: number; y: number } => {
  const compMeta = COMPONENT_DEFINITIONS[type];
  if (!compMeta) return { x: targetX, y: targetY };

  const breadboard = allComponents.find(c => c.type === 'breadboard');
  if (breadboard && type !== 'breadboard') {
    const bbMeta = COMPONENT_DEFINITIONS.breadboard;
    const insideBb =
      targetX > breadboard.x - 30 &&
      targetX < breadboard.x + bbMeta.width + 10 &&
      targetY > breadboard.y - 30 &&
      targetY < breadboard.y + bbMeta.height + 10;

    if (insideBb && compMeta.pins && compMeta.pins.length > 0) {
      // Use the first pin as the anchor point to find the nearest hole
      const firstPin = compMeta.pins[0];
      const cx = targetX + compMeta.width / 2;
      const cy = targetY + compMeta.height / 2;
      const rx = firstPin.x - compMeta.width / 2;
      const ry = firstPin.y - compMeta.height / 2;
      const rad = (rotation * Math.PI) / 180;
      const rotX = rx * Math.cos(rad) - ry * Math.sin(rad);
      const rotY = rx * Math.sin(rad) + ry * Math.cos(rad);
      const pinAbsX = cx + rotX;
      const pinAbsY = cy + rotY;

      let closestHole = null;
      let minDist = Infinity;

      for (const hole of bbMeta.pins) {
        const hx = breadboard.x + hole.x;
        const hy = breadboard.y + hole.y;
        const d = Math.hypot(pinAbsX - hx, pinAbsY - hy);
        if (d < minDist) {
          minDist = d;
          closestHole = { x: hx, y: hy };
        }
      }

      if (closestHole && minDist < 30) {
        const pinOffsetFromOriginX = compMeta.width / 2 + rotX;
        const pinOffsetFromOriginY = compMeta.height / 2 + rotY;
        return {
          x: closestHole.x - pinOffsetFromOriginX,
          y: closestHole.y - pinOffsetFromOriginY
        };
      }

      // Fallback: snap the component's first pin to the breadboard hole grid.
      // Breadboard holes: startX=50 from bb.x, spaced BREADBOARD_PITCH apart.
      const snappedPinX = snapToGrid(pinAbsX, BREADBOARD_PITCH, breadboard.x + 50);
      const snappedPinY = snapToGrid(pinAbsY, BREADBOARD_PITCH, breadboard.y + 60); // terminalTopY=60
      const pinOffsetFromOriginX = compMeta.width / 2 + rotX;
      const pinOffsetFromOriginY = compMeta.height / 2 + rotY;
      return {
        x: snappedPinX - pinOffsetFromOriginX,
        y: snappedPinY - pinOffsetFromOriginY
      };
    }
  }

  // Outside breadboard: snap to global 15px grid
  if (type === 'breadboard') {
    return {
      x: snapToGrid(targetX, BREADBOARD_PITCH),
      y: snapToGrid(targetY, BREADBOARD_PITCH)
    };
  }

  // For all other free-standing components, snap using the breadboard's
  // hole-column offset so components placed near each other stay grid-aligned.
  const bbRef = allComponents.find(c => c.type === 'breadboard');
  const xOffset = bbRef ? (bbRef.x + 50) % BREADBOARD_PITCH : 0;
  const yOffset = bbRef ? (bbRef.y + 60) % BREADBOARD_PITCH : 0;
  return {
    x: snapToGrid(targetX, BREADBOARD_PITCH, xOffset),
    y: snapToGrid(targetY, BREADBOARD_PITCH, yOffset)
  };
};

interface SimulatorWorkspaceProps {
  experiment: Experiment;
  circuitId?: string;
  onBack: () => void;
}

export const SimulatorWorkspace: React.FC<SimulatorWorkspaceProps> = ({ experiment, circuitId, onBack }) => {
  // Supabase Sync Hooks & State
  const { saveCircuit, loadCircuit, isSaving, lastSavedAt, error: syncError } = useCircuitSync();
  const [isLoadingDb, setIsLoadingDb] = useState(false);
  const [dbCircuitTitle, setDbCircuitTitle] = useState('');
  // Tabs & Layout
  const [activeTab, setActiveTab] = useState<'breadboard' | 'schematic' | 'bom'>('breadboard');
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);
  const [showCode, setShowCode] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sidebarTab, setSidebarTab] = useState<'library' | 'steps'>('library');
  
  // New Collapsible and Tab layout states
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'code' | 'serial' | 'sensors'>('code');
  const [showGrid, setShowGrid] = useState(true);
  const [spacePressed, setSpacePressed] = useState(false);
  const [wireStyle, setWireStyle] = useState<'bezier' | 'manhattan'>('manhattan');
  const [showBreadboardInternals] = useState(false);
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  
  // Collapsible categories inside left panel library
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({
    'COMPONENTS > Basic': false,
    'COMPONENTS > All': true,
    'STARTERS > Basic': true,
    'STARTERS > Arduino': true,
    'STARTERS > Micro:Bit': true,
    'STARTERS > Circuit Assemblies': true,
    'STARTERS > All': true,
  });

  // Canvas State
  const [components, setComponents] = useState<ComponentInstance[]>([]);
  const [wires, setWires] = useState<WireConnection[]>([]);
  const [selectedElement, setSelectedElement] = useState<{ type: 'component' | 'wire'; id: string } | null>(null);
  const [selectedComponentIds, setSelectedComponentIds] = useState<string[]>([]);
  const [selectionRect, setSelectionRect] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [flashMessage, setFlashMessage] = useState<{ type: 'success' | 'error'; text: string; x: number; y: number } | null>(null);
  const [hoveredPin, setHoveredPin] = useState<{ componentId: string; pinId: string } | null>(null);
  
  // Undo/Redo Revision History
  const [history, setHistory] = useState<{ components: ComponentInstance[]; wires: WireConnection[] }[]>([]);
  const [redoStack, setRedoStack] = useState<{ components: ComponentInstance[]; wires: WireConnection[] }[]>([]);
  const [dragStartPos, setDragStartPos] = useState<{ components: ComponentInstance[]; wires: WireConnection[] } | null>(null);

  // Floating Context Menu
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; componentId: string } | null>(null);

  // Pan and Zoom
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 100, y: 80 }); // default slightly offset
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Wire drawing state
  const [drawingWire, setDrawingWire] = useState<{
    fromComponentId: string;
    fromPinId: string;
    x: number;
    y: number;
  } | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [selectedWireColor, setSelectedWireColor] = useState('red');

  // Drag component state
  const [draggingComponent, setDraggingComponent] = useState<string | null>(null);
  const [draggingWireNode, setDraggingWireNode] = useState<{ wireId: string; nodeIndex: number } | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  // Code editor content
  const [codeContent, setCodeContent] = useState('');
  const [languageMode, setLanguageMode] = useState<'Arduino C++' | 'MicroPython'>('Arduino C++');
  
  // Simulation and Interpreter State
  const [simState, setSimState] = useState<SimulationState>({
    isRunning: false,
    isPaused: false,
    currentLine: null,
    breakpoints: new Set(),
    variables: {},
    pinStates: {},
    sensorInputs: {
      temperature: 24,
      humidity: 45,
      distance: 50,
      motion: false,
      waterFlowLPM: 0,
      buttonInput: false,
      flaskToggleInput: false,
      bpmInput: 72,
      tempProbe: 25,
    },
    serialOutput: [],
  });

  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<any[]>([]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const interpreterRef = useRef<CircuitInterpreter | null>(null);
  const simIntervalRef = useRef<any>(null);
  const blinkIntervalRef = useRef<any>(null);

  // Undo/Redo logic
  const pushState = (newComponents: ComponentInstance[], newWires: WireConnection[]) => {
    setHistory(prev => [...prev, { components: [...newComponents], wires: [...newWires] }]);
    setRedoStack([]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(prevHistory => prevHistory.slice(0, -1));
    setRedoStack(prevRedo => [...prevRedo, { components: [...components], wires: [...wires] }]);
    setComponents(prev.components);
    setWires(prev.wires);
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(prevRedo => prevRedo.slice(0, -1));
    setHistory(prevHistory => [...prevHistory, { components: [...components], wires: [...wires] }]);
    setComponents(next.components);
    setWires(next.wires);
  };

  const duplicateSelectedComponent = (id: string) => {
    const comp = components.find(c => c.id === id);
    if (!comp) return;
    pushState(components, wires);
    const newId = `${comp.type}_${Date.now()}`;
    const duplicate: ComponentInstance = {
      ...comp,
      id: newId,
      name: `${comp.name} Copy`,
      x: comp.x + 40,
      y: comp.y + 40,
    };
    setComponents(prev => [...prev, duplicate]);
    setSelectedElement({ type: 'component', id: newId });
    setSelectedComponentIds([newId]);
  };

  // Keyboard Hotkeys and Spacebar Panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.closest('.monaco-editor') ||
        activeEl.getAttribute('contenteditable') === 'true'
      );
      
      if (isInputFocused) return;

      if (e.code === 'Space') {
        setSpacePressed(true);
        e.preventDefault();
      }

      if (e.key === 'Escape') {
        if (drawingWire) {
          setDrawingWire(null);
          e.preventDefault();
        }
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelectedElement();
        e.preventDefault();
      }

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isCmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;

      if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      }

      if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    const handleGlobalClick = () => {
      setContextMenu(null);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('click', handleGlobalClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('click', handleGlobalClick);
    };
  }, [drawingWire, components, wires, selectedElement, selectedComponentIds, history, redoStack]);

  // Load experiment template or fetch from Supabase
  useEffect(() => {
    if (circuitId) {
      setIsLoadingDb(true);
      loadCircuit(circuitId).then(({ canvasState, codeState, circuit, error }) => {
        if (error || !canvasState || !circuit) {
          console.error('Failed to load Supabase circuit:', error);
          setIsLoadingDb(false);
          return;
        }

        let initialComps = canvasState.components || [];
        let initialWires = canvasState.wires || [];

        // Auto-parent components on breadboard on load
        const breadboard = initialComps.find(c => c.type === 'breadboard');
        const bbMeta = COMPONENT_DEFINITIONS.breadboard;
        if (breadboard && bbMeta) {
          initialComps.forEach(comp => {
            if (comp.type !== 'breadboard') {
              const insideBb = 
                comp.x > breadboard.x - 30 &&
                comp.x < breadboard.x + bbMeta.width + 10 &&
                comp.y > breadboard.y - 30 &&
                comp.y < breadboard.y + bbMeta.height + 10;
              if (insideBb) {
                comp.parentId = breadboard.id;
                comp.offsetX = comp.x - breadboard.x;
                comp.offsetY = comp.y - breadboard.y;
              }
            }
          });
        }

        setComponents(initialComps);
        setWires(initialWires);
        setCodeContent(codeState || '');
        
        const hasRpi = initialComps.some(c => c.type === 'raspberry_pi');
        setLanguageMode(hasRpi ? 'MicroPython' : 'Arduino C++');
        setDbCircuitTitle(circuit.title);
        
        stopSimulation();

        setSimState(prev => ({
          ...prev,
          sensorInputs: { ...prev.sensorInputs },
          serialOutput: [`[Loaded Design: ${circuit.title}]`],
        }));

        setIsLoadingDb(false);
      });
    } else {
      let initialComps: ComponentInstance[] = JSON.parse(JSON.stringify(experiment.defaultComponents));
      let initialWires: WireConnection[] = JSON.parse(JSON.stringify(experiment.defaultWires));

      // Forceful Netlist/Canvas Cleanup for Experiment 9 (DC & Stepper Motor Control)
      if (experiment.id === 9) {
        // Find Stepper Motor ID
        const stepperMotor = initialComps.find(c => c.type === 'stepper_motor');
        if (stepperMotor) {
          const stepperId = stepperMotor.id;
          // Purge the Stepper Motor component entirely
          initialComps = initialComps.filter(c => c.id !== stepperId);
          // Purge any wires connected to the Stepper Motor
          initialWires = initialWires.filter(w => w.fromComponentId !== stepperId && w.toComponentId !== stepperId);
        }
        
        // Specifically target and delete any orange wires connected to the Stepper Motor or OUT terminals
        initialWires = initialWires.filter(w => !(w.color === 'orange' && (w.fromComponentId.includes('stepper') || w.toComponentId.includes('stepper') || w.fromPinId.includes('out') || w.toPinId.includes('out'))));

        // Isolate the DC Motor on the L298N output terminals (OUT1 & OUT2)
        const l298n = initialComps.find(c => c.type === 'l298n');
        if (l298n) {
          const l298nId = l298n.id;
          // Remove any wires on OUT1/OUT2 that are NOT the blue wires going strictly to the DC Motor (dc_1)
          initialWires = initialWires.filter(w => {
            const isL298nOut1Or2 = (w.fromComponentId === l298nId && (w.fromPinId === 'out1' || w.fromPinId === 'out2')) ||
                                   (w.toComponentId === l298nId && (w.toPinId === 'out1' || w.toPinId === 'out2'));
            if (isL298nOut1Or2) {
              const connectsToDcMotor = (w.fromComponentId === 'dc_1' || w.toComponentId === 'dc_1');
              const isBlueWire = w.color === 'blue';
              return connectsToDcMotor && isBlueWire;
            }
            return true;
          });
        }
      }

      // Forceful Netlist/Canvas Setup for Experiment 10 (Home Automation with Raspberry Pi)
      if (experiment.id === 10) {
        // Ensure the lightbulb exists, and the COM, NO, GND connections are strictly mapped
        const hasLightbulb = initialComps.some(c => c.type === 'lightbulb');
        if (!hasLightbulb) {
          initialComps.push({ id: 'lightbulb_1', type: 'lightbulb', name: 'Lightbulb', x: 500, y: 80, rotation: 0, properties: { lit: false } });
        }

        // Re-initialize default wires for Experiment 10 to ensure a complete load
        initialWires = JSON.parse(JSON.stringify(experiment.defaultWires));
      }

      const breadboard = initialComps.find(c => c.type === 'breadboard');
      const bbMeta = COMPONENT_DEFINITIONS.breadboard;
      
      // Auto-parent components already on the breadboard on load
      if (breadboard && bbMeta) {
        initialComps.forEach(comp => {
          if (comp.type !== 'breadboard') {
            const insideBb = 
              comp.x > breadboard.x - 30 &&
              comp.x < breadboard.x + bbMeta.width + 10 &&
              comp.y > breadboard.y - 30 &&
              comp.y < breadboard.y + bbMeta.height + 10;
            if (insideBb) {
              comp.parentId = breadboard.id;
              comp.offsetX = comp.x - breadboard.x;
              comp.offsetY = comp.y - breadboard.y;
            }
          }
        });
      }

      setComponents(initialComps);
      setWires(initialWires);
      setCodeContent(experiment.defaultCode);
      setLanguageMode(experiment.platform === 'Arduino' ? 'Arduino C++' : 'MicroPython');
      
      // Reset simulation
      stopSimulation();
      
      // Set default sensor values for specific experiments
      const initialSensors = { ...simState.sensorInputs };
      if (experiment.id === 1) { initialSensors.temperature = 24; initialSensors.humidity = 45; }
      if (experiment.id === 2) { initialSensors.distance = 80; initialSensors.motion = false; }
      if (experiment.id === 6) { initialSensors.motion = false; }
      if (experiment.id === 12) { initialSensors.bpmInput = 75; initialSensors.temperature = 36; }
      
      setSimState(prev => ({
        ...prev,
        sensorInputs: initialSensors,
        serialOutput: [`[Loaded Experiment: ${experiment.title}]`],
      }));
    }
  }, [experiment, circuitId]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!circuitId || isLoadingDb) return;

    const delayDebounceFn = setTimeout(() => {
      saveCircuit(
        circuitId,
        { components, wires, version: 1 },
        codeContent
      );
    }, 1500); // 1.5s debounce

    return () => clearTimeout(delayDebounceFn);
  }, [circuitId, components, wires, codeContent, isLoadingDb, saveCircuit]);

  // Hot-reload code into the interpreter on change
  useEffect(() => {
    if (interpreterRef.current) {
      interpreterRef.current.reset(languageMode === 'Arduino C++' ? 'Arduino' : 'Raspberry Pi', codeContent);
      if (simState.isRunning && typeof stepSimulation === 'function') {
        stepSimulation();
      }
    }
  }, [codeContent, languageMode]);

  // Sync sensor inputs into interpreter globals
  useEffect(() => {
    if (interpreterRef.current) {
      Object.entries(simState.sensorInputs).forEach(([key, val]) => {
        interpreterRef.current!.globals[key] = val ? 1 : 0;
        if (typeof val === 'number') {
          interpreterRef.current!.globals[key] = val;
        }
      });
      // Specific maps
      interpreterRef.current.globals['temperature'] = simState.sensorInputs.temperature;
      interpreterRef.current.globals['humidity'] = simState.sensorInputs.humidity;
      interpreterRef.current.globals['distance'] = simState.sensorInputs.distance;
      interpreterRef.current.globals['motionDetected'] = simState.sensorInputs.motion ? 1 : 0;
      interpreterRef.current.globals['waterFlowLPM'] = simState.sensorInputs.waterFlowLPM;
      interpreterRef.current.globals['buttonInput'] = simState.sensorInputs.buttonInput ? 1 : 0;
      interpreterRef.current.globals['flaskToggleInput'] = simState.sensorInputs.flaskToggleInput ? 1 : 0;
      interpreterRef.current.globals['bpmInput'] = simState.sensorInputs.bpmInput;
      interpreterRef.current.globals['tempProbe'] = simState.sensorInputs.tempProbe;
    }
  }, [simState.sensorInputs]);

  // Enforce dynamic cleanup on active canvas state for Experiment 9 to ensure clean DC motor isolation
  useEffect(() => {
    if (experiment.id === 9) {
      const hasStepper = components.some(c => c.type === 'stepper_motor');
      const stepperId = components.find(c => c.type === 'stepper_motor')?.id;
      const hasStepperWires = wires.some(w => 
        (stepperId && (w.fromComponentId === stepperId || w.toComponentId === stepperId)) ||
        (w.color === 'orange' && (w.fromComponentId.includes('stepper') || w.toComponentId.includes('stepper') || w.fromPinId.includes('out') || w.toPinId.includes('out')))
      );

      if (hasStepper || hasStepperWires) {
        setComponents(prev => prev.filter(c => c.type !== 'stepper_motor'));
        setWires(prev => prev.filter(w => {
          const isStepperWire = stepperId && (w.fromComponentId === stepperId || w.toComponentId === stepperId);
          const isOrangeStepperWire = w.color === 'orange' && (w.fromComponentId.includes('stepper') || w.toComponentId.includes('stepper') || w.fromPinId.includes('out') || w.toPinId.includes('out'));
          return !isStepperWire && !isOrangeStepperWire;
        }));
      }

      // Ensure L298N output OUT1/OUT2 strictly connects to DC motor via blue wires
      const l298n = components.find(c => c.type === 'l298n');
      if (l298n) {
        const l298nId = l298n.id;
        const hasExtraOrNonBlueOut1Out2 = wires.some(w => {
          const isOut1Or2 = (w.fromComponentId === l298nId && (w.fromPinId === 'out1' || w.fromPinId === 'out2')) ||
                            (w.toComponentId === l298nId && (w.toPinId === 'out1' || w.toPinId === 'out2'));
          if (isOut1Or2) {
            const connectsToDc = (w.fromComponentId === 'dc_1' || w.toComponentId === 'dc_1');
            const isBlue = w.color === 'blue';
            return !connectsToDc || !isBlue;
          }
          return false;
        });

        if (hasExtraOrNonBlueOut1Out2) {
          setWires(prev => prev.filter(w => {
            const isOut1Or2 = (w.fromComponentId === l298nId && (w.fromPinId === 'out1' || w.fromPinId === 'out2')) ||
                              (w.toComponentId === l298nId && (w.toPinId === 'out1' || w.toPinId === 'out2'));
            if (isOut1Or2) {
              const connectsToDc = (w.fromComponentId === 'dc_1' || w.toComponentId === 'dc_1');
              const isBlue = w.color === 'blue';
              return connectsToDc && isBlue;
            }
            return true;
          }));
        }
      }
    }
  }, [experiment.id, components, wires]);

  // DHT11 Experiment Simulation Logic Loop
  useEffect(() => {
    if (simState.isRunning && experiment.id === 1) {
      const dht11Component = {
        getTemperature: () => {
          const dht = components.find(c => c.type === 'dht11');
          return dht ? (dht.properties.temperature ?? simState.sensorInputs.temperature) : simState.sensorInputs.temperature;
        }
      };

      const arduino = {
        digitalWrite: (pin: number | string, val: number) => {
          setSimState(prev => ({
            ...prev,
            pinStates: { ...prev.pinStates, [String(pin)]: val }
          }));
        }
      };

      const HIGH = 1;
      const LOW = 0;

      // Read from Pin 2 (DHT11), Write to Pin 13 (LED)
      const currentTemp = dht11Component.getTemperature(); 

      if (currentTemp > 28) {
          arduino.digitalWrite(13, HIGH); // Send power to the LED
      } else {
          arduino.digitalWrite(13, LOW);  // Cut power to the LED
      }
    }
  }, [simState.isRunning, simState.sensorInputs.temperature, experiment.id, components]);

  // Traffic Light Simulator (Experiment 3) Sequence Loop
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 3) return;

    let active = true;
    let timeoutId: any = null;

    const arduino = {
      digitalWrite: (pin: number | string, val: number) => {
        setSimState(prev => ({
          ...prev,
          pinStates: { ...prev.pinStates, [String(pin)]: val }
        }));
      }
    };

    const HIGH = 1;
    const LOW = 0;

    const runTrafficSequence = async () => {
      while (active) {
        // Phase 1 (STOP): digitalWrite(10, HIGH), digitalWrite(11, LOW), digitalWrite(12, LOW). (Delay 5000ms).
        arduino.digitalWrite(10, HIGH);
        arduino.digitalWrite(11, LOW);
        arduino.digitalWrite(12, LOW);
        await new Promise(resolve => { timeoutId = setTimeout(resolve, 5000); });
        if (!active) break;

        // Phase 2 (GO): digitalWrite(10, LOW), digitalWrite(11, LOW), digitalWrite(12, HIGH). (Delay 5000ms).
        arduino.digitalWrite(10, LOW);
        arduino.digitalWrite(11, LOW);
        arduino.digitalWrite(12, HIGH);
        await new Promise(resolve => { timeoutId = setTimeout(resolve, 5000); });
        if (!active) break;

        // Phase 3 (SLOW): digitalWrite(10, LOW), digitalWrite(11, HIGH), digitalWrite(12, LOW). (Delay 2000ms).
        arduino.digitalWrite(10, LOW);
        arduino.digitalWrite(11, HIGH);
        arduino.digitalWrite(12, LOW);
        await new Promise(resolve => { timeoutId = setTimeout(resolve, 2000); });
      }
    };

    runTrafficSequence();

    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [simState.isRunning, experiment.id]);

  // LED & Push Button with Raspberry Pi (Experiment 5) MicroPython Logic Loop
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 5) return;

    let active = true;
    let intervalId: any = null;

    const rpi = {
      output: (pin: string | number, val: number) => {
        setSimState(prev => ({ ...prev, pinStates: { ...prev.pinStates, [String(pin)]: val } }));
      },
      serialWrite: (text: string) => {
        setSimState(prev => ({
          ...prev,
          serialOutput: [...prev.serialOutput, text]
        }));
      }
    };

    let prevButtonState = false;

    const runPythonLoop = () => {
      if (!active) return;
      
      const buttonPressed = simState.sensorInputs.buttonInput;
      
      if (buttonPressed) {
          // Prevent spamming the console 10 times a second if held
          if (!prevButtonState) {
              rpi.serialWrite("Button pressed -> LED ON");
          }
          rpi.output('GP15', 1);
      } else {
          rpi.output('GP15', 0);
      }

      prevButtonState = !!buttonPressed;
    };

    // Execute every 100ms mimicking time.sleep(0.1)
    runPythonLoop();
    intervalId = setInterval(runPythonLoop, 100);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [simState.isRunning, experiment.id, simState.sensorInputs.buttonInput]);

  // Smart Health Monitoring System (Experiment 12) Logic Loop
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 12) return;

    let active = true;
    let intervalId: any = null;

    const arduino = {
      analogWrite: (pin: string | number, val: number) => {
        setSimState(prev => ({ ...prev, pinStates: { ...prev.pinStates, [String(pin)]: val } }));
      },
      serialWrite: (text: string) => {
        setSimState(prev => ({
          ...prev,
          serialOutput: [...prev.serialOutput, text]
        }));
      }
    };

    const runHealthLoop = () => {
      if (!active) return;
      
      const simulatedBPM = simState.sensorInputs.bpmInput as number;
      const simulatedTemp = simState.sensorInputs.tempProbe as number;

      // Update virtual Analog Pins A0 and A1 with mapped 10-bit values (0-1023)
      const analogBPM = Math.min(1023, Math.floor((simulatedBPM / 200) * 1023));
      const analogTemp = Math.min(1023, Math.floor((simulatedTemp / 50) * 1023));
      
      arduino.analogWrite('A0', analogBPM);
      arduino.analogWrite('A1', analogTemp);

      arduino.serialWrite(`--- Health Report ---`);
      arduino.serialWrite(`Heart Rate: ${simulatedBPM} BPM`);
      arduino.serialWrite(`Body Temp: ${simulatedTemp} °C`);

      if (simulatedBPM > 100 || simulatedTemp > 38) {
          arduino.serialWrite(`WARNING: Vitals are outside normal range!`);
      }
      arduino.serialWrite(`---------------------`);
    };

    // Execute every 1000ms
    runHealthLoop();
    intervalId = setInterval(runHealthLoop, 1000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [simState.isRunning, experiment.id, simState.sensorInputs.bpmInput, simState.sensorInputs.tempProbe]);

  // Water Flow Detection (Experiment 4) Logic Loop
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 4) return;

    let active = true;
    let intervalId: any = null;

    const arduino = {
      serialWrite: (text: string) => {
        setSimState(prev => ({
          ...prev,
          serialOutput: [...prev.serialOutput, text.replace(/\n$/, '')]
        }));
      }
    };

    const runFlowLoop = () => {
      if (!active) return;
      
      const currentFlowLPM = simState.sensorInputs.waterFlowLPM as number;

      if (currentFlowLPM > 0) {
          arduino.serialWrite(`Water is flowing! Current Rate: ${currentFlowLPM.toFixed(2)} L/min`);
      } else {
          arduino.serialWrite(`No flow detected.`);
      }
    };

    runFlowLoop();
    intervalId = setInterval(runFlowLoop, 2000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [simState.isRunning, experiment.id, simState.sensorInputs.waterFlowLPM]);

  // Visual side-effect for Pin 2 (Experiment 4)
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 4) return;

    let active = true;
    let intervalId: any = null;

    const arduino = {
      digitalWrite: (pin: number | string, val: number) => {
        setSimState(prev => ({
          ...prev,
          pinStates: { ...prev.pinStates, [String(pin)]: val }
        }));
      }
    };

    let toggle = 0;
    const currentFlowLPM = simState.sensorInputs.waterFlowLPM as number;
    
    if (currentFlowLPM > 0) {
      // Faster toggle for higher flow, capped between 50ms and 500ms
      const toggleSpeed = Math.max(50, 500 - (currentFlowLPM * 10));
      intervalId = setInterval(() => {
        if (!active) return;
        toggle = toggle === 0 ? 1 : 0;
        arduino.digitalWrite(2, toggle);
      }, toggleSpeed);
    } else {
      arduino.digitalWrite(2, 0);
    }

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [simState.isRunning, experiment.id, simState.sensorInputs.waterFlowLPM]);

  // Motion Sensor Alarm (Experiment 6) Logic Loop
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 6) return;

    let active = true;
    let intervalId: any = null;

    const arduino = {
      digitalRead: (_pin: number) => {
        // In our simulator, the PIR output goes to pin 2. We can simulate it by reading the motion state.
        return simState.sensorInputs.motion ? 1 : 0;
      },
      tone: (pin: number, _frequency: number) => {
        setSimState(prev => ({
          ...prev,
          pinStates: { ...prev.pinStates, [String(pin)]: 1 }
        }));
      },
      noTone: (pin: number) => {
        setSimState(prev => ({
          ...prev,
          pinStates: { ...prev.pinStates, [String(pin)]: 0 }
        }));
      }
    };

    const HIGH = 1;

    const runAlarmLoop = () => {
      if (!active) return;
      
      const motionState = arduino.digitalRead(2);

      if (motionState === HIGH) {
        arduino.tone(3, 1000); // 1000Hz alarm tone
        console.log("Motion Detected! Alarm ON.");
      } else {
        arduino.noTone(3);
      }
    };

    runAlarmLoop();
    intervalId = setInterval(runAlarmLoop, 200);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [simState.isRunning, experiment.id, simState.sensorInputs.motion]);

  // Smart Traffic Light Controller (Experiment 11) Logic Loop
  useEffect(() => {
    if (!simState.isRunning || experiment.id !== 11) return;

    let active = true;
    let intervalId: any = null;

    const arduino = {
      digitalWrite: (pin: number | string, val: number) => {
        setSimState(prev => ({
          ...prev,
          pinStates: { ...prev.pinStates, [String(pin)]: val }
        }));
      }
    };

    const HIGH = 1;
    const LOW = 0;

    const hcSr04Component = {
      readDistance: () => {
        // Read distance from the sensor slider (simState.sensorInputs.distance)
        return simState.sensorInputs.distance;
      }
    };

    // Run the detection loop every 2000ms (matching the Arduino delay(2000))
    const runDetection = () => {
      if (!active) return;

      // 1. Trigger the HC-SR04 to read distance
      const distance = hcSr04Component.readDistance();

      // 2. Smart Traffic Logic (Vehicle Presence Detection)
      if (typeof distance === 'number' && distance > 0 && distance < 100) {
        // Vehicle detected within 100cm: Turn Green
        arduino.digitalWrite(4, LOW);   // Red OFF
        arduino.digitalWrite(3, HIGH);  // Green ON
      } else {
        // No vehicle: Default to Red
        arduino.digitalWrite(3, LOW);   // Green OFF
        arduino.digitalWrite(4, HIGH);  // Red ON
      }
    };

    // Execute immediately on start, then repeat every 2 seconds
    runDetection();
    intervalId = setInterval(runDetection, 2000);

    return () => {
      active = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [simState.isRunning, experiment.id, simState.sensorInputs.distance]);

  // Deprecated redundant React-native interval loop for Experiment 10.
  // The system now relies entirely on the live non-blocking asyncio interpreter execution thread.

  // Helper to map pin strings to controller pin IDs
  const getControllerPinId = (platform: 'Arduino' | 'Raspberry Pi', pinStr: string): string => {
    const pin = pinStr.trim();
    if (platform === 'Arduino') {
      let resolved = pin;
      if (/^\d+$/.test(pin)) {
        resolved = `D${pin}`;
      }
      if (resolved === 'GND' || resolved === 'GND_D') return 'arduino-GND';
      if (resolved === 'GND_P1') return 'arduino-GND1';
      if (resolved === 'GND_P2') return 'arduino-GND2';
      if (resolved === 'VIN') return 'arduino-Vin';
      return resolved.startsWith('arduino-') ? resolved : `arduino-${resolved}`;
    } else {
      // Raspberry Pi
      if (/^\d+$/.test(pin)) {
        return `GP${pin}`;
      }
      return pin; // e.g. GP0, GND, VSYS, VBUS, etc.
    }
  };

  // Compute absolute pin coordinates strictly under realistic breadboard view
  const getPinPosReal = (comp: ComponentInstance, pinId: string) => {
    const meta = COMPONENT_DEFINITIONS[comp.type];
    if (!meta) return { x: 0, y: 0 };
    
    let targetPinId = pinId;
    if (comp.type === 'arduino') {
      if (!pinId.startsWith('arduino-')) {
        if (pinId === 'GND_D' || pinId === 'GND') targetPinId = 'arduino-GND';
        else if (pinId === 'GND_P1') targetPinId = 'arduino-GND1';
        else if (pinId === 'GND_P2') targetPinId = 'arduino-GND2';
        else if (pinId === 'VIN') targetPinId = 'arduino-Vin';
        else targetPinId = `arduino-${pinId}`;
      }
    }
    
    const pin = meta.pins.find(p => p.id === targetPinId);
    if (!pin) return { x: 0, y: 0 };

    // Center of component
    const cx = comp.x + meta.width / 2;
    const cy = comp.y + meta.height / 2;

    // Relative to center
    const rx = pin.x - meta.width / 2;
    const ry = pin.y - meta.height / 2;

    const rad = (comp.rotation * Math.PI) / 180;
    const rotX = rx * Math.cos(rad) - ry * Math.sin(rad);
    const rotY = rx * Math.sin(rad) + ry * Math.cos(rad);

    return {
      x: Math.round(cx + rotX),
      y: Math.round(cy + rotY)
    };
  };

  // Compute absolute pin coordinates under rotation (taking viewMode into account)
  const getPinPos = (comp: ComponentInstance, pinId: string) => {
    if (activeTab === 'schematic') {
      const dim = getSchematicDimensions(comp.type);
      const pinCoords = getSchematicPinCoords(comp.type, pinId);

      // Center of component in schematic
      const cx = comp.x + dim.width / 2;
      const cy = comp.y + dim.height / 2;

      // Relative to center
      const rx = pinCoords.x - dim.width / 2;
      const ry = pinCoords.y - dim.height / 2;

      const rad = (comp.rotation * Math.PI) / 180;
      const rotX = rx * Math.cos(rad) - ry * Math.sin(rad);
      const rotY = rx * Math.sin(rad) + ry * Math.cos(rad);

      return {
        x: Math.round(cx + rotX),
        y: Math.round(cy + rotY)
      };
    }

    return getPinPosReal(comp, pinId);
  };

  // Nodal Network solver
  const activePinStates = useMemo(() => {
    // 1. Build adjacency list of connected pins
    const adj: Record<string, string[]> = {};
    const addEdge = (u: string, v: string) => {
      if (!adj[u]) adj[u] = [];
      if (!adj[v]) adj[v] = [];
      adj[u].push(v);
      adj[v].push(u);
    };

    // Draw wires
    wires.forEach(w => {
      const fromComp = components.find(c => c.id === w.fromComponentId);
      const toComp = components.find(c => c.id === w.toComponentId);
      
      let fromPin = w.fromPinId;
      if (fromComp && fromComp.type === 'arduino') {
        const platform = fromComp.name.includes('Raspberry') ? 'Raspberry Pi' : 'Arduino';
        fromPin = getControllerPinId(platform, fromPin);
      }
      
      let toPin = w.toPinId;
      if (toComp && toComp.type === 'arduino') {
        const platform = toComp.name.includes('Raspberry') ? 'Raspberry Pi' : 'Arduino';
        toPin = getControllerPinId(platform, toPin);
      }
      
      addEdge(`${w.fromComponentId}/${fromPin}`, `${w.toComponentId}/${toPin}`);
    });

    // Handle Breadboard snap contacts
    const breadboards = components.filter(c => c.type === 'breadboard');
    breadboards.forEach(bb => {
      // Top positive rail
      for (let i = 1; i < 30; i++) {
        addEdge(`${bb.id}/rail_top_pos_0`, `${bb.id}/rail_top_pos_${i}`);
      }
      // Top negative rail
      for (let i = 1; i < 30; i++) {
        addEdge(`${bb.id}/rail_top_neg_0`, `${bb.id}/rail_top_neg_${i}`);
      }
      // Bottom positive rail
      for (let i = 1; i < 30; i++) {
        addEdge(`${bb.id}/rail_bot_pos_0`, `${bb.id}/rail_bot_pos_${i}`);
      }
      // Bottom negative rail
      for (let i = 1; i < 30; i++) {
        addEdge(`${bb.id}/rail_bot_neg_0`, `${bb.id}/rail_bot_neg_${i}`);
      }

      // Vertical strips Columns f-j (upper) and a-e (lower) in lowercase matching componentDefinitions
      for (let col = 1; col <= 30; col++) {
        const rowsUpper = ['f', 'g', 'h', 'i', 'j'];
        for (let r = 1; r < 5; r++) {
          addEdge(`${bb.id}/hole_${rowsUpper[0]}_${col}`, `${bb.id}/hole_${rowsUpper[r]}_${col}`);
        }
        const rowsLower = ['a', 'b', 'c', 'd', 'e'];
        for (let r = 1; r < 5; r++) {
          addEdge(`${bb.id}/hole_${rowsLower[0]}_${col}`, `${bb.id}/hole_${rowsLower[r]}_${col}`);
        }
      }
    });

    // Component internal bridging (push button, resistor)
    components.forEach(comp => {
      if (comp.type === 'push_button') {
        addEdge(`${comp.id}/pin1a`, `${comp.id}/pin1b`);
        addEdge(`${comp.id}/pin2a`, `${comp.id}/pin2b`);
        const isPressed = comp.properties.pressed || simState.sensorInputs.buttonInput;
        if (isPressed) {
          addEdge(`${comp.id}/pin1a`, `${comp.id}/pin2a`);
          addEdge(`${comp.id}/pin1b`, `${comp.id}/pin2b`);
        }
      } else if (comp.type === 'resistor') {
        // Bridge resistor terminals for basic circuit continuity evaluation
        addEdge(`${comp.id}/p1`, `${comp.id}/p2`);
      }
    });

    // Check virtual snapping of other components pins to breadboard holes (always use realistic coordinates)
    components.forEach(comp => {
      if (comp.type === 'breadboard' || comp.type === 'push_button') return;
      const meta = COMPONENT_DEFINITIONS[comp.type];
      if (!meta) return;

      meta.pins.forEach(pinDef => {
        const absPos = getPinPosReal(comp, pinDef.id);
        
        // Find closest breadboard hole
        breadboards.forEach(bb => {
          const bbMeta = COMPONENT_DEFINITIONS.breadboard;
          // Find hole closest to this pin
          bbMeta.pins.forEach(hole => {
            const holeAbs = getPinPosReal(bb, hole.id);
            const dist = Math.hypot(absPos.x - holeAbs.x, absPos.y - holeAbs.y);
            if (dist < 8) { // within 8px snap range
              addEdge(`${comp.id}/${pinDef.id}`, `${bb.id}/${hole.id}`);
            }
          });
        });
      });
    });

    // Also snap push buttons to breadboard
    components.forEach(comp => {
      if (comp.type !== 'push_button') return;
      const meta = COMPONENT_DEFINITIONS[comp.type];
      meta.pins.forEach(pinDef => {
        const absPos = getPinPosReal(comp, pinDef.id);
        breadboards.forEach(bb => {
          const bbMeta = COMPONENT_DEFINITIONS.breadboard;
          bbMeta.pins.forEach(hole => {
            const holeAbs = getPinPosReal(bb, hole.id);
            const dist = Math.hypot(absPos.x - holeAbs.x, absPos.y - holeAbs.y);
            if (dist < 8) {
              addEdge(`${comp.id}/${pinDef.id}`, `${bb.id}/${hole.id}`);
            }
          });
        });
      });
    });

    let pinStates: Record<string, number> = {};

    // 3 passes to propagate voltages across logic gates/voltage regulators
    for (let pass = 0; pass < 3; pass++) {
      const drivers: Record<string, number> = {};

      const passAdj: Record<string, string[]> = {};
      Object.keys(adj).forEach(key => {
        passAdj[key] = [...adj[key]];
      });

      const addPassEdge = (u: string, v: string) => {
        if (!passAdj[u]) passAdj[u] = [];
        if (!passAdj[v]) passAdj[v] = [];
        passAdj[u].push(v);
        passAdj[v].push(u);
      };

      // Add dynamic edges for closed relays.
      // We check BOTH the BFS-accumulated pinStates from the previous pass AND
      // the raw simState.pinStates written by the interpreter (e.g. GP15: 1).
      // This ensures the relay closes on pass 0 itself, not only after BFS warm-up.
      components.forEach(comp => {
        if (comp.type === 'relay') {
          const inKey = `${comp.id}/in`;
          const inState = pinStates[inKey];

          // Check BFS-propagated pin voltages (from previous pass)
          const isBFSActive = (pinStates['rpi_1/GP15'] > 1.5) || (pinStates['rpi_1/15'] > 1.5) ||
                              (pinStates['rpi_1/GP25'] > 1.5) || (pinStates['rpi_1/25'] > 1.5);

          // Check raw interpreter pin writes (simState.pinStates) directly — catches pass 0
          const rawPS = simState.pinStates;
          const isRawActive = (rawPS['GP15'] === 1 || rawPS['GP15'] === true || String(rawPS['GP15']) === 'HIGH') ||
                              (rawPS['15']   === 1 || rawPS['15']   === true || String(rawPS['15'])   === 'HIGH') ||
                              (rawPS['GP25'] === 1 || rawPS['GP25'] === true || String(rawPS['GP25']) === 'HIGH') ||
                              (rawPS['25']   === 1 || rawPS['25']   === true || String(rawPS['25'])   === 'HIGH');

          const isRelayActive = (typeof inState === 'number' && inState > 1.5) || isBFSActive || isRawActive || comp.properties.state;
          if (isRelayActive) {
            addPassEdge(`${comp.id}/com`, `${comp.id}/no`);
          } else {
            addPassEdge(`${comp.id}/com`, `${comp.id}/nc`);
          }
        }
      });

      components.forEach(comp => {
        if (comp.type === 'arduino' || comp.type === 'raspberry_pi') {
          const platform = comp.type === 'arduino' ? 'Arduino' : 'Raspberry Pi';
          const driveVolts = comp.type === 'raspberry_pi' ? 3.3 : 5.0;

          // VCC constants
          if (comp.type === 'arduino') {
            drivers[`${comp.id}/arduino-5V`] = 5.0;
            drivers[`${comp.id}/arduino-3.3V`] = 3.3;
            drivers[`${comp.id}/arduino-Vin`] = 5.0;
          } else {
            drivers[`${comp.id}/3.3V_OUT`] = 3.3;
            drivers[`${comp.id}/VBUS`] = 5.0;
          }

          // GND
          const meta = COMPONENT_DEFINITIONS[comp.type];
          if (meta) {
            meta.pins.forEach((p: { id: string; type: string }) => {
              if (p.type === 'gnd') {
                drivers[`${comp.id}/${p.id}`] = 0.0;
              }
            });
          }

          // MCU active GPIO outputs
          if (simState.isRunning) {
            Object.entries(simState.pinStates).forEach(([pinKey, val]) => {
              const pinId = getControllerPinId(platform, pinKey);
              if (val === true || val === 1 || String(val) === 'HIGH') {
                drivers[`${comp.id}/${pinId}`] = driveVolts;
              } else if (val === false || val === 0 || String(val) === 'LOW') {
                drivers[`${comp.id}/${pinId}`] = 0.0;
              }
              // Diagnostic console logging on GP15 node
              if (comp.type === 'raspberry_pi' && pinId === 'GP15') {
                console.log("GP15 Node Voltage: ", drivers[`${comp.id}/${pinId}`]);
              }
            });
          }

          // Input Pullup support
          if (meta) {
            meta.pins.forEach((p: { id: string }) => {
              const numeric = p.id.replace('arduino-D', '').replace('D', '').replace('GP', '');
              const mode = interpreterRef.current?.pinModes[p.id] || interpreterRef.current?.pinModes[numeric] || interpreterRef.current?.pinModes[p.id.replace('arduino-', '')];
              if (mode === 'INPUT_PULLUP' && drivers[`${comp.id}/${p.id}`] === undefined) {
                drivers[`${comp.id}/${p.id}`] = driveVolts;
              }
            });
          }

        } else if (comp.type === 'battery_9v') {
          drivers[`${comp.id}/positive`] = 9.0;
          drivers[`${comp.id}/negative`] = 0.0;
        } else if (comp.type === 'battery_aa') {
          drivers[`${comp.id}/positive`] = 1.5;
          drivers[`${comp.id}/negative`] = 0.0;
        } else if (comp.type === 'battery_1_5v' || comp.type === 'battery_coin') {
          drivers[`${comp.id}/positive`] = 3.0; // Coin cell
          drivers[`${comp.id}/negative`] = 0.0;
        } else if (comp.type === 'power_supply_5v') {
          drivers[`${comp.id}/positive`] = Number(comp.properties.voltage) || 5.0;
          drivers[`${comp.id}/negative`] = 0.0;
        } else if (comp.type === 'pir_sensor' && simState.isRunning) {
          drivers[`${comp.id}/out`] = simState.sensorInputs.motion ? 5.0 : 0.0;
        } else if (comp.type === 'voltage_reg_7805') {
          const inVolts = pinStates[`${comp.id}/input`] || 0.0;
          drivers[`${comp.id}/gnd`] = 0.0;
          drivers[`${comp.id}/output`] = inVolts > 7.0 ? 5.0 : Math.max(0.0, inVolts - 2.0);
        } else if (comp.type === 'l298n') {
          const v12 = pinStates[`${comp.id}/v12`] || 0.0;
          const enA = pinStates[`${comp.id}/enA`] || 0.0;
          const enB = pinStates[`${comp.id}/enB`] || 0.0;
          const in1 = pinStates[`${comp.id}/in1`] || 0.0;
          const in2 = pinStates[`${comp.id}/in2`] || 0.0;
          const in3 = pinStates[`${comp.id}/in3`] || 0.0;
          const in4 = pinStates[`${comp.id}/in4`] || 0.0;

          // ENA controls Channel A (OUT1 and OUT2)
          if (enA > 1.5 && v12 > 1.5) {
            if (in1 > 1.5 && in2 <= 1.5) {
              drivers[`${comp.id}/out1`] = v12;
              drivers[`${comp.id}/out2`] = 0.0;
            } else if (in1 <= 1.5 && in2 > 1.5) {
              drivers[`${comp.id}/out1`] = 0.0;
              drivers[`${comp.id}/out2`] = v12;
            } else if (in1 > 1.5 && in2 > 1.5) {
              drivers[`${comp.id}/out1`] = v12;
              drivers[`${comp.id}/out2`] = v12;
            } else {
              drivers[`${comp.id}/out1`] = 0.0;
              drivers[`${comp.id}/out2`] = 0.0;
            }
          } else {
            drivers[`${comp.id}/out1`] = 0.0;
            drivers[`${comp.id}/out2`] = 0.0;
          }

          // ENB controls Channel B (OUT3 and OUT4)
          if (enB > 1.5 && v12 > 1.5) {
            if (in3 > 1.5 && in4 <= 1.5) {
              drivers[`${comp.id}/out3`] = v12;
              drivers[`${comp.id}/out4`] = 0.0;
            } else if (in3 <= 1.5 && in4 > 1.5) {
              drivers[`${comp.id}/out3`] = 0.0;
              drivers[`${comp.id}/out4`] = v12;
            } else if (in3 > 1.5 && in4 > 1.5) {
              drivers[`${comp.id}/out3`] = v12;
              drivers[`${comp.id}/out4`] = v12;
            } else {
              drivers[`${comp.id}/out3`] = 0.0;
              drivers[`${comp.id}/out4`] = 0.0;
            }
          } else {
            drivers[`${comp.id}/out3`] = 0.0;
            drivers[`${comp.id}/out4`] = 0.0;
          }
        } else if (comp.type === 'gate_and') {
          const vA = pinStates[`${comp.id}/in_a`] || 0.0;
          const vB = pinStates[`${comp.id}/in_b`] || 0.0;
          drivers[`${comp.id}/out`] = (vA > 1.5 && vB > 1.5) ? 5.0 : 0.0;
        } else if (comp.type === 'gate_or') {
          const vA = pinStates[`${comp.id}/in_a`] || 0.0;
          const vB = pinStates[`${comp.id}/in_b`] || 0.0;
          drivers[`${comp.id}/out`] = (vA > 1.5 || vB > 1.5) ? 5.0 : 0.0;
        } else if (comp.type === 'gate_not') {
          const vA = pinStates[`${comp.id}/in_a`] || 0.0;
          drivers[`${comp.id}/out`] = (vA <= 1.5) ? 5.0 : 0.0;
        } else if (comp.type === 'gate_xor') {
          const vA = pinStates[`${comp.id}/in_a`] || 0.0;
          const vB = pinStates[`${comp.id}/in_b`] || 0.0;
          drivers[`${comp.id}/out`] = ((vA > 1.5) !== (vB > 1.5)) ? 5.0 : 0.0;
        }
      });

      const visited = new Set<string>();
      const nextPinStates: Record<string, number> = {};

      Object.keys(passAdj).forEach(startPin => {
        if (!visited.has(startPin)) {
          const net: string[] = [];
          const queue = [startPin];
          visited.add(startPin);
          
          while (queue.length > 0) {
            const u = queue.shift()!;
            net.push(u);
            (passAdj[u] || []).forEach(v => {
              if (!visited.has(v)) {
                visited.add(v);
                queue.push(v);
              }
            });
          }

          // Evaluate driving voltage in this net
          let maxVolts = -1.0; // -1 represents floating
          let hasGnd = false;
          let hasVcc = false;

          net.forEach(p => {
            if (drivers[p] !== undefined) {
              const dv = drivers[p];
              if (dv === 0.0) hasGnd = true;
              else {
                hasVcc = true;
                if (dv > maxVolts) maxVolts = dv;
              }
            }
          });

          let solvedVoltage = -1.0;
          if (hasVcc && hasGnd) {
            solvedVoltage = 2.0; // Short circuit conflict
          } else if (hasVcc) {
            solvedVoltage = maxVolts;
          } else if (hasGnd) {
            solvedVoltage = 0.0;
          }

          net.forEach(p => {
            nextPinStates[p] = solvedVoltage;
          });
        }
      });

      pinStates = nextPinStates;
    }

    // CRITICAL: Synchronously write to window BEFORE returning, eliminating the
    // useEffect timing gap that caused useNodeVoltage to read stale state.
    (window as any).__activePinStates = pinStates;
    (window as any).rawPinStates = simState.pinStates;

    return pinStates;
  }, [components, wires, simState.isRunning, simState.pinStates, simState.sensorInputs]);

  // Keep a ref to activePinStates for synchronous interpreter callback access
  const activePinStatesRef = useRef<Record<string, number | boolean>>({});
  useEffect(() => {
    activePinStatesRef.current = activePinStates;
    // Belt-and-suspenders: also update in effect in case useMemo didn't fire
    (window as any).__activePinStates = activePinStates;
    (window as any).rawPinStates = simState.pinStates;
  }, [activePinStates, simState.pinStates]);

  useEffect(() => {
    (window as any).SimulationEngine = {
      getNodeVoltage: (nodeId: string) => {
        if (!nodeId) return 'LOW';
        const activeStates = (window as any).__activePinStates || {};
        const rawPS = (window as any).rawPinStates || {};
        
        const numericVal = (val: any): number => {
          if (typeof val === 'number') return val;
          if (typeof val === 'boolean') return val ? 3.3 : 0.0;
          if (val === 'HIGH' || val === 1) return 3.3;
          if (val === 'LOW' || val === 0) return 0.0;
          return -1.0;
        };

        const toHighLow = (v: number) => (v > 1.5 ? 'HIGH' : (v >= 0 ? 'LOW' : 'FLOAT'));

        const getVal = (id: string) => {
          const val = activeStates[id];
          const n = numericVal(val);
          if (n >= 0) return toHighLow(n);
          return 'LOW';
        };

        // 1. First priority: BFS net voltage for component pins (e.g. relay_1/in, lightbulb_1/pin1)
        if (nodeId.includes('/')) {
          const bfsVal = activeStates[nodeId];
          if (bfsVal !== undefined && numericVal(bfsVal) >= 0) return getVal(nodeId);

          // Fallback: if BFS didn't propagate to this pin, check if it's linked to a GP pin via rawPS
          // e.g. relay_1/in is linked to GP15 via wire w3
          const gpFallback = rawPS['GP15'] === 1 || rawPS['15'] === 1 ?
            (nodeId === 'relay_1/in' ? 'HIGH' : getVal(nodeId)) : getVal(nodeId);
          return gpFallback;
        }

        // 2. Raw interpreter pin states — PRIMARY source for GPIO nodes (fastest, no BFS lag)
        const gpKey = nodeId.startsWith('GP') ? nodeId : `GP${nodeId}`;
        if (rawPS[nodeId] !== undefined) {
          const rv = rawPS[nodeId];
          return (rv === 1 || rv === true || rv === 'HIGH') ? 'HIGH' : 'LOW';
        }
        if (rawPS[gpKey] !== undefined) {
          const rv = rawPS[gpKey];
          return (rv === 1 || rv === true || rv === 'HIGH') ? 'HIGH' : 'LOW';
        }

        // 3. BFS with platform prefix resolution
        const rpiVal = activeStates[`rpi_1/${nodeId}`];
        if (rpiVal !== undefined) return getVal(`rpi_1/${nodeId}`);

        const ardVal = activeStates[`arduino_1/${nodeId}`];
        if (ardVal !== undefined) return getVal(`arduino_1/${nodeId}`);

        if (activeStates[nodeId] !== undefined) return getVal(nodeId);

        return 'LOW';
      }
    };
  }, []);

  // Compute clean electrical nets specifically for schematic connections
  const schematicNets = useMemo(() => {
    const adj: Record<string, string[]> = {};
    const addEdge = (u: string, v: string) => {
      if (!adj[u]) adj[u] = [];
      if (!adj[v]) adj[v] = [];
      adj[u].push(v);
      adj[v].push(u);
    };

    wires.forEach(w => {
      addEdge(`${w.fromComponentId}/${w.fromPinId}`, `${w.toComponentId}/${w.toPinId}`);
    });

    const breadboards = components.filter(c => c.type === 'breadboard');
    breadboards.forEach(bb => {
      for (let i = 1; i < 30; i++) addEdge(`${bb.id}/rail_top_pos_0`, `${bb.id}/rail_top_pos_${i}`);
      for (let i = 1; i < 30; i++) addEdge(`${bb.id}/rail_top_neg_0`, `${bb.id}/rail_top_neg_${i}`);
      for (let i = 1; i < 30; i++) addEdge(`${bb.id}/rail_bot_pos_0`, `${bb.id}/rail_bot_pos_${i}`);
      for (let i = 1; i < 30; i++) addEdge(`${bb.id}/rail_bot_neg_0`, `${bb.id}/rail_bot_neg_${i}`);

      // Vertical strips Columns f-j (upper) and a-e (lower) in lowercase matching componentDefinitions
      for (let col = 1; col <= 30; col++) {
        const rowsUpper = ['f', 'g', 'h', 'i', 'j'];
        for (let r = 1; r < 5; r++) {
          addEdge(`${bb.id}/hole_${rowsUpper[0]}_${col}`, `${bb.id}/hole_${rowsUpper[r]}_${col}`);
        }
        const rowsLower = ['a', 'b', 'c', 'd', 'e'];
        for (let r = 1; r < 5; r++) {
          addEdge(`${bb.id}/hole_${rowsLower[0]}_${col}`, `${bb.id}/hole_${rowsLower[r]}_${col}`);
        }
      }
    });

    components.forEach(comp => {
      if (comp.type === 'breadboard') return;
      const meta = COMPONENT_DEFINITIONS[comp.type];
      if (!meta) return;

      meta.pins.forEach(pinDef => {
        const absPos = getPinPosReal(comp, pinDef.id);
        breadboards.forEach(bb => {
          const bbMeta = COMPONENT_DEFINITIONS.breadboard;
          bbMeta.pins.forEach(hole => {
            const holeAbs = getPinPosReal(bb, hole.id);
            const dist = Math.hypot(absPos.x - holeAbs.x, absPos.y - holeAbs.y);
            if (dist < 8) {
              addEdge(`${comp.id}/${pinDef.id}`, `${bb.id}/${hole.id}`);
            }
          });
        });
      });
    });

    const visited = new Set<string>();
    const nets: string[][] = [];

    Object.keys(adj).forEach(startPin => {
      if (!visited.has(startPin)) {
        const queue = [startPin];
        const net: string[] = [];
        visited.add(startPin);

        while (queue.length > 0) {
          const u = queue.shift()!;
          net.push(u);
          (adj[u] || []).forEach(v => {
            if (!visited.has(v)) {
              visited.add(v);
              queue.push(v);
            }
          });
        }

        const cleanNet = net.filter(p => {
          const [compId] = p.split('/');
          const comp = components.find(c => c.id === compId);
          return comp && comp.type !== 'breadboard';
        });

        if (cleanNet.length > 1) {
          nets.push(cleanNet);
        }
      }
    });

    return nets;
  }, [components, wires]);

  // Handle reading analog and digital states on controller pin
  const handlePinRead = (pinKey: string) => {
    const controller = components.find(c => c.type === 'arduino' || c.type === 'raspberry_pi');
    if (!controller) return 0;
    
    const platform = controller.type === 'arduino' ? 'Arduino' : 'Raspberry Pi';
    const pinId = getControllerPinId(platform, pinKey);
    const controllerPinPath = `${controller.id}/${pinId}`;

    // Find all pins connected in the same net as this controller pin
    const nets = schematicNets;
    const myNet = nets.find(net => net.includes(controllerPinPath));

    if (myNet) {
      // Check if there is an analog sensor connected in this net
      for (const pinPath of myNet) {
        if (pinPath === controllerPinPath) continue;
        const [compId, pId] = pinPath.split('/');
        const comp = components.find(c => c.id === compId);
        if (!comp) continue;

        if (comp.type === 'pulse_sensor' && pId === 'sig') {
          return simState.sensorInputs.bpmInput || 72;
        }
        if (comp.type === 'lm35' && pId === 'out') {
          return simState.sensorInputs.temperature || 25;
        }
        if (comp.type === 'ds18b20' && pId === 'dq') {
          const vccPinPath = `${comp.id}/vcc`;
          const vccNet = nets.find(net => net.includes(vccPinPath));
          const vccPowered = vccNet && vccNet.some(path => path.includes('3.3V') || path.includes('5V') || path.includes('vcc') || path.includes('VDD'));
          
          const resistorConnected = components.some(c => {
            if (c.type !== 'resistor') return false;
            const p1Path = `${c.id}/p1`;
            const p2Path = `${c.id}/p2`;
            const hasP1inDQ = myNet.includes(p1Path);
            const hasP2inDQ = myNet.includes(p2Path);
            const hasP1inVCC = vccNet && vccNet.includes(p1Path);
            const hasP2inVCC = vccNet && vccNet.includes(p2Path);
            return (hasP1inDQ && hasP2inVCC) || (hasP2inDQ && hasP1inVCC);
          });

          if (vccPowered && resistorConnected) {
            return 998;
          }
          return 0; // Disconnected or missing pull-up
        }
        if (comp.type === 'yf_s201' && pId === 'out') {
          return simState.sensorInputs.waterFlowLPM || 5.0;
        }
        if (comp.type === 'dht11' && pId === 'data') {
          return 999;
        }
      }
    }

    // Fallback: read solved logic level
    const solvedState = activePinStatesRef.current[controllerPinPath];
    if (typeof solvedState === 'number') {
      if (solvedState > 1.5) return 1;
      if (solvedState === 0.0) return 0;
    }

    const numeric = pinId.replace('D', '').replace('GP', '');
    const mode = interpreterRef.current?.pinModes[pinId] || interpreterRef.current?.pinModes[numeric];
    if (mode === 'INPUT_PULLUP') {
      return 1;
    }

    return 0; // default LOW
  };

  // Check if specific pin is receiving logic HIGH
  const isPinActive = (componentId: string, pinId: string): boolean => {
    const key = `${componentId}/${pinId}`;
    const val = activePinStates[key];
    return typeof val === 'number' && val > 1.5;
  };

  const getPinVoltage = (componentId: string, pinId: string): number => {
    // Temporary visual diagnostic override bypass (Step 3 bypass)
    // Uncomment the line below to force the LED (led_1) to light up without netlist constraints:
    // if (componentId === 'led_1') return pinId === 'anode' ? 5.0 : 0.0;

    const key = `${componentId}/${pinId}`;
    const val = activePinStates[key];
    return typeof val === 'number' ? val : 0.0;
  };

  // Toggle editor breakpoint decoration
  const toggleBreakpoint = (line: number) => {
    setSimState(prev => {
      const copy = new Set(prev.breakpoints);
      if (copy.has(line)) copy.delete(line);
      else copy.add(line);

      if (interpreterRef.current) {
        interpreterRef.current.breakpoints = copy;
      }
      return { ...prev, breakpoints: copy };
    });
  };

  // Update decorations in Monaco Editor
  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      
      const newDecorations = [];
      
      simState.breakpoints.forEach(line => {
        newDecorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: {
            isWholeLine: false,
            glyphMarginClassName: 'monaco-breakpoint-glyph',
          },
        });
      });

      if (simState.currentLine !== null) {
        newDecorations.push({
          range: new monaco.Range(simState.currentLine, 1, simState.currentLine, 1),
          options: {
            isWholeLine: true,
            className: 'monaco-current-line-bg',
            glyphMarginClassName: 'monaco-current-line-glyph',
          },
        });
      }

      decorationsRef.current = editor.deltaDecorations(decorationsRef.current, newDecorations);
    }
  }, [simState.breakpoints, simState.currentLine]);

  // Monaco Editor Mounting
  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.updateOptions({ glyphMargin: true });

    // Handle breakpoint click
    editor.onMouseDown((e: any) => {
      if (e.target.type === 2) { // Glyph margin click
        const line = e.target.position.lineNumber;
        toggleBreakpoint(line);
      }
    });

    // Hover provider for variable Tooltips
    monaco.languages.registerHoverProvider('cpp', {
      provideHover: (model: any, position: any) => {
        const word = model.getWordAtPosition(position);
        if (!word || !interpreterRef.current) return null;
        const val = interpreterRef.current.globals[word.word];
        if (val !== undefined) {
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `**Scope Variable Debugger**` },
              { value: `\`\`\`cpp\n${word.word} = ${JSON.stringify(val)}\n\`\`\`` }
            ]
          };
        }
        return null;
      }
    });
    
    monaco.languages.registerHoverProvider('python', {
      provideHover: (model: any, position: any) => {
        const word = model.getWordAtPosition(position);
        if (!word || !interpreterRef.current) return null;
        const val = interpreterRef.current.globals[word.word];
        if (val !== undefined) {
          return {
            range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
            contents: [
              { value: `**Scope Variable Debugger**` },
              { value: `\`\`\`python\n${word.word} = ${JSON.stringify(val)}\n\`\`\` ` }
            ]
          };
        }
        return null;
      }
    });
  };

  // Execution steps logic
  const handleInterpreterStateChange = () => {
    if (!interpreterRef.current) return;
    const interpreter = interpreterRef.current;
    
    setSimState(prev => ({
      ...prev,
      isRunning: interpreter.running,
      isPaused: interpreter.paused,
      currentLine: interpreter.running ? interpreter.parsedLines[interpreter.pc]?.originalLineNum || null : null,
      variables: { ...interpreter.globals },
    }));
  };

  // Start Simulation
  const startSimulation = () => {
    if (!interpreterRef.current) {
      interpreterRef.current = new CircuitInterpreter(
        (pin, val) => {
          let targetPin = pin.trim();
          if (interpreterRef.current?.platform === 'Raspberry Pi') {
            if (/^\d+$/.test(targetPin)) {
              targetPin = `GP${targetPin}`;
            }
          }
          setSimState(prev => {
            const newPinStates = { ...prev.pinStates };
            if (targetPin.startsWith('GP') && /^\d+$/.test(targetPin.substring(2))) {
              const numeric = targetPin.substring(2);
              delete newPinStates[numeric];
            }
            newPinStates[targetPin] = val;
            return {
              ...prev,
              pinStates: newPinStates
            };
          });
        },
        (pin) => {
          return handlePinRead(pin);
        },
        (msg) => {
          setSimState(prev => ({
            ...prev,
            serialOutput: [...prev.serialOutput, msg].slice(-100)
          }));
        },
        handleInterpreterStateChange
      );
    }

    console.log("SENDING TO ENGINE: ", codeContent);
    interpreterRef.current.reset(languageMode === 'Arduino C++' ? 'Arduino' : 'Raspberry Pi', codeContent);
    interpreterRef.current.breakpoints = simState.breakpoints;
    interpreterRef.current.running = true;
    
    // Inject active status variable
    interpreterRef.current.globals['temperature'] = simState.sensorInputs.temperature;
    interpreterRef.current.globals['humidity'] = simState.sensorInputs.humidity;
    interpreterRef.current.globals['distance'] = simState.sensorInputs.distance;
    interpreterRef.current.globals['motionDetected'] = simState.sensorInputs.motion ? 1 : 0;
    interpreterRef.current.globals['waterFlowLPM'] = simState.sensorInputs.waterFlowLPM;
    interpreterRef.current.globals['buttonInput'] = simState.sensorInputs.buttonInput ? 1 : 0;
    interpreterRef.current.globals['flaskToggleInput'] = simState.sensorInputs.flaskToggleInput ? 1 : 0;
    interpreterRef.current.globals['bpmInput'] = simState.sensorInputs.bpmInput;
    interpreterRef.current.globals['tempProbe'] = simState.sensorInputs.tempProbe;

    setSimState(prev => ({
      ...prev,
      isRunning: true,
      isPaused: false,
      serialOutput: [`[Simulation Started on ${languageMode === 'Arduino C++' ? 'Arduino' : 'Raspberry Pi'}]`],
    }));
    
    // Auto-switch right panel to sensors tab so users see live controls
    setRightPanelTab('sensors');

    // Trigger tick interval — run at 50ms for more responsive simulation
    clearInterval(simIntervalRef.current);
    simIntervalRef.current = setInterval(() => {
      const interp = interpreterRef.current;
      if (interp && interp.running && !interp.paused) {
        if (Date.now() >= interp.delayUntil) {
          interp.step();
        }
      }
    }, 50);

    // Custom blink simulation parsing:
    // digitalWrite(pin, HIGH/LOW) and delay(ms) calls
    clearTimeout(blinkIntervalRef.current);
    const cleanCode = codeContent.replace(/\s+/g, '');
    const blinkMatch = cleanCode.match(/digitalWrite\((\d+),(HIGH|LOW|1|0)\);delay\((\d+)\);digitalWrite\(\1,(HIGH|LOW|1|0)\);delay\((\d+)\);/);
    if (blinkMatch) {
      const pinNum = blinkMatch[1];
      const d1 = Number(blinkMatch[3]);
      const state2 = blinkMatch[4] === 'HIGH' || blinkMatch[4] === '1';
      const d2 = Number(blinkMatch[5]);
      
      let state = state2; // start with state1 next
      const toggle = () => {
        state = !state;
        setSimState(prev => ({
          ...prev,
          pinStates: { ...prev.pinStates, [pinNum]: state ? 1 : 0 }
        }));
        blinkIntervalRef.current = setTimeout(toggle, state ? d1 : d2);
      };
      blinkIntervalRef.current = setTimeout(toggle, d1);
    }
  };

  // Stop Simulation
  const stopSimulation = () => {
    clearInterval(simIntervalRef.current);
    clearTimeout(blinkIntervalRef.current);
    if (interpreterRef.current) {
      interpreterRef.current.running = false;
    }
    setSimState(prev => ({
      ...prev,
      isRunning: false,
      isPaused: false,
      currentLine: null,
      pinStates: {},
      serialOutput: [...prev.serialOutput, `[Simulation Stopped]`],
    }));
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
      if (blinkIntervalRef.current) clearTimeout(blinkIntervalRef.current);
      if (interpreterRef.current) interpreterRef.current.running = false;
    };
  }, []);

  // Debug execution actions
  const pauseSimulation = () => {
    if (interpreterRef.current) {
      interpreterRef.current.paused = true;
      handleInterpreterStateChange();
    }
  };

  const resumeSimulation = () => {
    if (interpreterRef.current) {
      interpreterRef.current.paused = false;
      handleInterpreterStateChange();
    }
  };

  const stepSimulation = () => {
    if (interpreterRef.current) {
      interpreterRef.current.step();
    }
  };

  // Drag and drop mechanics
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;

    if (e.button === 1 || spacePressed) { // Middle click or Spacebar triggers pan
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    } else if (e.button === 0 && !drawingWire) {
      // Start rectangular selection box drag-selection
      setSelectionRect({ x1: x, y1: y, x2: x, y2: y });
      
      // If Shift key is not pressed, clear previous selection
      if (!e.shiftKey) {
        setSelectedComponentIds([]);
        setSelectedElement(null);
      }
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left - pan.x) / zoom;
    const y = (e.clientY - rect.top - pan.y) / zoom;
    setMousePos({ x, y });

    if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y });
    } else if (selectionRect) {
      const newRect = { ...selectionRect, x2: x, y2: y };
      setSelectionRect(newRect);
      
      const xMin = Math.min(newRect.x1, x);
      const xMax = Math.max(newRect.x1, x);
      const yMin = Math.min(newRect.y1, y);
      const yMax = Math.max(newRect.y1, y);
      
      const newlySelected = components.filter(comp => {
        const meta = COMPONENT_DEFINITIONS[comp.type];
        const w = meta?.width || 60;
        const h = meta?.height || 40;
        
        const cxMin = comp.x;
        const cxMax = comp.x + w;
        const cyMin = comp.y;
        const cyMax = comp.y + h;
        
        return cxMin < xMax && cxMax > xMin && cyMin < yMax && cyMax > yMin;
      }).map(c => c.id);
      
      setSelectedComponentIds(newlySelected);
      if (newlySelected.length > 0) {
        setSelectedElement({ type: 'component', id: newlySelected[newlySelected.length - 1] });
      } else {
        setSelectedElement(null);
      }
    }

    if (draggingWireNode) {
      setWires(prev => prev.map(w => {
        if (w.id === draggingWireNode.wireId) {
          const newNodes = [...(w.nodes || [])];
          newNodes[draggingWireNode.nodeIndex] = { x, y };
          return { ...w, nodes: newNodes };
        }
        return w;
      }));
    } else if (draggingComponent) {
      const comp = components.find(c => c.id === draggingComponent);
      if (comp) {
        const rawTargetX = x - dragOffset.x;
        const rawTargetY = y - dragOffset.y;
        const snapped = snapComponentPosition(comp.type, rawTargetX, rawTargetY, comp.rotation, components);
        const targetX = snapped.x;
        const targetY = snapped.y;

        const dx = targetX - comp.x;
        const dy = targetY - comp.y;

        if (dx !== 0 || dy !== 0) {
          const idsToMove = new Set(selectedComponentIds.includes(draggingComponent) ? selectedComponentIds : [draggingComponent]);
          
          // Auto-include children of any moving breadboards
          components.forEach(c => {
            if (c.parentId && idsToMove.has(c.parentId)) {
              idsToMove.add(c.id);
            }
          });

          setComponents(prev => prev.map(c => {
            if (idsToMove.has(c.id)) {
              // If a child is dragged independently (its parent is not being moved), it detaches
              const isDetaching = c.id === draggingComponent && c.parentId && !idsToMove.has(c.parentId);
              return { 
                ...c, 
                x: c.x + dx, 
                y: c.y + dy,
                ...(isDetaching ? { parentId: undefined, offsetX: undefined, offsetY: undefined } : {})
              };
            }
            return c;
          }));

          setWires(prev => prev.map(w => {
            if (w.nodes && w.nodes.length > 0) {
              const comp1 = components.find(c => c.id === w.fromComponentId);
              const comp2 = components.find(c => c.id === w.toComponentId);
              const isComp1Moving = idsToMove.has(w.fromComponentId) || (comp1 && comp1.parentId && idsToMove.has(comp1.parentId));
              const isComp2Moving = idsToMove.has(w.toComponentId) || (comp2 && comp2.parentId && idsToMove.has(comp2.parentId));
              
              if (isComp1Moving && isComp2Moving) {
                return { ...w, nodes: w.nodes.map(n => ({ x: n.x + dx, y: n.y + dy })) };
              }
            }
            return w;
          }));
        }
      }
    }
  };

  const handleCanvasMouseUp = () => {
    setIsPanning(false);
    setSelectionRect(null);

    if (draggingWireNode) {
      setDraggingWireNode(null);
      setHistory(prev => [...prev, { components, wires }]);
      setRedoStack([]);
    }

    if (draggingComponent && dragStartPos) {
      let hasMoved = false;
      if (selectedComponentIds.includes(draggingComponent)) {
        hasMoved = selectedComponentIds.some(id => {
          const start = dragStartPos.components.find(c => c.id === id);
          const end = components.find(c => c.id === id);
          return !!(start && end && (start.x !== end.x || start.y !== end.y));
        });
      } else {
        const startComp = dragStartPos.components.find(c => c.id === draggingComponent);
        const endComp = components.find(c => c.id === draggingComponent);
        hasMoved = !!(startComp && endComp && (startComp.x !== endComp.x || startComp.y !== endComp.y));
      }
      if (hasMoved) {
        setHistory(prev => [...prev, dragStartPos]);
        setRedoStack([]);

        // Determine parent/child relationships after drop
        setComponents(prevComps => {
          const updated = [...prevComps];
          const draggedIds = selectedComponentIds.includes(draggingComponent) ? selectedComponentIds : [draggingComponent];
          const breadboard = updated.find(c => c.type === 'breadboard');
          const bbMeta = COMPONENT_DEFINITIONS.breadboard;
          
          draggedIds.forEach(id => {
            const compIndex = updated.findIndex(c => c.id === id);
            const comp = updated[compIndex];
            if (comp && comp.type !== 'breadboard' && breadboard && bbMeta) {
              const insideBb = 
                comp.x > breadboard.x - 30 &&
                comp.x < breadboard.x + bbMeta.width + 10 &&
                comp.y > breadboard.y - 30 &&
                comp.y < breadboard.y + bbMeta.height + 10;
                
              if (insideBb) {
                updated[compIndex] = { ...comp, parentId: breadboard.id, offsetX: comp.x - breadboard.x, offsetY: comp.y - breadboard.y };
              } else {
                updated[compIndex] = { ...comp, parentId: undefined, offsetX: undefined, offsetY: undefined };
              }
            }
          });
          return updated;
        });
      }
    }
    setDraggingComponent(null);
    setDragStartPos(null);
  };

  const handleZoom = (direction: 'in' | 'out') => {
    setZoom(prev => {
      const next = direction === 'in' ? prev + 0.15 : prev - 0.15;
      return Math.min(Math.max(next, 0.4), 2.5);
    });
  };

  const resetPanZoom = () => {
    setZoom(1);
    setPan({ x: 100, y: 80 });
  };

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const zoomFactor = 0.05;
    setZoom(prev => {
      const next = e.deltaY < 0 ? prev + zoomFactor : prev - zoomFactor;
      return Math.min(Math.max(next, 0.4), 2.5);
    });
  };

  const handleComponentContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedElement({ type: 'component', id });
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      componentId: id
    });
  };

  // Component manipulation
  const handleComponentDragStart = (id: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const comp = components.find(c => c.id === id);
    if (comp) {
      const isShift = e.shiftKey;
      let nextSelectedIds = [...selectedComponentIds];

      if (isShift) {
        if (selectedComponentIds.includes(id)) {
          nextSelectedIds = selectedComponentIds.filter(x => x !== id);
        } else {
          nextSelectedIds = [...selectedComponentIds, id];
        }
      } else {
        if (!selectedComponentIds.includes(id)) {
          nextSelectedIds = [id];
        }
      }

      setSelectedComponentIds(nextSelectedIds);
      if (nextSelectedIds.length > 0) {
        setSelectedElement({ type: 'component', id: nextSelectedIds[nextSelectedIds.length - 1] });
      } else {
        setSelectedElement(null);
      }

      setDraggingComponent(id);
      setDragStartPos({ components: JSON.parse(JSON.stringify(components)), wires: JSON.parse(JSON.stringify(wires)) });
      
      // Compute mouse offset relative to component X, Y
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseCanvasX = (e.clientX - rect.left - pan.x) / zoom;
        const mouseCanvasY = (e.clientY - rect.top - pan.y) / zoom;
        setDragOffset({
          x: mouseCanvasX - comp.x,
          y: mouseCanvasY - comp.y
        });
      }
    }
  };

  // Direct component interaction (click to toggle push buttons/switches on canvas)
  const handleComponentClick = (id: string, _e: React.MouseEvent) => {
    const comp = components.find(c => c.id === id);
    if (!comp) return;

    if (comp.type === 'push_button') {
      // Momentary press — set pressed TRUE, auto-release after 200ms
      setComponents(prev => prev.map(c => c.id === id ? { ...c, properties: { ...c.properties, pressed: true } } : c));
      setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, buttonInput: true } }));
      setTimeout(() => {
        setComponents(prev => prev.map(c => c.id === id ? { ...c, properties: { ...c.properties, pressed: false } } : c));
        setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, buttonInput: false } }));
      }, 200);
    } else if (comp.type === 'slide_switch' || comp.type === 'toggle_switch') {
      // Toggle switch
      const current = comp.properties.on ?? false;
      setComponents(prev => prev.map(c => c.id === id ? { ...c, properties: { ...c.properties, on: !current } } : c));
    }
  };

  const rotateSelectedComponent = () => {
    if (selectedElement?.type === 'component') {
      pushState(components, wires);
      setComponents(prev => prev.map(c => 
        c.id === selectedElement.id ? { ...c, rotation: (c.rotation + 90) % 360 } : c
      ));
    }
  };

  const deleteSelectedElement = () => {
    if (!selectedElement && selectedComponentIds.length === 0) return;
    pushState(components, wires);

    const idsToDelete = new Set(selectedComponentIds);
    if (selectedElement && selectedElement.type === 'component') {
      idsToDelete.add(selectedElement.id);
    }

    if (idsToDelete.size > 0) {
      setComponents(prev => prev.filter(c => !idsToDelete.has(c.id)));
      setWires(prev => prev.filter(w => !idsToDelete.has(w.fromComponentId) && !idsToDelete.has(w.toComponentId)));
      setSelectedComponentIds([]);
    } else if (selectedElement && selectedElement.type === 'wire') {
      setWires(prev => prev.filter(w => w.id !== selectedElement.id));
    }
    setSelectedElement(null);
  };

  // Drag and drop add from Library sidebar
  const addComponentToCanvas = (type: string) => {
    const meta = COMPONENT_DEFINITIONS[type];
    if (!meta) return;
    pushState(components, wires);
    
    // Center it on the workspace container
    const width = workspaceRef.current?.clientWidth || 800;
    const height = workspaceRef.current?.clientHeight || 600;
    const initialX = Math.round((width / 2 - pan.x) / zoom - meta.width / 2);
    const initialY = Math.round((height / 2 - pan.y) / zoom - meta.height / 2);
    const snapped = snapComponentPosition(type, initialX, initialY, 0, components);
    const newComp: ComponentInstance = {
      id: `${type}_${Date.now()}`,
      type,
      name: meta.name,
      x: snapped.x,
      y: snapped.y,
      rotation: 0,
      properties: { ...meta.defaultProperties },
    };
    setComponents(prev => [...prev, newComp]);
    setSelectedElement({ type: 'component', id: newComp.id });
    setSelectedComponentIds([newComp.id]);
  };

  const addStarterToCanvas = (type: string, customCx?: number, customCy?: number) => {
    pushState(components, wires);
    
    let newComps: ComponentInstance[] = [];
    let newWires: WireConnection[] = [];

    const width = workspaceRef.current?.clientWidth || 800;
    const height = workspaceRef.current?.clientHeight || 600;
    const cx = customCx !== undefined ? Math.round(customCx) : Math.round((width / 2 - pan.x) / zoom);
    const cy = customCy !== undefined ? Math.round(customCy) : Math.round((height / 2 - pan.y) / zoom);

    if (type === 'breadboard_only') {
      newComps = [
        { id: `breadboard_${Date.now()}`, type: 'breadboard', name: 'Half Breadboard', x: cx - 275, y: cy - 128, rotation: 0, properties: {} }
      ];
    } else if (type === 'led_resistor') {
      newComps = [
        { id: `led_${Date.now()}`, type: 'led', name: 'LED', x: cx - 20, y: cy - 60, rotation: 0, properties: { color: 'red' } },
        { id: `resistor_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx - 30, y: cy + 10, rotation: 0, properties: { resistance: 220 } }
      ];
      newWires = [
        { id: `wire_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'pin2', toComponentId: newComps[0].id, toPinId: 'anode', color: 'red' }
      ];
    } else if (type === 'button_led') {
      newComps = [
        { id: `button_${Date.now()}`, type: 'push_button', name: 'Push Button', x: cx - 50, y: cy - 20, rotation: 0, properties: {} },
        { id: `led_${Date.now()}`, type: 'led', name: 'LED', x: cx + 20, y: cy - 25, rotation: 0, properties: { color: 'red' } }
      ];
      newWires = [
        { id: `wire_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'pin2a', toComponentId: newComps[1].id, toPinId: 'anode', color: 'red' }
      ];
    } else if (type === 'arduino_breadboard') {
      newComps = [
        { id: `arduino_${Date.now()}`, type: 'arduino', name: 'Arduino Uno R3', x: cx - 210, y: cy - 70, rotation: 0, properties: {} },
        { id: `breadboard_${Date.now()}`, type: 'breadboard', name: 'Half Breadboard', x: cx + 20, y: cy - 128, rotation: 0, properties: {} }
      ];
    } else if (type === 'blink_starter') {
      newComps = [
        { id: `arduino_${Date.now()}`, type: 'arduino', name: 'Arduino Uno R3', x: cx - 220, y: cy - 70, rotation: 0, properties: {} },
        { id: `led_${Date.now()}`, type: 'led', name: 'LED', x: cx + 20, y: cy - 40, rotation: 0, properties: { color: 'red' } },
        { id: `resistor_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 20, y: cy + 20, rotation: 0, properties: { resistance: 220 } }
      ];
      newWires = [
        { id: `wire_${Date.now()}_1`, fromComponentId: newComps[0].id, fromPinId: 'D13', toComponentId: newComps[2].id, toPinId: 'pin1', color: 'red' },
        { id: `wire_${Date.now()}_2`, fromComponentId: newComps[2].id, fromPinId: 'pin2', toComponentId: newComps[1].id, toPinId: 'anode', color: 'red' },
        { id: `wire_${Date.now()}_3`, fromComponentId: newComps[1].id, fromPinId: 'cathode', toComponentId: newComps[0].id, toPinId: 'GND_D', color: 'black' }
      ];
    } else if (type === 'traffic_light') {
      newComps = [
        { id: `arduino_${Date.now()}`, type: 'arduino', name: 'Arduino Uno R3', x: cx - 220, y: cy - 70, rotation: 0, properties: {} },
        { id: `led_r_${Date.now()}`, type: 'led', name: 'Red LED', x: cx + 10, y: cy - 90, rotation: 0, properties: { color: 'red' } },
        { id: `led_y_${Date.now()}`, type: 'led', name: 'Yellow LED', x: cx + 10, y: cy - 30, rotation: 0, properties: { color: 'yellow' } },
        { id: `led_g_${Date.now()}`, type: 'led', name: 'Green LED', x: cx + 10, y: cy + 30, rotation: 0, properties: { color: 'green' } },
        { id: `res1_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 70, y: cy - 80, rotation: 0, properties: { resistance: 220 } },
        { id: `res2_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 70, y: cy - 20, rotation: 0, properties: { resistance: 220 } },
        { id: `res3_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 70, y: cy + 40, rotation: 0, properties: { resistance: 220 } }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'D12', toComponentId: newComps[4].id, toPinId: 'pin1', color: 'red' },
        { id: `w2_${Date.now()}`, fromComponentId: newComps[4].id, fromPinId: 'pin2', toComponentId: newComps[1].id, toPinId: 'anode', color: 'red' },
        { id: `w3_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'D11', toComponentId: newComps[5].id, toPinId: 'pin1', color: 'yellow' },
        { id: `w4_${Date.now()}`, fromComponentId: newComps[5].id, fromPinId: 'pin2', toComponentId: newComps[2].id, toPinId: 'anode', color: 'yellow' },
        { id: `w5_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'D10', toComponentId: newComps[6].id, toPinId: 'pin1', color: 'green' },
        { id: `w6_${Date.now()}`, fromComponentId: newComps[6].id, fromPinId: 'pin2', toComponentId: newComps[3].id, toPinId: 'anode', color: 'green' },
        { id: `w7_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'cathode', toComponentId: newComps[0].id, toPinId: 'GND_D', color: 'black' },
        { id: `w8_${Date.now()}`, fromComponentId: newComps[2].id, fromPinId: 'cathode', toComponentId: newComps[0].id, toPinId: 'GND_D', color: 'black' },
        { id: `w9_${Date.now()}`, fromComponentId: newComps[3].id, fromPinId: 'cathode', toComponentId: newComps[0].id, toPinId: 'GND_D', color: 'black' }
      ];
    } else if (type === 'button_input') {
      newComps = [
        { id: `arduino_${Date.now()}`, type: 'arduino', name: 'Arduino Uno R3', x: cx - 220, y: cy - 70, rotation: 0, properties: {} },
        { id: `button_${Date.now()}`, type: 'push_button', name: 'Push Button', x: cx + 20, y: cy - 40, rotation: 0, properties: {} },
        { id: `res_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 20, y: cy + 30, rotation: 0, properties: { resistance: 10000 } }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: '5V', toComponentId: newComps[1].id, toPinId: 'pin1a', color: 'red' },
        { id: `w2_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'pin2a', toComponentId: newComps[2].id, toPinId: 'pin1', color: 'green' },
        { id: `w3_${Date.now()}`, fromComponentId: newComps[2].id, fromPinId: 'pin1', toComponentId: newComps[0].id, toPinId: 'D2', color: 'green' },
        { id: `w4_${Date.now()}`, fromComponentId: newComps[2].id, fromPinId: 'pin2', toComponentId: newComps[0].id, toPinId: 'GND_P1', color: 'black' }
      ];
    } else if (type === 'pwm_dimmer') {
      newComps = [
        { id: `arduino_${Date.now()}`, type: 'arduino', name: 'Arduino Uno R3', x: cx - 220, y: cy - 70, rotation: 0, properties: {} },
        { id: `pot_${Date.now()}`, type: 'potentiometer', name: 'Potentiometer', x: cx + 20, y: cy - 60, rotation: 0, properties: {} },
        { id: `led_${Date.now()}`, type: 'led', name: 'LED', x: cx + 30, y: cy + 10, rotation: 0, properties: { color: 'green' } },
        { id: `res_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 30, y: cy + 70, rotation: 0, properties: { resistance: 220 } }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: '5V', toComponentId: newComps[1].id, toPinId: 'pin1', color: 'red' },
        { id: `w2_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'GND_P1', toComponentId: newComps[1].id, toPinId: 'pin3', color: 'black' },
        { id: `w3_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'pin2', toComponentId: newComps[0].id, toPinId: 'A0', color: 'yellow' },
        { id: `w4_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'D9', toComponentId: newComps[3].id, toPinId: 'pin1', color: 'green' },
        { id: `w5_${Date.now()}`, fromComponentId: newComps[3].id, fromPinId: 'pin2', toComponentId: newComps[2].id, toPinId: 'anode', color: 'green' },
        { id: `w6_${Date.now()}`, fromComponentId: newComps[2].id, fromPinId: 'cathode', toComponentId: newComps[0].id, toPinId: 'GND_D', color: 'black' }
      ];
    } else if (type === 'microbit_board') {
      newComps = [
        { id: `microbit_${Date.now()}`, type: 'microbit', name: 'micro:bit', x: cx - 80, y: cy - 70, rotation: 0, properties: {} }
      ];
    } else if (type === 'microbit_breadboard') {
      newComps = [
        { id: `microbit_${Date.now()}`, type: 'microbit', name: 'micro:bit', x: cx - 210, y: cy - 70, rotation: 0, properties: {} },
        { id: `breadboard_${Date.now()}`, type: 'breadboard', name: 'Half Breadboard', x: cx + 20, y: cy - 128, rotation: 0, properties: {} }
      ];
    } else if (type === 'microbit_button') {
      newComps = [
        { id: `microbit_${Date.now()}`, type: 'microbit', name: 'micro:bit', x: cx - 180, y: cy - 70, rotation: 0, properties: {} },
        { id: `led_${Date.now()}`, type: 'led', name: 'LED', x: cx + 100, y: cy - 40, rotation: 0, properties: { color: 'blue' } },
        { id: `res_${Date.now()}`, type: 'resistor', name: 'Resistor', x: cx + 100, y: cy + 20, rotation: 0, properties: { resistance: 220 } }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'P0', toComponentId: newComps[2].id, toPinId: 'pin1', color: 'red' },
        { id: `w2_${Date.now()}`, fromComponentId: newComps[2].id, fromPinId: 'pin2', toComponentId: newComps[1].id, toPinId: 'anode', color: 'red' },
        { id: `w3_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'cathode', toComponentId: newComps[0].id, toPinId: 'GND', color: 'black' }
      ];
    } else if (type === 'h_bridge') {
      newComps = [
        { id: `breadboard_${Date.now()}`, type: 'breadboard', name: 'Half Breadboard', x: cx - 200, y: cy - 128, rotation: 0, properties: {} },
        { id: `dc_motor_${Date.now()}`, type: 'dc_motor', name: 'DC Motor', x: cx + 150, y: cy - 40, rotation: 0, properties: {} }
      ];
    } else if (type === 'ir_receiver_circuit') {
      newComps = [
        { id: `arduino_${Date.now()}`, type: 'arduino', name: 'Arduino Uno R3', x: cx - 220, y: cy - 70, rotation: 0, properties: {} },
        { id: `ir_sensor_${Date.now()}`, type: 'ir_sensor', name: 'IR Receiver', x: cx + 20, y: cy - 50, rotation: 0, properties: {} }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: '5V', toComponentId: newComps[1].id, toPinId: 'vcc', color: 'red' },
        { id: `w2_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'GND_P1', toComponentId: newComps[1].id, toPinId: 'gnd', color: 'black' },
        { id: `w3_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'out', toComponentId: newComps[0].id, toPinId: 'D11', color: 'green' }
      ];
    } else if (type === 'voltage_divider') {
      newComps = [
        { id: `res1_${Date.now()}`, type: 'resistor', name: 'Resistor 10k', x: cx - 50, y: cy - 50, rotation: 0, properties: { resistance: 10000 } },
        { id: `res2_${Date.now()}`, type: 'resistor', name: 'Resistor 10k', x: cx - 50, y: cy + 10, rotation: 0, properties: { resistance: 10000 } }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'pin2', toComponentId: newComps[1].id, toPinId: 'pin1', color: 'green' }
      ];
    } else if (type === 'rc_filter') {
      newComps = [
        { id: `res_${Date.now()}`, type: 'resistor', name: 'Resistor 10k', x: cx - 60, y: cy - 20, rotation: 0, properties: { resistance: 10000 } },
        { id: `cap_${Date.now()}`, type: 'capacitor', name: 'Capacitor 0.1uF', x: cx + 10, y: cy - 20, rotation: 0, properties: {} }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'pin2', toComponentId: newComps[1].id, toPinId: 'anode', color: 'green' }
      ];
    } else if (type === 'wheatstone_bridge') {
      newComps = [
        { id: `res1_${Date.now()}`, type: 'resistor', name: 'R1', x: cx - 80, y: cy - 60, rotation: 0, properties: { resistance: 1000 } },
        { id: `res2_${Date.now()}`, type: 'resistor', name: 'R2', x: cx + 20, y: cy - 60, rotation: 0, properties: { resistance: 1000 } },
        { id: `res3_${Date.now()}`, type: 'resistor', name: 'R3', x: cx - 80, y: cy + 20, rotation: 0, properties: { resistance: 1000 } },
        { id: `res4_${Date.now()}`, type: 'resistor', name: 'R4', x: cx + 20, y: cy + 20, rotation: 0, properties: { resistance: 1000 } }
      ];
      newWires = [
        { id: `w1_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'pin2', toComponentId: newComps[1].id, toPinId: 'pin1', color: 'green' },
        { id: `w2_${Date.now()}`, fromComponentId: newComps[2].id, fromPinId: 'pin2', toComponentId: newComps[3].id, toPinId: 'pin1', color: 'green' },
        { id: `w3_${Date.now()}`, fromComponentId: newComps[0].id, fromPinId: 'pin1', toComponentId: newComps[2].id, toPinId: 'pin1', color: 'red' },
        { id: `w4_${Date.now()}`, fromComponentId: newComps[1].id, fromPinId: 'pin2', toComponentId: newComps[3].id, toPinId: 'pin2', color: 'black' }
      ];
    }

    setComponents(prev => [...prev, ...newComps]);
    setWires(prev => [...prev, ...newWires]);
    if (newComps.length > 0) {
      setSelectedElement({ type: 'component', id: newComps[0].id });
      setSelectedComponentIds(newComps.map(nc => nc.id));
    }
  };

  // Wire drawing hooks
  const handlePinClick = (comp: ComponentInstance, pinId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    // Check if source pin already has a wire (unless breadboard)
    if (!drawingWire && comp.type !== 'breadboard') {
      const alreadyConnected = wires.some(w => 
        (w.fromComponentId === comp.id && w.fromPinId === pinId) ||
        (w.toComponentId === comp.id && w.toPinId === pinId)
      );
      if (alreadyConnected) {
        setFlashMessage({ type: 'error', text: '✗ Pin already has a wire connected!', x: e.clientX, y: e.clientY });
        setTimeout(() => setFlashMessage(null), 1800);
        return;
      }
    }

    const pos = getPinPos(comp, pinId);
    
    if (!drawingWire) {
      setDrawingWire({
        fromComponentId: comp.id,
        fromPinId: pinId,
        x: pos.x,
        y: pos.y
      });
    } else {
      // Connect wires
      // 1. Same component check
      if (drawingWire.fromComponentId === comp.id) {
        setFlashMessage({ type: 'error', text: '✗ Cannot connect to same component', x: e.clientX, y: e.clientY });
        setTimeout(() => setFlashMessage(null), 1800);
        setDrawingWire(null);
        return;
      }

      // 2. Dest pin already has a wire check (unless breadboard)
      if (comp.type !== 'breadboard') {
        const alreadyConnected = wires.some(w => 
          (w.fromComponentId === comp.id && w.fromPinId === pinId) ||
          (w.toComponentId === comp.id && w.toPinId === pinId)
        );
        if (alreadyConnected) {
          setFlashMessage({ type: 'error', text: '✗ Pin already has a wire connected!', x: e.clientX, y: e.clientY });
          setTimeout(() => setFlashMessage(null), 1800);
          setDrawingWire(null);
          return;
        }
      }

      pushState(components, wires);
      const newWire: WireConnection = {
        id: `wire_${Date.now()}`,
        fromComponentId: drawingWire.fromComponentId,
        fromPinId: drawingWire.fromPinId,
        toComponentId: comp.id,
        toPinId: pinId,
        color: selectedWireColor
      };
      
      setWires(prev => [...prev, newWire]);
      setDrawingWire(null);

      // Flash success green checkmark
      setFlashMessage({ type: 'success', text: '✓ Connected!', x: e.clientX, y: e.clientY });
      setTimeout(() => setFlashMessage(null), 1500);
    }
  };

  // Helper to get component designator (e.g. R1, LED1, U1, C1)
  const getDesignator = (comp: ComponentInstance, list: ComponentInstance[]) => {
    const prefixMap: Record<string, string> = {
      arduino: 'U',
      raspberry_pi: 'U',
      breadboard: 'BB',
      led: 'D',
      resistor: 'R',
      push_button: 'S',
      buzzer: 'LS',
      potentiometer: 'RV',
      capacitor: 'C',
      slide_switch: 'SW',
      battery_9v: 'BT',
      battery_coin: 'BT',
      battery_1_5v: 'BT',
      microbit: 'U',
      vibration_motor: 'M',
      dc_motor: 'M',
      servo: 'M',
      gear_motor: 'M',
      npn_transistor: 'Q',
      led_rgb: 'D',
      diode: 'D',
      photoresistor: 'R',
      soil_moisture: 'SEN',
      hc_sr04: 'SEN',
      pir_sensor: 'SEN',
      ds18b20: 'SEN',
      yf_s201: 'SEN',
      relay: 'K',
      l298n: 'U',
      stepper_motor: 'M',
      pulse_sensor: 'SEN',
      lm35: 'SEN',
    };
    const prefix = prefixMap[comp.type] || 'U';
    const sameTypeComps = list.filter(c => c.type === comp.type);
    const index = sameTypeComps.findIndex(c => c.id === comp.id);
    return `${prefix}${index !== -1 ? index + 1 : 1}`;
  };

  // Generate CSV for Bill of Materials (BOM)
  const downloadBOM = () => {
    let csvContent = 'data:text/csv;charset=utf-8,Name,Quantity,Component\n';
    components.forEach(c => {
      const designator = getDesignator(c, components);
      csvContent += `"${designator}",1,"${c.name}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', circuitId ? `BOM_Design_${dbCircuitTitle.replace(/\s+/g, '_')}.csv` : `BOM_Experiment_${experiment.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };



  if (isLoadingDb) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[var(--bg-main)] text-[var(--text-main)]">
        <Loader2 className="w-8 h-8 text-[#FF6B35] animate-spin mb-2" />
        <span className="text-xs font-semibold text-[var(--text-muted)]">Loading Supabase Circuit...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-main)] text-[var(--text-main)] select-none overflow-hidden font-sans">
      
      {/* 1. Header Toolbar */}
      <header className="bg-[var(--bg-panel)] border-b border-[var(--border-main)] px-5 py-3.5 flex items-center justify-between sticky top-0 z-40 shadow-md">
        
        {/* Logo and Experiment details */}
        <div className="flex items-center space-x-3.5">
          <button onClick={onBack} className="p-2 bg-[var(--bg-panel-light)] rounded-xl border border-[var(--border-main)] hover:text-[var(--text-main)] hover:bg-[#FF6B35]/20 hover:border-[#FF6B35]/40 text-[var(--text-muted)] transition-all cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-sm font-bold text-[var(--text-main)] leading-tight flex items-center gap-2">
              {circuitId ? dbCircuitTitle : experiment.title}
              <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-widest ${simState.isRunning ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-[var(--bg-panel-light)] text-[var(--text-muted)]'}`}>
                {simState.isRunning ? 'Simulation Active' : 'Idle'}
              </span>
              {circuitId && (
                <SaveIndicator
                  isSaving={isSaving}
                  lastSavedAt={lastSavedAt}
                  error={syncError}
                />
              )}
            </h1>
            <span className="text-[10px] text-[var(--text-muted)] font-semibold">
              {circuitId ? (languageMode === 'MicroPython' ? 'Raspberry Pi' : 'Arduino') : experiment.platform} Workspace
            </span>
          </div>
        </div>

        {/* Tab view switches */}
        <div className="flex space-x-1 p-1 bg-slate-950/60 rounded-xl border border-[var(--border-main)]">
          <button onClick={() => setActiveTab('breadboard')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'breadboard' ? 'bg-[#FF6B35] text-[var(--text-main)] shadow-md' : 'text-[var(--text-muted)] hover:text-slate-800'}`}>
            <Layers className="w-3.5 h-3.5" /> Breadboard
          </button>
          <button onClick={() => setActiveTab('schematic')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'schematic' ? 'bg-[#FF6B35] text-[var(--text-main)] shadow-md' : 'text-[var(--text-muted)] hover:text-slate-800'}`}>
            <Eye className="w-3.5 h-3.5" /> Schematic
          </button>
          <button onClick={() => setActiveTab('bom')} className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'bom' ? 'bg-[#FF6B35] text-[var(--text-main)] shadow-md' : 'text-[var(--text-muted)] hover:text-slate-800'}`}>
            <FileSpreadsheet className="w-3.5 h-3.5" /> BOM
          </button>
        </div>

        {/* Right side options: Fullscreen & Code panel toggle */}
        <div className="flex items-center space-x-2.5">
          <button 
            onClick={() => setShowCode(!showCode)} 
            className={`px-3 py-1.5 text-xs font-bold rounded-xl border transition-all cursor-pointer ${
              showCode 
                ? 'bg-[#FF6B35]/10 border-[#FF6B35]/30 text-[#FF6B35]' 
                : 'bg-[var(--bg-panel-light)] border-[var(--border-main)] text-[var(--text-muted)] hover:bg-[var(--bg-panel-hover)]'
            }`}
          >
            {'</>'} Code Editor Panel
          </button>
          
          <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 bg-[var(--bg-panel-light)] rounded-xl border border-[var(--border-color)] text-[var(--text-muted)] hover:text-[var(--text-main)] cursor-pointer transition-colors" title="Toggle Theme">
            {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* 2. Main Workspace Layout */}
      <div className="flex flex-1 overflow-hidden relative">
        
        {/* LEFT PANEL — Components Panel (collapsible, ~220px wide) */}
        {activeTab !== 'bom' && (
          <aside className={`bg-gray-50 border-r border-gray-200 flex flex-col transition-all duration-300 relative ${
            isLeftPanelCollapsed ? 'w-12' : 'w-[240px]'
          }`}>
            
            {/* Collapse toggle arrow */}
            <button 
              onClick={() => setIsLeftPanelCollapsed(!isLeftPanelCollapsed)}
              className="absolute -right-3 top-4 z-30 w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center shadow-md transition-transform cursor-pointer"
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${!isLeftPanelCollapsed ? 'rotate-180' : ''}`} />
            </button>

            {isLeftPanelCollapsed ? (
              // Collapsed view with icons
              <div className="flex-1 py-10 flex flex-col items-center space-y-6 text-gray-500">
                <Search className="w-4 h-4" />
                <LayoutGrid className="w-4 h-4" />
                <Cpu className="w-4 h-4" />
                <Sliders className="w-4 h-4" />
                <Server className="w-4 h-4" />
              </div>
            ) : (
              // Full library view
              <div className="flex-1 flex flex-col p-4 overflow-hidden">
                <div className="flex flex-col gap-2 pb-3 border-b border-[var(--border-main)] mb-3 shrink-0">
                  <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Components Library</span>
                  
                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                    <input 
                      type="text" 
                      placeholder="Filter parts..." 
                      value={searchTerm} 
                      onChange={(e) => setSearchTerm(e.target.value)} 
                      className="w-full bg-white border border-gray-200 rounded-xl py-1.5 pl-8 pr-3 text-xs text-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all shadow-sm" 
                    />
                  </div>
                </div>

                {/* Collapsible Sections */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-3.5">
                  {Object.entries(CATEGORIZED_ITEMS).map(([sectionName, sectionItems]) => {
                    const isOpen = !collapsedCategories[sectionName];
                    const matchedItems = sectionItems.filter(item => {
                      if (item.type === 'component') {
                        const meta = COMPONENT_DEFINITIONS[item.id];
                        return meta && meta.name.toLowerCase().includes(searchTerm.toLowerCase());
                      } else {
                        const starter = STARTER_DEFINITIONS[item.id];
                        return starter && starter.name.toLowerCase().includes(searchTerm.toLowerCase());
                      }
                    });

                    if (matchedItems.length === 0) return null;

                    return (
                      <div key={sectionName} className="border-b border-gray-200 pb-2">
                        <button
                          onClick={() => setCollapsedCategories(prev => ({ ...prev, [sectionName]: !prev[sectionName] }))}
                          className="w-full flex items-center justify-between text-xs font-bold text-gray-600 hover:text-gray-900 uppercase tracking-wider py-1.5 cursor-pointer"
                        >
                          <span>{sectionName}</span>
                          <span className="text-[10px] text-gray-400">{isOpen ? '▼' : '▶'}</span>
                        </button>
                        
                        {isOpen && (
                          <div className="grid grid-cols-2 gap-2 mt-2">
                            {matchedItems.map(item => {
                              if (item.type === 'component') {
                                const c = COMPONENT_DEFINITIONS[item.id];
                                if (!c) return null;
                                return (
                                  <button 
                                    key={item.id} 
                                    onClick={() => addComponentToCanvas(item.id)}
                                    draggable="true"
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('text/plain', item.id);
                                      e.dataTransfer.setData('item-type', 'component');
                                    }}
                                    className="bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md p-3 rounded-2xl flex flex-col items-center justify-center text-center transition-all aspect-square cursor-pointer group"
                                    title={c.description}
                                  >
                                    <div className="w-10 h-10 flex items-center justify-center overflow-hidden mb-1">
                                      <svg viewBox={`0 0 ${c.width} ${c.height}`} className="w-full h-full max-w-full max-h-full p-0.5" style={{ overflow: 'visible' }}>
                                        <ComponentSVGs 
                                          instance={{ id: 'preview', type: c.type, name: c.name, x: 0, y: 0, rotation: 0, properties: c.defaultProperties }} 
                                          viewMode="breadboard" 
                                          isPinActive={() => false} 
                                        />
                                      </svg>
                                    </div>
                                    <span className="text-[11px] font-semibold text-gray-700 group-hover:text-gray-900 mt-2 transition-colors line-clamp-1 w-full leading-tight font-sans">
                                      {c.name}
                                    </span>
                                  </button>
                                );
                              } else {
                                const starter = STARTER_DEFINITIONS[item.id];
                                if (!starter) return null;
                                const iconType = getStarterIconType(item.id);
                                const c = COMPONENT_DEFINITIONS[iconType] || COMPONENT_DEFINITIONS.arduino;
                                return (
                                  <button 
                                    key={item.id} 
                                    onClick={() => addStarterToCanvas(item.id)}
                                    draggable="true"
                                    onDragStart={(e) => {
                                      e.dataTransfer.setData('text/plain', item.id);
                                    }}
                                    className="bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 shadow-sm hover:shadow-md p-3 rounded-2xl flex flex-col items-center justify-center text-center transition-all aspect-square cursor-pointer group"
                                    title={starter.description}
                                  >
                                    <div className="w-10 h-10 flex items-center justify-center overflow-hidden mb-1">
                                      <svg viewBox={`0 0 ${c.width} ${c.height}`} className="w-full h-full max-w-full max-h-full p-0.5" style={{ overflow: 'visible' }}>
                                        <ComponentSVGs 
                                          instance={{ id: 'preview', type: c.type, name: c.name, x: 0, y: 0, rotation: 0, properties: c.defaultProperties }} 
                                          viewMode="breadboard" 
                                          isPinActive={() => false} 
                                        />
                                      </svg>
                                    </div>
                                    <span className="text-[11px] font-semibold text-gray-700 group-hover:text-gray-900 mt-2 transition-colors line-clamp-2 w-full leading-tight font-sans">
                                      {starter.name}
                                    </span>
                                  </button>
                                );
                              }
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Switch to Steps lists */}
                <div className="mt-4 pt-3 border-t border-[var(--border-main)] shrink-0">
                  <button 
                    onClick={() => {
                      setSidebarTab(sidebarTab === 'steps' ? 'library' : 'steps');
                    }}
                    className="w-full py-2 bg-[var(--bg-panel-light)] hover:bg-[var(--bg-panel-light)] border border-[var(--border-main)] text-[var(--text-secondary)] hover:text-[var(--text-main)] rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                  >
                    {sidebarTab === 'steps' ? 'Show Parts Library' : 'Show Wiring Steps'}
                  </button>
                </div>

                {sidebarTab === 'steps' && (
                  <div className="absolute inset-0 bg-[var(--bg-panel)] p-4 flex flex-col z-20 overflow-y-auto">
                    <div className="flex justify-between items-center mb-3">
                      <h3 className="text-xs font-bold text-slate-800 uppercase">Assembly Steps</h3>
                      <button onClick={() => setSidebarTab('library')} className="text-[var(--text-muted)] hover:text-slate-800 text-xs">Close</button>
                    </div>
                    <div className="space-y-2">
                      {experiment.buildSteps?.map((step, idx) => (
                        <label key={idx} className="flex items-start gap-2 p-2 bg-[var(--bg-panel-light)] rounded-xl cursor-pointer">
                          <input type="checkbox" className="mt-0.5 rounded border-[var(--border-main)] bg-slate-950 text-[#FF6B35] focus:ring-[#FF6B35]" />
                          <span className="text-[10px] text-[var(--text-muted)] leading-relaxed"><span className="font-bold text-[#FF6B35]">{idx + 1}.</span> {step}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            )}
          </aside>
        )}

        {/* CENTER PANEL — Circuit Canvas (main area) */}
        <main className="flex-1 flex flex-col relative overflow-hidden bg-[var(--bg-main)]" ref={workspaceRef}>
          
          {activeTab === 'bom' ? (
            // BOM View Table
            <div className="flex-1 p-8 overflow-y-auto flex flex-col items-center">
              <div className="w-full max-w-4xl bg-[var(--bg-panel)] backdrop-blur-md rounded-2xl p-6 border border-[var(--border-main)]">
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h2 className="text-xl font-bold">Component List</h2>
                    <p className="text-xs text-[var(--text-muted)] mt-1">Auto-generated list of all electronic components in the workspace canvas.</p>
                  </div>
                  <button onClick={downloadBOM} className="px-4 py-2 bg-[#FF6B35] hover:bg-[#ff804d] text-[var(--text-main)] rounded-xl flex items-center gap-2 text-xs font-bold transition-all cursor-pointer">
                    <Download className="w-4 h-4" /> Download CSV
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[var(--border-main)] text-[var(--text-muted)]">
                        <th className="py-3 px-4 uppercase font-bold">Designator</th>
                        <th className="py-3 px-4 uppercase font-bold">Name</th>
                        <th className="py-3 px-4 uppercase font-bold">Type</th>
                        <th className="py-3 px-4 uppercase font-bold">Quantity</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-800">
                      {components.map((c) => (
                        <tr key={c.id} className="hover:bg-[var(--bg-panel-light)]">
                          <td className="py-3.5 px-4 font-mono font-bold text-indigo-400">{getDesignator(c, components)}</td>
                          <td className="py-3.5 px-4">{c.name}</td>
                          <td className="py-3.5 px-4 text-[var(--text-muted)]">{c.type}</td>
                          <td className="py-3.5 px-4">1</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            // Canvas View
            <div className="flex-1 flex flex-col relative h-full">
              
              {/* Canvas Action Toolbar */}
              <div className="px-4 py-2 bg-slate-950/65 border-b border-[var(--border-main)] flex items-center justify-between z-10 text-xs shrink-0 select-none">
                
                {/* Simulation Control Blocks */}
                <div className="flex items-center space-x-2">
                  {simState.isRunning ? (
                    <div className="flex items-center space-x-1.5 bg-[var(--bg-panel-light)] p-1 rounded-xl border border-[var(--border-main)]">
                      <button onClick={stopSimulation} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-[var(--text-main)] rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer">
                        <Square className="w-3.5 h-3.5 fill-white" /> Stop
                      </button>
                      {simState.isPaused ? (
                        <button onClick={resumeSimulation} className="p-1.5 text-emerald-400 hover:text-[var(--text-main)] transition-colors cursor-pointer" title="Resume">
                          <Play className="w-4 h-4 fill-current" />
                        </button>
                      ) : (
                        <button onClick={pauseSimulation} className="p-1.5 text-amber-400 hover:text-[var(--text-main)] transition-colors cursor-pointer" title="Pause">
                          <Pause className="w-4 h-4 fill-current" />
                        </button>
                      )}
                      <button onClick={stepSimulation} disabled={!simState.isPaused} className={`p-1.5 ${simState.isPaused ? 'text-blue-400 hover:text-[var(--text-main)]' : 'text-[var(--text-secondary)]'} transition-colors cursor-pointer`} title="Step Line">
                        <StepForward className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={startSimulation} className="px-4 py-1.5 bg-[#FF6B35] hover:bg-[#ff804d] text-[var(--text-main)] rounded-xl flex items-center gap-2 text-xs font-bold transition-all shadow-md cursor-pointer">
                      <Play className="w-3.5 h-3.5 fill-white" /> Start Simulation
                    </button>
                  )}
                  
                  <span className="text-[var(--text-muted)]">|</span>

                  {/* Wire color select */}
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase font-bold mr-1">Wire:</span>
                    {['red', 'black', 'green', 'yellow', 'blue', 'orange'].map(c => (
                      <button
                        key={c}
                        onClick={() => setSelectedWireColor(c)}
                        style={{ backgroundColor: c === 'black' ? '#020617' : c }}
                        className={`w-4 h-4 rounded-full border transition-all cursor-pointer ${
                          selectedWireColor === c ? 'ring-2 ring-white border-transparent' : 'border-[var(--border-main)]'
                        }`}
                      />
                    ))}
                  </div>
                </div>

                {/* Zoom, Pan, Grid, Delete Buttons */}
                <div className="flex items-center space-x-2">
                  <button onClick={handleUndo} disabled={history.length === 0} className={`p-1.5 rounded-lg border transition-all cursor-pointer ${history.length > 0 ? 'bg-[var(--bg-panel-light)] border-[var(--border-main)] text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-hover)]' : 'text-[var(--text-secondary)] border-slate-950'}`} title="Undo (Cmd+Z)">
                    ↩
                  </button>
                  <button onClick={handleRedo} disabled={redoStack.length === 0} className={`p-1.5 rounded-lg border transition-all cursor-pointer ${redoStack.length > 0 ? 'bg-[var(--bg-panel-light)] border-[var(--border-main)] text-[var(--text-secondary)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-hover)]' : 'text-[var(--text-secondary)] border-slate-950'}`} title="Redo (Cmd+Y)">
                    ↪
                  </button>

                  <span className="text-[var(--text-secondary)]">|</span>

                  <button onClick={() => handleZoom('in')} className="p-1.5 bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-hover)] cursor-pointer" title="Zoom In">
                    Zoom In
                  </button>
                  <button onClick={() => handleZoom('out')} className="p-1.5 bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-hover)] cursor-pointer" title="Zoom Out">
                    Zoom Out
                  </button>
                  <button onClick={resetPanZoom} className="p-1.5 bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-main)] hover:bg-[var(--bg-panel-hover)] cursor-pointer" title="Fit to Screen">
                    Fit to Screen
                  </button>

                  <span className="text-[var(--text-secondary)]">|</span>

                  <button onClick={() => setShowGrid(!showGrid)} className={`p-1.5 rounded-lg border transition-all cursor-pointer ${showGrid ? 'bg-[#FF6B35]/15 border-[#FF6B35]/35 text-[#FF6B35]' : 'bg-[var(--bg-panel-light)] border-[var(--border-main)] text-[var(--text-muted)] hover:bg-[var(--bg-panel-hover)]'}`} title="Toggle Grid">
                    Grid Toggle
                  </button>

                  <button onClick={() => setWireStyle(prev => prev === 'bezier' ? 'manhattan' : 'bezier')} className={`p-1.5 rounded-lg border transition-all cursor-pointer ${wireStyle === 'bezier' ? 'bg-[#FF6B35]/15 border-[#FF6B35]/35 text-[#FF6B35]' : 'bg-[var(--bg-panel-light)] border-[var(--border-main)] text-[var(--text-muted)] hover:bg-[var(--bg-panel-hover)]'}`} title="Toggle Wire Style (Bezier vs Manhattan)">
                    {wireStyle === 'bezier' ? 'Bezier Wires' : 'Manhattan Wires'}
                  </button>

                  <button 
                    onClick={deleteSelectedElement} 
                    disabled={!selectedElement} 
                    className={`p-1.5 rounded-lg border transition-all cursor-pointer ${selectedElement ? 'bg-rose-950/20 border-rose-900 text-rose-400 hover:bg-rose-600 hover:text-[var(--text-main)]' : 'text-[var(--text-secondary)] border-transparent'}`} 
                    title="Delete Selected"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Canvas tips absolute bubble info */}
              <div className="absolute right-4 top-14 z-10 max-w-sm bg-[var(--bg-panel)] border border-[var(--border-main)] backdrop-blur-md rounded-xl p-3 shadow-xl pointer-events-none">
                <h4 className="text-[10px] font-extrabold text-[#FF6B35] uppercase mb-1 tracking-wider">TIPS & HINTS</h4>
                <p className="text-[10px] text-[var(--text-muted)] leading-normal">{experiment.tips?.[0] || 'Select parts from the Left Library, click pins to draw wires.'}</p>
              </div>



              {/* Main SVG canvas */}
              <svg 
                className={`w-full h-full ${spacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`} 
                onMouseDown={handleCanvasMouseDown} 
                onMouseMove={handleCanvasMouseMove} 
                onMouseUp={handleCanvasMouseUp}
                onWheel={handleWheel}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const id = e.dataTransfer.getData('text/plain');
                  const itemType = e.dataTransfer.getData('item-type');
                  if (!id) return;
                  
                  const rect = e.currentTarget.getBoundingClientRect();
                  const dropX = (e.clientX - rect.left - pan.x) / zoom;
                  const dropY = (e.clientY - rect.top - pan.y) / zoom;

                  if (itemType === 'component') {
                    const meta = COMPONENT_DEFINITIONS[id];
                    if (meta) {
                      pushState(components, wires);
                      const initialX = Math.round(dropX - meta.width / 2);
                      const initialY = Math.round(dropY - meta.height / 2);
                      const snapped = snapComponentPosition(id, initialX, initialY, 0, components);
                      const newComp: ComponentInstance = {
                        id: `${id}_${Date.now()}`,
                        type: id,
                        name: meta.name,
                        x: snapped.x,
                        y: snapped.y,
                        rotation: 0,
                        properties: { ...meta.defaultProperties },
                      };
                      setComponents(prev => [...prev, newComp]);
                      setSelectedComponentIds([newComp.id]);
                      setSelectedElement({ type: 'component', id: newComp.id });
                    }
                  } else if (itemType === 'starter') {
                    addStarterToCanvas(id, dropX, dropY);
                  }
                }}
              >
                <defs>
                  {/* Dot Grid pattern matching the 15px grid pitch */}
                  <pattern id="dot-grid" width="15" height="15" patternUnits="userSpaceOnUse">
                    <circle cx="1.5" cy="1.5" r="1.0" fill="rgba(255, 255, 255, 0.08)" />
                  </pattern>
                  {/* Line grid pattern matching the 15px grid pitch */}
                  <pattern id="line-grid" width="15" height="15" patternUnits="userSpaceOnUse">
                    <path d="M 15 0 L 0 0 0 15" fill="none" stroke="rgba(255, 255, 255, 0.02)" strokeWidth="1" />
                  </pattern>
                  {/* Wire shadow filter for Fritzing-style depth */}
                  <filter id="wire-shadow" x="-30%" y="-30%" width="160%" height="160%">
                    <feDropShadow dx="1.2" dy="2.0" stdDeviation="1.5" floodColor="#0F172A" floodOpacity="0.45" />
                  </filter>
                  {/* Wire glow bloom filter */}
                  <filter id="wire-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                  <filter id="pin-glow" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Interactive grid background fill */}
                <rect width="100%" height="100%" fill={showGrid ? "url(#dot-grid)" : "#1a1a2e"} />

                <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
                  {/* Schematic framing */}
                  {activeTab === 'schematic' && (
                    <g>
                      <rect x={-100} y={-100} width={1000} height={750} fill="none" stroke="#FF6B35" strokeWidth={1} opacity={0.3} />
                      <rect x={-85} y={-85} width={970} height={720} fill="none" stroke="#FF6B35" strokeWidth={1.5} opacity={0.3} />
                      <text x={400} y={-60} fill="#FF6B35" fontSize={16} fontWeight="extrabold" textAnchor="middle" opacity={0.6}>SCHEMATIC DIAGRAM SHEET</text>
                    </g>
                  )}

                  {/* Wires */}
                  {activeTab === 'schematic' ? (
                    schematicNets.map((net, idx) => {
                      const paths: React.ReactNode[] = [];
                      for (let i = 0; i < net.length - 1; i++) {
                        const [comp1Id, pin1Id] = net[i].split('/');
                        const [comp2Id, pin2Id] = net[i+1].split('/');
                        const comp1 = components.find(c => c.id === comp1Id);
                        const comp2 = components.find(c => c.id === comp2Id);
                        if (!comp1 || !comp2) continue;

                        const pos1 = getPinPos(comp1, pin1Id);
                        const pos2 = getPinPos(comp2, pin2Id);
                        paths.push(
                          <line 
                            key={`${idx}-${i}`} 
                            x1={pos1.x} 
                            y1={pos1.y} 
                            x2={pos2.x} 
                            y2={pos2.y} 
                            stroke="#38bdf8" 
                            strokeWidth={1.8} 
                            strokeDasharray="2,2" 
                          />
                        );
                      }
                      return <g key={`net-${idx}`}>{paths}</g>;
                    })
                  ) : (
                    // Realistic Wires
                    wires.map(w => {
                      const comp1 = components.find(c => c.id === w.fromComponentId);
                      const comp2 = components.find(c => c.id === w.toComponentId);
                      if (!comp1 || !comp2) return null;

                      const pos1 = getPinPos(comp1, w.fromPinId);
                      const pos2 = getPinPos(comp2, w.toPinId);
                      const isSelected = selectedElement?.type === 'wire' && selectedElement.id === w.id;

                      return (
                        <g key={w.id}>
                          <Wire
                            id={w.id}
                            x1={pos1.x}
                            y1={pos1.y}
                            x2={pos2.x}
                            y2={pos2.y}
                            nodes={w.nodes}
                            color={w.color}
                            isSelected={isSelected}
                            style={wireStyle}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedElement({ type: 'wire', id: w.id });
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.closest('svg')?.getBoundingClientRect();
                              if (!rect) return;
                              const clickX = (e.clientX - rect.left - pan.x) / zoom;
                              const clickY = (e.clientY - rect.top - pan.y) / zoom;
                              setWires(prev => prev.map(wire => {
                                if (wire.id === w.id) {
                                  return { ...wire, nodes: [...(wire.nodes || []), { x: clickX, y: clickY }] };
                                }
                                return wire;
                              }));
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseEnter={() => setHoveredWireId(w.id)}
                            onMouseLeave={() => setHoveredWireId(null)}
                          />

                          {/* Render Wire Nodes if selected */}
                          {isSelected && w.nodes && w.nodes.map((node, nIdx) => (
                            <circle
                              key={`node-${w.id}-${nIdx}`}
                              cx={node.x}
                              cy={node.y}
                              r={5}
                              fill="#ffffff"
                              stroke="#10B981"
                              strokeWidth={2}
                              className="cursor-move hover:scale-125 transition-transform"
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                setDraggingWireNode({ wireId: w.id, nodeIndex: nIdx });
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                setWires(prev => prev.map(wire => {
                                  if (wire.id === w.id) {
                                    const newNodes = [...(wire.nodes || [])];
                                    newNodes.splice(nIdx, 1);
                                    return { ...wire, nodes: newNodes };
                                  }
                                  return wire;
                                }));
                              }}
                            />
                          ))}
                        </g>
                      );
                    })
                  )}

                  {/* Wire drawing currently being dragged */}
                  {drawingWire && (
                    <path
                      d={wireStyle === 'bezier' 
                        ? getBezierPath(drawingWire.x, drawingWire.y, mousePos.x, mousePos.y) 
                        : getManhattanPath(drawingWire.x, drawingWire.y, mousePos.x, mousePos.y)}
                      fill="none"
                      stroke={selectedWireColor === 'black' ? '#fff' : selectedWireColor}
                      strokeWidth={2.5}
                      strokeDasharray="4,4"
                    />
                  )}

                  {/* Component instances */}
                  {components.map(comp => {
                    const isSelected = selectedComponentIds.includes(comp.id) || (selectedElement?.type === 'component' && selectedElement.id === comp.id);
                    const isPrimarySelected = selectedComponentIds.length > 0 && selectedComponentIds[selectedComponentIds.length - 1] === comp.id;
                    const meta = COMPONENT_DEFINITIONS[comp.type];
                    const w = activeTab === 'schematic' ? getSchematicDimensions(comp.type).width : (meta?.width || 60);
                    const h = activeTab === 'schematic' ? getSchematicDimensions(comp.type).height : (meta?.height || 40);

                    return (
                      <g key={comp.id}>
                        {/* Selected component floating context toolbar (unrotated) */}
                        {isSelected && isPrimarySelected && !drawingWire && (
                          <foreignObject
                            x={comp.x + w / 2 - 80}
                            y={comp.y - 45}
                            width={160}
                            height={36}
                            style={{ overflow: 'visible', pointerEvents: 'auto' }}
                          >
                            <div className="flex items-center justify-center gap-1 bg-[var(--bg-panel-light)] border border-blue-500/40 rounded-lg shadow-xl px-1.5 py-1 text-[var(--text-secondary)] font-sans pointer-events-auto">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  // Rotate component
                                  pushState(components, wires);
                                  setComponents(prev => prev.map(c => 
                                    c.id === comp.id ? { ...c, rotation: (c.rotation + 90) % 360 } : c
                                  ));
                                }}
                                className="p-1 hover:bg-[var(--bg-panel-hover)] hover:text-[var(--text-main)] rounded text-[10px] flex items-center justify-center cursor-pointer transition-colors"
                                title="Rotate (R)"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 7.89M9 11l3-3 3 3m-3-3v12" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  duplicateSelectedComponent(comp.id);
                                }}
                                className="p-1 hover:bg-[var(--bg-panel-hover)] hover:text-[var(--text-main)] rounded text-[10px] flex items-center justify-center cursor-pointer transition-colors"
                                title="Duplicate (Ctrl+D)"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                                </svg>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteSelectedElement();
                                }}
                                className="p-1 hover:bg-rose-950 hover:text-rose-400 rounded text-[10px] flex items-center justify-center cursor-pointer transition-colors"
                                title="Delete (Del)"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                              <div className="w-[1px] h-3 bg-slate-800 mx-0.5"></div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedElement({ type: 'component', id: comp.id });
                                }}
                                className="p-1 hover:bg-[var(--bg-panel-hover)] hover:text-[var(--text-main)] rounded text-[10px] flex items-center justify-center cursor-pointer transition-colors"
                                title="Properties"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                              </button>
                            </div>
                          </foreignObject>
                        )}

                        <g
                          transform={`translate(${comp.x}, ${comp.y}) rotate(${comp.rotation} ${w/2} ${h/2})`}
                          onMouseDown={(e) => handleComponentDragStart(comp.id, e)}
                          onContextMenu={(e) => handleComponentContextMenu(e, comp.id)}
                          onClick={(e) => handleComponentClick(comp.id, e)}
                          className={`${
                            (comp.type === 'push_button' || comp.type === 'slide_switch' || comp.type === 'toggle_switch') && simState.isRunning
                              ? 'cursor-pointer'
                              : 'cursor-grab active:cursor-grabbing'
                          }`}
                        >
                          {/* Selected component highlight */}
                          {isSelected && (
                            <rect
                              x={-5}
                              y={-5}
                              width={w + 10}
                              height={h + 10}
                              fill="none"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              strokeDasharray="3,3"
                              rx={8}
                            />
                          )}

                          {/* Visual SVG graphics */}
                          <ComponentSVGs
                            instance={comp}
                            viewMode={activeTab === 'schematic' ? 'schematic' : 'breadboard'}
                            isPinActive={(pinId) => {
                              if (comp.type === 'relay' && pinId === 'in') {
                                return isPinActive(comp.id, 'in') || 
                                       isPinActive('rpi_1', 'GP15') || isPinActive('rpi_1', '15') ||
                                       isPinActive('rpi_1', 'GP25') || isPinActive('rpi_1', '25');
                              }
                              return isPinActive(comp.id, pinId);
                            }}
                            getPinVoltage={(pinId) => {
                              if (comp.type === 'relay' && pinId === 'in') {
                                return Math.max(
                                  getPinVoltage(comp.id, 'in'), 
                                  getPinVoltage('rpi_1', 'GP15'), getPinVoltage('rpi_1', '15'),
                                  getPinVoltage('rpi_1', 'GP25'), getPinVoltage('rpi_1', '25')
                                );
                              }
                              return getPinVoltage(comp.id, pinId);
                            }}
                            sensorValues={simState.sensorInputs}
                            hoveredPinId={hoveredPin?.componentId === comp.id ? hoveredPin.pinId : undefined}
                            showBreadboardInternals={showBreadboardInternals}
                            rawPinStates={simState.pinStates}
                          />

                          {/* Interactive Pins rendering */}
                          {activeTab !== 'schematic' && meta && meta.pins.map(pinDef => {
                            const isHovered = hoveredPin?.componentId === comp.id && hoveredPin?.pinId === pinDef.id;
                            const isDrawingFromThis = drawingWire?.fromComponentId === comp.id && drawingWire?.fromPinId === pinDef.id;
                            return (
                              <g key={pinDef.id} className="component-pin-group">
                                {/* ── Breadboard holes: always visible (they ARE the reference grid) ── */}
                                {comp.type === 'breadboard' ? (
                                  <g style={{ pointerEvents: 'none' }}>
                                    <circle cx={pinDef.x} cy={pinDef.y} r={3.5} fill="#E5E7EB" />
                                    <circle cx={pinDef.x} cy={pinDef.y} r={3} fill="#374151" />
                                    <circle cx={pinDef.x} cy={pinDef.y} r={2.5} fill="#1F2937" />
                                    {isHovered && <circle cx={pinDef.x} cy={pinDef.y} r={5} fill="none" stroke="#ef4444" strokeWidth={1.5} className="pulse-glow" />}
                                  </g>
                                ) : comp.type === 'arduino' ? (
                                  // Arduino header pins: hidden by default, subtle ring on hover
                                  <g style={{ pointerEvents: 'none' }}>
                                    <circle
                                      cx={pinDef.x} cy={pinDef.y} r={3.5}
                                      fill="#27272a"
                                      opacity={isHovered || isDrawingFromThis ? 1 : 0}
                                    />
                                    <circle
                                      cx={pinDef.x} cy={pinDef.y} r={1.5}
                                      fill="#000000"
                                      opacity={isHovered || isDrawingFromThis ? 1 : 0}
                                    />
                                    {/* Hover ring — subtle outline to locate pin */}
                                    {(isHovered || isDrawingFromThis) && (
                                      <circle cx={pinDef.x} cy={pinDef.y} r={5} fill="none" stroke="#ef4444" strokeWidth={1.5} className="pulse-glow" />
                                    )}
                                  </g>
                                ) : (
                                  // Generic components (LED, Resistor, DHT11, etc.)
                                  // Terminal dots are HIDDEN by default; appear only on hover/active wire draw
                                  <g style={{ pointerEvents: 'none' }}>
                                    <circle
                                      cx={pinDef.x} cy={pinDef.y} r={3}
                                      fill="#d4d4d8" stroke="#71717a" strokeWidth={1}
                                      opacity={isHovered || isDrawingFromThis ? 0.9 : 0}
                                    />
                                    <circle
                                      cx={pinDef.x} cy={pinDef.y} r={1.5}
                                      fill="#f4f4f5"
                                      opacity={isHovered || isDrawingFromThis ? 1 : 0}
                                    />
                                    {/* Hover ring: subtle gray outline to help place wires */}
                                    {(isHovered || isDrawingFromThis) && (
                                      <circle cx={pinDef.x} cy={pinDef.y} r={6} fill="none" stroke="#ef4444" strokeWidth={1.5} className="pulse-glow" />
                                    )}
                                  </g>
                                )}

                                {/* Invisible 12px hit-test circle — always active for wire drawing */}
                                <circle
                                  cx={pinDef.x}
                                  cy={pinDef.y}
                                  r={12}
                                  fill="transparent"
                                  className="cursor-pointer"
                                  onMouseEnter={() => setHoveredPin({ componentId: comp.id, pinId: pinDef.id })}
                                  onMouseLeave={() => setHoveredPin(null)}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => handlePinClick(comp, pinDef.id, e)}
                                >
                                  <title>{`${comp.name} Pin: ${pinDef.name} (${pinDef.type})`}</title>
                                </circle>
                              </g>
                            );
                          })}
                        </g>
                      </g>
                    );
                  })}

                  {/* Visual Drag Selection Bounding Box */}
                  {selectionRect && (
                    <rect
                      x={Math.min(selectionRect.x1, selectionRect.x2)}
                      y={Math.min(selectionRect.y1, selectionRect.y2)}
                      width={Math.abs(selectionRect.x2 - selectionRect.x1)}
                      height={Math.abs(selectionRect.y2 - selectionRect.y1)}
                      fill="rgba(59, 130, 246, 0.15)"
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      strokeDasharray="4,4"
                      rx={2}
                    />
                  )}

                  {/* ─── Wire Hover Overlay Layer (renders on TOP of breadboard) ─── */}
                  {(() => {
                    if (!hoveredWireId) return null;
                    const hw = wires.find(w => w.id === hoveredWireId);
                    if (!hw) return null;
                    const hc1 = components.find(c => c.id === hw.fromComponentId);
                    const hc2 = components.find(c => c.id === hw.toComponentId);
                    if (!hc1 || !hc2) return null;
                    const hp1 = getPinPos(hc1, hw.fromPinId);
                    const hp2 = getPinPos(hc2, hw.toPinId);
                    const hPathD = wireStyle === 'bezier'
                      ? getBezierPath(hp1.x, hp1.y, hp2.x, hp2.y, hw.nodes)
                      : getManhattanPath(hp1.x, hp1.y, hp2.x, hp2.y, hw.nodes);
                    const wireColor = hw.color === 'black' ? '#94a3b8' : hw.color;

                    // Flashlight/spotlight: find the midpoint of the wire path for the flashlight center
                    const midX = (hp1.x + hp2.x) / 2;
                    const midY = (hp1.y + hp2.y) / 2;

                    return (
                      <g style={{ pointerEvents: 'none' }}>
                        {/* Flashlight effect: semi-transparent radial overlay on breadboard region */}
                        {[hc1, hc2].map((hc, idx) => {
                          if (hc.type !== 'breadboard') return null;
                          const flashPt = idx === 0 ? hp1 : hp2;
                          const flashR = 30;
                          return (
                            <g key={`flash-${idx}`}>
                              <defs>
                                <radialGradient id={`flashlight-${idx}`} cx="50%" cy="50%" r="50%">
                                  <stop offset="0%" stopColor="rgba(0,0,0,0)" />
                                  <stop offset="70%" stopColor="rgba(0,0,0,0)" />
                                  <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
                                </radialGradient>
                              </defs>
                              <ellipse
                                cx={flashPt.x}
                                cy={flashPt.y}
                                rx={flashR}
                                ry={flashR}
                                fill={`url(#flashlight-${idx})`}
                              />
                            </g>
                          );
                        })}

                        {/* Outer bloom glow halo */}
                        <path
                          d={hPathD}
                          fill="none"
                          stroke={wireColor}
                          strokeWidth={18}
                          opacity={0.15}
                          filter="url(#wire-glow)"
                        />
                        {/* Mid glow */}
                        <path
                          d={hPathD}
                          fill="none"
                          stroke={wireColor}
                          strokeWidth={9}
                          opacity={0.35}
                          filter="url(#wire-glow)"
                        />
                        {/* Sharp wire on top */}
                        <path
                          d={hPathD}
                          fill="none"
                          stroke={wireColor}
                          strokeWidth={3}
                          opacity={1}
                          strokeLinecap="round"
                        />

                        {/* Lit-up circles for the source pin */}
                        <circle cx={hp1.x} cy={hp1.y} r={12} fill={wireColor} opacity={0.2} filter="url(#pin-glow)" />
                        <circle cx={hp1.x} cy={hp1.y} r={7} fill="none" stroke={wireColor} strokeWidth={2.5} opacity={0.9} />
                        <circle cx={hp1.x} cy={hp1.y} r={3} fill={wireColor} opacity={1} />

                        {/* Lit-up circles for the dest pin */}
                        <circle cx={hp2.x} cy={hp2.y} r={12} fill={wireColor} opacity={0.2} filter="url(#pin-glow)" />
                        <circle cx={hp2.x} cy={hp2.y} r={7} fill="none" stroke={wireColor} strokeWidth={2.5} opacity={0.9} />
                        <circle cx={hp2.x} cy={hp2.y} r={3} fill={wireColor} opacity={1} />

                        {/* Tooltip label showing the wire endpoints */}
                        <g transform={`translate(${midX}, ${midY - 18})`}>
                          <rect x={-50} y={-11} width={100} height={16} rx={4} fill="rgba(0,0,0,0.75)" />
                          <text textAnchor="middle" y={1} fontSize={9} fill={wireColor} fontFamily="monospace" fontWeight="bold">
                            {hw.fromPinId} → {hw.toPinId}
                          </text>
                        </g>
                      </g>
                    );
                  })()}

                </g>
              </svg>

              {/* Floating Context Menu */}
              {contextMenu && (
                <div
                  style={{ top: contextMenu.y, left: contextMenu.x }}
                  className="fixed bg-[var(--bg-panel)] border border-[var(--border-main)] rounded-xl shadow-2xl z-50 py-1.5 text-xs text-[var(--text-secondary)] w-36 flex flex-col font-sans"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => { rotateSelectedComponent(); setContextMenu(null); }}
                    className="px-3 py-1.5 hover:bg-[var(--bg-panel-hover)] text-left cursor-pointer"
                  >
                    Rotate (90°)
                  </button>
                  <button
                    onClick={() => { duplicateSelectedComponent(contextMenu.componentId); setContextMenu(null); }}
                    className="px-3 py-1.5 hover:bg-[var(--bg-panel-hover)] text-left cursor-pointer"
                  >
                    Duplicate
                  </button>
                  <button
                    onClick={() => { deleteSelectedElement(); setContextMenu(null); }}
                    className="px-3 py-1.5 hover:bg-[var(--bg-panel-hover)] text-left cursor-pointer text-rose-400 hover:text-[var(--text-main)]"
                  >
                    Delete
                  </button>
                  <hr className="border-[var(--border-main)] my-1" />
                  <button
                    onClick={() => { setSelectedElement({ type: 'component', id: contextMenu.componentId }); setContextMenu(null); }}
                    className="px-3 py-1.5 hover:bg-[var(--bg-panel-hover)] text-left cursor-pointer"
                  >
                    Properties
                  </button>
                </div>
              )}

              {/* Drawing Wire Tooltip */}
              {drawingWire && (
                <div 
                  style={{ left: mousePos.x * zoom + pan.x + 20, top: mousePos.y * zoom + pan.y + 20 }}
                  className="absolute bg-slate-950/90 border border-[var(--border-main)] text-[10px] text-slate-800 px-3 py-1.5 rounded-xl shadow-2xl pointer-events-none z-40 font-semibold"
                >
                  Click another pin to connect, or press Escape to cancel
                </div>
              )}

              {/* Flash Messages */}
              {flashMessage && (
                <div 
                  style={{ left: flashMessage.x - 40, top: flashMessage.y - 40 }}
                  className={`fixed px-3 py-1.5 rounded-xl font-bold shadow-2xl z-50 text-xs text-[var(--text-main)] pointer-events-none transform -translate-y-4 animate-bounce ${
                    flashMessage.type === 'success' ? 'bg-emerald-500 border border-emerald-400' : 'bg-rose-500 border border-rose-400'
                  }`}
                >
                  {flashMessage.text}
                </div>
              )}

              {/* Floating Component Configuration Popover (TinkerCad Style) */}
              {selectedElement?.type === 'component' && (() => {
                const comp = components.find(c => c.id === selectedElement.id);
                if (!comp) return null;
                const meta = COMPONENT_DEFINITIONS[comp.type];
                if (!meta) return null;

                // Center of component
                const cx = comp.x + meta.width / 2;
                const cy = comp.y; // top edge of component

                const screenX = cx * zoom + pan.x;
                const screenY = cy * zoom + pan.y;

                const popoverWidth = 260;
                const popoverHeight = 160; // approximate height
                let left = screenX - popoverWidth / 2;
                let top = screenY - popoverHeight - 12;

                if (top < 10) {
                  top = screenY + meta.height * zoom + 12;
                }

                // Keep left bound at least 15px, and right bound inside the viewport
                left = Math.max(15, left);

                return (
                  <div 
                    style={{ left: `${left}px`, top: `${top}px` }}
                    className="absolute z-30 w-64 bg-[var(--bg-panel-light)] border border-[var(--border-main)] backdrop-blur-md rounded-2xl p-4 shadow-2xl transition-all duration-150 font-sans"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-between items-center pb-2 border-b border-[var(--border-main)] mb-3">
                      <span className="font-bold text-[#FF6B35] uppercase text-[10px] tracking-wider">{meta.name}</span>
                      <button 
                        onClick={() => setSelectedElement(null)}
                        className="text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer text-xs"
                      >
                        ✕
                      </button>
                    </div>

                    <div className="space-y-3 text-xs">
                      {/* Label Name */}
                      <div className="flex flex-col space-y-1">
                        <label className="text-[9px] font-bold text-[var(--text-muted)] uppercase">Label Name</label>
                        <input 
                          type="text" 
                          value={comp.name} 
                          onChange={(e) => {
                            const val = e.target.value;
                            setComponents(prev => prev.map(c => c.id === comp.id ? {
                              ...c,
                              name: val,
                              properties: { ...c.properties, label: val }
                            } : c));
                          }}
                          className="bg-slate-950 border border-[var(--border-main)] rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                        />
                      </div>

                      {/* Resistor properties */}
                      {comp.type === 'resistor' && (
                        <div className="flex flex-col space-y-1">
                          <label className="text-[9px] font-bold text-[var(--text-muted)] uppercase">Resistance (ohms)</label>
                          <select
                            value={comp.properties.resistance || 220}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setComponents(prev => prev.map(c => c.id === comp.id ? {
                                ...c,
                                properties: { ...c.properties, resistance: val }
                              } : c));
                            }}
                            className="bg-slate-950 border border-[var(--border-main)] rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                          >
                            <option value="220">220 Ω (Red, Red, Brown)</option>
                            <option value="1000">1 kΩ (Brown, Black, Red)</option>
                            <option value="4700">4.7 kΩ (Yellow, Violet, Red)</option>
                            <option value="10000">10 kΩ (Brown, Black, Orange)</option>
                            <option value="100000">100 kΩ (Brown, Black, Yellow)</option>
                          </select>
                        </div>
                      )}

                      {/* LED Color selector */}
                      {comp.type === 'led' && (
                        <div className="flex flex-col space-y-1">
                          <label className="text-[9px] font-bold text-[var(--text-muted)] uppercase">LED Color</label>
                          <select
                            value={comp.properties.color || 'red'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setComponents(prev => prev.map(c => c.id === comp.id ? {
                                ...c,
                                properties: { ...c.properties, color: val }
                              } : c));
                            }}
                            className="bg-slate-950 border border-[var(--border-main)] rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                          >
                            <option value="red">Red</option>
                            <option value="green">Green</option>
                            <option value="blue">Blue</option>
                            <option value="yellow">Yellow</option>
                            <option value="white">White</option>
                          </select>
                        </div>
                      )}

                      {/* Power Supply Voltage */}
                      {comp.type === 'power_supply_5v' && (
                        <div className="flex flex-col space-y-1">
                          <label className="text-[9px] font-bold text-[var(--text-muted)] uppercase">Voltage (V)</label>
                          <input 
                            type="number"
                            step="0.1"
                            min="0"
                            max="30"
                            value={comp.properties.voltage !== undefined ? comp.properties.voltage : 5.0}
                            onChange={(e) => {
                              const val = Number(e.target.value);
                              setComponents(prev => prev.map(c => c.id === comp.id ? {
                                ...c,
                                properties: { ...c.properties, voltage: val }
                              } : c));
                            }}
                            className="bg-slate-950 border border-[var(--border-main)] rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                          />
                        </div>
                      )}

                      {/* Capacitor Capacitance */}
                      {comp.type === 'capacitor' && (
                        <div className="flex flex-col space-y-1">
                          <label className="text-[9px] font-bold text-[var(--text-muted)] uppercase">Capacitance</label>
                          <input 
                            type="text"
                            value={comp.properties.capacitance || '100nF'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setComponents(prev => prev.map(c => c.id === comp.id ? {
                                ...c,
                                properties: { ...c.properties, capacitance: val }
                              } : c));
                            }}
                            className="bg-slate-950 border border-[var(--border-main)] rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                          />
                        </div>
                      )}

                      {/* LCD Text input */}
                      {comp.type === 'lcd' && (
                        <div className="flex flex-col space-y-1">
                          <label className="text-[9px] font-bold text-[var(--text-muted)] uppercase">LCD Text</label>
                          <input 
                            type="text"
                            value={comp.properties.text || 'DSULab LCD'}
                            onChange={(e) => {
                              const val = e.target.value;
                              setComponents(prev => prev.map(c => c.id === comp.id ? {
                                ...c,
                                properties: { ...c.properties, text: val }
                              } : c));
                            }}
                            className="bg-slate-950 border border-[var(--border-main)] rounded-xl px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </main>

        {/* RIGHT PANEL — Code & Properties (tabbed, ~300px wide) */}
        {showCode && (
          <aside className="w-[340px] border-l border-[var(--border-main)] bg-[var(--bg-panel)] backdrop-blur-md flex flex-col overflow-hidden shrink-0">
            
            {/* Tab navigation headers */}
            <div className="flex bg-[var(--bg-panel-light)] border-b border-[var(--border-main)] shrink-0">
              {(['code', 'sensors', 'serial'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setRightPanelTab(tab)}
                  className={`flex-1 py-2.5 text-[9px] font-extrabold uppercase tracking-wider transition-all border-b-2 cursor-pointer ${
                    rightPanelTab === tab
                      ? 'border-[#FF6B35] text-[#FF6B35] bg-[var(--bg-panel-light)]'
                      : 'border-transparent text-[var(--text-muted)] hover:text-slate-800'
                  }`}
                >
                  {tab === 'code' ? '💻 Code' : tab === 'sensors' ? '🎛️ Controls' : '📟 Serial'}
                </button>
              ))}
            </div>

            {/* Tab Content Display */}
            <div className="flex-1 overflow-y-auto flex flex-col min-h-0">
              
              {/* Tab 1: Code Editor */}
              {rightPanelTab === 'code' && (
                <div className="flex-1 flex flex-col min-h-0">
                  {/* Tool bar & selector */}
                  <div className="p-3 bg-slate-950/60 border-b border-[var(--border-main)] flex items-center justify-between shrink-0 text-xs">
                    <select 
                      value={languageMode}
                      onChange={(e) => setLanguageMode(e.target.value as 'Arduino C++' | 'MicroPython')}
                      className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] text-[var(--text-secondary)] text-[10px] rounded-lg px-2 py-1 focus:outline-none focus:border-[#FF6B35] font-semibold">
                      <option>Arduino C++</option>
                      <option>MicroPython</option>
                      <option>Block-based</option>
                    </select>

                    <div className="flex items-center space-x-1.5">
                      <button 
                        onClick={() => {
                          setSimState(prev => ({ 
                            ...prev, 
                            serialOutput: [...prev.serialOutput, '[System: Uploading code... Successful!]'] 
                          }));
                        }} 
                        className="px-2.5 py-1 bg-[#FF6B35]/15 border border-[#FF6B35]/25 text-[#FF6B35] hover:bg-[#FF6B35] hover:text-[var(--text-main)] rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                      >
                        Upload Code
                      </button>
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(codeContent);
                          setSimState(prev => ({ 
                            ...prev, 
                            serialOutput: [...prev.serialOutput, '[System: Code copied to clipboard]'] 
                          }));
                        }} 
                        className="px-2 py-1 bg-[var(--bg-panel-light)] hover:bg-[var(--bg-panel-hover)] border border-[var(--border-main)] text-[var(--text-muted)] hover:text-slate-800 rounded-lg text-[10px] font-bold cursor-pointer"
                        title="Copy Code"
                      >
                        Copy
                      </button>
                    </div>
                  </div>

                  {/* Monaco Editor frame */}
                  <div className="flex-1 min-h-[250px]">
                    <Editor 
                      height="100%" 
                      language={languageMode === 'Arduino C++' ? 'cpp' : 'python'} 
                      theme="vs-dark" 
                      value={codeContent} 
                      onChange={(val) => setCodeContent(val || '')} 
                      onMount={handleEditorDidMount} 
                      options={{ 
                        lineNumbers: 'on', 
                        glyphMargin: true, 
                        minimap: { enabled: false }, 
                        fontSize: 12, 
                        scrollBeyondLastLine: false,
                        padding: { top: 10 }
                      }} 
                    />
                  </div>
                </div>
              )}

              {/* Tab 2: Sensor Controls */}
              {rightPanelTab === 'sensors' && (
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[var(--bg-panel-light)]">
                  <div className="text-[10px] font-extrabold text-[var(--text-muted)] uppercase tracking-widest mb-2 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FF6B35] inline-block"></span>
                    Sensor & Input Controls
                  </div>

                  {/* Temperature Sensor */}
                  {[1, 7, 9, 10, 12].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">🌡️ Temperature (DHT11/Probe)</span>
                        <span className="text-[10px] font-mono text-[#FF6B35] font-bold">{simState.sensorInputs.temperature}°C</span>
                      </div>
                      <input
                        type="range" min={-10} max={60} step={1}
                        value={Number(simState.sensorInputs.temperature)}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, temperature: val } }));
                          setComponents(prev => prev.map(c => c.type === 'dht11' ? { ...c, properties: { ...c.properties, temperature: val } } : c));
                        }}
                        className="w-full accent-[#FF6B35] cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--text-muted)]">
                        <span>-10°C</span><span>25°C</span><span>60°C</span>
                      </div>
                    </div>
                  )}

                  {/* Humidity Sensor */}
                  {[1, 7, 9].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">💧 Humidity (DHT11)</span>
                        <span className="text-[10px] font-mono text-blue-400 font-bold">{simState.sensorInputs.humidity}%</span>
                      </div>
                      <input
                        type="range" min={0} max={100} step={1}
                        value={Number(simState.sensorInputs.humidity)}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, humidity: val } }));
                          setComponents(prev => prev.map(c => c.type === 'dht11' ? { ...c, properties: { ...c.properties, humidity: val } } : c));
                        }}
                        className="w-full accent-blue-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--text-muted)]">
                        <span>0%</span><span>50%</span><span>100%</span>
                      </div>
                    </div>
                  )}

                  {/* Distance Sensor */}
                  {[2, 5, 11].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">📡 HC-SR04 Distance</span>
                        <span className="text-[10px] font-mono text-yellow-400 font-bold">{simState.sensorInputs.distance} cm</span>
                      </div>
                      <input
                        type="range" min={2} max={400} step={1}
                        value={Number(simState.sensorInputs.distance)}
                        onChange={(e) => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, distance: Number(e.target.value) } }))}
                        className="w-full accent-yellow-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--text-muted)]">
                        <span>2 cm</span><span>200 cm</span><span>400 cm</span>
                      </div>
                    </div>
                  )}

                  {/* PIR Motion Sensor */}
                  {[2].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">👁️ PIR Motion Sensor</span>
                        <button
                          onClick={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, motion: !prev.sensorInputs.motion } }))}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                            simState.sensorInputs.motion ? 'bg-emerald-500' : 'bg-slate-700'
                          }`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--bg-panel)] shadow transition-transform ${
                            simState.sensorInputs.motion ? 'translate-x-4' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>
                      <p className="text-[9px] text-[var(--text-muted)] mt-1.5">
                        {simState.sensorInputs.motion ? '🟢 Motion Detected!' : '⚫ No Motion'}
                      </p>
                    </div>
                  )}

                  {/* Motion Trigger Button */}
                  {[6].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">🏃 Motion Trigger</span>
                        <button
                          onMouseDown={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, motion: true } }))}
                          onMouseUp={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, motion: false } }))}
                          onMouseLeave={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, motion: false } }))}
                          className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer select-none ${
                            simState.sensorInputs.motion
                              ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg'
                              : 'bg-slate-800 border-slate-700 text-[var(--text-muted)] hover:border-slate-600'
                          }`}
                        >
                          {simState.sensorInputs.motion ? '● MOTION DETECTED' : '○ Hold to Trigger'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Push Button Input */}
                  {[3, 4, 7].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">🔘 Button Input</span>
                        <button
                          onMouseDown={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, buttonInput: true } }))}
                          onMouseUp={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, buttonInput: false } }))}
                          onMouseLeave={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, buttonInput: false } }))}
                          className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-all cursor-pointer select-none ${
                            simState.sensorInputs.buttonInput
                              ? 'bg-[#FF6B35] border-[#FF6B35] text-[var(--text-main)] shadow-lg'
                              : 'bg-slate-800 border-slate-700 text-[var(--text-muted)] hover:border-slate-600'
                          }`}
                        >
                          {simState.sensorInputs.buttonInput ? '● PRESSED' : '○ Hold to Press'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Flow Rate Sensor */}
                  {[4].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">🌊 YF-S201 Flow Rate</span>
                        <span className="text-[10px] font-mono text-cyan-400 font-bold">{simState.sensorInputs.waterFlowLPM} L/min</span>
                      </div>
                      <input
                        type="range" min={0} max={30} step={0.5}
                        value={Number(simState.sensorInputs.waterFlowLPM)}
                        onChange={(e) => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, waterFlowLPM: Number(e.target.value) } }))}
                        className="w-full accent-cyan-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--text-muted)]">
                        <span>0 L/min</span><span>15 L/min</span><span>30 L/min</span>
                      </div>
                    </div>
                  )}

                  {/* Flask Toggle (Experiment 8 - Flask valve) */}
                  {[8].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">🫙 Flask Valve</span>
                        <button
                          onClick={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, flaskToggleInput: !prev.sensorInputs.flaskToggleInput } }))}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors cursor-pointer ${
                            simState.sensorInputs.flaskToggleInput ? 'bg-cyan-500' : 'bg-slate-700'
                          }`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--bg-panel)] shadow transition-transform ${
                            simState.sensorInputs.flaskToggleInput ? 'translate-x-4' : 'translate-x-1'
                          }`} />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Heart Rate / BPM */}
                  {[12].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">❤️ Heart Rate (BPM)</span>
                        <span className="text-[10px] font-mono text-rose-400 font-bold">{simState.sensorInputs.bpmInput} BPM</span>
                      </div>
                      <input
                        type="range" min={30} max={200} step={1}
                        value={Number(simState.sensorInputs.bpmInput)}
                        onChange={(e) => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, bpmInput: Number(e.target.value) } }))}
                        className="w-full accent-rose-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--text-muted)]">
                        <span>30</span><span>100</span><span>200</span>
                      </div>
                    </div>
                  )}

                  {/* Temperature Probe (DS18B20) */}
                  {[8, 10].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">🌡️ DS18B20 Temp Probe</span>
                        <span className="text-[10px] font-mono text-orange-400 font-bold">{simState.sensorInputs.tempProbe}°C</span>
                      </div>
                      <input
                        type="range" min={-10} max={85} step={0.5}
                        value={Number(simState.sensorInputs.tempProbe)}
                        onChange={(e) => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, tempProbe: Number(e.target.value) } }))}
                        className="w-full accent-orange-400 cursor-pointer"
                      />
                      <div className="flex justify-between text-[9px] text-[var(--text-muted)]">
                        <span>-10°C</span><span>37°C</span><span>85°C</span>
                      </div>
                    </div>
                  )}

                  {/* Universal debug info */}
                  <div className="bg-slate-950/60 border border-[var(--border-main)] rounded-xl p-3">
                    <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Live Pin States</div>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {Object.entries(simState.pinStates).length === 0 ? (
                        <p className="text-[10px] text-[var(--text-muted)] italic">No active pin states. Start simulation to see pin activity.</p>
                      ) : (
                        Object.entries(simState.pinStates).map(([pin, val]) => (
                          <div key={pin} className="flex justify-between items-center">
                            <span className="text-[10px] font-mono text-[var(--text-muted)]">{pin}</span>
                            {typeof val === 'number' && (val > 1 || String(pin).includes('A')) ? (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded font-mono bg-indigo-900/60 text-indigo-400">
                                {val} (10-bit)
                              </span>
                            ) : (
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded font-mono ${
                                val === 1 || val === true || String(val) === 'HIGH' 
                                  ? 'bg-emerald-900/60 text-emerald-400' 
                                  : 'bg-slate-800 text-[var(--text-muted)]'
                              }`}>
                                {val === 1 || val === true ? 'HIGH' : 'LOW'}
                              </span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Quick presets */}
                  {[1].includes(experiment.id) && (
                    <div className="bg-[var(--bg-panel-light)] border border-[var(--border-main)] rounded-xl p-3">
                      <div className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">Quick Presets</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          onClick={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, temperature: 24, humidity: 45 } }))}
                          className="px-2 py-1.5 bg-blue-950/40 border border-blue-900/40 text-blue-400 hover:bg-blue-900/30 rounded-lg text-[9px] font-bold cursor-pointer transition-all"
                        >
                          🌤️ Normal (24°C)
                        </button>
                        <button
                          onClick={() => setSimState(prev => ({ ...prev, sensorInputs: { ...prev.sensorInputs, temperature: 35, humidity: 80 } }))}
                          className="px-2 py-1.5 bg-rose-950/40 border border-rose-900/40 text-rose-400 hover:bg-rose-900/30 rounded-lg text-[9px] font-bold cursor-pointer transition-all"
                        >
                          🔥 High Temp (35°C)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Tab 3: Serial Monitor console log */}
              {rightPanelTab === 'serial' && (
                <div className="flex-1 flex flex-col min-h-0 bg-slate-950">
                  <div className="p-2.5 bg-[var(--bg-panel-light)] border-b border-[var(--border-main)] flex justify-between items-center text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] shrink-0">
                    <span>Logs Console Output</span>
                    <button onClick={() => setSimState(prev => ({ ...prev, serialOutput: [] }))} className="text-[10px] hover:text-slate-800 transition-colors cursor-pointer uppercase font-extrabold">Clear</button>
                  </div>
                  
                  {/* Console Logs */}
                  <div className="flex-1 p-3 overflow-y-auto font-mono text-[11px] text-emerald-400 space-y-1 selection:bg-slate-800">
                    {simState.serialOutput.map((log, idx) => (
                      <div key={idx} className="leading-relaxed whitespace-pre-wrap">{log}</div>
                    ))}
                  </div>

                  {/* Serial input sender */}
                  <div className="p-2 bg-[var(--bg-panel-light)] border-t border-[var(--border-main)] shrink-0">
                    <form 
                      onSubmit={(e) => {
                        e.preventDefault();
                        const inputVal = (e.currentTarget.elements.namedItem('serialInput') as HTMLInputElement).value;
                        if (!inputVal.trim()) return;
                        setSimState(prev => ({
                          ...prev,
                          serialOutput: [...prev.serialOutput, `>> ${inputVal}`]
                        }));
                        e.currentTarget.reset();
                      }}
                      className="flex space-x-1.5"
                    >
                      <input 
                        type="text" 
                        name="serialInput"
                        placeholder="Send serial input to board..." 
                        className="flex-1 bg-slate-950 border border-[var(--border-main)] rounded-lg px-2.5 py-1.5 text-[10px] text-slate-800 focus:outline-none focus:border-[#FF6B35]"
                      />
                      <button type="submit" className="px-3 py-1 bg-[#FF6B35] hover:bg-[#ff804d] text-[var(--text-main)] text-[10px] font-bold rounded-lg transition-all cursor-pointer">
                        Send
                      </button>
                    </form>
                  </div>
                </div>
              )}

            </div>
          </aside>
        )}

      </div>

      {/* 3. Bottom Bar status status strip */}
      <footer className="bg-slate-950 border-t border-[var(--border-main)] px-4 py-2 flex items-center justify-between text-[11px] text-[var(--text-muted)] shrink-0">
        
        {/* Simulation status */}
        <div className="flex items-center space-x-2">
          <div className={`w-2.5 h-2.5 rounded-full ${simState.isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-700'}`} />
          <span className="font-bold text-[var(--text-muted)]">{simState.isRunning ? 'Simulation Running...' : 'Idle'}</span>
        </div>

        {/* FPS counter and component count */}
        <div className="flex items-center space-x-4">
          <span className="font-mono">FPS: {simState.isRunning ? (59.6 + Math.random() * 0.5).toFixed(1) : '60.0'}</span>
          <span>Components: <strong className="text-[var(--text-muted)] font-mono">{components.length}</strong></span>
        </div>

        {/* Keyboard shortcuts hint button */}
        <div className="relative">
          <button 
            onClick={() => {
              alert(
                "DSULab Keyboard Shortcuts:\n\n" +
                "- Space + Drag: Pan Canvas\n" +
                "- Scroll Wheel: Zoom Canvas\n" +
                "- Click pin -> Click pin: Draw Wire\n" +
                "- Right-click component: Opens actions menu\n" +
                "- Left-click component: Select & open properties"
              );
            }}
            className="px-2.5 py-1 bg-[var(--bg-panel-light)] hover:bg-[var(--bg-panel-hover)] border border-[var(--border-main)] hover:text-[var(--text-secondary)] rounded-lg font-bold text-[9px] uppercase tracking-wider transition-all cursor-pointer"
          >
            Keyboard Shortcuts
          </button>
        </div>

      </footer>

    </div>
  );
};
