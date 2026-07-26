import type { ComponentInstance, WireConnection } from '../types';
import { COMPONENT_DEFINITIONS } from './componentDefinitions';

/**
 * Maps breadboard holes to electrical nodes.
 * E.g., '12-f' up to '12-j' all map to the same node 'term_upper_12'.
 * Top power rail negative maps to 'rail_top_neg'.
 */
export const getBreadboardNodeId = (holeId: string): string | null => {
  if (holeId.startsWith('rail_top_neg')) return 'rail_top_neg';
  if (holeId.startsWith('rail_top_pos')) return 'rail_top_pos';
  if (holeId.startsWith('rail_bot_pos')) return 'rail_bot_pos';
  if (holeId.startsWith('rail_bot_neg')) return 'rail_bot_neg';
  
  if (holeId.startsWith('hole_')) {
    const parts = holeId.split('_');
    if (parts.length === 3) {
      const row = parts[1]; // f, g, h, i, j OR a, b, c, d, e
      const col = parts[2];
      if (['f', 'g', 'h', 'i', 'j'].includes(row)) {
        return `term_upper_${col}`;
      } else if (['a', 'b', 'c', 'd', 'e'].includes(row)) {
        return `term_lower_${col}`;
      }
    }
  }
  return null;
};

export interface PinReference {
  componentId: string;
  pinId: string;
}

/**
 * State machine that maps each electrical node (and hole coordinate) to an array of connected component pins.
 */
export const buildBreadboardNodeMap = (
  components: ComponentInstance[],
  wires: WireConnection[]
): Record<string, PinReference[]> => {
  const nodeMap: Record<string, PinReference[]> = {};
  const holeToPinMap: Record<string, PinReference[]> = {};

  const breadboard = components.find(c => c.type === 'breadboard');
  if (!breadboard) return {};

  const bbMeta = COMPONENT_DEFINITIONS['breadboard'];

  // Helper to add to node
  const addToNode = (nodeId: string, ref: PinReference) => {
    if (!nodeMap[nodeId]) nodeMap[nodeId] = [];
    nodeMap[nodeId].push(ref);
  };

  // Resolve component pins snapped to the breadboard
  components.forEach(comp => {
    if (comp.type === 'breadboard') return;
    
    const meta = COMPONENT_DEFINITIONS[comp.type];
    if (!meta) return;

    // Check if component overlaps breadboard physically (using the same logic as snapComponentPosition)
    const insideBb = 
      comp.x > breadboard.x - 30 &&
      comp.x < breadboard.x + bbMeta.width + 10 &&
      comp.y > breadboard.y - 30 &&
      comp.y < breadboard.y + bbMeta.height + 10;

    if (!insideBb) return;

    // Calculate absolute positions of component pins to find snapped holes
    meta.pins.forEach(pin => {
      const cx = comp.x + meta.width / 2;
      const cy = comp.y + meta.height / 2;
      const rx = pin.x - meta.width / 2;
      const ry = pin.y - meta.height / 2;
      const rad = (comp.rotation * Math.PI) / 180;
      const rotX = rx * Math.cos(rad) - ry * Math.sin(rad);
      const rotY = rx * Math.sin(rad) + ry * Math.cos(rad);
      const pinAbsX = cx + rotX;
      const pinAbsY = cy + rotY;

      // Find if this absolute pin coordinate exactly matches any hole coordinate
      for (const hole of bbMeta.pins) {
        const hx = breadboard.x + hole.x;
        const hy = breadboard.y + hole.y;
        
        // If distance is extremely small, it's snapped
        if (Math.hypot(pinAbsX - hx, pinAbsY - hy) < 5) {
          const nodeId = getBreadboardNodeId(hole.id);
          if (nodeId) {
            addToNode(nodeId, { componentId: comp.id, pinId: pin.id });
          }
          // Also map the exact hole ID (e.g. hole_f_12)
          if (!holeToPinMap[hole.id]) holeToPinMap[hole.id] = [];
          holeToPinMap[hole.id].push({ componentId: comp.id, pinId: pin.id });
          break;
        }
      }
    });
  });

  // Wires act as bridges between nodes (including breadboard holes and external components)
  wires.forEach(wire => {
    let node1 = wire.fromPinId;
    let node2 = wire.toPinId;
    
    // If the wire is plugged into a breadboard hole, resolve the hole to its breadboard net node
    if (wire.fromComponentId === breadboard.id) {
      const netId = getBreadboardNodeId(wire.fromPinId);
      if (netId) node1 = netId;
    } else {
      addToNode(node1, { componentId: wire.fromComponentId, pinId: wire.fromPinId });
    }

    if (wire.toComponentId === breadboard.id) {
      const netId = getBreadboardNodeId(wire.toPinId);
      if (netId) node2 = netId;
    } else {
      addToNode(node2, { componentId: wire.toComponentId, pinId: wire.toPinId });
    }

    // Connect node1 and node2 logically (this simplified map merges them or links them)
    // For a robust simulator, these would union into a single net.
    // For this state machine representation, we push the "wire" as a reference.
    if (node1 !== node2) {
       addToNode(node1, { componentId: wire.id, pinId: node2 });
       addToNode(node2, { componentId: wire.id, pinId: node1 });
    }
  });

  return { ...nodeMap, ...holeToPinMap };
};
