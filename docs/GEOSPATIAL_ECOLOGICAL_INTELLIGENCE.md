# ECOsonic 3.0 — Geospatial Ecological Intelligence & Observation Gap System

## 1. Executive Summary & Objective

In ecological field acoustics, a core challenge is moving beyond raw classification lists to determine **what was expected to be vocalizing within a given geographic and seasonal habitat, and which expected species were not acoustically detected during an observation session**.

The **Geospatial Ecological Intelligence & Observation Gap Engine** introduces a scientifically rigorous subsystem to ECOsonic 3.0 that evaluates observation sessions against regional ecological baselines while strictly adhering to ecological epistemology:

> **Fundamental Epistemological Rule:**  
> Acoustic non-detection is **insufficient evidence for biological absence**. Non-detection simply means vocalizations were not recorded above model confidence thresholds within that specific recording window. A species may be foraging silently, nesting, outside microphone detection radius (~50–150m in dense canopy), or inhibited by weather.  
> **ECOsonic reports `not_detected = True`, NEVER `absent = True`.**

---

## 2. Core Scientific Terminology

To avoid pseudo-scientific over-claiming, the subsystem enforces the following standard terminology across backend schemas, APIs, AI prompts, and frontend interfaces:

| Term | Scientific Definition | Disallowed Phrasing |
|---|---|---|
| **Expected species** | Species possessing modeled regional and seasonal suitability in the observation context based on BirdNET Geo V3.0 occurrence priors. | "Native species", "Guaranteed species" |
| **Detected species** | Species registered acoustically in the session with model confidence above verification thresholds and temporal persistence. | "Confirmed inhabitants" |
| **Expected but not acoustically detected** | Regional baseline species with zero verified acoustic classifications during the sampling interval. | **"Absent species"**, **"Locally extinct"**, "Missing species" |
| **Observation gap** | The subset of regional baseline species not acoustically captured during the specific observation window. | "Extinction gap", "Ecosystem deficit" |
| **Acoustic Observation Coverage** | The explainable ratio: $\frac{\text{Detected Expected Species}}{\text{Total Regionally Expected Species}} \times 100\%$. | **"Biodiversity Health Score"**, **"Ecosystem Score"** |
| **Insufficient evidence for absence** | Formal scientific caveat accompanying every unobserved expected species record. | "Confirmed missing" |
| **Unexpected taxa** | Taxa acoustically registered with high confidence but not listed in regional baseline (e.g. seasonal migrants, range shifts). | **"Invasive species"**, "Anomalous intruders" |

---

## 3. Subsystem Architecture

```
                                  [ Audio Stream / LiveSession ]
                                                │
                                                ▼
                                    [ BirdNET Inference Worker ]
                                                │
                                    (Raw Acoustic Detections)
                                                │
                                                ▼
                            ┌────────────────────────────────────────┐
                            │    ObservationGapEngine (Core)         │
                            │  1. Non-biological sound filtering    │
                            │  2. Temporal persistence aggregation   │
                            │  3. Quality threshold gating          │
                            └───────────────────┬────────────────────┘
                                                │
              ┌─────────────────────────────────┴─────────────────────────────────┐
              ▼                                                                   ▼
┌───────────────────────────────┐                               ┌─────────────────────────────────┐
│ BirdNetGeoKnowledgeProvider   │                               │ Observation Gap Partitioner     │
│ - 14,082 species spatial prior│                               │ 1. Observed Expected Taxa       │
│ - 48 meteorological weeks     │                               │ 2. Observation Gap Taxa         │
│ - In-memory coordinate cache  │                               │ 3. Unexpected Taxa              │
└──────────────┬────────────────┘                               │ 4. Acoustic Coverage Metric     │
               │                                                └────────────────┬────────────────┘
               ▼                                                                 │
    (Regional Baseline)                                                          │
               │                                                                 │
               └────────────────────────────────┬────────────────────────────────┘
                                                │
                                                ▼
                            ┌────────────────────────────────────────┐
                            │   EcologicalInterpretationService      │
                            │  • Generalized privacy coordinates     │
                            │  • Grounded evidence lexicon whitelist│
                            │  • Hallucination scrubber              │
                            │  • Absence claim sanitizer             │
                            │  • Deterministic rule engine fallback  │
                            └───────────────────┬────────────────────┘
                                                │
                                                ▼
                                   [ ObservationGapResponse ]
                                                │
                                                ▼
                                    [ REST API / Frontend ]
                                  ObservationGapSection.tsx
```

---

## 4. Ecological Knowledge Layer

### Interface: `EcologicalKnowledgeProvider`
Located in `backend/app/services/ecological_knowledge/provider_base.py`. Provides an asynchronous abstraction for looking up regional species checklists:

```python
class EcologicalKnowledgeProvider(ABC):
    @abstractmethod
    async def get_expected_species(
        self,
        latitude: float,
        longitude: float,
        observation_week: int,
        min_occurrence_score: float = 0.08,
        ecosystem_category: Optional[str] = None,
    ) -> List[ExpectedSpeciesItem]:
        """Retrieve regionally and seasonally expected species."""
```

### Production Implementation: `BirdNetGeoKnowledgeProvider`
Located in `backend/app/services/ecological_knowledge/birdnet_geo_provider.py`.
- Wraps ECOsonic's pre-existing `GeoTemporalIntelligenceService`.
- Executes the official **BirdNET Geo V3.0 ONNX model** (14,082 species output vector).
- Computes spatial coordinates to location encoding and observation date to one of **48 meteorological weeks**.
- Normalizes species probabilities into occurrence scores with qualitative tiering:
  - $\ge 0.60$: `expected` (frequent/common)
  - $0.30 - 0.60$: `expected` (moderate)
  - $0.08 - 0.30$: `rare` (infrequent seasonal presence)

### Testing Implementation: `MockEcologicalKnowledgeProvider`
Located in `backend/app/services/ecological_knowledge/mock_provider.py`.
- Supplies deterministic, isolated species checklists for automated regression and unit testing without ONNX model overhead.

---

## 5. Detection Quality & Partitioning Engine

Located in `backend/app/services/observation_gap_engine.py`.

### Quality Rules
1. **Non-Biological Exclusion:** Automatically removes mechanical and anthropogenic sound classes (`Engine`, `Chainsaw`, `Siren`, `Gunshot`, `Vehicle`, etc.) before biological comparison.
2. **Temporal Persistence Thresholding:**
   - Single-window detection: requires $\ge 0.35$ model confidence.
   - Multi-window persistent detection ($\ge 2$ distinct windows): requires $\ge 0.25$ confidence.
   - Computes `first_seen_seconds`, `last_seen_seconds`, and `is_persistent`.
3. **Fourfold Matrix Partitioning:**
   - **Observed Expected (`expected_and_detected`):** Present in regional baseline and verified in acoustic detections.
   - **Observation Gap (`expected_but_not_detected`):** Present in regional baseline but unobserved. Annotated with possible acoustic/ecological factors (e.g. foraging silence, canopy dampening).
   - **Unexpected Taxa (`detected_unexpected`):** Acoustically verified but outside expected baseline. Labeled as potential regional visitor, non-breeding disperser, or seasonal migrant (**never invasive**).

### Observation Adequacy Rules
- **Unspecified Location:** When coordinates are `None`, engine sets `observation_adequacy = "location_unspecified"`, suppresses fabricated checklists, and returns zero expected species.
- **Duration Constraints:**
  - $< 120$ seconds: flagged as `"insufficient_duration"` (sampling too brief for reliable ecological conclusions).
  - $120 - 300$ seconds: flagged as `"marginal_duration"` (preliminary inventory).
  - $\ge 300$ seconds: flagged as `"adequate"`.
- **Zero Detections:** flagged as `"zero_detections"`; non-detection disclaimer prominently preserved.

---

## 6. Safe AI Interpretation Layer (Gemini)

Located in `backend/app/services/ecological_interpretation_service.py`.

### Epistemological Guardrails
1. **Interpretation Only:** Gemini is strictly an **interpretative and explanatory agent**. It is **NEVER** queried for species checklists and has **zero authority** over species occurrences.
2. **Isolated Execution:** Gemini is never placed in the real-time audio pipeline, WebSocket server, or inference loop. Gap analyses run asynchronously upon user or session request.
3. **Absence Claim Sanitizer:** Text generated by external AI is automatically scanned with regular expressions; claims such as `"Species X is absent"` are transformed into `"Species X was not acoustically detected"`.
4. **Ungrounded Hallucination Scrubber:** Highlights and summaries are checked against an **allowed species lexicon whitelist** (the strict union of expected baseline species and detected session species). Mentions of ungrounded species (e.g. foreign or hallucinated taxa) are discarded.
5. **Deterministic Rule Engine Fallback:** If `GEMINI_API_KEY` is omitted, disabled, or fails (rate-limit, timeout), the service falls back to a deterministic, rule-based ecological interpretation generator that produces 100% grounded, factual summaries without external dependencies.
6. **Location Privacy:** Raw GPS coordinates are never sent to external AI APIs; coordinates are generalized to coarse 0.1° (~10km) grids.

---

## 7. API & Frontend Integration

### REST Endpoint: `POST /api/v1/ecology/observation-gap`
- **Request:**
  ```json
  {
    "session_id": "3f8e...",
    "latitude": 47.86,
    "longitude": -123.93,
    "min_occurrence_score": 0.08,
    "min_confidence": 0.25,
    "include_ai_interpretation": true
  }
  ```
- **Response:**
  Returns complete `ObservationGapResponse` with `context`, `coverage`, `expected_and_detected`, `expected_but_not_detected`, `detected_unexpected`, and `interpretation`.

### Frontend Adapter: `fetchObservationGap`
- Added to `EcoSonicDataAdapter` interface.
- Implemented in `BackendEcoSonicAdapter` with error recovery.
- Implemented in `DemoEcoSonicAdapter` with realistic Hoh Rainforest demo fixtures.

### UI Component: `ObservationGapSection.tsx`
- **Location:** `web/src/components/ecology/ObservationGapSection.tsx`.
- **Rendered in:** `web/src/pages/SessionDetailPage.tsx`.
- **Features:**
  - Acoustic Observation Coverage percentage progress ring & metric cards.
  - Adequacy badge with color coding (`adequate`, `marginal_duration`, `insufficient_duration`, `zero_detections`, `location_unspecified`).
  - Coarse privacy grid tag and ecological context strip.
  - Interactive tabs: *All Taxa*, *Observation Gap*, *Observed Baseline*, *Unexpected Taxa*.
  - Grounded AI/Rule Engine interpretation panel with expandable methodological limitations.
  - Mandatory scientific absence caveat banner.

---

## 8. Verification & Test Suite

The subsystem is validated by automated backend and frontend test suites:

### Backend Tests (`backend/tests/test_observation_gap.py` & `test_ecology_api.py`)
- **Case 1:** Partitioning expected vs detected; gap calculation; `not_detected=True`; `evidence_status='insufficient_evidence_for_absence'`.
- **Case 2:** Unexpected species handling; occurrence marked unexpected; verifies "invasive" is never emitted.
- **Case 3:** Missing coordinates; `location_unspecified` adequacy; zero fabricated species.
- **Case 4:** Short recording (<120s); `insufficient_duration` adequacy warning.
- **Case 5:** Zero detections; `zero_detections` adequacy; non-detection disclaimers preserved.
- **Case 6:** Fallback rule engine when Gemini is unavailable; grounded synthesis.
- **Case 7:** Hallucination scrubber and absence language sanitization.
- **Case 8:** Repeated detections deduplication and temporal persistence metrics.
- **Case 9:** Non-biological acoustic class exclusion (`Engine`, `Chainsaw`, etc.).
- **Integration Test:** End-to-end FastAPI endpoint test validating session creation, database retrieval, and JSON schema compliance.

*Results:* **10 / 10 passed in 1.92s.**

### Frontend Tests & Build (`web/src/adapters/ecosonicAdapter.test.ts`)
- `DemoEcoSonicAdapter.fetchObservationGap` fixture contract validation.
- Full TypeScript & Vite build verification (`npm --prefix web run build`).

*Results:* **94 / 94 passed in 1.38s; zero build errors.**
