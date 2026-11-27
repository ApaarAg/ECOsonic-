export interface BrowserGeolocationResult {
  status: "available" | "unavailable";
  latitude: number | null;
  longitude: number | null;
  accuracyM: number | null;
  capturedAt: string | null;
  reason?: "denied" | "timeout" | "position_unavailable" | "unsupported";
  error?: string | null;
}

/**
 * Queries real browser/device geolocation via navigator.geolocation.getCurrentPosition.
 * Never fabricates default coordinates or substitutes prior coordinates when unavailable.
 */
export async function acquireBrowserLocation(
  timeoutMs = 6500,
): Promise<BrowserGeolocationResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return {
      status: "unavailable",
      latitude: null,
      longitude: null,
      accuracyM: null,
      capturedAt: null,
      reason: "unsupported",
      error: "Browser geolocation is not supported in this environment.",
    };
  }

  return new Promise<BrowserGeolocationResult>((resolve) => {
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = pos.coords?.latitude;
          const lon = pos.coords?.longitude;
          const acc = pos.coords?.accuracy;
          if (
            typeof lat !== "number" ||
            !Number.isFinite(lat) ||
            lat < -90 ||
            lat > 90 ||
            typeof lon !== "number" ||
            !Number.isFinite(lon) ||
            lon < -180 ||
            lon > 180
          ) {
            resolve({
              status: "unavailable",
              latitude: null,
              longitude: null,
              accuracyM: null,
              capturedAt: null,
              reason: "position_unavailable",
              error: "Browser returned non-finite or out-of-range coordinates.",
            });
            return;
          }

          const capturedAt =
            typeof pos.timestamp === "number" && Number.isFinite(pos.timestamp)
              ? new Date(pos.timestamp).toISOString()
              : new Date().toISOString();

          resolve({
            status: "available",
            latitude: lat,
            longitude: lon,
            accuracyM:
              typeof acc === "number" && Number.isFinite(acc) && acc >= 0
                ? acc
                : null,
            capturedAt,
            error: null,
          });
        },
        (err) => {
          const reason: BrowserGeolocationResult["reason"] =
            err.code === 1
              ? "denied"
              : err.code === 3
                ? "timeout"
                : "position_unavailable";
          resolve({
            status: "unavailable",
            latitude: null,
            longitude: null,
            accuracyM: null,
            capturedAt: null,
            reason,
            error: err.message || "Unable to acquire browser location.",
          });
        },
        {
          enableHighAccuracy: true,
          timeout: timeoutMs,
          maximumAge: 0,
        },
      );
    } catch (exc) {
      resolve({
        status: "unavailable",
        latitude: null,
        longitude: null,
        accuracyM: null,
        capturedAt: null,
        reason: "position_unavailable",
        error: exc instanceof Error ? exc.message : String(exc),
      });
    }
  });
}
