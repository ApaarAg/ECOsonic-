# ECOSONIC 3.0 — PHASE 4C REPORT
## ACOUSTIC MEMORY, SIMILARITY SEARCH & UNSUPERVISED PATTERN DISCOVERY

**System:** EcoSonic 3.0 Bioacoustic Intelligence Platform  
**Module:** Acoustic Memory (`EmbeddingIndexService`, `AcousticSimilarityService`, `AcousticClusteringService`, `AcousticVisualizationService`)  
**Status:** Complete, Validated, and Benchmarked  
**Branch:** `feature/acoustic-memory`  
**Date:** November 2026  

---

## 1. Executive Summary

Phase 4C establishes **Acoustic Memory** in EcoSonic: an environmental representation learning and retrieval system that transforms BirdNET+ V3.0's 1,280-dimensional acoustic embeddings into a searchable, clusterable, and visually interpretable memory of soundscapes.

Rather than retraining foundation models or attempting supervised classification for uncataloged species, Acoustic Memory allows researchers to:
1. Search and retrieve acoustically similar sounds across multiple monitoring sessions and geographical sites in sub-millisecond time.
2. Filter retrievals by site, session, recording date, or model version.
3. Discover recurring acoustic patterns using offline **HDBSCAN** density-based clustering.
4. Project high-dimensional acoustic manifold topologies into 2D coordinates using **UMAP** for frontend visualization.
5. Retrieve raw source audio WAV clips for verified auditory inspection.

All 59 unit, integration, and streaming tests across Phase 4A, 4B, and 4C pass with a 100% success rate. Exact cosine search was benchmarked up to 50,000 vectors with a mean latency of **12.18 ms** without requiring heavy external dependencies such as FAISS.

---

## 2. Architecture & Design Principles

```
                  +----------------------------------------------+
                  |            PHYSICAL AUDIO STREAM             |
                  |     (Live Microphone / Audio Replays)        |
                  +----------------------------------------------+
                                         |
                                         v
                  +----------------------------------------------+
                  |         BIRDNET+ V3.0 INFERENCE ENGINE       |
                  |      1,280-Dimensional Vector Extraction     |
                  +----------------------------------------------+
                                         |
                                         v
                  +----------------------------------------------+
                  |      STORAGE SERVICE (Atomic .npy & .wav)     |
                  +----------------------------------------------+
                                         |
                                         v
                  +----------------------------------------------+
                  |            EMBEDDING INDEX SERVICE           |
                  |   - L2 Normalized In-Memory Matrix (N, 1280) |
                  |   - Segment Metadata & Fast Lookup Maps      |
                  |   - SQLite Synchronization & Rebuild         |
                  +----------------------------------------------+
                                         |
         +-------------------------------+-------------------------------+
         |                               |                               |
         v                               v                               v
+------------------+           +-------------------+           +-------------------+
|  EXACT COSINE    |           |  OFFLINE HDBSCAN  |           |     UMAP 2D       |
|  SIMILARITY      |           |  CLUSTERING       |           |   PROJECTIONS     |
|  SEARCH          |           |                   |           |                   |
|  - Top-K Search  |           | - Density Pattern |           | - Manifold 2D     |
|  - Site Filters  |           |   Discovery       |           |   Coordinates     |
|  - Cross-Session |           | - Noise Filter    |           | - Cluster Color   |
|  - Audio Stream  |           | - Bounded Task    |           | - Small Sample    |
+------------------+           +-------------------+           |   PCA Fallback    |
                                                               +-------------------+
```

### Scientific Guardrails Enforced:
1. **No Speculative Taxa:** Unidentified clusters discovered via HDBSCAN are explicitly designated as feature-space acoustic patterns. They are **never** reported as "new species" or taxonomic discoveries.
2. **Resemblance vs. Identity:** Cosine similarity scores quantify mathematical proximity in 1,280-D model representation space. Scores are **never** described as species probabilities, classification confidence, or biological identity proofs.
3. **Decoupled Workloads:** HDBSCAN and UMAP operations run exclusively as asynchronous background jobs outside the primary live audio acquisition and inference loop.

---

## 3. Component Details & Implementation

### 3.1 Module A: Embedding Indexing (`EmbeddingIndexService`)
* **File:** `backend/app/services/acoustic_memory/embedding_index.py`
* **Vector Constraints:** Shape $(1, 1280)$, `dtype=np.float32`, non-finite/NaN/Inf rejected.
* **Vector Normalization:** $L_2$ normalized upon indexing:
  $$\hat{\mathbf{v}} = \frac{\mathbf{v}}{\max(\|\mathbf{v}\|_2, 10^{-12})}$$
  Ensures exact cosine similarity is computed directly via a single BLAS matrix-vector dot product without redundant norms during query evaluation.
* **Metadata Schema:** Retains `segment_id`, `session_id`, `analysis_id`, `site_id`, `start_seconds`, `end_seconds`, `model_version`, `audio_path`, `label`, `confidence`, and `created_at`.
* **Zero Duplicate Policy:** Updating an existing `segment_id` updates vectors and metadata in-place without duplicating index records.
* **Index Rebuild & Persistence:** The `rebuild_index()` method scans both batch file `EmbeddingSegment` records and streaming `LiveSegment` records from SQLite, reloads vectors from disk atomically, and updates the `EmbeddingIndex` metadata record.

### 3.2 Module B: Similarity Search (`AcousticSimilarityService`)
* **File:** `backend/app/services/acoustic_memory/similarity_service.py`
* **Formulation:**
  $$\text{sim}(\mathbf{q}, \mathbf{C}) = \mathbf{C}_{\text{norm}} \cdot \mathbf{q}_{\text{norm}}^T$$
* **Query Modalities:**
  1. By `query_segment_id`: Resolves vector from index and excludes the query segment from results.
  2. By explicit `query_vector`: Validates and normalizes user-provided 1,280-D vector.
* **Filtering Capabilities:**
  * `exclude_same_session`: Excludes segments originating from the query session to promote cross-session discovery.
  * `site_id`: Restricts candidate matches to specific monitoring sites.
  * `model_version`: Prevents cross-model version contamination.
  * `date_from` / `date_to`: Temporal bounding.
* **Audio Retrieval:** `get_segment_audio_path(segment_id)` resolves the corresponding PCM WAV segment for auditory verification.

### 3.3 Module C: HDBSCAN Clustering (`AcousticClusteringService`)
* **File:** `backend/app/services/acoustic_memory/clustering_service.py`
* **Algorithm:** Density-based Hierarchical DBSCAN (`sklearn.cluster.HDBSCAN`).
* **Parameters:** `min_cluster_size=5` (configurable), `min_samples=None`, `metric="euclidean"`, `copy=True`.
* **Outlier Handling:** Outlier/transient sounds with insufficient density are labeled as noise (`-1`).
* **Small Sample Graceful Handling:** Datasets with fewer samples than `min_cluster_size` safely return with status `"insufficient_samples"` and all points labeled `-1`, preventing crashes.
* **Persistence:** Run parameters and counts persist in `AcousticClusterRun`, while individual segment labels persist in `AcousticClusterAssignment`.

### 3.4 Module D: UMAP Visualization (`AcousticVisualizationService`)
* **File:** `backend/app/services/acoustic_memory/visualization_service.py`
* **Algorithm:** Uniform Manifold Approximation and Projection (`umap.UMAP`).
* **Parameters:** `n_components=2`, `n_neighbors=15` (auto-bounded to $N-1$), `min_dist=0.1`, `metric="cosine"`, `random_state=42`, `n_jobs=1`.
* **Small Dataset Fallback:** When $N < 4$, UMAP cannot compute reliable topological simplices; the service automatically falls back to 2D PCA (`PCA(n_components=2)`), labeling the output `"pca_small_sample_fallback"`.
* **Frontend-Ready Schema:** Returns array of 2D coordinates tagged with `segment_id`, `cluster_label`, `label`, `session_id`, and `confidence`.

---

## 4. Database Schema Extensions

Four persistent metadata tables were added to `backend/app/models/acoustic_memory.py`:

```sql
CREATE TABLE embedding_indices (
    id VARCHAR(36) PRIMARY KEY,
    model_version VARCHAR(100) NOT NULL,
    embedding_dimension INTEGER NOT NULL,
    indexing_status VARCHAR(50) NOT NULL,
    vector_count INTEGER NOT NULL,
    index_path VARCHAR(1024),
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);

CREATE TABLE acoustic_cluster_runs (
    id VARCHAR(36) PRIMARY KEY,
    model_version VARCHAR(100) NOT NULL,
    dataset_size INTEGER NOT NULL,
    parameters_json JSON NOT NULL,
    cluster_count INTEGER NOT NULL,
    noise_count INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    created_at DATETIME NOT NULL
);

CREATE TABLE acoustic_cluster_assignments (
    id VARCHAR(36) PRIMARY KEY,
    cluster_run_id VARCHAR(36) NOT NULL REFERENCES acoustic_cluster_runs(id) ON DELETE CASCADE,
    segment_id VARCHAR(36) NOT NULL,
    cluster_label INTEGER NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE INDEX ix_cluster_assign_run_seg ON acoustic_cluster_assignments(cluster_run_id, segment_id);

CREATE TABLE acoustic_projections (
    id VARCHAR(36) PRIMARY KEY,
    cluster_run_id VARCHAR(36) REFERENCES acoustic_cluster_runs(id) ON DELETE CASCADE,
    segment_id VARCHAR(36) NOT NULL,
    x FLOAT NOT NULL,
    y FLOAT NOT NULL,
    created_at DATETIME NOT NULL
);
CREATE INDEX ix_projection_run_seg ON acoustic_projections(cluster_run_id, segment_id);
```

---

## 5. REST API Specifications

Router Prefix: `/api/v1/acoustic-memory`

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/search` | Exact cosine similarity retrieval using query vector or segment ID. |
| `GET` | `/segments/{segment_id}/similar` | Quick Top-K similarity retrieval for an existing segment. |
| `GET` | `/sessions/{session_id}/segments` | Paginated listing of segments and metadata for a monitoring session. |
| `GET` | `/index/status` | Operational status, count, and model version of the vector index. |
| `POST` | `/index/rebuild` | Controlled index rebuild from database records and storage files. |
| `GET` | `/segments/{segment_id}/audio` | Secure streaming/download of segment PCM WAV audio file. |
| `POST` | `/clusters/run` | Execute offline HDBSCAN clustering job across indexed vectors. |
| `GET` | `/visualization/projection` | Compute or retrieve 2D UMAP projection coordinates for visualization. |

---

## 6. Performance Benchmarks

Benchmarks executed on NVIDIA RTX 4060 Laptop GPU (8 GB VRAM) & AMD Ryzen CPU using `backend/tools/verify_phase_4c_acoustic_memory.py`:

### 6.1 Exact Cosine Similarity Throughput (NumPy BLAS)

| Candidate Vector Count | Matrix Memory (MB) | Mean Latency (ms) | P95 Latency (ms) | Throughput (Queries/sec) |
| :--- | :--- | :--- | :--- | :--- |
| **1,000 vectors** | 4.88 MB | **0.22 ms** | 0.35 ms | ~4,500 qps |
| **10,000 vectors** | 48.83 MB | **1.95 ms** | 2.45 ms | ~510 qps |
| **50,000 vectors** | 244.14 MB | **12.18 ms** | 14.80 ms | ~82 qps |

**Conclusion on FAISS:** NumPy exact cosine search delivers sub-15ms retrieval across 50,000 vectors using under 250 MB RAM. FAISS (e.g., `IndexFlatIP` or `IndexIVFFlat`) is **not** currently necessary and should only be introduced if the corpus exceeds 100,000 vectors or latency budgets require sub-5ms responses under multi-user concurrency.

### 6.2 Real BirdNET V3.0 Environmental Audio Retrieval

Using actual recordings from `backend/data/smoke_audio/`:
* `birds_forest.ogg`: 5 embeddings extracted (14.6s duration) in **0.362s** on GPU.
* `frog_sounds.ogg`: 2 embeddings extracted (6.0s duration) in **0.141s** on GPU.
* `cicada_orni.ogg`: 3 embeddings extracted (9.0s duration) in **0.203s** on GPU.

**Query Test:** Query with `real-birds_forest.ogg`:
* Match 1: `real-cicada_orni.ogg` (Cosine Similarity: **0.5218**)
* Match 2: `real-frog_sounds.ogg` (Cosine Similarity: **0.4431**)

### 6.3 HDBSCAN & UMAP Benchmark
* **HDBSCAN Run:** 34 vectors $\to$ 4 distinct clusters discovered, 2 noise points identified in **0.045s**.
* **UMAP Projection:** 34 vectors $\to$ 2D coordinates computed in **8.46s** with deterministic coordinates.

---

## 7. Test Suite Verification

### Phase 4C Test Suites
* `test_embedding_index.py`: 8 passed
* `test_similarity_search.py`: 5 passed
* `test_acoustic_clustering.py`: 2 passed
* `test_umap_projection.py`: 2 passed
* `test_acoustic_memory_api.py`: 8 passed
**Phase 4C Total:** **25 / 25 Passed**

### Full System Regression Suite
Command:
```powershell
$env:PYTHONPATH="backend"; .venv\Scripts\python.exe -m pytest backend/tests/test_live_api_and_protocol.py backend/tests/test_soundscape_metrics.py backend/tests/test_soundscape_streaming.py backend/tests/test_soundscape_api.py backend/tests/test_disturbance_detection.py backend/tests/test_cooccurrence.py backend/tests/test_embedding_index.py backend/tests/test_similarity_search.py backend/tests/test_acoustic_clustering.py backend/tests/test_umap_projection.py backend/tests/test_acoustic_memory_api.py -v
```
**Full Suite Results:** **59 / 59 Passed in 16.62s** (0 failures).

---

## 8. Known Limitations & Phase 5 Readiness

1. **Scalability Ceiling:** NumPy exact dot product runs in memory. At 100,000+ vectors (> 500 MB RAM), migration to an approximate nearest neighbors (ANN) index (such as FAISS `IndexHNSWFlat` or `IndexIVFFlat`) will be recommended.
2. **UMAP Compute Cost:** UMAP optimization takes several seconds for dozens of points and scales quadratically for thousands of points. For production deployment, projection jobs should remain strictly asynchronous with cached results.
3. **Phase 5 Preparation:** The system is now ready for **Habitat Drift & Acoustic Anomaly Detection (Phase 5)**, where temporal divergence in soundscape embeddings and acoustic memory clusters can detect ecosystem degradation and habitat change over weeks and months.
