import React, { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  deleteDoc,
} from "firebase/firestore";
import {
  signInWithPopup,
  GoogleAuthProvider,
  signInAnonymously,
  onAuthStateChanged,
  signOut as firebaseSignOut,
} from "firebase/auth";
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
  ThumbsUp,
  ThumbsDown,
  User,
  LogOut,
  LogIn,
} from "lucide-react";

import { db, auth } from "./firebase";

// ✅ Define the current version (single source of truth)
const CURRENT_VERSION = "4.1";
const currentVersion = CURRENT_VERSION;

// ✅ Admin email (only this user can upload inspection data)
const ADMIN_EMAIL = "aaron.g@uveye.com";

// Check if current user is admin
const isAdmin = (user) => {
  if (!user) return false;
  if (!user.email) {
    console.warn("⚠️ User object has no email property:", user);
    return false;
  }
  const userEmail = user.email.toLowerCase().trim();
  const adminEmail = ADMIN_EMAIL.toLowerCase().trim();
  const isAdminUser = userEmail === adminEmail;
  
  if (!isAdminUser) {
    console.log("❌ Not admin:", { userEmail, adminEmail, match: false });
  } else {
    console.log("✅ Admin detected:", { userEmail, adminEmail });
  }
  
  return isAdminUser;
};

const API_CONFIG = {
  url:
    import.meta.env.VITE_API_URL ||
    "http://localhost:8080/api/get-uvpaint-inspections",
};

// -----------------------------
// Helpers
// -----------------------------
const sumActionMap = (m) => {
  if (!m || typeof m !== "object") return 0;
  return Object.values(m).reduce((a, b) => a + (Number(b) || 0), 0);
};

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
  return (
    candidates.find((u) => typeof u === "string" && u.trim())?.trim() || null
  );
};

const norm = (s) => String(s || "").trim().toLowerCase();
const normCam = (cam) => {
  const c = norm(cam);
  if (c.startsWith("front")) return "front";
  if (c.startsWith("rear")) return "rear";
  if (c.startsWith("center")) return "center";
  return c || null;
};

const normSide = (side) => {
  const s = norm(side);
  if (s.startsWith("left")) return "left";
  if (s.startsWith("right")) return "right";
  if (s.startsWith("center")) return "center";
  return s || null;
};

const isSlimOverview = (imageType) => norm(imageType) === "slimoverview";
const isZoomer = (imageType) => norm(imageType).includes("zoomer");
const isAllowedType = (imageType) =>
  isSlimOverview(imageType) || isZoomer(imageType);

const isPublishedUvpaint = (img) =>
  Boolean(
    img?.isActive &&
      img?.activeImage &&
      img?.pov &&
      img.imageType !== "Artemis" &&
      isAllowedType(img.imageType)
  );

// If we have collisions (multiple entries same rendition because we ignored serial),
// pick the “best” one deterministically.
const scoreCandidate = (c) => {
  const hasActive = Boolean(c?.activeImage);
  const isActive = Boolean(c?.isActive);
  const src = c?.source || "N/A";
  const srcPriority =
    src === "images" ? 30 : src === "uvpaintHistoryImages" ? 10 : 0;
  return (hasActive ? 100 : 0) + (isActive ? 40 : 0) + srcPriority;
};

// -----------------------------
// Trend Indicator Helper
// -----------------------------
const getTrendIndicator = (difference, threshold = 0.5) => {
  if (Math.abs(difference) < threshold) return { 
    indicator: "→", 
    status: "stable",
    direction: "neutral"
  };
  if (difference > 0) return { 
    indicator: "↑", 
    status: "increasing",
    direction: "up"
  };
  return { 
    indicator: "↓", 
    status: "decreasing",
    direction: "down"
  };
};

// -----------------------------
// Aggregated Metrics (ONLY SlimOverview + Zoomer*, NO UV360)
// -----------------------------
const computeAggregatedMetrics = (processedInspections) => {
  const tableA = [];
  const aggD = new Map();

  const addToTableD = ({
    imageType,
    simulatedCamera,
    simulatedCameraSide,
    originalCameraId,
    actions,
  }) => {
    const key = [
      imageType || "N/A",
      simulatedCamera || "N/A",
      simulatedCameraSide || "N/A",
      originalCameraId || "N/A",
    ].join("|");

    if (!aggD.has(key)) {
      aggD.set(key, {
        imageType: imageType || "N/A",
        simulatedCamera: simulatedCamera || "N/A",
        simulatedCameraSide: simulatedCameraSide || "N/A",
        originalCameraId: originalCameraId || "N/A",
        images: 0,
        totalActions: 0,
        previousTotalActions: 0,
        previousCount: 0,
        latestTotalActions: 0,
        latestCount: 0,
      });
    }

    const row = aggD.get(key);
    row.images += 1;
    row.totalActions += Number(actions) || 0;
  };

  // Track Previous vs Latest actions by camera/POV from comparisons
  const aggDComparisons = new Map();

  processedInspections.forEach((insp) => {
    insp.comparisons?.forEach((comp) => {
      const pov = comp.metadata?.pov;
      if (!pov) return;

      const key = [
        comp.metadata?.bucketType || "N/A",
        pov.simulatedCamera || "N/A",
        pov.simulatedCameraSide || "N/A",
        pov.originalCameraId || "N/A",
      ].join("|");

      if (!aggDComparisons.has(key)) {
        aggDComparisons.set(key, {
          imageType: comp.metadata?.bucketType || "N/A",
          simulatedCamera: pov.simulatedCamera || "N/A",
          simulatedCameraSide: pov.simulatedCameraSide || "N/A",
          originalCameraId: pov.originalCameraId || "N/A",
          previousTotalActions: 0,
          previousCount: 0,
          latestTotalActions: 0,
          latestCount: 0,
        });
      }

      const row = aggDComparisons.get(key);
      const actions = comp.metadata?.actions || [];

      // Previous (index 0)
      if (
        actions[0] !== null &&
        actions[0] !== undefined &&
        actions[0] !== "N/A"
      ) {
        const prevActions = Number(actions[0]) || 0;
        row.previousTotalActions += prevActions;
        row.previousCount += 1;
      }

      // Latest (index 1)
      if (
        actions[1] !== null &&
        actions[1] !== undefined &&
        actions[1] !== "N/A"
      ) {
        const latestActions = Number(actions[1]) || 0;
        row.latestTotalActions += latestActions;
        row.latestCount += 1;
      }
    });
  });

  processedInspections.forEach((insp, idx) => {
    const uvpaintData = insp.rawInspection?.uvpaintData;

    const publishedUvpaint = (uvpaintData?.images || []).filter((img) =>
      isPublishedUvpaint(img)
    );
    const publishedCount = publishedUvpaint.length;

    let totalActions = 0;
    let imagesWithActions = 0;

    publishedUvpaint.forEach((img) => {
      const actions = sumActionMap(img.actionsCounterMap);
      totalActions += actions;
      if (actions > 0) imagesWithActions += 1;
    });

    const avgActionsPerImage =
      publishedCount > 0 ? totalActions / publishedCount : 0;

    // Calculate Previous vs Latest averages from comparisons
    let previousTotalActions = 0;
    let previousCount = 0;
    let latestTotalActions = 0;
    let latestCount = 0;

    insp.comparisons?.forEach((comp) => {
      const actions = comp.metadata?.actions || [];

      // Previous (index 0)
      if (
        actions[0] !== null &&
        actions[0] !== undefined &&
        actions[0] !== "N/A"
      ) {
        const prevActions = Number(actions[0]) || 0;
        previousTotalActions += prevActions;
        previousCount += 1;
      }

      // Latest (index 1)
      if (
        actions[1] !== null &&
        actions[1] !== undefined &&
        actions[1] !== "N/A"
      ) {
        const latestActions = Number(actions[1]) || 0;
        latestTotalActions += latestActions;
        latestCount += 1;
      }
    });

    const avgPreviousActions =
      previousCount > 0 ? previousTotalActions / previousCount : 0;
    const avgLatestActions =
      latestCount > 0 ? latestTotalActions / latestCount : 0;

    // Calculate comparison (difference and percentage change)
    const actionsDifference = avgLatestActions - avgPreviousActions;
    const actionsPercentChange =
      avgPreviousActions > 0
        ? (actionsDifference / avgPreviousActions) * 100
        : avgLatestActions > 0
        ? 100
        : 0;

    // Calculate trend indicator
    const trend = getTrendIndicator(actionsDifference);

    const label = insp.vehicle
      ? `${insp.vehicle.year || ""} ${insp.vehicle.make || ""} ${
          insp.vehicle.model || ""
        }`.trim()
      : `Inspection ${idx + 1}`;

    tableA.push({
      inspectionIndex: idx + 1,
      inspectionId: insp.inspectionId,
      label,
      publishedCount,
      imagesWithActions,
      avgActionsPerImage,
      // Previous vs Latest comparison
      avgPreviousActions,
      avgLatestActions,
      actionsDifference,
      actionsPercentChange,
      // Trend indicators
      trend: trend.indicator,
      trendStatus: trend.status,
      trendDirection: trend.direction,
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
  });

  // Merge comparison data with published data
  aggDComparisons.forEach((compRow, key) => {
    if (aggD.has(key)) {
      const row = aggD.get(key);
      row.previousTotalActions = compRow.previousTotalActions;
      row.previousCount = compRow.previousCount;
      row.latestTotalActions = compRow.latestTotalActions;
      row.latestCount = compRow.latestCount;
    } else {
      // If no published data but has comparison data, add it
      aggD.set(key, {
        ...compRow,
        images: 0,
        totalActions: 0,
      });
    }
  });

  const tableD = Array.from(aggD.values()).map((r) => {
    const avgActionsPerImage = r.images > 0 ? r.totalActions / r.images : 0;
    const avgPreviousActions =
      r.previousCount > 0 ? r.previousTotalActions / r.previousCount : 0;
    const avgLatestActions =
      r.latestCount > 0 ? r.latestTotalActions / r.latestCount : 0;
    const actionsDifference = avgLatestActions - avgPreviousActions;
    const actionsPercentChange =
      avgPreviousActions > 0
        ? (actionsDifference / avgPreviousActions) * 100
        : avgLatestActions > 0
        ? 100
        : 0;

    // Calculate trend indicator
    const trend = getTrendIndicator(actionsDifference);

    return {
      ...r,
      avgActionsPerImage,
      avgPreviousActions,
      avgLatestActions,
      actionsDifference,
      actionsPercentChange,
      // Trend indicators
      trend: trend.indicator,
      trendStatus: trend.status,
      trendDirection: trend.direction,
    };
  });

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
    breakdown: { byInspection: [] },
  };

  processedInspections.forEach((insp, idx) => {
    const uvpaintData = insp.rawInspection?.uvpaintData;

    // Count from metrics logic (ONLY SlimOverview + Zoomer*)
    const publishedUvpaint = (uvpaintData?.images || []).filter((img) =>
      isPublishedUvpaint(img)
    );
    const metricsCount = publishedUvpaint.length;

    // Count from cards logic (Previous+Latest only)
    let cardPublishedCount = 0;
    let cardGeneratedCount = 0;

    insp.comparisons?.forEach((comp) => {
      const renditionData = comp.metadata?.renditionData || [];
      for (let slotIdx = 0; slotIdx < 2; slotIdx++) {
        const data = renditionData[slotIdx];
        if (!data || !data.activeImage) continue;

        // uvpaint: Published = isActive && activeImage exists
        if (data.isActive && data.activeImage) cardPublishedCount++;
        else cardGeneratedCount++;
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

// -----------------------------
// SlimOverview Grid Helper
// -----------------------------
const getSlimOverviewGridData = (comparisons) => {
  // Filter only SlimOverview comparisons - explicitly exclude Zoomer
  const slimComparisons = (comparisons || []).filter(
    (comp) => comp.metadata?.bucketType === "SlimOverview"
  );

  // Separate center camera images from regular slim images
  const centerCameraComparisons = [];
  const regularSlimComparisons = [];

  slimComparisons.forEach((comp) => {
    const pov = comp.metadata?.pov;
    if (!pov) return;

    const cam = normCam(pov.simulatedCamera);
    if (cam === "center") centerCameraComparisons.push(comp);
    else regularSlimComparisons.push(comp);
  });

  // Map for center camera images
  // 0- Center Right, 2- Center Front, 4- Center Left, 6- Center Rear
  const centerViewMap = {
    center_right: { label: "Center Right", position: 0 },
    center_front: { label: "Center Front", position: 2 },
    center_left: { label: "Center Left", position: 4 },
    center_rear: { label: "Center Rear", position: 6 },
    center_back: { label: "Center Rear", position: 6 }, // Alias
  };

  // Map for regular slim images
  // 1- Front Left, 3- Front Right, 5- Rear Left, 7- Rear Right
  const slimViewMap = {
    front_left: { label: "Front Left", position: 1 },
    front_right: { label: "Front Right", position: 3 },
    rear_left: { label: "Rear Left", position: 5 },
    rear_right: { label: "Rear Right", position: 7 },
  };

  // Create grid arrays (8 slots each for Latest and Previous)
  const latestGrid = Array(8).fill(null);
  const previousGrid = Array(8).fill(null);

  // Process center camera images (positions 0, 2, 4, 6)
  centerCameraComparisons.forEach((comp) => {
    const pov = comp.metadata?.pov;
    if (!pov) return;

    const cam = normCam(pov.simulatedCamera);
    const side = normSide(pov.simulatedCameraSide);
    const key = `${cam}_${side}`;
    const viewInfo = centerViewMap[key];

    if (viewInfo) {
      // Latest
      const latestImage = comp.images?.[1] || null;
      const latestActions = comp.metadata?.actions?.[1] ?? "N/A";
      const latestRenditionData = comp.metadata?.renditionData?.[1];
      const latestIsPublished =
        latestRenditionData?.isActive && latestRenditionData?.activeImage;
      const latestRendition = comp.metadata?.renditions?.[1];

      latestGrid[viewInfo.position] = {
        label: viewInfo.label,
        imageUrl: latestImage,
        actions: latestActions,
        isPublished: latestIsPublished,
        rendition: latestRendition,
        comparison: comp,
        pov,
      };

      // Previous
      const previousImage = comp.images?.[0] || null;
      const previousActions = comp.metadata?.actions?.[0] ?? "N/A";
      const previousRenditionData = comp.metadata?.renditionData?.[0];
      const previousIsPublished =
        previousRenditionData?.isActive && previousRenditionData?.activeImage;
      const previousRendition = comp.metadata?.renditions?.[0];

      previousGrid[viewInfo.position] = {
        label: viewInfo.label,
        imageUrl: previousImage,
        actions: previousActions,
        isPublished: previousIsPublished,
        rendition: previousRendition,
        comparison: comp,
        pov,
      };
    }
  });

  // Process regular slim images (positions 1, 3, 5, 7)
  regularSlimComparisons.forEach((comp) => {
    const pov = comp.metadata?.pov;
    if (!pov) return;

    const cam = normCam(pov.simulatedCamera);
    const side = normSide(pov.simulatedCameraSide);
    const key = `${cam}_${side}`;
    const viewInfo = slimViewMap[key];

    if (viewInfo) {
      const position = viewInfo.position;

      const latestImage = comp.images?.[1] || null;
      const latestActions = comp.metadata?.actions?.[1] ?? "N/A";
      const latestRenditionData = comp.metadata?.renditionData?.[1];
      const latestIsPublished =
        latestRenditionData?.isActive && latestRenditionData?.activeImage;
      const latestRendition = comp.metadata?.renditions?.[1];

      latestGrid[position] = {
        label: viewInfo.label,
        imageUrl: latestImage,
        actions: latestActions,
        isPublished: latestIsPublished,
        rendition: latestRendition,
        comparison: comp,
        pov,
      };

      const previousImage = comp.images?.[0] || null;
      const previousActions = comp.metadata?.actions?.[0] ?? "N/A";
      const previousRenditionData = comp.metadata?.renditionData?.[0];
      const previousIsPublished =
        previousRenditionData?.isActive && previousRenditionData?.activeImage;
      const previousRendition = comp.metadata?.renditions?.[0];

      previousGrid[position] = {
        label: viewInfo.label,
        imageUrl: previousImage,
        actions: previousActions,
        isPublished: previousIsPublished,
        rendition: previousRendition,
        comparison: comp,
        pov,
      };
    }
  });

  return { latestGrid, previousGrid };
};

// -----------------------------
// Zoomer Grid Helper
// -----------------------------
const getZoomerGridData = (comparisons) => {
  // Filter only Zoomer comparisons
  const zoomerComparisons = (comparisons || []).filter(
    (comp) => comp.metadata?.bucketType === "Zoomer"
  );

  // Create grid arrays (4 slots each for Latest and Previous)
  const latestGrid = Array(4).fill(null);
  const previousGrid = Array(4).fill(null);

  // Simply take the first 4 Zoomer comparisons
  zoomerComparisons.slice(0, 4).forEach((comp, idx) => {
    // Latest version (slot 1)
    const latestImage = comp.images?.[1] || null;
    const latestActions = comp.metadata?.actions?.[1] ?? "N/A";
    const latestRenditionData = comp.metadata?.renditionData?.[1];
    const latestIsPublished =
      latestRenditionData?.isActive && latestRenditionData?.activeImage;
    const latestRendition = comp.metadata?.renditions?.[1];
    const pov = comp.metadata?.pov;

    latestGrid[idx] = {
      label: comp.name || "Unknown",
      imageUrl: latestImage,
      actions: latestActions,
      isPublished: latestIsPublished,
      rendition: latestRendition,
      comparison: comp,
      pov,
    };

    // Previous version (slot 0)
    const previousImage = comp.images?.[0] || null;
    const previousActions = comp.metadata?.actions?.[0] ?? "N/A";
    const previousRenditionData = comp.metadata?.renditionData?.[0];
    const previousIsPublished =
      previousRenditionData?.isActive && previousRenditionData?.activeImage;
    const previousRendition = comp.metadata?.renditions?.[0];

    previousGrid[idx] = {
      label: comp.name || "Unknown",
      imageUrl: previousImage,
      actions: previousActions,
      isPublished: previousIsPublished,
      rendition: previousRendition,
      comparison: comp,
      pov,
    };
  });

  return { latestGrid, previousGrid };
};

// ---------- SlimOverview Grid Tab UI ----------
function SlimOverviewGridTab({
  currentInspection,
  zoom,
  themeVars,
  theme,
  cardStyle,
}) {
  const gridData = useMemo(
    () => getSlimOverviewGridData(currentInspection?.comparisons || []),
    [currentInspection]
  );

  const renderGrid = (grid, title, subtitle) => (
    <div className="space-y-4 w-full">
      <div>
        <h3
          className="text-xl font-semibold mb-1"
          style={{ color: themeVars.headerText }}
        >
          {title}
        </h3>
        {subtitle && (
          <p className="text-sm" style={{ color: themeVars.subText }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="slimGridContainer">
        {grid.map((item, idx) => {
          if (!item) {
            return (
              <div
                key={`empty-${idx}`}
                className="slimGridItem rounded-lg p-4 border border-dashed"
                style={{
                  ...cardStyle,
                  borderColor: themeVars.panelBorder,
                  opacity: 0.3,
                }}
              >
                <div
                  className="text-center text-sm"
                  style={{ color: themeVars.subText }}
                >
                  Empty
                </div>
              </div>
            );
          }

          return (
            <div
              key={`slim-${idx}`}
              className="slimGridItem rounded-lg p-4"
              style={cardStyle}
            >
              <div className="mb-2">
                <h4
                  className="font-semibold text-sm"
                  style={{ color: themeVars.headerText }}
                >
                  {item.label}
                </h4>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: item.isPublished
                        ? "rgba(34,197,94,0.18)"
                        : "rgba(148,163,184,0.14)",
                      color: themeVars.text,
                    }}
                  >
                    {item.isPublished ? "Published" : "Generated"}
                  </span>
                  {item.rendition !== null && item.rendition !== undefined && (
                    <span
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        background: themeVars.chipBg,
                        color: themeVars.chipText,
                      }}
                    >
                      {String(item.rendition) === "OG"
                        ? "OG"
                        : `R${item.rendition}`}
                    </span>
                  )}
                </div>
              </div>

              <div
                className="rounded-lg overflow-hidden mb-2 comparisonImageBox"
                style={{
                  height: "200px",
                  width: "100%",
                  background:
                    theme === "dark"
                      ? "rgba(15,23,42,0.5)"
                      : "rgba(15,23,42,0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  cursor: "zoom-in",
                }}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.label}
                    className="comparisonImg"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      width: "auto",
                      height: "auto",
                      objectFit: "contain",
                      transform: `scale(${zoom / 100})`,
                    }}
                    onError={(e) => {
                      e.currentTarget.style.opacity = "0.35";
                      e.currentTarget.style.filter = "grayscale(1)";
                    }}
                  />
                ) : (
                  <div className="text-center" style={{ color: themeVars.subText }}>
                    <div className="text-2xl mb-2">📭</div>
                    <div className="text-xs">No Image</div>
                  </div>
                )}
              </div>

              <div className="text-xs" style={{ color: themeVars.subText }}>
                Actions: {item.actions}
              </div>

              <div className="text-xs mt-1" style={{ color: themeVars.subText }}>
                {item.pov?.simulatedCamera} {item.pov?.simulatedCameraSide}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        .slimGridContainer {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
          width: 100%;
        }
        @media (max-width: 1024px) { .slimGridContainer { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 640px) { .slimGridContainer { grid-template-columns: repeat(1, minmax(0, 1fr)); } }
        .slimGridItem { min-width: 0; width: 100%; }
      `}</style>

      <div className="space-y-8 pb-8 w-full">
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-6 w-full">
          {renderGrid(
            gridData.latestGrid,
            "New Version (Latest)",
            "Latest rendition for each camera/side combination"
          )}
        </div>

        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-6 w-full">
          {renderGrid(
            gridData.previousGrid,
            "Old Version (Previous)",
            "Previous rendition for each camera/side combination"
          )}
        </div>
      </div>
    </>
  );
}

// ---------- Zoomer Grid Tab UI ----------
function ZoomerGridTab({ currentInspection, zoom, themeVars, theme, cardStyle }) {
  const gridData = useMemo(
    () => getZoomerGridData(currentInspection?.comparisons || []),
    [currentInspection]
  );

  const renderGrid = (grid, title, subtitle) => (
    <div className="space-y-4 w-full">
      <div>
        <h3
          className="text-xl font-semibold mb-1"
          style={{ color: themeVars.headerText }}
        >
          {title}
        </h3>
        {subtitle && (
          <p className="text-sm" style={{ color: themeVars.subText }}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="zoomerGridContainer">
        {grid.map((item, idx) => {
          if (!item) {
            return (
              <div
                key={`empty-${idx}`}
                className="zoomerGridItem rounded-lg p-4 border border-dashed"
                style={{
                  ...cardStyle,
                  borderColor: themeVars.panelBorder,
                  opacity: 0.3,
                }}
              >
                <div
                  className="text-center text-sm"
                  style={{ color: themeVars.subText }}
                >
                  Empty
                </div>
              </div>
            );
          }

          return (
            <div
              key={`zoomer-${idx}`}
              className="zoomerGridItem rounded-lg p-4"
              style={cardStyle}
            >
              <div className="mb-2">
                <h4
                  className="font-semibold text-sm"
                  style={{ color: themeVars.headerText }}
                >
                  {item.label}
                </h4>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      background: item.isPublished
                        ? "rgba(34,197,94,0.18)"
                        : "rgba(148,163,184,0.14)",
                      color: themeVars.text,
                    }}
                  >
                    {item.isPublished ? "Published" : "Generated"}
                  </span>
                  {item.rendition !== null && item.rendition !== undefined && (
                    <span
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        background: themeVars.chipBg,
                        color: themeVars.chipText,
                      }}
                    >
                      {String(item.rendition) === "OG"
                        ? "OG"
                        : `R${item.rendition}`}
                    </span>
                  )}
                </div>
              </div>

              <div
                className="rounded-lg overflow-hidden mb-2 comparisonImageBox"
                style={{
                  height: "200px",
                  width: "100%",
                  background:
                    theme === "dark"
                      ? "rgba(15,23,42,0.5)"
                      : "rgba(15,23,42,0.04)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                  cursor: "zoom-in",
                }}
              >
                {item.imageUrl ? (
                  <img
                    src={item.imageUrl}
                    alt={item.label}
                    className="comparisonImg"
                    style={{
                      maxWidth: "100%",
                      maxHeight: "100%",
                      width: "auto",
                      height: "auto",
                      objectFit: "contain",
                      transform: `scale(${zoom / 100})`,
                    }}
                    onError={(e) => {
                      e.currentTarget.style.opacity = "0.35";
                      e.currentTarget.style.filter = "grayscale(1)";
                    }}
                  />
                ) : (
                  <div className="text-center" style={{ color: themeVars.subText }}>
                    <div className="text-2xl mb-2">📭</div>
                    <div className="text-xs">No Image</div>
                  </div>
                )}
              </div>

              <div className="text-xs" style={{ color: themeVars.subText }}>
                Actions: {item.actions}
              </div>

              {item.pov && (
                <div className="text-xs mt-1" style={{ color: themeVars.subText }}>
                  {item.pov?.simulatedCamera} {item.pov?.simulatedCameraSide}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        .zoomerGridContainer {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1rem;
          width: 100%;
        }
        @media (max-width: 1024px) { .zoomerGridContainer { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 640px) { .zoomerGridContainer { grid-template-columns: repeat(1, minmax(0, 1fr)); } }
        .zoomerGridItem { min-width: 0; width: 100%; }
      `}</style>

      <div className="space-y-8 pb-8 w-full">
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-6 w-full">
          {renderGrid(
            gridData.latestGrid,
            "Zoomer - New Version (Latest)",
            "Latest rendition for each Zoomer comparison"
          )}
        </div>

        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-6 w-full">
          {renderGrid(
            gridData.previousGrid,
            "Zoomer - Old Version (Previous)",
            "Previous rendition for each Zoomer comparison"
          )}
        </div>
      </div>
    </>
  );
}

// ---------- Metrics Tab UI ----------
function MetricsTab({
  tableA,
  tableD,
  onJumpToInspection,
  validation,
  votes,
  allComparisons,
  inspections,
  themeVars,
  theme,
}) {
  // Per-image vote metrics aggregated by image type/camera (like Table D)
  const voteMetricsByType = useMemo(() => {
    if (!allComparisons || !votes) return [];
    
    // Group comparisons by image type/camera/side/cameraId (same key as Table D)
    const grouped = new Map();
    
    allComparisons.forEach((comp) => {
      const compId = comp.id;
      const voteData = votes[compId];
      if (!voteData || voteData.total === 0) return;
      
      const metadata = comp.metadata;
      const pov = metadata?.pov;
      if (!pov) return;
      
      // Create same key as Table D uses
      const key = [
        metadata?.bucketType || "N/A",
        pov.simulatedCamera || "N/A",
        pov.simulatedCameraSide || "N/A",
        pov.originalCameraId || "N/A",
      ].join("|");
      
      if (!grouped.has(key)) {
        grouped.set(key, {
          imageType: metadata?.bucketType || "N/A",
          simulatedCamera: pov.simulatedCamera || "N/A",
          simulatedCameraSide: pov.simulatedCameraSide || "N/A",
          originalCameraId: pov.originalCameraId || "N/A",
          totalApprovals: 0,
          totalRejections: 0,
          totalVotes: 0,
          totalActions: 0,
          comparisonCount: 0,
        });
      }
      
      const group = grouped.get(key);
      group.totalApprovals += voteData.approvals;
      group.totalRejections += voteData.rejections;
      group.totalVotes += voteData.total;
      
      // Get actions for this comparison (latest version)
      const actions = comp.metadata?.actions?.[1] ?? "N/A";
      const actionsNum = typeof actions === "number" ? actions : (typeof actions === "string" && actions !== "N/A" ? Number(actions) || 0 : 0);
      group.totalActions += actionsNum;
      group.comparisonCount += 1;
    });
    
    // Convert to array and calculate percentages
    return Array.from(grouped.values())
      .map((group) => {
        const approvalPercentage = group.totalVotes > 0
          ? (group.totalApprovals / group.totalVotes) * 100
          : 0;
        const avgActions = group.comparisonCount > 0
          ? group.totalActions / group.comparisonCount
          : 0;
        
        return {
          ...group,
          approvalPercentage,
          avgActions,
        };
      })
      .filter((g) => g.totalVotes > 0) // Only show groups with votes
      .sort((a, b) => b.approvalPercentage - a.approvalPercentage);
  }, [allComparisons, votes]);

  // Keep original voteMetrics for overall stats
  const voteMetrics = useMemo(() => {
    if (!allComparisons) return [];
    return allComparisons
      .map((comp) => {
        const compId = comp.id;
        const voteData = votes?.[compId] || {
          approvals: 0,
          rejections: 0,
          total: 0,
          percentage: 0,
        };
        
        // Get actions for this comparison (latest version)
        const actions = comp.metadata?.actions?.[1] ?? "N/A";
        const actionsNum = typeof actions === "number" ? actions : (typeof actions === "string" && actions !== "N/A" ? Number(actions) || 0 : 0);
        
        return {
          comparisonId: compId,
          name: comp.name,
          inspectionId: comp.metadata?.inspectionId,
          approvals: voteData.approvals,
          rejections: voteData.rejections,
          total: voteData.total,
          percentage: Number(voteData.percentage || 0),
          actions: actionsNum,
        };
      })
      .filter((m) => m.total > 0) // Only show comparisons with votes
      .sort((a, b) => b.percentage - a.percentage);
  }, [allComparisons, votes]);

  // Per-inspection aggregated scores
  const inspectionScores = useMemo(() => {
    if (!inspections || !votes) return [];
    
    return inspections.map((insp) => {
      const inspectionComparisons = allComparisons?.filter(
        (comp) => comp.metadata?.inspectionId === insp.inspectionId
      ) || [];
      
      const scores = inspectionComparisons
        .map((comp) => {
          const compId = comp.id;
          const voteData = votes[compId];
          if (!voteData || voteData.total === 0) return null;
          return voteData.percentage;
        })
        .filter((s) => s !== null);
      
      const avgScore = scores.length > 0
        ? scores.reduce((sum, s) => sum + s, 0) / scores.length
        : 0;
      
      const totalVotes = inspectionComparisons.reduce((sum, comp) => {
        const voteData = votes[comp.id];
        return sum + (voteData?.total || 0);
      }, 0);
      
      const imagesWithVotes = scores.length;
      const totalImages = inspectionComparisons.length;
      
      return {
        inspectionId: insp.inspectionId,
        label: insp.vehicle
          ? `${insp.vehicle.year || ""} ${insp.vehicle.make || ""} ${insp.vehicle.model || ""}`.trim()
          : `Inspection ${inspections.indexOf(insp) + 1}`,
        averageScore: avgScore,
        totalVotes,
        imagesWithVotes,
        totalImages,
        coverage: totalImages > 0 ? (imagesWithVotes / totalImages) * 100 : 0,
      };
    })
    .filter((insp) => insp.totalVotes > 0) // Only show inspections with votes
    .sort((a, b) => b.averageScore - a.averageScore);
  }, [inspections, allComparisons, votes]);

  // Overall dashboard stats
  const overallStats = useMemo(() => {
    if (!voteMetrics.length) {
      return {
        totalComparisons: 0,
        totalVotes: 0,
        overallApprovalRate: 0,
        totalApprovals: 0,
        totalRejections: 0,
        totalActions: 0,
        averageActionsPerImage: 0,
      };
    }
    
    const totalComparisons = voteMetrics.length;
    const totalVotes = voteMetrics.reduce((sum, m) => sum + m.total, 0);
    const totalApprovals = voteMetrics.reduce((sum, m) => sum + m.approvals, 0);
    const totalRejections = voteMetrics.reduce((sum, m) => sum + m.rejections, 0);
    const totalActions = voteMetrics.reduce((sum, m) => sum + m.actions, 0);
    
    const overallApprovalRate = totalVotes > 0
      ? (totalApprovals / totalVotes) * 100
      : 0;
    
    const averageActionsPerImage = totalComparisons > 0
      ? totalActions / totalComparisons
      : 0;
    
    return {
      totalComparisons,
      totalVotes,
      overallApprovalRate,
      totalApprovals,
      totalRejections,
      totalActions,
      averageActionsPerImage,
    };
  }, [voteMetrics]);

  // Export functions
  const exportToCSV = () => {
    const headers = [
      "Image Type",
      "Camera",
      "Side",
      "Camera ID",
      "Approvals",
      "Rejections",
      "Total Votes",
      "Approval %",
      "Avg Actions",
    ];
    
    const rows = voteMetricsByType.map((m) => [
      m.imageType,
      m.simulatedCamera,
      m.simulatedCameraSide,
      m.originalCameraId,
      m.totalApprovals,
      m.totalRejections,
      m.totalVotes,
      m.approvalPercentage.toFixed(2),
      m.avgActions.toFixed(2),
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `image-comparison-votes-${currentVersion}-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportInspectionScores = () => {
    const headers = [
      "Inspection ID",
      "Label",
      "Average Score %",
      "Total Votes",
      "Images With Votes",
      "Total Images",
      "Coverage %",
    ];
    
    const rows = inspectionScores.map((insp) => [
      insp.inspectionId,
      insp.label,
      insp.averageScore.toFixed(2),
      insp.totalVotes,
      insp.imagesWithVotes,
      insp.totalImages,
      insp.coverage.toFixed(2),
    ]);
    
    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");
    
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `inspection-scores-${currentVersion}-${new Date().toISOString().split("T")[0]}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportToJSON = () => {
    const data = {
      version: currentVersion,
      exportDate: new Date().toISOString(),
      overallStats,
      perImageScores: voteMetricsByType,
      perInspectionScores: inspectionScores,
    };
    
    const jsonContent = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `image-comparison-data-${currentVersion}-${new Date().toISOString().split("T")[0]}.json`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const themeVarsLocal = themeVars || {
    text: "#ffffff",
    subText: "#94a3b8",
    headerText: "#ffffff",
    panelBorder: "rgba(148,163,184,0.25)",
  };
  const themeLocal = theme || "dark";

  return (
    <div className="space-y-8">
      <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-white font-semibold">
              Audit DatasetRelease {currentVersion} — Metrics
            </h2>
            <div className="text-slate-300 text-sm mt-1">
              Scope: SlimOverview + Zoomer* only (UV360 ignored). Published =
              uvpaint isActive + activeImage.
            </div>
          </div>
        </div>
      </div>

      {/* Overall Dashboard Stats */}
      <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-semibold">
            📊 Overall Dashboard — Multi-User Aggregated Scores
          </h2>
          <div className="flex gap-2">
            <button
              onClick={exportToCSV}
              className="px-4 py-2 rounded-lg text-sm"
              style={{
                background: themeLocal === "dark" ? "#2563eb" : "#1d4ed8",
                color: "#fff",
              }}
            >
              Export Images CSV
            </button>
            <button
              onClick={exportInspectionScores}
              className="px-4 py-2 rounded-lg text-sm"
              style={{
                background: themeLocal === "dark" ? "#2563eb" : "#1d4ed8",
                color: "#fff",
              }}
            >
              Export Inspections CSV
            </button>
            <button
              onClick={exportToJSON}
              className="px-4 py-2 rounded-lg text-sm"
              style={{
                background: themeLocal === "dark" ? "#2563eb" : "#1d4ed8",
                color: "#fff",
              }}
            >
              Export All JSON
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Total Comparisons</div>
            <div className="text-white text-2xl font-bold">
              {overallStats.totalComparisons}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Total Votes</div>
            <div className="text-white text-2xl font-bold">
              {overallStats.totalVotes}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Overall Approval Rate</div>
            <div className="text-white text-2xl font-bold">
              {overallStats.overallApprovalRate.toFixed(1)}%
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Avg Actions/Image</div>
            <div className="text-white text-2xl font-bold">
              {overallStats.averageActionsPerImage.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Total Approvals</div>
            <div className="text-green-400 text-xl font-bold">
              {overallStats.totalApprovals}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Total Rejections</div>
            <div className="text-red-400 text-xl font-bold">
              {overallStats.totalRejections}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-4">
            <div className="text-slate-400 text-sm mb-1">Total Actions</div>
            <div className="text-white text-xl font-bold">
              {overallStats.totalActions}
            </div>
          </div>
        </div>
      </div>

      {/* Per-Inspection Scores */}
      {inspectionScores.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">
            📊 Per-Inspection Aggregated Scores
          </h2>
          <div className="text-slate-300 text-sm mb-3">
            Average approval percentage across all images in each inspection
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="text-slate-300">
                <tr>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Inspection
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Avg Score %
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Total Votes
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Images w/ Votes
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Total Images
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Coverage %
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {inspectionScores.map((insp) => (
                  <tr
                    key={insp.inspectionId}
                    className="hover:bg-slate-800/40"
                  >
                    <td className="py-2 pr-4 border border-slate-600">
                      <button
                        className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                        onClick={() => onJumpToInspection?.(insp.inspectionId)}
                        title={insp.inspectionId}
                      >
                        {insp.label}
                      </button>
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      <span
                        className={`font-semibold ${
                          insp.averageScore >= 70
                            ? "text-green-400"
                            : insp.averageScore >= 50
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {insp.averageScore.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {insp.totalVotes}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {insp.imagesWithVotes}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {insp.totalImages}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {insp.coverage.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-Image Scores (with Actions) - Aggregated by Image Type */}
      {voteMetricsByType.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">
            📊 Per-Image Scores (Approval % + Actions) — Aggregated by Image Type
          </h2>
          <div className="text-slate-300 text-sm mb-3">
            Aggregated approval scores and actions by image type/camera across all inspections
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="text-slate-300">
                <tr>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Image Type
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Camera
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Side
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Camera ID
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Approvals
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Rejections
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Total Votes
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Approval %
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Avg Actions
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {voteMetricsByType.map((metric, idx) => (
                  <tr
                    key={`${metric.imageType}-${metric.simulatedCamera}-${metric.simulatedCameraSide}-${idx}`}
                    className="hover:bg-slate-800/40"
                  >
                    <td className="py-2 pr-4 border border-slate-600">
                      {metric.imageType}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {metric.simulatedCamera}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {metric.simulatedCameraSide}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {metric.originalCameraId}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600 text-green-400">
                      {metric.totalApprovals}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600 text-red-400">
                      {metric.totalRejections}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {metric.totalVotes}
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      <span
                        className={`font-semibold ${
                          metric.approvalPercentage >= 70
                            ? "text-green-400"
                            : metric.approvalPercentage >= 50
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {metric.approvalPercentage.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2 pr-4 border border-slate-600">
                      {metric.avgActions.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table A - Inspection Health with Trends */}
      {tableA && tableA.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">
            📊 Table A — Inspection Health (Old vs New)
          </h2>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="text-slate-300">
                <tr>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Inspection
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Published Images
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Images w/ Actions
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Avg Actions (Old)
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Avg Actions (New)
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Difference
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    % Change
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {tableA.map((r) => {
                  const hasMoreActions = r.avgLatestActions > r.avgPreviousActions;
                  const hasFewerActions = r.avgLatestActions < r.avgPreviousActions;
                  const rowBg = hasMoreActions
                    ? themeLocal === "dark"
                      ? "rgba(239,68,68,0.15)"
                      : "rgba(239,68,68,0.08)"
                    : hasFewerActions
                    ? themeLocal === "dark"
                      ? "rgba(34,197,94,0.15)"
                      : "rgba(34,197,94,0.08)"
                    : "transparent";

                  return (
                    <tr
                      key={r.inspectionId}
                      className="hover:bg-slate-800/40"
                      style={{ background: rowBg }}
                    >
                      <td className="py-2 pr-4 border border-slate-600">
                        <button
                          className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                          onClick={() => onJumpToInspection?.(r.inspectionId)}
                          title={r.inspectionId}
                        >
                          {r.label || `Inspection ${r.inspectionIndex}`}
                        </button>
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.publishedCount}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.imagesWithActions}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.avgPreviousActions.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.avgLatestActions.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        <span
                          className={
                            r.actionsDifference > 0
                              ? "text-red-400"
                              : r.actionsDifference < 0
                              ? "text-green-400"
                              : ""
                          }
                        >
                          {r.actionsDifference > 0 ? "+" : ""}
                          {r.actionsDifference.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        <span
                          className={
                            r.actionsPercentChange > 0
                              ? "text-red-400"
                              : r.actionsPercentChange < 0
                              ? "text-green-400"
                              : ""
                          }
                        >
                          {r.actionsPercentChange > 0 ? "+" : ""}
                          {r.actionsPercentChange.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        <span
                          className="text-lg"
                          title={r.trendStatus}
                        >
                          {r.trend || "→"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table D - Detailed Breakdown by Image Type/Camera with Trends */}
      {tableD && tableD.length > 0 && (
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">
            📊 Table D — Detailed Breakdown by Image Type/Camera (Old vs New)
          </h2>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="text-slate-300">
                <tr>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Image Type
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Camera
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Side
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Camera ID
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Images
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Avg Actions (Old)
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Avg Actions (New)
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Difference
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    % Change
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Trend
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {tableD.map((r, idx) => {
                  const hasMoreActions = r.avgLatestActions > r.avgPreviousActions;
                  const hasFewerActions = r.avgLatestActions < r.avgPreviousActions;
                  const rowBg = hasMoreActions
                    ? themeLocal === "dark"
                      ? "rgba(239,68,68,0.15)"
                      : "rgba(239,68,68,0.08)"
                    : hasFewerActions
                    ? themeLocal === "dark"
                      ? "rgba(34,197,94,0.15)"
                      : "rgba(34,197,94,0.08)"
                    : "transparent";

                  return (
                    <tr
                      key={`${r.imageType}-${r.simulatedCamera}-${r.simulatedCameraSide}-${idx}`}
                      className="hover:bg-slate-800/40"
                      style={{ background: rowBg }}
                    >
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.imageType}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.simulatedCamera}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.simulatedCameraSide}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.originalCameraId}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.images}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.avgPreviousActions.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {r.avgLatestActions.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        <span
                          className={
                            r.actionsDifference > 0
                              ? "text-red-400"
                              : r.actionsDifference < 0
                              ? "text-green-400"
                              : ""
                          }
                        >
                          {r.actionsDifference > 0 ? "+" : ""}
                          {r.actionsDifference.toFixed(2)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        <span
                          className={
                            r.actionsPercentChange > 0
                              ? "text-red-400"
                              : r.actionsPercentChange < 0
                              ? "text-green-400"
                              : ""
                          }
                        >
                          {r.actionsPercentChange > 0 ? "+" : ""}
                          {r.actionsPercentChange.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        <span
                          className="text-lg"
                          title={r.trendStatus}
                        >
                          {r.trend || "→"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* validation + tables */}
      {validation && (
        <div className="bg-slate-800/30 border border-slate-600 rounded-lg p-4">
          <h2 className="text-white font-semibold mb-3">
            Validation & Breakdown
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm mb-1">
                Published (Metrics)
              </div>
              <div className="text-white text-2xl font-bold">
                {validation.totalPublishedInMetrics}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm mb-1">
                Published (Cards)
              </div>
              <div className="text-white text-2xl font-bold">
                {validation.totalPublishedInCards}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm mb-1">
                Generated (Cards)
              </div>
              <div className="text-white text-2xl font-bold">
                {validation.totalGeneratedInCards}
              </div>
            </div>
          </div>

          {validation.mismatches.length > 0 ? (
            <div className="mb-4 p-3 bg-yellow-900/20 border border-yellow-700/50 rounded-lg">
              <div className="text-yellow-400 font-semibold mb-2">
                ⚠️ {validation.mismatches.length} Mismatch(es)
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                {validation.mismatches.slice(0, 5).map((m, i) => (
                  <div key={i}>
                    Inspection {m.inspectionIndex}: Metrics={m.metricsCount},
                    Cards={m.cardPublishedCount} (diff: {m.difference})
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="mb-4 p-3 bg-green-900/20 border border-green-700/50 rounded-lg">
              <div className="text-green-400 font-semibold">
                ✅ All metrics aligned with cards
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border-collapse">
              <thead className="text-slate-300">
                <tr>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Inspection
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Metrics Published
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Card Published
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Card Generated
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Comparisons
                  </th>
                  <th className="text-left py-2 pr-4 border border-slate-600">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                {validation.breakdown.byInspection.map((item) => {
                  const ok = item.metricsPublished === item.cardPublished;
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
                      <td className="py-2 pr-4 border border-slate-600">
                        {item.metricsPublished}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {item.cardPublished}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {item.cardGenerated}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {item.comparisons}
                      </td>
                      <td className="py-2 pr-4 border border-slate-600">
                        {ok ? (
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
  const [loadingFromFirebase, setLoadingFromFirebase] = useState(false);
  const [inspectionsLoaded, setInspectionsLoaded] = useState(false);
  const [error, setError] = useState("");

  const [activeView, setActiveView] = useState("comparisons");
  const [metrics, setMetrics] = useState({
    tableA: [],
    tableD: [],
    validation: null,
  });

  const [theme, setTheme] = useState("dark");

  // ✅ Firebase Authentication state
  const [user, setUser] = useState(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);

  // ✅ Voting state
  const [votes, setVotes] = useState({}); // aggregated from Firestore
  const [userVotes, setUserVotes] = useState({}); // local per-user "already voted" state

  // Listen for authentication state changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthenticating(false);
      
      // Load user votes when user changes
      if (firebaseUser) {
        try {
          const storedUser = localStorage.getItem(`userVotes_${firebaseUser.uid}`);
          if (storedUser) setUserVotes(JSON.parse(storedUser));
        } catch (e) {
          console.error("Failed to load local user votes", e);
        }
      } else {
        setUserVotes({});
      }
    });

    return () => unsubscribe();
  }, []);

  // Load inspections from Firebase for regular users (not admin) - with real-time updates
  useEffect(() => {
    if (!user || isAdmin(user)) return; // Admin doesn't load from Firebase, they upload
    
    setLoadingFromFirebase(true);
    
    // Use real-time listener so users see data immediately when admin uploads
    const docRef = doc(db, "campaigns", currentVersion);
    
    console.log("🔍 Setting up Firebase listener for external user:", { userId: user.uid, version: currentVersion });
    
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        console.log("📥 Firebase snapshot received:", { 
          exists: docSnap.exists(),
          hasData: !!docSnap.data(),
          inspectionsCount: docSnap.data()?.inspections?.length || 0
        });
        
        setLoadingFromFirebase(false);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.inspections && data.inspections.length > 0) {
            console.log("✅ Inspections loaded from Firebase:", data.inspections.length);
            setInspections(data.inspections);
            setMetrics(data.metrics || { tableA: [], tableD: [], validation: null });
            setLoadMethod("firebase");
            setInspectionsLoaded(true);
          } else {
            console.warn("⚠️ Document exists but inspections array is empty or missing:", {
              hasInspections: !!data.inspections,
              inspectionsLength: data.inspections?.length,
              dataKeys: Object.keys(data || {})
            });
            setInspectionsLoaded(false);
          }
        } else {
          console.log("📭 Document does not exist yet in Firebase");
          setInspectionsLoaded(false);
        }
      },
      (error) => {
        console.error("❌ Failed to load inspections from Firebase:", error);
        setLoadingFromFirebase(false);
        setInspectionsLoaded(false);
        
        // Show user-friendly error for permission issues
        if (error.code === 'permission-denied') {
          setError("Permission denied: Please check Firestore security rules. External users need read access to the 'campaigns' collection.");
        }
      }
    );
    
    return () => unsubscribe();
  }, [user, currentVersion]);

  // Authentication functions
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Google sign-in error:", error);
      let errorMsg = error.message;
      if (error.code === 'auth/operation-not-allowed') {
        errorMsg = 'Google Sign-In is not enabled. Please enable it in Firebase Console > Authentication > Sign-in method > Google.';
      }
      alert(`Sign-in failed: ${errorMsg}`);
    }
  };

  const handleSignInAnonymously = async () => {
    try {
      await signInAnonymously(auth);
    } catch (error) {
      console.error("Anonymous sign-in error:", error);
      let errorMsg = error.message;
      if (error.code === 'auth/admin-restricted-operation' || error.code === 'auth/operation-not-allowed') {
        errorMsg = 'Anonymous Sign-In is not enabled. Please enable it in Firebase Console > Authentication > Sign-in method > Anonymous.';
      }
      alert(`Anonymous sign-in failed: ${errorMsg}`);
    }
  };

  const handleSignOut = async () => {
    try {
      await firebaseSignOut(auth);
      setUserVotes({});
    } catch (error) {
      console.error("Sign-out error:", error);
      alert(`Sign-out failed: ${error.message}`);
    }
  };

  // Persist local userVotes map (per user)
  useEffect(() => {
    if (user) {
      try {
        localStorage.setItem(`userVotes_${user.uid}`, JSON.stringify(userVotes));
      } catch {}
    }
  }, [userVotes, user]);

  // 🔥 Real-time vote aggregation listener (by version)
  useEffect(() => {
    const q = query(collection(db, "votes"), where("version", "==", currentVersion));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const aggVotes = {};

      snapshot.forEach((d) => {
        const data = d.data();
        const compId = data.comparisonId;
        if (!compId) return;

        if (!aggVotes[compId]) {
          aggVotes[compId] = { approvals: 0, rejections: 0, total: 0, percentage: 0 };
        }

        if (data.voteType === "approve") aggVotes[compId].approvals += 1;
        if (data.voteType === "reject") aggVotes[compId].rejections += 1;
        aggVotes[compId].total += 1;
      });

      Object.keys(aggVotes).forEach((compId) => {
        const v = aggVotes[compId];
        v.percentage = v.total > 0 ? (v.approvals / v.total) * 100 : 0;
      });

      setVotes(aggVotes);
    });

    return () => unsubscribe();
  }, []);

  // ✅ Vote handlers (writes are per image+version+userId)
  const handleVote = async (comparisonId, voteType) => {
    if (!comparisonId) return;
    if (!user) {
      alert("Please sign in first to vote!");
      return;
    }

    const voteDocId = `${comparisonId}_${currentVersion}_${user.uid}`;

    try {
      await setDoc(
        doc(db, "votes", voteDocId),
        {
          comparisonId,
          version: currentVersion,
          userId: user.uid,
          userName: user.displayName || user.email || "Anonymous",
          voteType,
          timestamp: serverTimestamp(),
        },
        { merge: true }
      );

      const versionVoteKey = `${comparisonId}_${currentVersion}`;
      setUserVotes((prev) => ({ ...prev, [versionVoteKey]: voteType }));
    } catch (err) {
      console.error("Firebase Vote failed:", err);
      alert("Failed to save vote to the shared database.");
    }
  };

  const handleUnvote = async (comparisonId) => {
    if (!comparisonId) return;
    if (!user) return;

    const voteDocId = `${comparisonId}_${currentVersion}_${user.uid}`;

    try {
      await deleteDoc(doc(db, "votes", voteDocId));
      const versionVoteKey = `${comparisonId}_${currentVersion}`;
      setUserVotes((prev) => {
        const next = { ...prev };
        delete next[versionVoteKey];
        return next;
      });
    } catch (err) {
      console.error("Firebase Unvote failed:", err);
      alert("Failed to remove vote.");
    }
  };

  const getVoteStatus = (comparisonId) =>
    userVotes[`${comparisonId}_${currentVersion}`] || null;

  const themeVars = useMemo(() => {
    if (theme === "light") {
      return {
        pageBg:
          "linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f8fafc 100%)",
        panelBg: "rgba(255,255,255,0.75)",
        panelBorder: "rgba(42, 15, 19, 0.1)",
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
      pageBg:
        "linear-gradient(135deg, #0f172a 0%, #1f2937 50%, #0f172a 100%)",
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

  const SLOTS = useMemo(
    () => [
      { label: "Previous", idx: 0 },
      { label: "Latest", idx: 1 },
      { label: "Original", idx: 2 },
    ],
    []
  );

  // Only these two buckets really matter now
  const IMAGE_TYPE_ORDER = useMemo(() => ({ SlimOverview: 0, Zoomer: 1 }), []);

  // Published flag aligned with metrics logic (uvpaint only)
  const getSlotPublishLabel = (metadata, idx) => {
    if (idx === 2) return "Original";
    const d = metadata?.renditionData?.[idx];
    if (!d) return "Generated";
    return d.isActive && d.activeImage ? "Published" : "Generated";
  };

  const isRowPublished = (row) => {
    const rd = row?.metadata?.renditionData || [];
    for (let i = 0; i < 2; i++) {
      const d = rd[i];
      if (d && d.isActive && d.activeImage) return true;
    }
    return false;
  };

  // ✅ New POV key:
  // - ONLY SlimOverview + Zoomer*
  // - IGNORE serialNumber
  // - Group by: (bucketType, simulatedCamera, simulatedCameraSide)
  const createPOVKey = (bucketType, pov) => {
    const cam = normCam(pov?.simulatedCamera) || "na";
    const side = normSide(pov?.simulatedCameraSide) || "na";
    return `${bucketType}_${cam}_${side}`;
  };

  const bucketTypeOf = (imageType) => {
    if (isSlimOverview(imageType)) return "SlimOverview";
    if (isZoomer(imageType)) return "Zoomer";
    return null;
  };

  const processInspectionData = (inspection) => {
    const uvpaintData = inspection?.uvpaintData;
    if (!uvpaintData) return [];

    const rowsByKey = {}; // key -> row
    const ensureRow = ({ key, bucketType, pov }) => {
      if (!rowsByKey[key]) {
        rowsByKey[key] = {
          bucketType,
          pov,
          renditions: {}, // { [renditionNum]: candidate[] }
          _sourcesSet: new Set(),
        };
      }
      return rowsByKey[key];
    };

    const putCandidate = ({
      imageType,
      pov,
      rendition,
      activeImage,
      status,
      source,
      actions = "N/A",
      originalImage,
      isActive = false,
    }) => {
      if (!pov) return;
      if (!isAllowedType(imageType)) return;

      const bucketType = bucketTypeOf(imageType);
      if (!bucketType) return;

      const key = createPOVKey(bucketType, pov);
      const row = ensureRow({ key, bucketType, pov });

      const rNum = Number.isFinite(Number(rendition)) ? Number(rendition) : null;
      if (rNum === null) return;

      const src = source || "N/A";
      row._sourcesSet.add(src);

      const candidate = {
        imageType: imageType || "N/A",
        bucketType,
        status: status || "N/A",
        activeImage: safeUrl(activeImage),
        originalImage: safeUrl(originalImage),
        image: safeUrl(activeImage),
        source: src,
        actions,
        isActive: Boolean(isActive),
        pov,
      };

      if (!row.renditions[rNum]) row.renditions[rNum] = [];
      row.renditions[rNum].push(candidate);
    };

    // ONLY uvpaintData.images + uvpaintHistoryImages
    (uvpaintData.images || []).forEach((img) => {
      if (!img || img.imageType === "Artemis") return;
      if (!img.pov) return;
      if (!isAllowedType(img.imageType)) return;

      putCandidate({
        imageType: img.imageType,
        pov: img.pov,
        rendition: img.rendition ?? 3,
        activeImage: img.activeImage,
        status: img.status,
        source: "images",
        actions: img.actionsCounterMap ? sumActionMap(img.actionsCounterMap) : 0,
        originalImage: pickOriginalUrl(img),
        isActive: img.isActive || false,
      });
    });

    (uvpaintData.uvpaintHistoryImages || []).forEach((img) => {
      if (!img || img.imageType === "Artemis") return;
      if (!img.pov) return;
      if (!isAllowedType(img.imageType)) return;

      putCandidate({
        imageType: img.imageType,
        pov: img.pov,
        rendition: img.rendition ?? 1,
        activeImage: img.activeImage,
        status: img.status,
        source: "uvpaintHistoryImages",
        actions: img.actionsCounterMap ? sumActionMap(img.actionsCounterMap) : 0,
        originalImage: pickOriginalUrl(img),
        isActive: img.isActive || false,
      });
    });

    // Originals index: ONLY from SlimOverview items (any serial), per (cam,side).
    // Priority: images > history.
    const ORIGINAL_PRIORITY = { images: 30, uvpaintHistoryImages: 10 };
    const originalsByCamSide = {}; // "front_right" -> { url, source, priority, obj }

    const considerOriginal = (img, sourceName) => {
      if (!img || !img.pov) return;
      if (!isSlimOverview(img.imageType)) return;

      const cam = normCam(img.pov.simulatedCamera);
      const side = normSide(img.pov.simulatedCameraSide);
      if (!cam || !side) return;

      const key = `${cam}_${side}`;
      const url = safeUrl(img.originalImage) || safeUrl(pickOriginalUrl(img));
      if (!url) return;

      const pr = ORIGINAL_PRIORITY[sourceName] ?? 0;
      const existing = originalsByCamSide[key];
      if (!existing || pr > existing.priority) {
        originalsByCamSide[key] = { url, source: sourceName, priority: pr, obj: img };
      }
    };

    (uvpaintData.images || []).forEach((img) => considerOriginal(img, "images"));
    (uvpaintData.uvpaintHistoryImages || []).forEach((img) => considerOriginal(img, "uvpaintHistoryImages"));

    // Build comparison groups
    const groups = [];

    Object.entries(rowsByKey).forEach(([key, row]) => {
      const renditionNums = Object.keys(row.renditions)
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => b - a);

      if (renditionNums.length === 0) return;

      const pickBestAt = (rNum) => {
        const arr = row.renditions[rNum] || [];
        if (arr.length === 0) return null;
        return arr.slice().sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
      };

      const latestR = renditionNums[0];
      const prevR = renditionNums[1] ?? null;

      const latest = pickBestAt(latestR);
      const prev = prevR !== null ? pickBestAt(prevR) : null;

      const cam = normCam(row.pov?.simulatedCamera);
      const side = normSide(row.pov?.simulatedCameraSide);
      const camSideKey = cam && side ? `${cam}_${side}` : null;

      const originalEntry = camSideKey ? originalsByCamSide[camSideKey] || null : null;
      const originalUrl = originalEntry?.url || null;
      const originalFrom = originalEntry?.source || "N/A";
      const originalObj = originalEntry?.obj || null;

      const cameraLabel = `${row.pov?.simulatedCamera || "N/A"} ${row.pov?.simulatedCameraSide || ""}`.trim();
      const povSources = Array.from(row._sourcesSet || []);

      const prevInfo = prev
        ? { imageType: safeText(prev.imageType), status: safeText(prev.status), originalImage: safeText(prev.originalImage), activeImage: safeText(prev.activeImage) }
        : null;

      const latestInfo = latest
        ? { imageType: safeText(latest.imageType), status: safeText(latest.status), originalImage: safeText(latest.originalImage), activeImage: safeText(latest.activeImage) }
        : null;

      const originalInfo = originalObj
        ? { imageType: safeText(originalObj.imageType), status: safeText(originalObj.status), originalImage: safeText(originalObj.originalImage), activeImage: safeText(originalObj.activeImage) }
        : null;

      const renditionData = [
        prev ? { imageType: prev.imageType, isActive: prev.isActive, activeImage: prev.activeImage } : null,
        latest ? { imageType: latest.imageType, isActive: latest.isActive, activeImage: latest.activeImage } : null,
        null,
      ];

      const bucketType = row.bucketType;

      const group = {
        id: `${inspection.inspectionId}_${key}`,
        name: `${cameraLabel} (${bucketType})`,
        sortKey: {
          typeOrder: IMAGE_TYPE_ORDER[bucketType] ?? 999,
          cam: (cam || "").toLowerCase(),
          side: (side || "").toLowerCase(),
        },
        images: [safeUrl(prev?.image), safeUrl(latest?.image), safeUrl(originalUrl)],
        metadata: {
          inspectionId: inspection.inspectionId,
          vehicle: inspection.uvpaintInspection?.vehicleInfo,
          pov: row.pov,

          bucketType,
          renditions: [prevR, latestR, originalUrl ? "OG" : null],
          statuses: [
            prev?.status || (prevR !== null ? "N/A" : "Empty"),
            latest?.status || "N/A",
            originalUrl ? "Original" : "Empty",
          ],
          sources: [
            prev?.source || (prevR !== null ? "N/A" : "Empty"),
            latest?.source || "N/A",
            originalUrl ? `SlimOverview_original:${originalFrom}` : "Empty",
          ],
          actions: [prev?.actions ?? "N/A", latest?.actions ?? "N/A", "N/A"],
          totalVersions: renditionNums.length,

          povSources,
          cardInfo: [prevInfo, latestInfo, originalInfo],
          renditionData,

          // debug
          groupKey: key,
          camSideKey: camSideKey || "N/A",
        },
      };

      group.metadata.published = isRowPublished(group);
      groups.push(group);
    });

    // Published first, then SlimOverview rows, then Zoomer rows, then cam/side
    groups.sort((a, b) => {
      const ap = a.metadata?.published ? 1 : 0;
      const bp = b.metadata?.published ? 1 : 0;
      if (ap !== bp) return bp - ap;

      if (a.sortKey.typeOrder !== b.sortKey.typeOrder) return a.sortKey.typeOrder - b.sortKey.typeOrder;
      if (a.sortKey.cam !== b.sortKey.cam) return a.sortKey.cam.localeCompare(b.sortKey.cam);
      return a.sortKey.side.localeCompare(b.sortKey.side);
    });

    return groups;
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check if user is admin
    if (!user || !isAdmin(user)) {
      alert("Only admins can upload inspection data.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const text = await file.text();
      const lines = text.split("\n").filter((line) => line.trim());

      const startIndex = lines[0]?.toLowerCase().includes("inspection") ? 1 : 0;
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

      // ✅ Save to Firebase for other users
      try {
        const firebaseData = {
          inspections: processedInspections,
          metrics: { ...aggregated, validation },
          uploadedBy: user.email,
          uploadedAt: serverTimestamp(),
          version: currentVersion,
        };
        
        console.log("💾 Saving to Firebase:", {
          version: currentVersion,
          inspectionsCount: processedInspections.length,
          documentPath: `campaigns/${currentVersion}`
        });
        
        await setDoc(
          doc(db, "campaigns", currentVersion),
          firebaseData,
          { merge: true }
        );
        console.log("✅ Inspections saved to Firebase for other users:", {
          inspectionsCount: processedInspections.length,
          version: currentVersion
        });
      } catch (firebaseError) {
        console.error("❌ Failed to save to Firebase:", firebaseError);
        alert(`Warning: Data was processed but failed to save to Firebase. External users won't see this data. Error: ${firebaseError.message}`);
        // Don't block the admin, just log the error
      }
    } catch (err) {
      setError(err?.message || String(err));
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

  const allComparisons = useMemo(() => inspections.flatMap((i) => i.comparisons || []), [inspections]);

  const pageStyle = { background: themeVars.pageBg };

  const cardStyle = {
    background: themeVars.cardBg,
    border: `1px solid ${themeVars.cardBorder}`,
  };

  const panelStyle = {
    background: themeVars.panelBg,
    border: `1px solid ${themeVars.panelBorder}`,
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
    position: relative;
    cursor: zoom-in;
  }
  .comparisonImageBox:hover .comparisonImg {
    transform: scale(1.5) !important;
    transition: transform 0.3s ease;
  }
  .comparisonImg {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    transform-origin: center center;
    will-change: transform;
    user-select: none;
    -webkit-user-drag: none;
    transition: transform 0.3s ease;
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

  /* Hover zoom for grid images */
  .slimGridItem .comparisonImageBox,
  .zoomerGridItem .comparisonImageBox {
    cursor: zoom-in;
  }
  .slimGridItem:hover .comparisonImageBox .comparisonImg,
  .zoomerGridItem:hover .comparisonImageBox .comparisonImg {
    transform: scale(1.3) !important;
    transition: transform 0.3s ease;
  }

  .voteBtn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid rgba(148,163,184,0.25);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    user-select: none;
  }
  .voteBtn:disabled { opacity: 0.55; cursor: not-allowed; }
`;

  // -------------------------
  // Upload screen (Admin only) or Auth screen (Regular users)
  // -------------------------
  if (!loadMethod) {
    // Debug: Log user info for admin check
    if (user) {
      console.log("🔍 User check:", {
        email: user.email,
        adminEmail: ADMIN_EMAIL,
        isAdmin: isAdmin(user),
        userObject: user
      });
    }
    
    // If not authenticated, show auth screen
    if (!user && !isAuthenticating) {
      return (
        <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
          <style>{comparisonCss}</style>
          <div className="max-w-md w-full">
            <div className="rounded-xl p-8" style={panelStyle}>
              <h1 className="text-3xl font-bold mb-4" style={{ color: themeVars.headerText }}>
                Image Comparison Platform
              </h1>
              <p className="mb-6" style={{ color: themeVars.subText }}>
                Please sign in to view and vote on image comparisons.
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={signInWithGoogle}
                  className="px-6 py-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  style={{
                    background: theme === "dark" ? "#2563eb" : "#1d4ed8",
                    color: "#fff",
                  }}
                >
                  <LogIn className="w-5 h-5" />
                  Sign in with Google
                </button>
                <button
                  onClick={handleSignInAnonymously}
                  className="px-6 py-3 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  style={panelStyle}
                >
                  <User className="w-5 h-5" style={{ color: themeVars.text }} />
                  <span style={{ color: themeVars.text }}>Sign in Anonymously</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // If authenticated but not admin, show loading/waiting screen
    if (user && !isAdmin(user)) {
      if (loadingFromFirebase) {
        return (
          <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
            <style>{comparisonCss}</style>
            <div className="max-w-md w-full text-center">
              <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4" style={{ color: themeVars.text }} />
              <p style={{ color: themeVars.text }}>Loading inspection data...</p>
            </div>
          </div>
        );
      }

      if (!inspectionsLoaded) {
        return (
          <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
            <style>{comparisonCss}</style>
            <div className="max-w-md w-full">
              <div className="rounded-xl p-8" style={panelStyle}>
                <h2 className="text-2xl font-bold mb-4" style={{ color: themeVars.headerText }}>
                  Waiting for Admin
                </h2>
                <p style={{ color: themeVars.subText }} className="mb-4">
                  The admin needs to upload inspection data first. Please check back later.
                </p>
                {error && error.includes("Permission denied") && (
                  <div className="mb-4 p-3 rounded-lg" style={{ 
                    background: theme === "dark" ? "rgba(239,68,68,0.2)" : "rgba(239,68,68,0.1)",
                    border: `1px solid ${theme === "dark" ? "rgba(239,68,68,0.5)" : "rgba(239,68,68,0.3)"}`
                  }}>
                    <p className="text-sm" style={{ color: theme === "dark" ? "#fca5a5" : "#dc2626" }}>
                      ⚠️ Permission Error: Firestore security rules need to be updated. Please contact the admin.
                    </p>
                  </div>
                )}
                <p className="text-xs mb-4" style={{ color: themeVars.subText }}>
                  This page will automatically update when data is available. You can also refresh the page.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 rounded-lg flex items-center justify-center gap-2 text-sm font-medium transition-colors"
                  style={{
                    background: theme === "dark" ? "rgba(148,163,184,0.2)" : "rgba(15,23,42,0.1)",
                    color: themeVars.text,
                  }}
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh Page
                </button>
              </div>
            </div>
          </div>
        );
      }
    }

    // Admin upload screen (only shown to admin)
    if (user && isAdmin(user)) {
      return (
        <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
          <style>{comparisonCss}</style>

          <div className="max-w-3xl w-full">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-4xl font-bold" style={{ color: themeVars.headerText }}>
                  Image Comparison Platform
                </h1>
                <p style={{ color: themeVars.subText }}>
                  Only SlimOverview + Zoomer* (grouped by Camera+Side, ignoring serial). UV360 ignored.
                </p>
              </div>

              <button
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                className="px-3 py-2 rounded-lg flex items-center gap-2"
                style={panelStyle}
                title="Toggle theme"
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span style={{ color: themeVars.text }}>{theme === "dark" ? "Light" : "Dark"}</span>
              </button>
            </div>

            <div className="rounded-xl p-8" style={panelStyle}>
              <div className="flex items-center gap-4 mb-6">
                <FileText className="w-10 h-10" style={{ color: theme === "dark" ? "#60a5fa" : "#2563eb" }} />
                <div>
                  <h3 className="text-xl font-semibold" style={{ color: themeVars.text }}>
                    Upload CSV File (Admin Only)
                  </h3>
                  <p className="text-sm mt-1" style={{ color: themeVars.subText }}>
                    Each row should contain an inspection ID. Data will be shared with all users.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <div
                  className="text-xs font-mono p-3 rounded"
                  style={{
                    background: theme === "dark" ? "rgba(15,23,42,0.5)" : "rgba(15,23,42,0.04)",
                    color: themeVars.subText,
                  }}
                >
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
                      color: themeVars.text,
                    }}
                  >
                    <Upload className="w-12 h-12 mx-auto mb-3" style={{ color: themeVars.subText }} />
                    <p>Click to upload CSV</p>
                    <p className="text-sm mt-1" style={{ color: themeVars.subText }}>
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

    // Loading state (while checking auth)
    return (
      <div className="min-h-screen p-8 flex items-center justify-center" style={pageStyle}>
        <style>{comparisonCss}</style>
        <div className="max-w-md w-full text-center">
          <RefreshCw className="w-12 h-12 animate-spin mx-auto mb-4" style={{ color: themeVars.text }} />
          <p style={{ color: themeVars.text }}>Loading...</p>
        </div>
      </div>
    );
  }

  // -------------------------
  // Main app screen
  // -------------------------
  return (
    <div className="min-h-screen p-8" style={pageStyle}>
      <style>{comparisonCss}</style>

      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-4xl font-bold mb-2" style={{ color: themeVars.headerText }}>
              Image Comparison Platform
            </h1>
            <p style={{ color: themeVars.subText }}>Viewing {inspections.length} inspection(s)</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Authentication UI */}
            {isAuthenticating ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={panelStyle}>
                <RefreshCw className="w-4 h-4 animate-spin" style={{ color: themeVars.text }} />
                <span className="text-sm" style={{ color: themeVars.text }}>Loading...</span>
              </div>
            ) : !user ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={signInWithGoogle}
                  className="px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                  style={{
                    background: theme === "dark" ? "#2563eb" : "#1d4ed8",
                    color: "#fff",
                  }}
                >
                  <LogIn className="w-4 h-4" />
                  Sign in with Google
                </button>
                <button
                  onClick={handleSignInAnonymously}
                  className="px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors"
                  style={panelStyle}
                >
                  <User className="w-4 h-4" style={{ color: themeVars.text }} />
                  <span style={{ color: themeVars.text }}>Sign in Anonymously</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={panelStyle}>
                <User className="w-4 h-4" style={{ color: themeVars.text }} />
                <span className="text-sm" style={{ color: themeVars.text }}>
                  {user.displayName || user.email || "Anonymous"}
                </span>
                <button
                  onClick={handleSignOut}
                  className="ml-2 p-1 rounded hover:opacity-80 transition-opacity"
                  title="Sign out"
                  style={{ color: themeVars.text }}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            )}

            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="px-3 py-2 rounded-lg flex items-center gap-2"
              style={panelStyle}
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span style={{ color: themeVars.text }}>{theme === "dark" ? "Light" : "Dark"}</span>
            </button>

            <button onClick={resetApp} className="px-4 py-2 rounded-lg transition-colors" style={{ ...panelStyle, color: themeVars.text }}>
              Upload New CSV
            </button>
          </div>
        </div>

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
                      ? theme === "dark"
                        ? "#2563eb"
                        : "#1d4ed8"
                      : theme === "dark"
                      ? "rgba(148,163,184,0.15)"
                      : "rgba(15,23,42,0.06)",
                    color: selected ? "#fff" : themeVars.text,
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

        <div className="flex gap-2 mb-4">
          {[
            ["comparisons", "Comparisons"],
            ["slimGrid", "SlimOverview Grid"],
            ["zoomerGrid", "Zoomer Grid"],
            ["metrics", "Metrics"],
          ].map(([k, label]) => (
            <button
              key={k}
              onClick={() => setActiveView(k)}
              className="px-4 py-2 rounded-lg"
              style={{
                background:
                  activeView === k
                    ? theme === "dark"
                      ? "#2563eb"
                      : "#1d4ed8"
                    : theme === "dark"
                    ? "rgba(148,163,184,0.15)"
                    : "rgba(15,23,42,0.06)",
                color: activeView === k ? "#fff" : themeVars.text,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeView === "metrics" ? (
          <MetricsTab
            tableA={metrics.tableA}
            tableD={metrics.tableD}
            validation={metrics.validation}
            votes={votes}
            allComparisons={allComparisons}
            inspections={inspections}
            themeVars={themeVars}
            theme={theme}
            onJumpToInspection={(inspectionId) => {
              const idx = inspections.findIndex((i) => i.inspectionId === inspectionId);
              if (idx >= 0) {
                setCurrentInspectionIndex(idx);
                setCurrentComparisonIndex(0);
                setActiveView("comparisons");
              }
            }}
          />
        ) : activeView === "zoomerGrid" ? (
          <ZoomerGridTab
            currentInspection={currentInspection}
            zoom={zoom}
            themeVars={themeVars}
            theme={theme}
            cardStyle={cardStyle}
          />
        ) : activeView === "slimGrid" ? (
          <SlimOverviewGridTab
            currentInspection={currentInspection}
            zoom={zoom}
            themeVars={themeVars}
            theme={theme}
            cardStyle={cardStyle}
          />
        ) : (
          <>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6 rounded-lg p-4" style={panelStyle}>
              <div className="flex items-center gap-3 flex-wrap">
                <span style={{ color: themeVars.text, fontWeight: 600 }}>Zoom:</span>
                <button onClick={() => adjustZoom(-10)} className="p-2 rounded-lg" style={panelStyle}>
                  <ZoomOut className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>
                <span className="font-mono min-w-16 text-center" style={{ color: themeVars.text }}>
                  {zoom}%
                </span>
                <button onClick={() => adjustZoom(10)} className="p-2 rounded-lg" style={panelStyle}>
                  <ZoomIn className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>
                <button
                  onClick={() => setZoom(100)}
                  className="ml-1 px-4 py-2 rounded-lg text-sm"
                  style={{ background: theme === "dark" ? "#2563eb" : "#1d4ed8", color: "#fff" }}
                >
                  Reset
                </button>

                <div className="text-xs ml-0 md:ml-2" style={{ color: themeVars.subText }}>
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
                  <ChevronLeft className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>

                <span style={{ color: themeVars.text }} className="px-2">
                  {currentComparisonIndex + 1} / {currentInspection?.comparisons.length || 0}
                </span>

                <button
                  onClick={goToNextComparison}
                  disabled={!currentInspection || currentComparisonIndex === currentInspection.comparisons.length - 1}
                  className="p-2 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                  style={panelStyle}
                >
                  <ChevronRight className="w-5 h-5" style={{ color: themeVars.text }} />
                </button>
              </div>
            </div>

            {currentComparison?.metadata && (
              <div className="rounded-lg p-4 mb-6" style={panelStyle}>
                <h3 className="font-semibold mb-3" style={{ color: themeVars.text }}>
                  {currentComparison.name}
                </h3>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span style={{ color: themeVars.subText }}>Inspection ID:</span>
                    <span className="ml-2 text-xs font-mono" style={{ color: themeVars.text }}>
                      {currentInspection.inspectionId}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: themeVars.subText }}>Camera:</span>
                    <span className="ml-2" style={{ color: themeVars.text }}>
                      {currentComparison.metadata.pov?.simulatedCamera} {currentComparison.metadata.pov?.simulatedCameraSide}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: themeVars.subText }}>Bucket:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVars.text }}>
                      {currentComparison.metadata.bucketType}
                    </span>
                  </div>

                  <div>
                    <span style={{ color: themeVars.subText }}>Row type:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVars.text }}>
                      {currentComparison.metadata?.published ? "PUBLISHED" : "GENERATED"}
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <span style={{ color: themeVars.subText }}>Row sources:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVars.text }}>
                      {(currentComparison.metadata?.povSources || []).join(", ") || "N/A"}
                    </span>
                  </div>

                  <div className="md:col-span-2">
                    <span style={{ color: themeVars.subText }}>Latest vote:</span>
                    <span className="ml-2 font-mono text-xs" style={{ color: themeVars.text }}>
                      {(() => {
                        const v = votes?.[currentComparison.id];
                        if (!v || !v.total) return "no votes";
                        return `${v.approvals}/${v.total} approvals (${Number(v.percentage || 0).toFixed(1)}%)`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {currentComparison && (
              <div className="comparisonGrid">
                {SLOTS.map(({ label, idx }) => {
                  const badge = currentComparison.metadata?.renditions?.[idx];
                  const actions = currentComparison.metadata?.actions?.[idx];
                  const imgUrl = currentComparison.images?.[idx] || null;
                  const povObj = currentComparison.metadata?.pov || null;

                  const info = currentComparison.metadata?.cardInfo?.[idx] || null;

                  const pubLabel = getSlotPublishLabel(currentComparison.metadata, idx);
                  const pubStyle =
                    pubLabel === "Published"
                      ? { background: "rgba(34,197,94,0.18)", color: themeVars.text, border: `1px solid ${themeVars.panelBorder}` }
                      : pubLabel === "Generated"
                      ? { background: "rgba(148,163,184,0.14)", color: themeVars.text, border: `1px solid ${themeVars.panelBorder}` }
                      : { background: themeVars.chipBg, color: themeVars.chipText };

                  const voteStatus = idx === 1 ? getVoteStatus(currentComparison.id) : null;

                  return (
                    <div key={label} className="comparisonCard" style={cardStyle}>
                      <div className="comparisonHeader">
                        <h3 className="comparisonTitle" style={{ color: themeVars.headerText }}>
                          {label}
                        </h3>

                        <div className="comparisonBadges">
                          <span className="comparisonBadge" style={pubStyle}>
                            {pubLabel}
                          </span>

                          {badge !== null && badge !== undefined && (
                            <span className="comparisonBadge" style={{ background: themeVars.chipBg, color: themeVars.chipText }}>
                              {String(badge) === "OG" ? "OG" : `R${badge}`}
                            </span>
                          )}

                          {idx === 1 && (
                            <>
                              <button
                                className="voteBtn"
                                onClick={() => handleVote(currentComparison.id, "approve")}
                                disabled={Boolean(voteStatus)}
                                style={{
                                  background:
                                    voteStatus === "approve"
                                      ? "rgba(34,197,94,0.18)"
                                      : theme === "dark"
                                      ? "rgba(15,23,42,0.45)"
                                      : "rgba(15,23,42,0.04)",
                                  color: themeVars.text,
                                }}
                                title="Approve Latest"
                              >
                                <ThumbsUp className="w-4 h-4" />
                              </button>

                              <button
                                className="voteBtn"
                                onClick={() => handleVote(currentComparison.id, "reject")}
                                disabled={Boolean(voteStatus)}
                                style={{
                                  background:
                                    voteStatus === "reject"
                                      ? "rgba(239,68,68,0.18)"
                                      : theme === "dark"
                                      ? "rgba(15,23,42,0.45)"
                                      : "rgba(15,23,42,0.04)",
                                  color: themeVars.text,
                                }}
                                title="Reject Latest"
                              >
                                <ThumbsDown className="w-4 h-4" />
                              </button>

                              {/* optional: allow undo */}
                              {voteStatus && (
                                <button
                                  className="voteBtn"
                                  onClick={() => handleUnvote(currentComparison.id)}
                                  style={{
                                    background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.04)",
                                    color: themeVars.text,
                                  }}
                                  title="Remove my vote"
                                >
                                  Undo
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div
                        className="comparisonDebug"
                        style={{
                          background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.04)",
                          border: `1px solid ${themeVars.panelBorder}`,
                          color: themeVars.text,
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

                      <div
                        className="comparisonDebug"
                        style={{
                          background: theme === "dark" ? "rgba(15,23,42,0.45)" : "rgba(15,23,42,0.04)",
                          border: `1px solid ${themeVars.panelBorder}`,
                          color: themeVars.text,
                        }}
                      >
                        <div className="comparisonDebugRow">
                          <span className="comparisonDebugLabel">URL:</span>
                          <span className="comparisonDebugValue">{imgUrl || "(empty)"}</span>
                        </div>

                        <div className="comparisonDebugRow" style={{ marginBottom: 0 }}>
                          <span className="comparisonDebugLabel">POV:</span>
                        </div>

                        <pre className="comparisonDebugPre">{povObj ? JSON.stringify(povObj, null, 2) : "(none)"}</pre>
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
                        <div className="comparisonStatus" style={{ color: themeVars.subText }}>
                          {currentComparison.metadata.statuses[idx]}
                        </div>
                      )}

                      <div className="comparisonStatus" style={{ color: themeVars.subText }}>
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
