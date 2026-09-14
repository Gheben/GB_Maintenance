import React, { useEffect, useState } from 'react';
import { AlertCircle, Loader } from 'lucide-react';
import InteractiveCorrelationGraph from './InteractiveCorrelationGraph';
import { assetsApi, servicesApi } from '../api';

/**
 * CorrelationGraphLoader
 * Loads and displays correlation graph for assets or services
 */

const CorrelationGraphLoader = ({ entityId, entityType, onNodeClick }) => {
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [depth, setDepth] = useState(1);

  useEffect(() => {
    loadGraph();
  }, [entityId, entityType, depth]);

  const loadGraph = async () => {
    try {
      setLoading(true);
      setError(null);

      const api = entityType === 'asset' ? assetsApi : servicesApi;
      const response = await api.getGraph(entityId, { depth });

      console.log('[CorrelationGraph] Response:', response);
      setGraphData(response.data || response);
    } catch (err) {
      console.error('Error loading correlation graph:', err);
      setError(err.message || 'Failed to load correlation graph');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center w-full h-96 bg-slate-50 border border-slate-200 rounded-lg">
        <div className="flex flex-col items-center gap-3">
          <Loader size={24} className="text-slate-400 animate-spin" />
          <p className="text-slate-500">Loading correlations...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 w-full p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
        <AlertCircle size={20} />
        <div className="flex-1">
          <p className="font-semibold">Error loading correlation graph</p>
          <p className="text-sm text-red-600 mt-1">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Depth control */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-lg border border-slate-200">
        <label htmlFor="graph-depth" className="text-sm font-medium text-slate-700">
          Expansion depth:
        </label>
        <select
          id="graph-depth"
          value={depth}
          onChange={(e) => setDepth(parseInt(e.target.value, 10))}
          className="px-3 py-1 text-sm border border-slate-300 rounded bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        >
          <option value={1}>1 level (direct relationships)</option>
          <option value={2}>2 levels (direct + indirect)</option>
          <option value={3}>3 levels (full expansion)</option>
        </select>
      </div>

      {/* Graph */}
      <InteractiveCorrelationGraph graphData={graphData} onNodeClick={onNodeClick} />
    </div>
  );
};

export default CorrelationGraphLoader;
