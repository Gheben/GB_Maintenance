import React, { useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, RotateCcw, X, KeyRound } from 'lucide-react';

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

function getLicenseColor(status) {
  return { valid: '#16A34A', expiring: '#EAB308', expired: '#DC2626' }[status] || '#94A3B8';
}

function getNodeLicenseStatus(node) {
  const statuses = (node.licenses || []).map(license => license.status);
  if (statuses.includes('expired')) return 'expired';
  if (statuses.includes('expiring')) return 'expiring';
  return statuses.length > 0 ? 'valid' : null;
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
      const licenseStatus = getNodeLicenseStatus(node);

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

          {licenseStatus && (
            <g transform={`translate(${pos.x + radius - 2}, ${pos.y - radius - 2})`}>
              <circle r="9" fill="white" stroke={getLicenseColor(licenseStatus)} strokeWidth="2" />
              <KeyRound x="-5" y="-5" width="10" height="10" color={getLicenseColor(licenseStatus)} strokeWidth="2.5" />
            </g>
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

          {/* Label - Improved positioning to avoid cutoff */}
          {(isHovered || isSelected) && (
            <g>
              <defs>
                <filter id="tooltip-shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="1" stdDeviation="2" floodOpacity="0.15" />
                </filter>
              </defs>
              <rect
                x={Math.max(5, Math.min(pos.x - 75, SVG_WIDTH - 150))}
                y={pos.y + 32}
                width="150"
                height="50"
                rx="6"
                fill="white"
                stroke="#D1D5DB"
                strokeWidth="1.5"
                filter="url(#tooltip-shadow)"
              />
              <text
                x={Math.max(5, Math.min(pos.x - 75, SVG_WIDTH - 150)) + 75}
                y={pos.y + 47}
                fontSize="12"
                fill="#1F2937"
                fontWeight="600"
                textAnchor="middle"
                className="pointer-events-none"
              >
                {node.label.length > 18 ? node.label.substring(0, 15) + '...' : node.label}
              </text>
              <text
                x={Math.max(5, Math.min(pos.x - 75, SVG_WIDTH - 150)) + 75}
                y={pos.y + 66}
                fontSize="11"
                fill="#6B7280"
                textAnchor="middle"
                className="pointer-events-none"
              >
                {node.type === 'service' ? 'Service' : 'Asset'}
              </text>
            </g>
          )}
        </g>
      );
    });
  };

  return (
    <div className="relative w-full bg-white border border-slate-200 rounded-lg overflow-visible flex flex-col isolate">
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

      {/* SVG viewport: clips only the zoomed and panned graph. */}
      <div className="relative h-[600px] w-full overflow-hidden bg-gradient-to-br from-slate-50 to-white">
        <svg
          ref={svgRef}
          width={SVG_WIDTH}
          height={SVG_HEIGHT}
          className="block cursor-grab active:cursor-grabbing"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onWheel={handleWheel}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: 'center center',
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
      </div>

      {/* Node Details Modal */}
      {showNodeDetails && selectedNode && (
        <div 
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[100]"
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

              {/* Licenses */}
              {(selectedNode.licenses || []).length > 0 && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase mb-2">Licenses</p>
                  <div className="space-y-2">
                    {selectedNode.licenses.map(license => (
                      <div key={license.id} className="flex items-start justify-between gap-3 p-2.5 rounded border border-slate-200 bg-slate-50">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 break-words">{license.name}</p>
                          {license.expiry_date && <p className="text-xs text-slate-500 mt-0.5">Expiry: {String(license.expiry_date).slice(0, 10)}</p>}
                        </div>
                        <span
                          className="shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ color: getLicenseColor(license.status), backgroundColor: `${getLicenseColor(license.status)}18` }}
                        >
                          {license.status === 'expired' ? 'Expired' : license.status === 'expiring' ? 'Expiring' : 'Valid'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
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
