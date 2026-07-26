import { COMPONENT_DEFINITIONS } from './componentDefinitions';

export const getSchematicDimensions = (type: string): { width: number; height: number } => {
  switch (type) {
    case 'arduino': return { width: 140, height: 180 };
    case 'raspberry_pi': return { width: 140, height: 180 };
    case 'breadboard': return { width: 0, height: 0 }; // hidden in schematic
    case 'led': return { width: 40, height: 40 };
    case 'resistor': return { width: 60, height: 20 };
    case 'push_button': return { width: 40, height: 40 };
    case 'buzzer': return { width: 50, height: 50 };
    case 'dht11': return { width: 80, height: 60 };
    case 'hc_sr04': return { width: 80, height: 60 };
    case 'pir_sensor': return { width: 80, height: 60 };
    case 'ds18b20': return { width: 80, height: 60 };
    case 'yf_s201': return { width: 80, height: 60 };
    case 'relay': return { width: 80, height: 65 };
    case 'l298n': return { width: 100, height: 100 };
    case 'dc_motor': return { width: 60, height: 60 };
    case 'stepper_motor': return { width: 60, height: 60 };
    case 'pulse_sensor': return { width: 80, height: 60 };
    case 'lm35': return { width: 80, height: 60 };
    case 'potentiometer': return { width: 60, height: 40 };
    case 'capacitor': return { width: 40, height: 40 };
    case 'slide_switch': return { width: 50, height: 40 };
    case 'battery_9v': return { width: 60, height: 50 };
    case 'battery_coin': return { width: 50, height: 50 };
    case 'battery_1_5v': return { width: 40, height: 60 };
    case 'microbit': return { width: 110, height: 100 };
    case 'vibration_motor': return { width: 50, height: 50 };
    case 'servo': return { width: 60, height: 60 };
    case 'gear_motor': return { width: 60, height: 70 };
    case 'npn_transistor': return { width: 50, height: 50 };
    case 'led_rgb': return { width: 60, height: 50 };
    case 'diode': return { width: 60, height: 30 };
    case 'photoresistor': return { width: 60, height: 30 };
    case 'soil_moisture': return { width: 70, height: 60 };
    default: return { width: 80, height: 60 };
  }
};

export const getSchematicPinCoords = (type: string, pinId: string): { x: number; y: number } => {
  if (type === 'led') {
    if (pinId === 'anode') return { x: 5, y: 20 };
    if (pinId === 'cathode') return { x: 35, y: 20 };
  }
  if (type === 'resistor') {
    if (pinId === 'pin1') return { x: 5, y: 10 };
    if (pinId === 'pin2') return { x: 55, y: 10 };
  }
  if (type === 'push_button') {
    if (pinId.includes('1a') || pinId.includes('2a')) return { x: 5, y: 20 };
    if (pinId.includes('1b') || pinId.includes('2b')) return { x: 35, y: 20 };
  }
  if (type === 'buzzer') {
    if (pinId === 'positive') return { x: 15, y: 40 };
    if (pinId === 'negative') return { x: 35, y: 40 };
  }
  if (type === 'potentiometer') {
    if (pinId === 'pin1') return { x: 5, y: 20 };
    if (pinId === 'wiper') return { x: 30, y: 35 };
    if (pinId === 'pin2') return { x: 55, y: 20 };
  }
  if (type === 'capacitor') {
    if (pinId === 'pin1') return { x: 10, y: 20 };
    if (pinId === 'pin2') return { x: 30, y: 20 };
  }
  if (type === 'slide_switch') {
    if (pinId === 'pin1') return { x: 5, y: 15 };
    if (pinId === 'common') return { x: 25, y: 25 };
    if (pinId === 'pin2') return { x: 45, y: 15 };
  }
  if (type === 'battery_9v') {
    if (pinId === 'positive') return { x: 15, y: 10 };
    if (pinId === 'negative') return { x: 45, y: 10 };
  }
  if (type === 'battery_coin') {
    if (pinId === 'positive') return { x: 15, y: 10 };
    if (pinId === 'negative') return { x: 35, y: 10 };
  }
  if (type === 'battery_1_5v') {
    if (pinId === 'positive') return { x: 20, y: 10 };
    if (pinId === 'negative') return { x: 20, y: 50 };
  }
  if (type === 'microbit') {
    if (pinId === 'pin0') return { x: 15, y: 90 };
    if (pinId === 'pin1') return { x: 35, y: 90 };
    if (pinId === 'pin2') return { x: 55, y: 90 };
    if (pinId === 'v3') return { x: 75, y: 90 };
    if (pinId === 'gnd') return { x: 95, y: 90 };
  }
  if (type === 'vibration_motor') {
    if (pinId === 'positive') return { x: 15, y: 40 };
    if (pinId === 'negative') return { x: 35, y: 40 };
  }
  if (type === 'servo') {
    if (pinId === 'sig') return { x: 15, y: 50 };
    if (pinId === 'vcc') return { x: 30, y: 50 };
    if (pinId === 'gnd') return { x: 45, y: 50 };
  }
  if (type === 'gear_motor') {
    if (pinId === 't1') return { x: 15, y: 60 };
    if (pinId === 't2') return { x: 45, y: 60 };
  }
  if (type === 'npn_transistor') {
    if (pinId === 'collector') return { x: 25, y: 10 };
    if (pinId === 'base') return { x: 5, y: 25 };
    if (pinId === 'emitter') return { x: 25, y: 40 };
  }
  if (type === 'led_rgb') {
    if (pinId === 'red') return { x: 15, y: 15 };
    if (pinId === 'cathode') return { x: 30, y: 40 };
    if (pinId === 'green') return { x: 30, y: 15 };
    if (pinId === 'blue') return { x: 45, y: 15 };
  }
  if (type === 'diode') {
    if (pinId === 'anode') return { x: 10, y: 15 };
    if (pinId === 'cathode') return { x: 50, y: 15 };
  }
  if (type === 'photoresistor') {
    if (pinId === 'pin1') return { x: 10, y: 15 };
    if (pinId === 'pin2') return { x: 50, y: 15 };
  }
  if (type === 'soil_moisture') {
    if (pinId === 'vcc') return { x: 15, y: 50 };
    if (pinId === 'gnd') return { x: 35, y: 50 };
    if (pinId === 'sig') return { x: 55, y: 50 };
  }
  
  if (type === 'arduino') {
    // Left edge inputs/power
    if (pinId === 'RESET') return { x: 10, y: 20 };
    if (pinId === '3.3V') return { x: 10, y: 35 };
    if (pinId === '5V') return { x: 10, y: 50 };
    if (pinId.startsWith('GND')) {
      if (pinId === 'GND_D') return { x: 10, y: 65 };
      return { x: 10, y: 75 };
    }
    if (pinId === 'VIN') return { x: 10, y: 90 };
    if (pinId === 'A0') return { x: 10, y: 105 };
    if (pinId === 'A1') return { x: 10, y: 117 };
    if (pinId === 'A2') return { x: 10, y: 129 };
    if (pinId === 'A3') return { x: 10, y: 141 };
    if (pinId === 'A4') return { x: 10, y: 153 };
    if (pinId === 'A5') return { x: 10, y: 165 };
    
    // Right edge digital output/signals
    if (pinId === 'D13') return { x: 130, y: 20 };
    if (pinId === 'D12') return { x: 130, y: 32 };
    if (pinId === 'D11') return { x: 130, y: 44 };
    if (pinId === 'D10') return { x: 130, y: 56 };
    if (pinId === 'D9') return { x: 130, y: 68 };
    if (pinId === 'D8') return { x: 130, y: 80 };
    if (pinId === 'D7') return { x: 130, y: 92 };
    if (pinId === 'D6') return { x: 130, y: 104 };
    if (pinId === 'D5') return { x: 130, y: 116 };
    if (pinId === 'D4') return { x: 130, y: 128 };
    if (pinId === 'D3') return { x: 130, y: 140 };
    if (pinId === 'D2') return { x: 130, y: 152 };
    if (pinId === 'TX') return { x: 130, y: 164 };
    if (pinId === 'RX') return { x: 130, y: 172 };
  }

  if (type === 'raspberry_pi') {
    // Power/Gnd
    if (pinId === 'VBUS') return { x: 10, y: 20 };
    if (pinId === 'VSYS') return { x: 10, y: 35 };
    if (pinId === '3.3V_OUT') return { x: 10, y: 50 };
    if (pinId.startsWith('GND')) return { x: 10, y: 65 };
    
    // GPIOs
    if (pinId === 'GP0') return { x: 130, y: 20 };
    if (pinId === 'GP1') return { x: 130, y: 32 };
    if (pinId === 'GP2') return { x: 130, y: 44 };
    if (pinId === 'GP3') return { x: 130, y: 56 };
    if (pinId === 'GP4') return { x: 130, y: 68 };
    if (pinId === 'GP12') return { x: 130, y: 120 };
    if (pinId === 'GP13') return { x: 130, y: 132 };
    if (pinId === 'GP14') return { x: 130, y: 144 };
    if (pinId === 'GP15') return { x: 130, y: 156 };
  }

  // Generic block placement
  const meta = COMPONENT_DEFINITIONS[type];
  if (meta) {
    const pinIndex = meta.pins.findIndex(p => p.id === pinId);
    if (pinIndex !== -1) {
      const dim = getSchematicDimensions(type);
      const step = dim.height / (meta.pins.length + 1);
      const isLeft = pinId.includes('vcc') || pinId.includes('gnd') || pinId === 'positive' || pinId === 'negative' || pinId === 'in' || pinId === 'v5' || pinId === 'v12';
      return {
        x: isLeft ? 10 : (dim.width - 10),
        y: Math.round(step * (pinIndex + 1))
      };
    }
  }

  return { x: 10, y: 10 };
};

export const getManhattanPath = (x1: number, y1: number, x2: number, y2: number, nodes?: { x: number; y: number }[]): string => {
  const pts = [{ x: x1, y: y1 }, ...(nodes || []), { x: x2, y: y2 }];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  const r = 12; // corner radius for bends

  for (let i = 0; i < pts.length - 1; i++) {
    const curr = pts[i];
    const next = pts[i + 1];

    const dx = next.x - curr.x;
    const dy = next.y - curr.y;

    if (Math.abs(dx) < 0.5 || Math.abs(dy) < 0.5) {
      d += ` L ${next.x} ${next.y}`;
    } else {
      // Draw an orthogonal bend with rounded corner
      const midX = next.x;
      const midY = curr.y;

      const signX = Math.sign(dx);
      const signY = Math.sign(dy);
      const rad = Math.min(r, Math.abs(dx) / 2, Math.abs(dy) / 2);

      const turnStartX = midX - signX * rad;
      const turnStartY = curr.y;
      const turnEndX = midX;
      const turnEndY = curr.y + signY * rad;

      d += ` L ${turnStartX} ${turnStartY} Q ${midX} ${midY} ${turnEndX} ${turnEndY} L ${next.x} ${next.y}`;
    }
  }

  return d;
};

export const getBezierPath = (x1: number, y1: number, x2: number, y2: number, nodes?: { x: number; y: number }[]): string => {
  const pts = [{ x: x1, y: y1 }, ...(nodes || []), { x: x2, y: y2 }];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const dist = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const sag = Math.max(30, dist * 0.25);
    const cp1x = p0.x;
    const cp1y = p0.y + sag;
    const cp2x = p1.x;
    const cp2y = p1.y + sag;
    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
  }
  return d;
};

