# ECOSONIC 3.0 — DATA RETENTION & PRIVACY POLICY

**Version:** 3.0.0  
**Effective Date:** 2026-11-22  
**Applies to:** EcoSonic 3.0 Bioacoustic Intelligence Storage & Services  

---

## 1. Purpose & Scope

EcoSonic 3.0 processes continuous high-resolution environmental acoustic streams to generate conservation insights, ecoacoustic soundscape metrics, and species occurrence intelligence.

This policy defines:
1. Data categorization across storage layers.
2. Standard retention schedules for raw audio, acoustic embeddings, and structured metadata.
3. Location privacy controls for endangered species and sensitive habitats.
4. Archival and secure deletion protocols.

---

## 2. Data Categorization & Storage Architecture

EcoSonic partitions data into three distinct operational tiers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 1: RAW AUDIO EVIDENCE                                                  │
│ Format: 32 kHz 16-bit mono PCM WAV files                                    │
│ Location: /storage/live_audio/{session_id}/segment_{start}_{end}.wav        │
│ Volume: ~192 KB per 3-second segment (~230 MB / continuous hour)            │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 2: ACOUSTIC EMBEDDINGS (ACOUSTIC MEMORY)                               │
│ Format: 1,280-dimensional float32 vectors (.npy / SQLite binary)            │
│ Location: /storage/live_embeddings/{session_id}/segment_{start}_{end}.npy   │
│ Volume: ~5 KB per 3-second window (~6 MB / continuous hour)                 │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ TIER 3: STRUCTURED METADATA & METRICS                                       │
│ Format: Relational SQLite records & JSON documents                          │
│ Location: /storage/db/ecosonic.db                                           │
│ Volume: ~0.5 KB per detection/fingerprint (~600 KB / continuous hour)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Retention Schedules

| Data Tier | Default Retention | Conservation Sanctuary Tier | Purpose & Disposal Method |
|---|---|---|---|
| **Tier 1: Raw Audio** | **14 Days** | **90 Days** | Enables manual expert acoustic verification of novel detections and disturbance bouts. Automatically purged via background cleanup once retention expires. |
| **Tier 2: Embeddings** | **90 Days** | **365 Days** | Powers similarity search, HDBSCAN pattern discovery, and UMAP manifold visualization. Disposed upon session expiration. |
| **Tier 3: Metadata & Metrics** | **Indefinite** | **Permanent Archive** | Retained permanently to support long-term ecological trend analysis, habitat drift monitoring, and biodiversity compliance reporting. |

---

## 4. Location Privacy & Spatial Protection Tiers

To prevent poaching, illegal egg collection, and disruptive human visitation in sensitive wildlife habitats, EcoSonic implements automated coordinate sensitivity controls:

### 4.1 Exact Mode (`location_sensitivity = "exact"`)
- **Target:** Public research stations, educational nature reserves, or non-threatened ecosystems.
- **Behavior:** Unmasked coordinates (full 6-decimal precision, $\sim 0.1\text{ meter}$) are serialized in API responses and export reports.

### 4.2 Generalized Mode (`location_sensitivity = "generalized"`)
- **Target:** Sensitive regional ecosystems, raptor roosts, or monitored forest tracts.
- **Behavior:** Coordinates are automatically rounded to 2 decimal places ($\sim 0.01^\circ \approx 1.1\text{ km}$ spatial blur). Precision is sufficient for regional modeling while concealing the exact physical sensor location.

### 4.3 Restricted Mode (`location_sensitivity = "restricted"`)
- **Target:** Critically endangered species nesting hollows, high-risk anti-poaching zones, or protected private reserves.
- **Behavior:** Coordinates are completely scrubbed from public and client responses (`latitude = null`, `longitude = null`). The record carries the mandatory advisory:
  > *"Coordinates restricted for ecological sensitivity protection."*

---

## 5. Automated Data Pruning Protocol

EcoSonic administrators may schedule periodic storage reclamation:

```bash
# Clean up raw WAV segments older than 14 days while preserving embeddings & metrics
find /app/storage/live_audio/ -type f -name "*.wav" -mtime +14 -delete
```

---

## 6. Scientific & Legal Disclaimers

1. **No Absolute Absence:** The absence of an acoustic detection does not prove biological absence (species may be silent, out of microphone range, or singing outside model sensitivity).
2. **Screening Tool Only:** Model predictions, disturbance alerts, and habitat drift statistics are automated screening indicators. They do not constitute certified legal proof of environmental crime or conclusive scientific evidence of biological extirpation.
