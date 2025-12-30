import React, { useEffect, useMemo, useState } from "react";
import {
  Upload,
  ZoomIn,
  ZoomOut,
  FileText,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Sun,
  Moon,
} from "lucide-react";

// HARDCODED API CONFIGURATION
const API_CONFIG = {
  url: "http://localhost:8080/api/get-uvpaint-inspections",
};

// ---------- Aggregated Metrics ----------
const sumActionMap = (m) => {
  if (!m || typeof m !== "object") return 0;
  return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
};

const parseUv360CategoryToSimCamSide = (category) => {
  if (!category) return { simulatedCamera: "N/A", simulatedCameraSide: "N/A" };
  const parts = String(category).split("_");
  const cam = parts[0] ? parts[0].charAt(0) + parts[0].slice(1).toLowerCase() : "N/A";
  const side = parts[1] ? parts[1].charAt(0) + parts[1].slice(1).toLowerCase() : "N/A";
  return { simulatedCamera: cam, simulatedCameraSide: side };
};

const computeAggregatedMetrics = (processedInspections) => {
  const tableA = [];
  const aggD = new Map();

  const addToTableD = ({ imageType, simulatedCamera, simulatedCameraSide, originalCameraId, actions }) => {
    const key = [imageType || "N/A", simulatedCamera || "N/A", simulatedCameraSide || "N/A", originalCameraId || "N/A"].join("|");

    if (!aggD.has(key)) {
      aggD.set(key, {
        imageType: imageType || "N/A",
        simulatedCamera: simulatedCamera || "N/A",
        simulatedCameraSide: simulatedCameraSide || "N/A",
        originalCameraId: originalCameraId || "N/A",
        images: 0,
        totalActions: 0,
      });
    }

    const row = aggD.get(key);
    row.images += 1;
    row.totalActions += Number(actions) || 0;
  };

  processedInspections.forEach((insp, idx) => {
    const uvpaintData = insp.rawInspection?.uvpaintData;

    const publishedUvpaint = (uvpaintData?.images || []).filter(
      (img) => img?.isActive && img?.activeImage && img?.pov && img.imageType !== "Artemis"
    );

    const publishedUv360 = (uvpaintData?.uv360Images || []).filter((img) => !!img?.Uv360ProcessedImage);

    const publishedCount = publishedUvpaint.length + publishedUv360.length;

    let totalActions = 0;
    let imagesWithActions = 0;

    publishedUvpaint.forEach((img) => {
      const actions = sumActionMap(img.actionsCounterMap);
      totalActions += actions;
      if (actions > 0) imagesWithActions += 1;
    });

    const avgActionsPerImage = publishedCount > 0 ? totalActions / publishedCount : 0;

    const label = insp.vehicle
      ? `${insp.vehicle.year || ""} ${insp.vehicle.make || ""} ${insp.vehicle.model || ""}`.trim()
      : `Inspection ${idx + 1}`;

    tableA.push({
      inspectionIndex: idx + 1,
      inspectionId: insp.inspectionId,
      label,
      publishedCount,
      imagesWithActions,
      avgActionsPerImage,
    });

    publishedUvpaint.forEach((img) => {
      addToTableD({
        imageType: img.imageType,
        simulatedCamera: img.pov?.simulatedCamera,
        simulatedCameraSide: img.pov?.simulatedCameraSide,
        originalCameraId: img.pov?.originalCameraId || "N/A",
        actions: sumActionMap(img.actionsCounterMap),
      });
    });

    publishedUv360.forEach((img) => {
      const category = img?.pov?.category;
      const { simulatedCamera, simulatedCameraSide } = parseUv360CategoryToSimCamSide(category);

      addToTableD({
        imageType: "UV360",
        simulatedCamera,
        simulatedCameraSide,
        originalCameraId: "N/A",
        actions: 0,
      });
    });
  });

  const tableD = Array.from(aggD.values()).map((r) => ({
    ...r,
    avgActionsPerImage: r.images > 0 ? r.totalActions / r.images : 0,
  }));

  tableD.sort((a, b) => b.avgActionsPerImage - a.avgActionsPerImage);

  return { tableA, tableD };
};

// ✅ Validation: Compare metrics counts with actual comparison cards
const validateMetricsAlignment = (processedInspections) => {
  const validation = {
    totalPublishedInMetrics: 0,
    totalPublishedInCards: 0,
    totalGeneratedInCards: 0,
    mismatches: [],
    breakdown: {
      byInspection: [],
    },
  };

  processedInspections.forEach((insp, idx) => {
    const uvpaintData = insp.rawInspection?.uvpaintData;
    
    // Count from metrics logic
    const publishedUvpaint = (uvpaintData?.images || []).filter(
      (img) => img?.isActive && img?.activeImage && img?.pov && img.imageType !== "Artemis"
    );
    const publishedUv360 = (uvpaintData?.uv360Images || []).filter((img) => !!img?.Uv360ProcessedImage);
    const metricsCount = publishedUvpaint.length + publishedUv360.length;

    // Count from cards logic
    let cardPublishedCount = 0;
    let cardGeneratedCount = 0;

    insp.comparisons?.forEach((comp) => {
      const renditionData = comp.metadata?.renditionData || [];
      
      // Check Previous (idx 0) and Latest (idx 1) slots
      for (let slotIdx = 0; slotIdx < 2; slotIdx++) {
        const data = renditionData[slotIdx];
        if (!data || !data.activeImage) continue;

        if (data.imageType === "UV360") {
          if (data.hasUv360Processed) {
            cardPublishedCount++;
          } else {
            cardGeneratedCount++;
          }
        } else {
          // uvpaint: Published = isActive && activeImage exists
          if (data.isActive && data.activeImage) {
            cardPublishedCount++;
          } else {
            cardGeneratedCount++;
          }
        }
      }
    });

    validation.totalPublishedInMetrics += metricsCount;
    validation.totalPublishedInCards += cardPublishedCount;
    validation.totalGeneratedInCards += cardGeneratedCount;

    const diff = Math.abs(metricsCount - cardPublishedCount);
    if (diff > 0) {
      validation.mismatches.push({
        inspectionId: insp.inspectionId,
        inspectionIndex: idx + 1,
        metricsCount,
        cardPublishedCount,
        cardGeneratedCount,
        difference: diff,
      });
    }

    validation.breakdown.byInspection.push({
      inspectionId: insp.inspectionId,
      inspectionIndex: idx + 1,
      metricsPublished: metricsCount,
      cardPublished: cardPublishedCount,
      cardGenerated: cardGeneratedCount,
      comparisons: insp.comparisons?.length || 0,
    });
  });

  return validation;
};

// ---------- Metrics Tab UI ----------
function MetricsTab({ tableA, tableD, onJumpToInspection, validation }) {
  return (
    <div className="space-y-8">
      {/* ✅ Validation & Breakdown Section */}
      {validation && (
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">Validation & Breakdown</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm mb-1">Total Published (Metrics)</div>
              <div className="text-white text-2xl font-bold">{validation.totalPublishedInMetrics}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm mb-1">Total Published (Cards)</div>
              <div className="text-white text-2xl font-bold">{validation.totalPublishedInCards}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm mb-1">Total Generated (Cards)</div>
              <div className="text-white text-2xl font-bold">{validation.totalGeneratedInCards}</div>
            </div>
          </div>

          {validation.mismatches.length > 0 && (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
              <div className="text-yellow-400 font-semibold mb-2">
                ⚠️ {validation.mismatches.length} Mismatch(es) Found
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                {validation.mismatches.slice(0, 5).map((m, idx) => (
                  <div key={idx}>
                    Inspection {m.inspectionIndex}: Metrics={m.metricsCount}, Cards={m.cardPublishedCount} (diff: {m.difference})
                  </div>
                ))}
                {validation.mismatches.length > 5 && (
                  <div className="text-slate-400">... and {validation.mismatches.length - 5} more</div>
                )}
              </div>
            </div>
          )}

          {validation.mismatches.length === 0 && (
            <div className="mb-4 p-3 bg-green-900/20 border border-green-700/50 rounded-lg">
              <div className="text-green-400 font-semibold">✅ All metrics aligned with cards</div>
            </div>
          )}

          {/* Breakdown Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="text-slate-300">
                <tr>
                  <th className="text-left py-2 pr-4 border border-slate-600">Inspection</th>
                  <th className="text-left py-2 pr-4 border border-slate-600">Metrics Published</th>
                  <th className="text-left py-2 pr-4 border border-slate-600">Card Published</th>
                  <th className="text-left py-2 pr-4 border border-slate-600">Card Generated</th>
                  <th className="text-left py-2 pr-4 border border-slate-600">Comparisons</th>
                  <th className="text-left py-2 pr-4 border border-slate-600">Status</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {validation.breakdown.byInspection.map((item) => {
                  const isAligned = item.metricsPublished === item.cardPublished;
                  return (
                    <tr key={item.inspectionId} className="hover:bg-slate-800/40">
                      <td className="py-2 pr-4 border border-slate-600">
                        <button
                          className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                          onClick={() => onJumpToInspection?.(item.inspectionId)}
                          title={item.inspectionId}
                        >
                          #{item.inspectionIndex}
                        </button>
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">{item.metricsPublished}</td>
                      <td className="py-2 pr-4 border border-slate-600">{item.cardPublished}</td>
                      <td className="py-2 pr-4 border border-slate-600">{item.cardGenerated}</td>
                      <td className="py-2 pr-4 border border-slate-600">{item.comparisons}</td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {isAligned ? (
                          <span className="text-green-400">✓ Aligned</span>
                        ) : (
                          <span className="text-yellow-400">⚠ Mismatch</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-3"> Inspection Health</h2>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="text-slate-300">
              <tr>
                <th className="text-left py-2 pr-4 border border-slate-600">Inspection</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Published Images</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Images w/ Actions</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Avg Actions / Image</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {tableA.map((r) => (
                <tr key={r.inspectionId} className="hover:bg-slate-800/40">
                  <td className="py-2 pr-4 border border-slate-600">
                    <button
                      className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                      onClick={() => onJumpToInspection?.(r.inspectionId)}
                      title={r.inspectionId}
                    >
                      {r.label || `Inspection ${r.inspectionIndex}`}
                    </button>
                  </td>
                  <td className="py-2 pr-4 border border-slate-600">{r.publishedCount}</td>
                  <td className="py-2 pr-4 border border-slate-600">{r.imagesWithActions}</td>
                  <td className="py-2 pr-4 border border-slate-600">{r.avgActionsPerImage.toFixed(2)}</td>
                </tr>
              ))}
              {tableA.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400 border border-slate-600" colSpan={4}>
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
        <h2 className="text-white font-semibold mb-3"> Camera / POV Heatmap (Aggregate)</h2>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm border-collapse">
            <thead className="text-slate-300">
              <tr>
                <th className="text-left py-2 pr-4 border border-slate-600">Image Type</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Sim Cam</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Sim Side</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Original Cam</th>
                <th className="text-left py-2 pr-4 border border-slate-600"># Images</th>
                <th className="text-left py-2 pr-4 border border-slate-600">Avg Actions / Image</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {tableD.map((r, idx) => (
                <tr
                  key={`${r.imageType}|${r.simulatedCamera}|${r.simulatedCameraSide}|${r.originalCameraId}|${idx}`}
                  className="hover:bg-slate-800/40"
                >
                  <td className="py-2 pr-4 border border-slate-600">{r.imageType}</td>
                  <td className="py-2 pr-4 border border-slate-600">{r.simulatedCamera}</td>
                  <td className="py-2 pr-4 border border-slate-600">{r.simulatedCameraSide}</td>
                  <td className="py-2 pr-4 font-mono text-xs border border-slate-600">{r.originalCameraId}</td>
                  <td className="py-2 pr-4 border border-slate-600">{r.images}</td>
                  <td className="py-2 pr-4 border border-slate-600">{r.avgActionsPerImage.toFixed(2)}</td>
                </tr>
              ))}
              {tableD.length === 0 && (
                <tr>
                  <td className="py-3 text-slate-400 border border-slate-600" colSpan={6}>
                    No data
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function ImageComparison() {
  const [inspections, setInspections] = useState([]);
  const [currentInspectionIndex, setCurrentInspectionIndex] = useState(0);
  const [currentComparisonIndex, setCurrentComparisonIndex] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [loadMethod, setLoadMethod] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [activeView, setActiveView] = useState("comparisons"); // 'comparisons' | 'metrics'
  const [metrics, setMetrics] = useState({ tableA: [], tableD: [], validation: null });

  // theme toggle (local state only)
  const [theme, setTheme] = useState("dark"); // 'dark' | 'light'

  const themeVars = useMemo(() => {
    if (theme === "light") {
      return {
        pageBg: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f8fafc 100%)",
        panelBg: "rgba(255,255,255,0.75)",
        panelBorder: "rgba(15,23,42,0.10)",
        text: "#0f172a",
        subText: "#475569",
        headerText: "#0f172a",
        chipBg: "#eef2ff",
        chipText: "#3730a3",
        cardBg: "#ffffff",
        cardBorder: "#e5e7eb",
      };
    }
    return {
      pageBg: "linear-gradient(135deg, #0f172a 0%, #1f2937 50%, #0f172a 100%)",
      panelBg: "rgba(30,41,59,0.50)",
      panelBorder: "rgba(148,163,184,0.25)",
      text: "#ffffff",
      subText: "#94a3b8",
      headerText: "#ffffff",
      chipBg: "rgba(99,102,241,0.15)",
      chipText: "#c7d2fe",
      cardBg: "rgba(15,23,42,0.35)",
      cardBorder: "rgba(148,163,184,0.20)",
    };
  }, [theme]);

  // fixed slot mapping (prevents regression)
  const SLOTS = useMemo(
    () => [
      { label: "Previous", idx: 0 },
      { label: "Latest", idx: 1 },
      { label: "Original", idx: 2 },
    ],
    []
  );

  const IMAGE_TYPE_ORDER = useMemo(() => ({ UV360: 0, SlimOverview: 1, Zoomer: 2 }), []);

  const safeUrl = (u) => (typeof u === "string" && u.trim() ? u.trim() : null);

  const safeText = (v) => {
    if (v === null || v === undefined) return "N/A";
    const s = String(v).trim();
    return s ? s : "N/A";
  };

  const pickOriginalUrl = (obj) => {
    if (!obj) return null;
    const candidates = [
      obj.originalImage,
      obj.originalImageUrl,
      obj.originalImageWithBackground,
      obj.originalImageWithoutBackground,
    ];
    return candidates.find((u) => typeof u === "string" && u.trim())?.trim() || null;
  };

  const createPOVKey = (imageType, pov, category = null) => {
    if (imageType === "UV360") {
      return `UV360_${category || "unknown"}_${pov?.serialNumber ?? "none"}`;
    }
    return `${imageType}_${pov?.simulatedCamera || "NA"}_${pov?.simulatedCameraSide || "NA"}_${pov?.serialNumber ?? "none"}`;
  };

  const parseUv360CameraSide = (category) => {
    const parts = String(category || "").split("_");
    const camera = parts[0] ? parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase() : "N/A";
    const side = parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1).toLowerCase() : "N/A";
    return { camera, side };
  };

  // ✅ slot-level Published flag - ALIGNED WITH METRICS LOGIC
  // Metrics logic:
  // - uvpaint: Published = isActive && activeImage && pov && imageType !== "Artemis"
  // - UV360: Published = has Uv360ProcessedImage
  const getSlotPublishLabel = (metadata, idx) => {
    if (idx === 2) return "Original";
    
    const renditionData = metadata?.renditionData?.[idx];
    if (!renditionData) return "Generated";

    // ✅ Match metrics logic exactly
    if (renditionData.imageType === "UV360") {
      return renditionData.hasUv360Processed ? "Published" : "Generated";
    } else {
      // For uvpaint images: Published = isActive && activeImage exists
      const hasActiveImage = Boolean(renditionData.activeImage);
      return renditionData.isActive && hasActiveImage ? "Published" : "Generated";
    }
  };

  // ✅ row-level Published flag - ALIGNED WITH METRICS LOGIC
  const isRowPublished = (row) => {
    // Check if any slot in this row is Published according to metrics logic
    const renditionData = row?.metadata?.renditionData || [];
    
    for (let idx = 0; idx < 2; idx++) { // Only check Previous (0) and Latest (1), not Original (2)
      const data = renditionData[idx];
      if (!data) continue;

      if (data.imageType === "UV360") {
        if (data.hasUv360Processed) return true;
      } else {
        // uvpaint: Published = isActive && activeImage exists
        if (data.isActive && data.activeImage) return true;
      }
    }
    
    return false;
  };

  const processInspectionData = (inspection) => {
    const uvpaintData = inspection?.uvpaintData;
    if (!uvpaintData) return [];

    const rowsByPOV = {};

    const ensureRow = ({ povKey, imageType, pov, category }) => {
      if (!rowsByPOV[povKey]) {
        rowsByPOV[povKey] = {
          imageType,
          pov,
          category,
          renditions: {},
          _sourcesSet: new Set(),
        };
      }
      return rowsByPOV[povKey];
    };

    const putRendition = ({
      imageType,
      pov,
      category = null,
      rendition,
      activeImage,
      status,
      source,
      actions = "N/A",
      originalImage,
      isActive = false, // ✅ Track isActive for metrics alignment
      hasUv360Processed = false, // ✅ Track UV360 processed status
    }) => {
      if (!pov) return;
      const povKey = createPOVKey(imageType, pov, category);
      const row = ensureRow({ povKey, imageType, pov, category });

      const rNum = Number.isFinite(Number(rendition)) ? Number(rendition) : null;
      if (rNum === null) return;

      const src = source || "N/A";
      row._sourcesSet.add(src);

      // ✅ store explicit fields for UI on all cards
      row.renditions[rNum] = {
        imageType: imageType || "N/A",
        status: status || "N/A",
        activeImage: safeUrl(activeImage),
        originalImage: safeUrl(originalImage),
        image: safeUrl(activeImage), // keep old key used by rendering
        source: src,
        actions,
        isActive, // ✅ Store for Published determination
        hasUv360Processed, // ✅ Store for Published determination
      };
    };

    // uvpaintData.images (Generated latest)
    if (Array.isArray(uvpaintData.images)) {
      uvpaintData.images.forEach((img) => {
        if (!img || img.imageType === "Artemis") return;
        if (!img.pov) return;

        // ✅ Metrics alignment: Published = isActive && activeImage && pov && imageType !== "Artemis"
        const isPublished = Boolean(
          img?.isActive && img?.activeImage && img?.pov && img.imageType !== "Artemis"
        );

        putRendition({
          imageType: img.imageType,
          pov: img.pov,
          rendition: img.rendition ?? 3,
          activeImage: img.activeImage,
          status: img.status,
          source: "images",
          actions: img.actionsCounterMap ? sumActionMap(img.actionsCounterMap) : 0,
          originalImage: pickOriginalUrl(img),
          isActive: img.isActive || false,
          hasUv360Processed: false,
        });
      });
    }

    // uvpaintHistoryImages (Generated history)
    if (Array.isArray(uvpaintData.uvpaintHistoryImages)) {
      uvpaintData.uvpaintHistoryImages.forEach((img) => {
        if (!img || img.imageType === "Artemis") return;
        if (!img.pov) return;

        putRendition({
          imageType: img.imageType,
          pov: img.pov,
          rendition: img.rendition ?? 1,
          activeImage: img.activeImage,
          status: img.status,
          source: "uvpaintHistoryImages",
          actions: img.actionsCounterMap ? sumActionMap(img.actionsCounterMap) : 0,
          originalImage: pickOriginalUrl(img),
          isActive: img.isActive || false,
          hasUv360Processed: false,
        });
      });
    }

    // uv360Images (Published latest)
    if (Array.isArray(uvpaintData.uv360Images)) {
      uvpaintData.uv360Images.forEach((img) => {
        const pov = img?.pov || {};
        const category = pov.category || "";
        if (!category) return;

        const processed = safeUrl(img.Uv360ProcessedImage);
        if (!processed) return;

        // ✅ Metrics alignment: Published = has Uv360ProcessedImage
        const hasUv360Processed = Boolean(img?.Uv360ProcessedImage);

        const { camera, side } = parseUv360CameraSide(category);

        putRendition({
          imageType: "UV360",
          pov: { simulatedCamera: camera, simulatedCameraSide: side, serialNumber: pov.serialNumber },
          category,
          rendition: img.rendition ?? 2,
          activeImage: processed,
          status: "Published",
          source: "uv360Images",
          actions: "N/A",
          originalImage: pickOriginalUrl(img),
          isActive: false,
          hasUv360Processed,
        });
      });
    }

    // uv360HistoryImages (Published history)
    if (Array.isArray(uvpaintData.uv360HistoryImages)) {
      uvpaintData.uv360HistoryImages.forEach((img) => {
        const pov = img?.pov || {};
        const category = pov.category || "";
        if (!category) return;

        const processed = safeUrl(img.Uv360ProcessedImage);
        if (!processed) return;

        // ✅ Metrics alignment: Published = has Uv360ProcessedImage
        const hasUv360Processed = Boolean(img?.Uv360ProcessedImage);

        const { camera, side } = parseUv360CameraSide(category);

        putRendition({
          imageType: "UV360",
          pov: { simulatedCamera: camera, simulatedCameraSide: side, serialNumber: pov.serialNumber },
          category,
          rendition: img.rendition ?? 0,
          activeImage: processed,
          status: "History-Published",
          source: "uv360HistoryImages",
          actions: "N/A",
          originalImage: pickOriginalUrl(img),
          isActive: false,
          hasUv360Processed,
        });
      });
    }

    // ----------------------------
    // ✅ Static originals index from SlimOverview serialNumber=-1 using **img.originalImage**
    //    Keep full object so we can display its fields on the Original card too.
    // ----------------------------
    const norm = (s) => String(s || "").trim().toLowerCase();

    const normCam = (cam) => {
      const c = norm(cam);
      if (c.startsWith("front")) return "front";
      if (c.startsWith("rear")) return "rear";
      return null;
    };

    const normSide = (side) => {
      const s = norm(side);
      if (s.startsWith("left")) return "left";
      if (s.startsWith("right")) return "right";
      return null;
    };

    const ORIGINAL_PRIORITY = {
      images: 30,
      uvpaintHistoryImages: 10,
      uv360Images: 5,
      uv360HistoryImages: 0,
    };

    // front_right -> { url, source, priority, obj }
    const originalsByPov = {};

    const considerStaticOriginal = (img, sourceName) => {
      if (!img) return;
      if (img.imageType !== "SlimOverview") return;

      const pov = img.pov;
      if (!pov) return;

      const serial = Number(pov.serialNumber);
      if (serial !== -1) return;

      const cam = normCam(pov.simulatedCamera);
      const side = normSide(pov.simulatedCameraSide);
      if (!cam || !side) return;

      const key = `${cam}_${side}`;

      // ✅ requirement: originalImage
      const url = safeUrl(img.originalImage);
      if (!url) return;

      const pr = ORIGINAL_PRIORITY[sourceName] ?? 0;
      const existing = originalsByPov[key];

      if (!existing || pr > existing.priority) {
        originalsByPov[key] = { url, source: sourceName, priority: pr, obj: img };
      }
    };

    (uvpaintData.images || []).forEach((img) => considerStaticOriginal(img, "images"));
    (uvpaintData.uvpaintHistoryImages || []).forEach((img) => considerStaticOriginal(img, "uvpaintHistoryImages"));
    (uvpaintData.uv360Images || []).forEach((img) => considerStaticOriginal(img, "uv360Images"));
    (uvpaintData.uv360HistoryImages || []).forEach((img) => considerStaticOriginal(img, "uv360HistoryImages"));

    // Build groups
    const groups = [];

    Object.entries(rowsByPOV).forEach(([povKey, row]) => {
      const renditionNums = Object.keys(row.renditions)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);

      if (renditionNums.length === 0) return;

      const latestR = renditionNums[0];
      const prevR = renditionNums[1] ?? null;

      const latest = row.renditions[latestR];
      const prev = prevR !== null ? row.renditions[prevR] : null;

      const cameraLabel = `${row.pov?.simulatedCamera || "N/A"} ${row.pov?.simulatedCameraSide || ""}`.trim();

      // ✅ Original card pulls from the 4 static SlimOverview originalImage URLs
      const camKey = normCam(row.pov?.simulatedCamera);
      const sideKey = normSide(row.pov?.simulatedCameraSide);
      const ogKey = camKey && sideKey ? `${camKey}_${sideKey}` : null;

      const originalEntry = ogKey ? originalsByPov?.[ogKey] || null : null;
      const originalUrl = originalEntry?.url || null;
      const originalFrom = originalEntry?.source || "N/A";
      const originalObj = originalEntry?.obj || null;

      const povFrom = latest?.source || prev?.source || "N/A";
      const povSources = Array.from(row._sourcesSet || []);

      // ✅ per-card info for all 3 cards
      const prevInfo = prev
        ? {
            imageType: safeText(prev.imageType),
            status: safeText(prev.status),
            originalImage: safeText(prev.originalImage),
            activeImage: safeText(prev.activeImage),
          }
        : null;

      const latestInfo = latest
        ? {
            imageType: safeText(latest.imageType),
            status: safeText(latest.status),
            originalImage: safeText(latest.originalImage),
            activeImage: safeText(latest.activeImage),
          }
        : null;

      const originalInfo = originalObj
        ? {
            imageType: safeText(originalObj.imageType),
            status: safeText(originalObj.status),
            originalImage: safeText(originalObj.originalImage),
            activeImage: safeText(originalObj.activeImage),
          }
        : null;

      // ✅ Store rendition data for Published determination (aligned with metrics)
      const renditionData = [
        prev ? {
          imageType: prev.imageType,
          isActive: prev.isActive || false,
          hasUv360Processed: prev.hasUv360Processed || false,
          activeImage: prev.activeImage,
        } : null,
        latest ? {
          imageType: latest.imageType,
          isActive: latest.isActive || false,
          hasUv360Processed: latest.hasUv360Processed || false,
          activeImage: latest.activeImage,
        } : null,
        null, // Original slot doesn't use Published logic
      ];

      const group = {
        id: `${inspection.inspectionId}_${povKey}`,
        name: `${cameraLabel} (${row.imageType})`,
        sortKey: {
          typeOrder: IMAGE_TYPE_ORDER[row.imageType] ?? 999,
          cam: (row.pov?.simulatedCamera || "").toLowerCase(),
          side: (row.pov?.simulatedCameraSide || "").toLowerCase(),
          serial: Number(row.pov?.serialNumber ?? 0),
        },
        images: [
          safeUrl(prev?.image),     // Previous
          safeUrl(latest?.image),   // Latest
          safeUrl(originalUrl),     // Original (static SlimOverview originalImage)
        ],
        metadata: {
          inspectionId: inspection.inspectionId,
          vehicle: inspection.uvpaintInspection?.vehicleInfo,

          pov: row.pov,
          povFrom,
          povSources,

          imageType: row.imageType,
          renditions: [prevR, latestR, originalUrl ? "OG" : null],
          statuses: [
            prev?.status || (prevR !== null ? "N/A" : "Empty"),
            latest?.status || "N/A",
            originalUrl ? "Original" : "Empty",
          ],
          sources: [
            prev?.source || (prevR !== null ? "N/A" : "Empty"),
            latest?.source || "N/A",
            originalUrl ? `SlimOverview_-1_static:${originalFrom}` : "Empty",
          ],
          actions: [
            prev?.actions ?? "N/A",
            latest?.actions ?? "N/A",
            "N/A",
          ],
          totalVersions: renditionNums.length,

          // ✅ NEW: fields displayed on each card
          cardInfo: [prevInfo, latestInfo, originalInfo],

          // ✅ Rendition data for Published determination (aligned with metrics)
          renditionData,

          // extra debug
          originalStaticKey: ogKey || "N/A",
        },
      };

      group.metadata.published = isRowPublished(group);
      groups.push(group);
    });

    // Published rows first, then your existing sort
    groups.sort((a, b) => {
      const ap = a.metadata?.published ? 1 : 0;
      const bp = b.metadata?.published ? 1 : 0;
      if (ap !== bp) return bp - ap;

      if (a.sortKey.typeOrder !== b.sortKey.typeOrder) return a.sortKey.typeOrder - b.sortKey.typeOrder;
      if (a.sortKey.cam !== b.sortKey.cam) return a.sortKey.cam.localeCompare(b.sortKey.cam);
      if (a.sortKey.side !== b.sortKey.side) return a.sortKey.side.localeCompare(b.sortKey.side);
      return (a.sortKey.serial || 0) - (b.sortKey.serial || 0);
    });

    return groups;
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    setError("");

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());

      const startIndex = lines[0].toLowerCase().includes("inspection") ? 1 : 0;
      const inspectionIds = lines
        .slice(startIndex)
        .map((line) => line.split(",")[0].trim())
        .filter((id) => id);

      if (inspectionIds.length === 0) throw new Error("No inspection IDs found in CSV");

      const processedInspections = [];

      for (const inspectionId of inspectionIds) {
        try {
          const response = await fetch(API_CONFIG.url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ inspectionIds: [inspectionId] }),
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
              inspectionId,
              vehicle: inspection.uvpaintInspection?.vehicleInfo,
              comparisons,
              rawInspection: inspection,
            });
          }
        } catch (err) {
          console.error(`Error processing inspection ${inspectionId}:`, err);
        }
      }

      if (processedInspections.length === 0) throw new Error("No valid inspections could be processed");

      const aggregated = computeAggregatedMetrics(processedInspections);
      const validation = validateMetricsAlignment(processedInspections);
      setMetrics({ ...aggregated, validation });

      setInspections(processedInspections);
      setCurrentInspectionIndex(0);
      setCurrentComparisonIndex(0);
      setActiveView("comparisons");
      setLoadMethod("csv");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const adjustZoom = (delta) => setZoom((prev) => Math.max(50, Math.min(200, prev + delta)));

  const goToPreviousComparison = () => setCurrentComparisonIndex((prev) => Math.max(0, prev - 1));

  const goToNextComparison = () => {
    const currentInspection = inspections[currentInspectionIndex];
    if (!currentInspection) return;
    setCurrentComparisonIndex((prev) => Math.min(currentInspection.comparisons.length - 1, prev + 1));
  };

  const goToPrevInspection = () => {
    setCurrentInspectionIndex((prev) => {
      const next = Math.max(0, prev - 1);
      if (next !== prev) setCurrentComparisonIndex(0);
      return next;
    });
  };

  const goToNextInspection = () => {
    setCurrentInspectionIndex((prev) => {
      const next = Math.min(inspections.length - 1, prev + 1);
      if (next !== prev) setCurrentComparisonIndex(0);
      return next;
    });
  };

  const resetApp = () => {
    setLoadMethod(null);
    setInspections([]);
    setCurrentInspectionIndex(0);
    setCurrentComparisonIndex(0);
    setActiveView("comparisons");
    setMetrics({ tableA: [], tableD: [], validation: null });
    setError("");
  };

  const currentInspection = inspections[currentInspectionIndex];
  const currentComparison = currentInspection?.comparisons?.[currentComparisonIndex];

  useEffect(() => {
    if (!loadMethod || activeView !== "comparisons") return;

    const onKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        goToPreviousComparison();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        goToNextComparison();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        goToPrevInspection();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        goToNextInspection();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loadMethod, activeView, currentInspectionIndex, inspections, currentComparisonIndex]);

  const jumpOptions = useMemo(() => {
    const comps = currentInspection?.comparisons || [];
    return comps.map((c, idx) => {
      const flag = c?.metadata?.published ? "PUBLISHED" : "GENERATED";
      return {
        idx,
        label: `${String(idx + 1).padStart(3, "0")} — [${flag}] ${c.name}`,
        value: String(idx),
      };
    });
  }, [currentInspection]);

  const themeVarsMemo = themeVars;

  const pageStyle = { background: themeVarsMemo.pageBg };

  const cardStyle = {
    background: themeVarsMemo.cardBg,
    border: `1px solid ${themeVarsMemo.cardBorder}`,
  };

  const panelStyle = {
    background: themeVarsMemo.panelBg,
    border: `1px solid ${themeVarsMemo.panelBorder}`,
    backdropFilter: "blur(10px)",
  };

  const comparisonCss = `
  .comparisonGrid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 16px;
    align-items: stretch;
  }
  @media (max-width: 1024px) {
    .comparisonGrid { grid-template-columns: 1fr; }
  }
  .comparisonCard {
    border-radius: 16px;
    padding: 14px;
    overflow: hidden;
  }
  .comparisonHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }
  .comparisonTitle {
    font-size: 16px;
    font-weight: 700;
    line-height: 1.2;
  }
  .comparisonBadges {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .comparisonBadge {
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 700;
    white-space: nowrap;
  }

  /* Debug block */
  .comparisonDebug {
    margin: 6px 0 10px 0;
    padding: 8px 10px;
    border-radius: 10px;
    font-size: 11px;
    line-height: 1.35;
    opacity: 0.95;
    overflow: hidden;
  }
  .comparisonDebugRow {
    display: flex;
    gap: 8px;
    align-items: baseline;
    margin-bottom: 6px;
  }
  .comparisonDebugLabel {
    font-weight: 700;
    opacity: 0.85;
    white-space: nowrap;
  }
  .comparisonDebugValue {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    word-break: break-all;
  }
  .comparisonDebugPre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  }

  .comparisonImageBox {
    height: 420px;
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .comparisonImg {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transform-origin: center center;
    will-change: transform;
    user-select: none;
    -webkit-user-drag: none;
  }
  .comparisonEmpty {
    height: 100%;
    width: 100%;
    display: grid;
    place-items: center;
    opacity: 0.9;
  }
  .comparisonEmptyIcon { font-size: 32px; margin-bottom: 10px; }
  .comparisonEmptyText { font-size: 14px; }
  .comparisonStatus { margin-top: 10px; font-size: 12px; opacity: 0.9; }
  .imgFailed { opacity: 0.35; filter: grayscale(1); }
`;

  if (!loadMethod) {
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
        <style>{comparisonCss}</style>

        <div className="max-w-3xl w-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-4xl font-bold" style={{ color: themeVarsMemo.headerText }}>
                Image Comparison Platform
              </h1>
              <p style={{ color: themeVarsMemo.subText }}>Upload a CSV with inspection IDs to compare versions</p>
            </div>

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="px-3 py-2 rounded-lg flex items-center gap-2"
              style={panelStyle}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span style={{ color: themeVarsMemo.text }}>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
          </div>

          <div className="rounded-xl p-8" style={panelStyle}>
            <div className="flex items-center gap-4 mb-6">
              <FileText className="w-10 h-10" style={{ color: theme === "dark" ? "#60a5fa" : "#2563eb" }} />
              <div>
                <h3 className="text-xl font-semibold" style={{ color: themeVarsMemo.text }}>
                  Upload CSV File
                </h3>
                <p className="text-sm mt-1" style={{ color: themeVarsMemo.subText }}>
                  Each row should contain an inspection ID
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div
                className="text-xs font-mono p-3 rounded"
                style={{
                  background: theme === "dark" ? "rgba(15,23,42,0.5)" : "rgba(15,23,42,0.04)",
                  color: themeVarsMemo.subText,
                }}
              >
                <strong>CSV Format:</strong>
                <br />
                inspectionId
                <br />
                35336435-f455-46bc-a821-cbf2d60ec868
                <br />
                ...
                <br />
                <br />
                <strong>API Endpoint:</strong>
                <br />
                {API_CONFIG.url}
              </div>

              {error && (
                <div
                  className="rounded-lg p-3 text-sm"
                  style={{
                    border: "1px solid rgba(239,68,68,0.5)",
                    background: "rgba(239,68,68,0.08)",
                    color: "#ef4444",
                  }}
                >
                  {error}
                </div>
              )}

              <label className="block">
                <div
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
                  style={{
                    borderColor: theme === "dark" ? "rgba(148,163,184,0.35)" : "rgba(15,23,42,0.20)",
                    color: themeVarsMemo.text,
                  }}
                >
                  <Upload className="w-12 h-12 mx-auto mb-3" style={{ color: themeVarsMemo.subText }} />
                  <p>Click to upload CSV</p>
                  <p className="text-sm mt-1" style={{ color: themeVarsMemo.subText }}>
                    or drag and drop
                  </p>
                </div>
                <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" disabled={loading} />
              </label>

              {loading && (
                <div className="flex items-center justify-center gap-2" style={{ color: theme === "dark" ? "#60a5fa" : "#2563eb" }}>
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
    <div className="min-h-screen p-8" style={pageStyle}>
      <style>{comparisonCss}</style>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ color: themeVarsMemo.headerText }}>
              Image Comparison Platform
            </h1>
            <p style={{ color: themeVarsMemo.subText }}>Viewing {inspections.length} inspection(s)</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="px-3 py-2 rounded-lg flex items-center gap-2"
              style={panelStyle}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span style={{ color: themeVarsMemo.text }}>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>

            <button
              onClick={resetApp}
              className="px-4 py-2 rounded-lg transition-colors"
              style={{ ...panelStyle, color: themeVarsMemo.text }}
            >
              Upload New CSV
            </button>
          </div>
        </div>

        {/* Inspection Tabs */}
        <div className="mb-4 rounded-lg p-2" style={panelStyle}>
          <div className="flex gap-2 overflow-x-auto">
            {inspections.map((insp, idx) => {
              const selected = currentInspectionIndex === idx;
              return (
                <button
                  key={idx}
                  onClick={() => {
                    setCurrentInspectionIndex(idx);
                    setCurrentComparisonIndex(0);
                  }}
                  className="px-4 py-2 rounded-lg whitespace-nowrap transition-colors"
                  style={{
                    background: selected
                      ? (theme === "dark" ? "#2563eb" : "#1d4ed8")
                      : (theme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(15,23,42,0.06)"),
                    color: selected ? "#fff" : themeVarsMemo.text,
                  }}
                >
                  <div className="text-sm font-medium">
                    {insp.vehicle ? `${insp.vehicle.year} ${insp.vehicle.make}` : `Inspection ${idx + 1}`}
                  </div>
                  <div className="text-xs opacity-75">
                    {insp.comparisons.length} comparison{insp.comparisons.length !== 1 ? "s" : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setActiveView("comparisons")}
            className="px-4 py-2 rounded-lg"
            style={{
              background: activeView === "comparisons" ? (theme === "dark" ? "#2563eb" : "#1d4ed8") : theme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(15,23,42,0.06)",
              color: activeView === "comparisons" ? "#fff" : themeVarsMemo.text,
            }}
          >
            Comparisons
          </button>

          <button
            onClick={() => setActiveView("metrics")}
            className="px-4 py-2 rounded-lg"
            style={{
              background: activeView === "metrics" ? (theme === "dark" ? "#2563eb" : "#1d4ed8") : theme === "dark" ? "rgba(148,163,184,0.15)" : "rgba(15,23,42,0.06)",
              color: activeView === "metrics" ? "#fff" : themeVarsMemo.text,
            }}
          >
            Metrics
          </button>
        </div>

        {activeView === "metrics" ? (
          <MetricsTab
            tableA={metrics.tableA}
            tableD={metrics.tableD}
            validation={metrics.validation}
            onJumpToInspection={(inspectionId) => {
              const idx = inspections.findIndex((i) => i.inspectionId === inspectionId);
              if (idx >= 0) {
                setCurrentInspectionIndex(idx);
                setCurrentComparisonIndex(0);
                setActiveView("comparisons");
              }
            }}
          />
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6 rounded-lg p-4" style={panelStyle}>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ color: themeVarsMemo.text, fontWeight: 600 }}>Zoom:</span>
                <button onClick={() => adjustZoom(-10)} className="p-2 rounded-lg" style={panelStyle}>
                  <ZoomOut className="w-5 h-5" style={{ color: themeVarsMemo.text }} />
                </button>
                <span className="font-mono min-w-16 text-center" style={{ color: themeVarsMemo.text }}>
                  {zoom}%
                </span>
                <button onClick={() => adjustZoom(10)} className="p-2 rounded-lg" style={panelStyle}>
                  <ZoomIn className="w-5 h-5" style={{ color: themeVarsMemo.text }} />
                </button>
                <button
                  onClick={() => setZoom(100)}
                  className="ml-1 px-4 py-2 rounded-lg text-sm"
                  style={{ background: theme === "dark" ? "#2563eb" : "#1d4ed8", color: "#fff" }}
                >
                  Reset
                </button>

                {/* Jump dropdown */}
                <div className="flex items-center gap-2 ml-0 md:ml-3">
                  <span className="text-sm" style={{ color: themeVarsMemo.subText }}>
                    Jump:
                  </span>
                  <select
                    value={String(currentComparisonIndex)}
                    onChange={(e) => setCurrentComparisonIndex(Number(e.target.value))}
                    className="px-3 py-2 rounded-lg text-sm"
                    style={{
                      background: theme === "dark" ? "rgba(15,23,42,0.55)" : "#fff",
                      color: themeVarsMemo.text,
                      border: `1px solid ${themeVarsMemo.panelBorder}`,
                    }}
                  >
                    {jumpOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-xs ml-0 md:ml-2" style={{ color: themeVarsMemo.subText }}>
                  Shortcuts: ←/→ comparisons, ↑/↓ inspections
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentComparisonIndex((p) => Math.max(0, p - 1))}
                  disabled={currentComparisonIndex === 0}
                  className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  style={panelStyle}
                >
                  <ChevronLeft className="w-5 h-5" style={{ color: themeVarsMemo.text }} />
                </button>

                <span style={{ color: themeVarsMemo.text }} className="px-2">
                  {currentComparisonIndex + 1} / {currentInspection?.comparisons.length || 0}
                </span>

                <button
                  onClick={goToNextComparison}
                  disabled={!currentInspection || currentComparisonIndex === currentInspection.comparisons.length - 1}
                  className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  style={panelStyle}
                >
                  <ChevronRight className="w-5 h-5" style={{ color: themeVarsMemo.text }} />
                </button>
              </div>
            </div>

            {/* Metadata */}
            {currentComparison?.metadata && (
              <div className="rounded-lg p-4 mb-6" style={panelStyle}>
                <h3 className="font-semibold mb-3" style={{ color: themeVarsMemo.text }}>
                  {currentComparison.name}
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span style={{ color: themeVarsMemo.subText }}>Inspection ID:</span>
                    <span className="ml-2 text-xs font-mono" style={{ color: themeVarsMemo.text }}>
                      {currentInspection.inspectionId}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: themeVarsMemo.subText }}>Camera:</span>
                    <span className="ml-2" style={{ color: themeVarsMemo.text }}>
                      {currentComparison.metadata.pov?.simulatedCamera} {currentComparison.metadata.pov?.simulatedCameraSide}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: themeVarsMemo.subText }}>Renditions:</span>
                    <span className="ml-2" style={{ color: themeVarsMemo.text }}>
                      {(currentComparison.metadata.renditions || []).filter((r) => r !== null).join(" → ")}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: themeVarsMemo.subText }}>Vehicle:</span>
                    <span className="ml-2" style={{ color: themeVarsMemo.text }}>
                      {currentInspection.vehicle
                        ? `${currentInspection.vehicle.year} ${currentInspection.vehicle.make} ${currentInspection.vehicle.model}`
                        : "N/A"}
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <span style={{ color: themeVarsMemo.subText }}>Row type:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVarsMemo.text }}>
                      {currentComparison.metadata?.published ? "PUBLISHED" : "GENERATED"}
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <span style={{ color: themeVarsMemo.subText }}>Row sources:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVarsMemo.text }}>
                      {(currentComparison.metadata?.povSources || []).join(", ") || "N/A"}
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <span style={{ color: themeVarsMemo.subText }}>Static OG Key:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVarsMemo.text }}>
                      {currentComparison.metadata?.originalStaticKey || "N/A"}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Image Comparison */}
            {currentComparison && (
              <div className="comparisonGrid">
                {SLOTS.map(({ label, idx }) => {
                  const badge = currentComparison.metadata?.renditions?.[idx];
                  const actions = currentComparison.metadata?.actions?.[idx];

                  const imgUrl = currentComparison.images?.[idx] || null;
                  const povObj = currentComparison.metadata?.pov || null;

                  // ✅ fields for ALL cards
                  const info = currentComparison.metadata?.cardInfo?.[idx] || null;

                  const pubLabel = getSlotPublishLabel(currentComparison.metadata, idx);
                  const pubStyle =
                    pubLabel === "Published"
                      ? { background: "rgba(34,197,94,0.18)", color: themeVarsMemo.text, border: `1px solid ${themeVarsMemo.panelBorder}` }
                      : pubLabel === "Generated"
                      ? { background: "rgba(148,163,184,0.14)", color: themeVarsMemo.text, border: `1px solid ${themeVarsMemo.panelBorder}` }
                      : { background: themeVarsMemo.chipBg, color: themeVarsMemo.chipText };

                  return (
                    <div key={label} className="comparisonCard" style={cardStyle}>
                      <div className="comparisonHeader">
                        <h3 className="comparisonTitle" style={{ color: themeVarsMemo.headerText }}>
                          {label}
                        </h3>

                        <div className="comparisonBadges">
                          <span className="comparisonBadge" style={pubStyle}>
                            {pubLabel}
                          </span>

                          {badge !== null && badge !== undefined && (
                            <span className="comparisonBadge" style={{ background: themeVarsMemo.chipBg, color: themeVarsMemo.chipText }}>
                              {String(badge) === "OG" ? "OG" : `R${badge}`}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* ✅ Card info (ALL 3) */}
                      <div
                        className="comparisonDebug"
                        style={{
                          background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.04)",
                          border: `1px solid ${themeVarsMemo.panelBorder}`,
                          color: themeVarsMemo.text,
                        }}
                      >
                        <div className="comparisonDebugRow">
                          <span className="comparisonDebugLabel">imageType:</span>
                          <span className="comparisonDebugValue">{info?.imageType || "N/A"}</span>
                        </div>

                        <div className="comparisonDebugRow">
                          <span className="comparisonDebugLabel">status:</span>
                          <span className="comparisonDebugValue">{info?.status || "N/A"}</span>
                        </div>

                        <div className="comparisonDebugRow">
                          <span className="comparisonDebugLabel">originalImage:</span>
                          <span className="comparisonDebugValue">{info?.originalImage || "N/A"}</span>
                        </div>

                        <div className="comparisonDebugRow" style={{ marginBottom: 0 }}>
                          <span className="comparisonDebugLabel">activeImage:</span>
                          <span className="comparisonDebugValue">{info?.activeImage || "N/A"}</span>
                        </div>
                      </div>

                      {/* Debug UI (existing) */}
                      <div
                        className="comparisonDebug"
                        style={{
                          background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.04)",
                          border: `1px solid ${themeVarsMemo.panelBorder}`,
                          color: themeVarsMemo.text,
                        }}
                      >
                        <div className="comparisonDebugRow">
                          <span className="comparisonDebugLabel">URL:</span>
                          <span className="comparisonDebugValue">{imgUrl || "(empty)"}</span>
                        </div>

                        <div className="comparisonDebugRow" style={{ marginBottom: 0 }}>
                          <span className="comparisonDebugLabel">POV:</span>
                        </div>

                        <pre className="comparisonDebugPre">
                          {povObj ? JSON.stringify(povObj, null, 2) : "(none)"}
                        </pre>
                      </div>

                      <div className="comparisonImageBox">
                        {imgUrl ? (
                          <img
                            src={imgUrl}
                            alt={label}
                            style={{ transform: `scale(${zoom / 100})` }}
                            className="comparisonImg"
                            loading="eager"
                            decoding="async"
                            onError={(e) => {
                              console.warn("Failed to load image:", e.currentTarget.src);
                              e.currentTarget.alt = "Failed to load";
                              e.currentTarget.classList.add("imgFailed");
                            }}
                          />
                        ) : (
                          <div className="comparisonEmpty">
                            <div className="comparisonEmptyIcon">📭</div>
                            <div className="comparisonEmptyText">Empty Slot</div>
                          </div>
                        )}
                      </div>

                      {currentComparison.metadata?.statuses?.[idx] && (
                        <div className="comparisonStatus" style={{ color: themeVarsMemo.subText }}>
                          {currentComparison.metadata.statuses[idx]}
                        </div>
                      )}

                      <div className="comparisonStatus" style={{ color: themeVarsMemo.subText }}>
                        Actions: {actions ?? "N/A"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
