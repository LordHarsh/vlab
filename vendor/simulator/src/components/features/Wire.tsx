import React from 'react';
import { getManhattanPath, getBezierPath } from '../../utils/schematicLayout';

interface WireProps {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  nodes?: { x: number; y: number }[];
  color: string;
  isSelected: boolean;
  style?: 'bezier' | 'manhattan';
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}

export const Wire: React.FC<WireProps> = ({
  id: _id,
  x1,
  y1,
  x2,
  y2,
  nodes,
  color,
  isSelected,
  style = 'manhattan',
  onClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
  onMouseDown
}) => {
  const [isHovered, setIsHovered] = React.useState(false);

  const pathD = style === 'bezier' 
    ? getBezierPath(x1, y1, x2, y2, nodes) 
    : getManhattanPath(x1, y1, x2, y2, nodes);
  
  // Resolve standard colors to premium hex codes
  const resolveColor = (c: string): string => {
    switch (c) {
      case 'red': return '#EF4444';
      case 'blue': return '#3B82F6';
      case 'black': return '#1F2937';
      case 'green': return '#10B981';
      case 'yellow': return '#F59E0B';
      case 'purple': return '#8B5CF6';
      case 'orange': return '#F97316';
      case 'white': return '#F9FAFB';
      default: return c;
    }
  };

  const wireColor = resolveColor(color);

  return (
    <g 
      className={`wire-group ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={(e) => {
        setIsHovered(true);
        if (onMouseEnter) onMouseEnter();
      }}
      onMouseLeave={(e) => {
        setIsHovered(false);
        if (onMouseLeave) onMouseLeave();
      }}
      onMouseDown={onMouseDown}
      style={{ cursor: 'pointer' }}
    >
      {/* LAYER 1: The Glow (Only visible if hovered or selected, matches active path exactly) */}
      {(isHovered || isSelected) && (
        <path 
          d={pathD} 
          stroke={isSelected ? '#3B82F6' : '#0044FF'} 
          strokeWidth={isSelected ? 10 : 8} 
          fill="none" 
          opacity={0.4} 
          style={{ filter: `drop-shadow(0 0 5px ${isSelected ? '#3B82F6' : 'blue'})` }}
        />
      )}

      {/* LAYER 2: The Visible Wire */}
      <path 
        d={pathD} 
        fill="none" 
        stroke={wireColor} 
        strokeWidth={isSelected ? 4.5 : 3.5} 
        strokeLinecap="round"
        pointerEvents="none" /* Let the hitbox handle the mouse */
      />

      {/* Wire glossy highlight overlay */}
      <path
        d={pathD}
        fill="none"
        stroke="#ffffff"
        strokeWidth={1}
        strokeLinecap="round"
        opacity={0.35}
        pointerEvents="none"
      />

      {/* LAYER 3: The Invisible Hitbox (Thick transparent stroke for easy hovering) */}
      <path 
        d={pathD} 
        stroke="transparent" 
        strokeWidth={15} 
        fill="none" 
        cursor="pointer"
      />

      {/* Metallic terminal eyelets at holes */}
      <g style={{ pointerEvents: 'none' }}>
        {/* Start point eyelet */}
        <circle cx={x1} cy={y1} r={3.5} fill="#94A3B8" stroke="#475569" strokeWidth={1} />
        <circle cx={x1} cy={y1} r={1.5} fill="#0F172A" />

        {/* End point eyelet */}
        <circle cx={x2} cy={y2} r={3.5} fill="#94A3B8" stroke="#475569" strokeWidth={1} />
        <circle cx={x2} cy={y2} r={1.5} fill="#0F172A" />
      </g>
    </g>
  );
};
