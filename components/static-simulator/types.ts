export interface ComponentPropertySchema {
  color?: string;
  resistance?: number;
  label?: string;
  [key: string]: any;
}

export interface ComponentInstance {
  id: string;
  type: string; // 'arduino' | 'raspberry_pi' | 'breadboard' | 'led' | 'resistor' | etc.
  name: string;
  x: number;
  y: number;
  rotation: number; // 0, 90, 180, 270
  properties: ComponentPropertySchema;
  parentId?: string; // ID of the breadboard this component is snapped into
  offsetX?: number; // Relative X offset from parent
  offsetY?: number; // Relative Y offset from parent
}

export interface PinDefinition {
  id: string; // unique pin ID within component (e.g., '5V', 'D13', 'anode')
  name: string; // human-readable label
  x: number; // relative coordinate to component center/top-left
  y: number;
  type: 'power' | 'gnd' | 'digital' | 'analog' | 'signal' | 'passive';
}

export interface WireConnection {
  id: string;
  fromComponentId: string;
  fromPinId: string;
  toComponentId: string;
  toPinId: string;
  color: string; // red, black, green, yellow, blue, etc.
  nodes?: {x: number, y: number}[];
}

export interface Experiment {
  id: number;
  title: string;
  description: string;
  category?: 'arduino' | 'raspberry-pi';
  platform: 'Arduino' | 'Raspberry Pi';
  keyComponents: string[];
  defaultCode: string;
  defaultComponents: ComponentInstance[];
  defaultWires: WireConnection[];
  tips?: string[];
  buildSteps?: string[];
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
}

export interface SimulationState {
  isRunning: boolean;
  isPaused: boolean;
  currentLine: number | null;
  breakpoints: Set<number>;
  variables: Record<string, any>;
  pinStates: Record<string, number | boolean>; // Maps 'componentId/pinId' -> value (voltage or logic state)
  sensorInputs: Record<string, number | boolean>; // Slider and toggle inputs for sensors
  serialOutput: string[];
}
