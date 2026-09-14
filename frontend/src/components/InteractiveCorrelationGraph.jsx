import React, { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X } from 'lucide-react';

/**
 * InteractiveCorrelationGraph
 * Beautiful, interactive SVG-based graph visualization for asset/service correlations
 */

// Color palette by type
const COLOR_MAP = {
  asset: { base: '#3B82F6', light: '#DBEAFE' },           // Blue
  service: { base: '#10B981', light: '#D1FAE5' },         // Green
  maintenance: { base: '#F97316', light: '#FFEDD5' },     // Orange
  incident: { base: '#EF4444', light: '#FEE2E2' },        // Red
  blackout: { base: '#A855F7', light: '#F3E8FF' },        // Purple
  part_is: { base: '#FBBF24', light: '#FEF3C7' },         // Amber
};

// Calculate radial layout positions
function calculateRadialLayout(nodes, centerX, centerY, baseRadius = 100) {
  const layout = {};
  const mainNode = nodes.find(n => n.is_main);
  if (!mainNode) return layout;

  layout[mainNode.id] = { x: centerX, y: centerY };

  // Separate by depth
  const depth1Nodes = nodes.filter(n => n.depth === 1 && !n.is_main);
  const depth2Nodes = nodes.filter(n => n.depth === 2 && !n.is_main);

  // Place depth 1 nodes in a circle
  const d1Angle = (2 * Math.PI) / Math.max(depth1Nodes.length, 1);
  depth1Nodes.forEach((node, i) => {
    const angle = i * d1Angle - Math.PI / 2;
    layout[node.id] = {
      x: centerX + baseRadius * Math.cos(angle),
      y: centerY + baseRadius * Math.sin(angle),
    };
  });

  // Place depth 2 nodes further out, clustered near their "parents"
  if (depth2Nodes.length > 0) {
    const d2Radius = baseRadius * 1.8;
    const d2Angle = (2 * Math.PI) / Math.max(depth2Nodes.length, 1);
    depth2Nodes.forEach((node, i) => {
      const angle = i * d2Angle - Math.PI / 2;
      layout[node.id] = {
        x: centerX + d2Radius * Math.cos(angle),
        y: centerY + d2Radius * Math.sin(angle),
      };
    });
  }

  return layout;
}

// Get color for node
function getNodeColor(node) {
  if (node.type === 'asset') {
    return node.part_is_relevant ? COLOR_MAP.part_is.base : COLOR_MAP.asset.base;
  }
  return COLOR_MAP[node.type]?.base || '#6B7280';
}

// Get status indicator color
function getStatusColor(status) {
  const statusColors = {
    operational: '#10B981',
    degraded: '#FBBF24',
    partial_outage: '#F97316',
    major_outage: '#EF4444',
    under_maintenance: '#A855F7',
  };
  return statusColors[status] || '#6B7280';
}

const InteractiveCorrelationGraph = ({ graphData, onNodeClick }) => {
  const svgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [hoveredNode, setHoveredNode] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [showNodeDetails, setShowNodeDetails] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);

  // Prevent page scrolling when hovering over graph
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (e) => {
      e.preventDefault();
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, []);

  if (!graphData || !graphData.nodes || graphData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-96 bg-slate-50 border border-slate-200 rounded-lg">
        <p className="text-slate-500">No correlations found</p>
      </div>
    );
  }

  const SVG_WIDTH = 800;
  const SVG_HEIGHT = 600;
  const CENTER_X = SVG_WIDTH / 2;
  const CENTER_Y = SVG_HEIGHT / 2;
  const BASE_RADIUS = 120;

  const layout = calculateRadialLayout(graphData.nodes, CENTER_X, CENTER_Y, BASE_RADIUS);

  const handleMouseDown = (e) => {
    if (e.button === 2) return; // Right click
    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseMove = (e) => {
    if (!isDragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setPan(p => ({ x: p.x + dx, y: p.y + dy }));
    setDragStart({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
    setDragStart(null);
  };

  const handleWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(3, z * factor)));
  };

  const handleZoomIn = () => setZoom(z => Math.min(3, z + 0.2));
  const handleZoomOut = () => setZoom(z => Math.max(0.5, z - 0.2));
  const handleReset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setSelectedNode(null);
    setShowNodeDetails(false);
    setHoveredNode(null);
  };

  const handleNodeClick = (node) => {
    setSelectedNode(node);
    setShowNodeDetails(true);
    if (onNodeClick) onNodeClick(node);
  };

  // Render edges
  const renderEdges = () => {
    return graphData.edges.map((edge, idx) => {
      const sourcePos = layout[edge.source];
      const targetPos = layout[edge.target];
      if (!sourcePos || !targetPos) return null;

      const isHighlighted =
        hoveredNode?.id === edge.source ||
        hoveredNode?.id === edge.target ||
        selectedNode?.id === edge.source ||
        selectedNode?.id === edge.target;

      const strokeDasharray = edge.is_direct ? 'none' : '5,5';
      const strokeWidth = isHighlighted ? 2.5 : 1.5;
      const opacity = isHighlighted ? 1 : 0.4;

      return (
        <g key={`edge-${idx}`} opacity={opacity}>
          <line
            x1={sourcePos.x}
            y1={sourcePos.y}
            x2={targetPos.x}
            y2={targetPos.y}
            stroke="#9CA3AF"
            strokeWidth={strokeWidth}
            strokeDasharray={strokeDasharray}
            strokeLinecap="round"
          />
        </g>
      );
    });
  };

  // Render nodes
  const renderNodes = () => {
    return graphData.nodes.map((node) => {
      const pos = layout[node.id];
      if (!pos) return null;

      const nodeColor = getNodeColor(node);
      const isHovered = hoveredNode?.id === node.id;
      const isSelected = selectedNode?.id === node.id;
      const radius = isHovered || isSelected ? 28 : 20;
      const statusColor = getStatusColor(node.status);

      return (
        <g
          key={`node-${node.id}`}
          onMouseEnter={() => setHoveredNode(node)}
          onMouseLeave={() => setHoveredNode(null)}
          onClick={() => handleNodeClick(node)}
          style={{ cursor: 'pointer' }}
        >
          {/* Main circle */}
          <circle
            cx={pos.x}
            cy={pos.y}
            r={radius}
            fill={nodeColor}
            opacity={0.9}
            className="transition-all duration-200"
          />

          {/* Status ring */}
          {node.status && (
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius + 2}
              fill="none"
              stroke={statusColor}
              strokeWidth={2}
              opacity={0.6}
            />
          )}

          {/* Main node indicator */}
          {node.is_main && (
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius + 5}
              fill="none"
              stroke={nodeColor}
              strokeWidth={2}
              strokeDasharray="3,3"
              opacity={0.5}
            />
          )}

          {/* Hover/selected glow */}
          {(isHovered || isSelected) && (
            <circle
              cx={pos.x}
              cy={pos.y}
              r={radius + 8}
              fill={nodeColor}
              opacity={0.1}
            />
          )}

          {/* Icon/Type indicator */}
          <text
            x={pos.x}
            y={pos.y}
            fontSize="10"
            fill="white"
            fontWeight="bold"
            textAnchor="middle"
            dominantBaseline="central"
            className="pointer-events-none"
          >
            {node.type === 'service' ? 'S' : 'A'}
          </text>

          {/* Label */}
          {(isHovered || isSelected) && (
            <g>
              <rect
                x={pos.x - 60}
                y={pos.y + 35}
                width="120"
                height="40"
                rx="4"
                fill="white"
                stroke="#E5E7EB"
                strokeWidth="1"
                filter="drop-shadow(0 1px 2px rgba(0,0,0,0.1))"
              />
              <text
                x={pos.x}
                y={pos.y + 45}
                fontSize="12"
                fill="#1F2937"
                fontWeight="600"
                textAnchor="middle"
                className="pointer-events-none"
              >
                {node.label.length > 15 ? node.label.substring(0, 12) + '...' : node.label}
              </text>
              <text
                x={pos.x}
                y={pos.y + 63}
                fontSize="10"
                fill="#6B7280"
                textAnchor="middle"
                className="pointer-events-none"
              >
                {node.type} • {node.status || 'unknown'}
              </text>
            </g>
          )}
        </g>
      );
    });
  };

  return (
    <div className="w-full bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div className="text-sm text-slate-600">
          {graphData.nodes.length} nodes • {graphData.edges.length} connections
          {graphData.nodes.length === 1 && graphData.edges.length === 0 && (
            <span className="ml-3 text-amber-600">ℹ️ No correlations found - this is an isolated entity</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleZoomIn}
            className="p-2 hover:bg-white rounded border border-slate-200 transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={16} className="text-slate-600" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 hover:bg-white rounded border border-slate-200 transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={16} className="text-slate-600" />
          </button>
          <button
            onClick={handleReset}
            className="p-2 hover:bg-white rounded border border-slate-200 transition-colors"
            title="Reset view"
          >
            <RotateCcw size={16} className="text-slate-600" />
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        width={SVG_WIDTH}
        height={SVG_HEIGHT}
        className="flex-1 bg-gradient-to-br from-slate-50 to-white cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        style={{
          transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
          transformOrigin: 'top left',
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
      >
        {/* Grid background */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E5E7EB" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width={SVG_WIDTH} height={SVG_HEIGHT} fill="url(#grid)" opacity={0.5} />

        {/* Render edges first (behind nodes) */}
        {renderEdges()}

        {/* Render nodes */}
        {renderNodes()}
      </svg>

      {/* Legend */}
      <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500" />
          <span className="text-slate-600">Asset</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-slate-600">Service</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-400" />
          <span className="text-slate-600">Part-IS</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-4 bg-slate-400" />
          <span className="text-slate-600">Direct</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-0.5 w-4 bg-slate-400" style={{ backgroundImage: 'repeating-linear-gradient(90deg, currentColor 0, currentColor 2px, transparent 2px, transparent 5px)' }} />
          <span className="text-slate-600">Related</span>
        </div>
      </div>

      {/* Node Details Modal */}
      {showNodeDetails && selectedNode && (
        <div 
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => {
            setShowNodeDetails(false);
            setSelectedNode(null);
          }}
        >
          <div 
            className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-6 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
                  style={{ backgroundColor: getNodeColor(selectedNode) }}
                >
                  {selectedNode.type === 'service' ? 'S' : 'A'}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{selectedNode.label}</h2>
                  <p className="text-sm text-slate-500 mt-0.5 capitalize">{selectedNode.type}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowNodeDetails(false);
                  setSelectedNode(null);
                }}
                className="text-slate-400 hover:text-slate-600 transition"
              >
                <X size={20} />
              </button>
            </div>

            {/* Details */}
            <div className="p-6 space-y-4">
              {/* Status */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Status</p>
                <div className="flex items-center gap-2">
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: getStatusColor(selectedNode.status) }}
                  />
                  <span className="text-sm font-medium text-slate-700 capitalize">
                    {selectedNode.status || 'unknown'}
                  </span>
                </div>
              </div>

              {/* Criticality */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Criticality</p>
                <span className="inline-block px-2 py-1 bg-slate-100 text-slate-700 rounded text-sm font-medium capitalize">
                  {selectedNode.criticality || 'N/A'}
                </span>
              </div>

              {/* Category (only for assets) */}
              {selectedNode.type === 'asset' && selectedNode.category && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase mb-1">Category</p>
                  <span className="text-sm font-medium text-slate-700 capitalize">
                    {selectedNode.category}
                  </span>
                </div>
              )}

              {/* Part-IS (only for assets) */}
              {selectedNode.type === 'asset' && selectedNode.part_is_relevant && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded">
                  <p className="text-sm font-medium text-amber-900">🏷️ Part-IS Relevant</p>
                </div>
              )}

              {/* Depth */}
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Distance from main</p>
                <span className="text-sm text-slate-700">
                  {selectedNode.depth === 0 ? 'Main entity' : `${selectedNode.depth} hop${selectedNode.depth > 1 ? 's' : ''}`}
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 rounded-b-lg">
              <button
                onClick={() => {
                  setShowNodeDetails(false);
                  setSelectedNode(null);
                }}
                className="w-full px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default InteractiveCorrelationGraph;
