import React, { useState } from 'react';
import { Upload, ZoomIn, ZoomOut, FileText, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

// HARDCODED API CONFIGURATION
const API_CONFIG = {
  url: 'https://staging.api.uveye.app/v1/get-uvpaint-inspections',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_API_KEY_HERE'
  }
};

export default function ImageComparison() {
  const [inspections, setInspections] = useState([]);
  const [currentInspectionIndex, setCurrentInspectionIndex] = useState(0);
  const [currentComparisonIndex, setCurrentComparisonIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [loadMethod, setLoadMethod] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const createPOVKey = (imageType, pov, category = null) => {
    if (imageType === 'UV360') {
      return `UV360_${category}_${pov.serialNumber || 'none'}`;
    }
    return `${imageType}_${pov.simulatedCamera}_${pov.simulatedCameraSide}_${pov.serialNumber || 'none'}`;
  };

  const processInspectionData = (inspection) => {
    const uvpaintData = inspection.uvpaintData;
    const groups = [];
    
    if (uvpaintData) {
      const imagesByPOV = {};
      
      // Rendition 3 (Latest) - from 'images' array
      if (uvpaintData.images && Array.isArray(uvpaintData.images)) {
        uvpaintData.images.forEach(img => {
          if (img.imageType === 'Artemis' || !img.isActive || !img.activeImage || !img.pov) return;
          
          const povKey = createPOVKey(img.imageType, img.pov);
          if (!imagesByPOV[povKey]) {
            imagesByPOV[povKey] = {
              imageType: img.imageType,
              pov: img.pov,
              renditions: {}
            };
          }
          imagesByPOV[povKey].renditions[3] = {
            image: img.activeImage,
            status: img.status,
            source: 'images (Latest)',
            actions: img.actionsCounterMap ? Object.values(img.actionsCounterMap).reduce((a, b) => a + b, 0) : 0
          };
        });
      }
      
      // Rendition 1 (History-Generated) - from 'uvpaintHistoryImages' array
      if (uvpaintData.uvpaintHistoryImages && Array.isArray(uvpaintData.uvpaintHistoryImages)) {
        uvpaintData.uvpaintHistoryImages.forEach(img => {
          if (img.imageType === 'Artemis' || !img.activeImage || !img.pov) return;
          
          const povKey = createPOVKey(img.imageType, img.pov);
          if (!imagesByPOV[povKey]) {
            imagesByPOV[povKey] = {
              imageType: img.imageType,
              pov: img.pov,
              renditions: {}
            };
          }
          imagesByPOV[povKey].renditions[1] = {
            image: img.activeImage,
            status: img.status,
            source: 'uvpaintHistoryImages (History-Gen)',
            actions: img.actionsCounterMap ? Object.values(img.actionsCounterMap).reduce((a, b) => a + b, 0) : 0
          };
        });
      }
      
      // Rendition 2 (Published) - from 'uv360Images' array
      if (uvpaintData.uv360Images && Array.isArray(uvpaintData.uv360Images)) {
        uvpaintData.uv360Images.forEach(img => {
          const pov = img.pov || {};
          const category = pov.category || '';
          if (!category || !img.Uv360ProcessedImage) return;
          
          const parts = category.split('_');
          const camera = parts[0]?.charAt(0).toUpperCase() + parts[0]?.slice(1).toLowerCase() || 'N/A';
          const side = parts[1]?.charAt(0).toUpperCase() + parts[1]?.slice(1).toLowerCase() || 'N/A';
          
          const povKey = createPOVKey('UV360', pov, category);
          if (!imagesByPOV[povKey]) {
            imagesByPOV[povKey] = {
              imageType: 'UV360',
              pov: { simulatedCamera: camera, simulatedCameraSide: side, serialNumber: pov.serialNumber },
              category: category,
              renditions: {}
            };
          }
          imagesByPOV[povKey].renditions[2] = {
            image: img.Uv360ProcessedImage,
            status: 'Published',
            source: 'uv360Images (Published)',
            actions: 'N/A'
          };
        });
      }
      
      // Rendition 0 (History-Published) - from 'uv360HistoryImages' array
      if (uvpaintData.uv360HistoryImages && Array.isArray(uvpaintData.uv360HistoryImages)) {
        uvpaintData.uv360HistoryImages.forEach(img => {
          const pov = img.pov || {};
          const category = pov.category || '';
          if (!category || !img.Uv360ProcessedImage) return;
          
          const parts = category.split('_');
          const camera = parts[0]?.charAt(0).toUpperCase() + parts[0]?.slice(1).toLowerCase() || 'N/A';
          const side = parts[1]?.charAt(0).toUpperCase() + parts[1]?.slice(1).toLowerCase() || 'N/A';
          
          const povKey = createPOVKey('UV360', pov, category);
          if (!imagesByPOV[povKey]) {
            imagesByPOV[povKey] = {
              imageType: 'UV360',
              pov: { simulatedCamera: camera, simulatedCameraSide: side, serialNumber: pov.serialNumber },
              category: category,
              renditions: {}
            };
          }
          imagesByPOV[povKey].renditions[0] = {
            image: img.Uv360ProcessedImage,
            status: 'History-Published',
            source: 'uv360HistoryImages (History-Pub)',
            actions: 'N/A'
          };
        });
      }

      // Create comparison groups
      Object.entries(imagesByPOV).forEach(([povKey, povData]) => {
        const renditionNumbers = Object.keys(povData.renditions).map(Number).sort((a, b) => b - a);
        
        if (renditionNumbers.length >= 2) {
          const latestRendition = renditionNumbers[0];
          const previousRendition = renditionNumbers[1];
          
          const latestVersion = povData.renditions[latestRendition];
          const previousVersion = povData.renditions[previousRendition];
          
          const cameraLabel = `${povData.pov.simulatedCamera} ${povData.pov.simulatedCameraSide}`;
          
          groups.push({
            id: `${inspection.inspectionId}_${povKey}`,
            name: `${cameraLabel} (${povData.imageType})`,
            images: [previousVersion.image, latestVersion.image, null],
            metadata: {
              inspectionId: inspection.inspectionId,
              vehicle: inspection.uvpaintInspection?.vehicleInfo,
              pov: povData.pov,
              imageType: povData.imageType,
              renditions: [previousRendition, latestRendition, null],
              statuses: [previousVersion.status, latestVersion.status, 'Reserved'],
              sources: [previousVersion.source, latestVersion.source, 'Empty'],
              actions: [previousVersion.actions, latestVersion.actions, 'N/A'],
              totalVersions: renditionNumbers.length
            }
          });
        }
      });
    }
    
    return groups;
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError('');

    try {
      const text = await file.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      // Extract inspection IDs (skip header if present)
      const startIndex = lines[0].toLowerCase().includes('inspection') ? 1 : 0;
      const inspectionIds = lines.slice(startIndex)
        .map(line => line.split(',')[0].trim())
        .filter(id => id);

      if (inspectionIds.length === 0) {
        throw new Error('No inspection IDs found in CSV');
      }

      const processedInspections = [];

      // Fetch from API
      for (const inspectionId of inspectionIds) {
        try {
          const response = await fetch(API_CONFIG.url, {
            method: 'POST',
            headers: API_CONFIG.headers,
            body: JSON.stringify({ inspectionIds: [inspectionId] })
          });

          if (!response.ok) {
            console.error(`Failed to fetch inspection ${inspectionId}: ${response.status}`);
            continue;
          }

          const data = await response.json();
          
          if (data.uvpaintInspections && data.uvpaintInspections.length > 0) {
            const inspection = data.uvpaintInspections[0];
            const comparisons = processInspectionData(inspection);
            
            processedInspections.push({
              inspectionId: inspectionId,
              vehicle: inspection.uvpaintInspection?.vehicleInfo,
              comparisons: comparisons
            });
          }
        } catch (err) {
          console.error(`Error processing inspection ${inspectionId}:`, err);
        }
      }

      if (processedInspections.length === 0) {
        throw new Error('No valid inspections could be processed');
      }

      setInspections(processedInspections);
      setCurrentInspectionIndex(0);
      setCurrentComparisonIndex(0);
      setLoadMethod('csv');
      setLoading(false);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const adjustZoom = (delta) => {
    setZoom(prev => Math.max(50, Math.min(200, prev + delta)));
  };

  const goToPreviousComparison = () => {
    setCurrentComparisonIndex(prev => Math.max(0, prev - 1));
  };

  const goToNextComparison = () => {
    const currentInspection = inspections[currentInspectionIndex];
    if (currentInspection) {
      setCurrentComparisonIndex(prev => Math.min(currentInspection.comparisons.length - 1, prev + 1));
    }
  };

  const resetApp = () => {
    setLoadMethod(null);
    setInspections([]);
    setCurrentInspectionIndex(0);
    setCurrentComparisonIndex(0);
    setError('');
  };

  const currentInspection = inspections[currentInspectionIndex];
  const currentComparison = currentInspection?.comparisons[currentComparisonIndex];

  if (!loadMethod) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 flex items-center justify-center">
        <div className="max-w-3xl w-full">
          <h1 className="text-4xl font-bold text-white mb-4 text-center">Image Comparison Platform</h1>
          <p className="text-slate-400 text-center mb-12">Upload a CSV with inspection IDs to compare versions</p>
          
          <div className="bg-slate-800/50 backdrop-blur border-2 border-slate-700 rounded-xl p-8">
            <div className="flex items-center gap-4 mb-6">
              <FileText className="w-10 h-10 text-blue-400" />
              <div>
                <h3 className="text-xl font-semibold text-white">Upload CSV File</h3>
                <p className="text-slate-400 text-sm mt-1">Each row should contain an inspection ID</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="text-xs text-slate-500 font-mono bg-slate-900/50 p-3 rounded">
                <strong>CSV Format:</strong><br/>
                inspectionId<br/>
                35336435-f455-46bc-a821-cbf2d60ec868<br/>
                380a808f-91fc-463a-bf12-2f8f4b9febd6<br/>
                ...<br/><br/>
                <strong>API Endpoint:</strong><br/>
                {API_CONFIG.url}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <label className="block">
                <div className="border-2 border-dashed border-slate-600 hover:border-blue-500 rounded-lg p-8 text-center cursor-pointer transition-colors">
                  <Upload className="w-12 h-12 text-slate-400 mx-auto mb-3" />
                  <p className="text-slate-300">Click to upload CSV</p>
                  <p className="text-slate-500 text-sm mt-1">or drag and drop</p>
                </div>
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVUpload}
                  className="hidden"
                  disabled={loading}
                />
              </label>

              {loading && (
                <div className="flex items-center justify-center gap-2 text-blue-400">
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Processing inspections...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">Image Comparison Platform</h1>
            <p className="text-slate-400">Viewing {inspections.length} inspection(s)</p>
          </div>
          <button
            onClick={resetApp}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors"
          >
            Upload New CSV
          </button>
        </div>

        {/* Inspection Tabs */}
        <div className="mb-6 bg-slate-800/50 rounded-lg p-2 backdrop-blur">
          <div className="flex gap-2 overflow-x-auto">
            {inspections.map((insp, idx) => (
              <button
                key={idx}
                onClick={() => {
                  setCurrentInspectionIndex(idx);
                  setCurrentComparisonIndex(0);
                }}
                className={`px-4 py-2 rounded-lg whitespace-nowrap transition-colors ${
                  currentInspectionIndex === idx
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <div className="text-sm font-medium">
                  {insp.vehicle ? `${insp.vehicle.year} ${insp.vehicle.make}` : `Inspection ${idx + 1}`}
                </div>
                <div className="text-xs opacity-75">
                  {insp.comparisons.length} comparison{insp.comparisons.length !== 1 ? 's' : ''}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between mb-6 bg-slate-800/50 rounded-lg p-4 backdrop-blur">
          <div className="flex items-center gap-4">
            <span className="text-white font-medium">Zoom:</span>
            <button onClick={() => adjustZoom(-10)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
              <ZoomOut className="w-5 h-5 text-white" />
            </button>
            <span className="text-white font-mono min-w-16 text-center">{zoom}%</span>
            <button onClick={() => adjustZoom(10)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors">
              <ZoomIn className="w-5 h-5 text-white" />
            </button>
            <button onClick={() => setZoom(100)} className="ml-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white text-sm transition-colors">
              Reset
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={goToPreviousComparison} disabled={currentComparisonIndex === 0} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>
            <span className="text-white px-4">
              {currentComparisonIndex + 1} / {currentInspection?.comparisons.length || 0}
            </span>
            <button onClick={goToNextComparison} disabled={!currentInspection || currentComparisonIndex === currentInspection.comparisons.length - 1} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>

        {/* Metadata */}
        {currentComparison?.metadata && (
          <div className="bg-slate-800/30 rounded-lg p-4 mb-6 border border-slate-700">
            <h3 className="text-white font-semibold mb-3">{currentComparison.name}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-slate-400">Inspection ID:</span>
                <span className="text-slate-300 ml-2 text-xs font-mono">{currentInspection.inspectionId}</span>
              </div>
              <div>
                <span className="text-slate-400">Camera:</span>
                <span className="text-slate-300 ml-2">{currentComparison.metadata.pov.simulatedCamera} {currentComparison.metadata.pov.simulatedCameraSide}</span>
              </div>
              <div>
                <span className="text-slate-400">Renditions:</span>
                <span className="text-slate-300 ml-2">{currentComparison.metadata.renditions.filter(r => r !== null).join(' → ')}</span>
              </div>
              <div>
                <span className="text-slate-400">Vehicle:</span>
                <span className="text-slate-300 ml-2">
                  {currentInspection.vehicle ? `${currentInspection.vehicle.year} ${currentInspection.vehicle.make} ${currentInspection.vehicle.model}` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Image Comparison */}
        {currentComparison && (
          <div className="grid grid-cols-3 gap-6">
            {[0, 1, 2].map((idx) => (
              <div key={idx} className="bg-slate-800/50 rounded-xl p-4 backdrop-blur border border-slate-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-white">
                    {idx === 0 ? 'Previous' : idx === 1 ? 'Latest' : 'Reserved'}
                  </h3>
                  {currentComparison.metadata?.renditions?.[idx] !== null && currentComparison.metadata?.renditions?.[idx] !== undefined && (
                    <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded">
                      R{currentComparison.metadata.renditions[idx]}
                    </span>
                  )}
                </div>
                <div className="aspect-square rounded-lg overflow-hidden bg-slate-900 flex items-center justify-center">
                  {currentComparison.images[idx] ? (
                    <img
                      src={currentComparison.images[idx]}
                      alt={`Version ${idx + 1}`}
                      style={{ transform: `scale(${zoom / 100})`, transition: 'transform 0.2s ease' }}
                      className="max-w-full max-h-full object-contain"
                      onError={(e) => { e.target.src = ''; e.target.alt = 'Failed to load'; }}
                    />
                  ) : (
                    <div className="text-slate-500 text-center">
                      <div className="text-4xl mb-2">📭</div>
                      <div className="text-sm">Empty Slot</div>
                    </div>
                  )}
                </div>
                {currentComparison.metadata?.statuses?.[idx] && (
                  <div className="mt-2 text-xs text-center text-slate-400">
                    {currentComparison.metadata.statuses[idx]}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}