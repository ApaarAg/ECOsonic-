import React, { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Upload,
  Radio,
  MapPin,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Download,
  Trash2,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { analysesService } from '../services/analysesService';
import { acousticService } from '../services/acousticService';
import { detectionsService } from '../services/detectionsService';
import { Analysis, Detection } from '../types';
import { WaveformPlayer } from '../components/audio/WaveformPlayer';
import { SpectrogramView } from '../components/audio/SpectrogramView';
import { DetectionsTimeline } from '../components/charts/DetectionsTimeline';
import { DetectionCard } from '../components/detections/DetectionCard';
import { LoadingState } from '../components/common/LoadingState';
import { ErrorBanner } from '../components/common/ErrorBanner';
import { formatSeconds, formatCoordinates } from '../utils/formatters';

const ALLOWED_EXTENSIONS = ['wav', 'mp3', 'flac', 'ogg', 'm4a'];

export const AudioIntelligence: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlAnalysisId = searchParams.get('analysis_id');

  // File upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [latitude, setLatitude] = useState<string>('');
  const [longitude, setLongitude] = useState<string>('');
  const [recordedAt, setRecordedAt] = useState<string>('');
  const [dragOver, setDragOver] = useState<boolean>(false);

  // Active analysis state
  const [activeAnalysis, setActiveAnalysis] = useState<Analysis | null>(null);
  const [analysesList, setAnalysesList] = useState<Analysis[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [currentStage, setCurrentStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Audio playback & segment highlight
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [highlightRegion, setHighlightRegion] = useState<{ start: number; end: number } | undefined>(undefined);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Fetch recent analyses list for quick switcher
  const refreshList = async () => {
    try {
      const data = await analysesService.listAnalyses(1, 20);
      setAnalysesList(data.items);
    } catch (e) {
      console.warn('Could not list analyses:', e);
    }
  };

  useEffect(() => {
    refreshList();
  }, []);

  // Load analysis if specified in URL query
  useEffect(() => {
    if (urlAnalysisId) {
      loadAnalysisDetails(urlAnalysisId);
    }
  }, [urlAnalysisId]);

  const loadAnalysisDetails = async (id: string) => {
    setError(null);
    try {
      const analysis = await analysesService.getAnalysis(id);
      setActiveAnalysis(analysis);
      setAudioUrl(acousticService.getAudioStreamUrl(id));
      if (analysis.detections && analysis.detections.length > 0) {
        setSelectedDetection(analysis.detections[0]);
        setHighlightRegion({
          start: analysis.detections[0].start_seconds,
          end: analysis.detections[0].end_seconds,
        });
      }
    } catch (err: any) {
      setError(err.message || `Failed to load analysis '${id}'`);
    }
  };

  // File validation
  const validateAndSetFile = (file: File) => {
    setError(null);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`Unsupported audio format '.${ext}'. Supported formats are: ${ALLOWED_EXTENSIONS.join(', ')}`);
      return;
    }
    if (file.size > 256 * 1024 * 1024) {
      setError(`File size exceeds 256 MB maximum threshold.`);
      return;
    }
    setSelectedFile(file);
  };

  // Upload & start analysis polling
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFile) return;

    setIsUploading(true);
    setUploadProgress(5);
    setCurrentStage('Initiating upload');
    setError(null);

    try {
      const latVal = latitude ? parseFloat(latitude) : undefined;
      const lonVal = longitude ? parseFloat(longitude) : undefined;

      const created = await analysesService.uploadAnalysis({
        file: selectedFile,
        latitude: latVal,
        longitude: lonVal,
        recorded_at: recordedAt ? new Date(recordedAt).toISOString() : undefined,
      });

      setSearchParams({ analysis_id: created.id });

      // Begin status polling loop
      await pollJobStatus(created.id);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      setIsUploading(false);
    }
  };

  // Status Poller
  const pollJobStatus = async (analysisId: string) => {
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes max

    const interval = setInterval(async () => {
      attempts++;
      try {
        const statusData = await analysesService.getAnalysisStatus(analysisId);
        setUploadProgress(statusData.progress);
        setCurrentStage(statusData.current_stage || 'Processing audio stream');

        if (statusData.status === 'completed') {
          clearInterval(interval);
          setIsUploading(false);
          await loadAnalysisDetails(analysisId);
          await refreshList();
        } else if (statusData.status === 'failed' || statusData.status === 'cancelled') {
          clearInterval(interval);
          setIsUploading(false);
          setError(statusData.error_message || `Analysis ${statusData.status}.`);
          await refreshList();
        } else if (attempts >= maxAttempts) {
          clearInterval(interval);
          setIsUploading(false);
          setError('Analysis polling timed out. Check backend status.');
        }
      } catch (e: any) {
        clearInterval(interval);
        setIsUploading(false);
        setError(e.message || 'Polling error');
      }
    }, 1000);
  };

  const handleSelectDetection = (det: Detection) => {
    setSelectedDetection(det);
    setHighlightRegion({
      start: det.start_seconds,
      end: det.end_seconds,
    });
  };

  const handleReviewDetection = async (
    detectionId: string,
    status: 'confirmed' | 'rejected' | 'uncertain'
  ) => {
    try {
      await detectionsService.submitReview(detectionId, status);
      // Update local state
      if (activeAnalysis && activeAnalysis.detections) {
        const updatedDets = activeAnalysis.detections.map((d) =>
          d.id === detectionId ? { ...d, review_status: status } : d
        );
        setActiveAnalysis({ ...activeAnalysis, detections: updatedDets });
      }
    } catch (e: any) {
      setError(e.message || 'Failed to submit review');
    }
  };

  const handleDeleteAnalysis = async () => {
    if (!activeAnalysis) return;
    if (!window.confirm(`Delete analysis for ${activeAnalysis.filename}?`)) return;
    try {
      await analysesService.deleteAnalysis(activeAnalysis.id);
      setActiveAnalysis(null);
      setAudioUrl(null);
      setSearchParams({});
      await refreshList();
    } catch (e: any) {
      setError(e.message || 'Failed to delete analysis');
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-bio-leaf" />
            <h1 className="text-2xl font-bold tracking-tight text-white">Audio Intelligence</h1>
          </div>
          <p className="mt-1 text-sm text-forest-300">
            Acoustic signal normalization, BirdNET+ V3.0 neural classification, and interactive playback
          </p>
        </div>

        {/* Existing Analyses Switcher */}
        {analysesList.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-forest-400">Select Session:</span>
            <select
              value={activeAnalysis?.id || ''}
              onChange={(e) => {
                if (e.target.value) {
                  setSearchParams({ analysis_id: e.target.value });
                }
              }}
              className="bg-forest-900 border border-forest-750 text-xs font-mono text-forest-200 rounded-lg px-3 py-1.5 focus:border-bio-emerald outline-none"
            >
              <option value="">-- Ingested Recordings --</option>
              {analysesList.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filename} ({a.status})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Main Grid: Upload Sidebar + Analysis Workbench */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column (Upload Form) */}
        <div className="lg:col-span-4 space-y-6">
          <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
            <div className="flex items-center justify-between text-xs font-mono text-forest-300 pb-2 border-b border-forest-800">
              <span className="font-semibold text-gray-200 flex items-center gap-2">
                <Upload className="w-4 h-4 text-bio-leaf" />
                Ingestion Engine
              </span>
              <span className="text-[10px] text-bio-leaf">WAV, MP3, FLAC, OGG</span>
            </div>

            <form onSubmit={handleUpload} className="space-y-4">
              {/* Drag and Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  if (e.dataTransfer.files?.[0]) {
                    validateAndSetFile(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                  dragOver
                    ? 'border-bio-leaf bg-bio-emerald/10'
                    : selectedFile
                    ? 'border-bio-emerald bg-forest-850'
                    : 'border-forest-750 hover:border-forest-600 bg-forest-950/60'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files?.[0]) {
                      validateAndSetFile(e.target.files[0]);
                    }
                  }}
                  accept=".wav,.mp3,.flac,.ogg,.m4a"
                  className="hidden"
                />

                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="p-3 rounded-full bg-forest-800 text-bio-leaf border border-forest-700">
                    <Upload className="w-5 h-5" />
                  </div>
                  {selectedFile ? (
                    <div>
                      <p className="text-xs font-mono font-semibold text-white truncate max-w-xs">
                        {selectedFile.name}
                      </p>
                      <p className="text-[10px] font-mono text-bio-leaf mt-0.5">
                        {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Ready
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-xs font-medium text-gray-200">
                        Drop bioacoustic audio or click to browse
                      </p>
                      <p className="text-[10px] text-forest-400 mt-1 font-mono">
                        Up to 256 MB • Auto-converted to 32kHz Mono
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* Coordinates & Metadata */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-mono text-forest-300 uppercase mb-1">
                    Latitude
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 51.5074"
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      className="w-full bg-forest-950 border border-forest-750 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-forest-500 focus:border-bio-emerald outline-none"
                    />
                    <MapPin className="w-3.5 h-3.5 text-forest-500 absolute right-2.5 top-2" />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-mono text-forest-300 uppercase mb-1">
                    Longitude
                  </label>
                  <div className="relative">
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. -0.1278"
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      className="w-full bg-forest-950 border border-forest-750 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-forest-500 focus:border-bio-emerald outline-none"
                    />
                    <MapPin className="w-3.5 h-3.5 text-forest-500 absolute right-2.5 top-2" />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-mono text-forest-300 uppercase mb-1">
                  Recording Date & Time
                </label>
                <div className="relative">
                  <input
                    type="datetime-local"
                    value={recordedAt}
                    onChange={(e) => setRecordedAt(e.target.value)}
                    className="w-full bg-forest-950 border border-forest-750 rounded-lg px-2.5 py-1.5 text-xs font-mono text-white placeholder-forest-500 focus:border-bio-emerald outline-none"
                  />
                  <Calendar className="w-3.5 h-3.5 text-forest-500 absolute right-2.5 top-2" />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={!selectedFile || isUploading}
                className="w-full py-2.5 px-4 rounded-lg bg-bio-emerald hover:bg-bio-leaf disabled:opacity-40 text-forest-950 font-semibold text-xs font-mono flex items-center justify-center gap-2 transition-all shadow-forest-glow"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Analyzing Signal...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>Run Bioacoustic Analysis</span>
                  </>
                )}
              </button>
            </form>
          </div>

          {/* Polling / Upload Progress Card */}
          {isUploading && (
            <div className="p-5 rounded-xl bg-forest-900 border border-bio-leaf/40">
              <LoadingState
                message="Processing Audio Recording"
                stage={currentStage}
                progress={uploadProgress}
              />
            </div>
          )}
        </div>

        {/* Right Column (Workbench: Player, Spectrogram, Timeline & Detections) */}
        <div className="lg:col-span-8 space-y-6">
          {!activeAnalysis && !isUploading ? (
            <div className="p-12 rounded-xl bg-forest-900/60 border border-forest-750 text-center space-y-3">
              <Radio className="w-10 h-10 text-forest-400 mx-auto animate-pulse" />
              <h3 className="text-base font-semibold text-white">No Active Audio Session</h3>
              <p className="text-xs text-forest-300 max-w-md mx-auto">
                Upload a field recording on the left or select an existing session from the dropdown to
                inspect detections, waveforms, and spectrogram harmonics.
              </p>
            </div>
          ) : activeAnalysis ? (
            <div className="space-y-6">
              {/* Active Session Info Bar */}
              <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white text-sm">{activeAnalysis.filename}</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800/40 text-[10px]">
                      {activeAnalysis.status}
                    </span>
                  </div>
                  <p className="text-forest-400 text-[11px]">
                    UUID: {activeAnalysis.id} • {formatCoordinates(activeAnalysis.latitude, activeAnalysis.longitude)}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={analysesService.getEmbeddingsDownloadUrl(activeAnalysis.id)}
                    download
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-800 hover:bg-forest-750 text-forest-200 hover:text-white border border-forest-700 text-xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-bio-leaf" />
                    <span>Embeddings (.npy)</span>
                  </a>

                  <button
                    onClick={handleDeleteAnalysis}
                    className="p-2 rounded-lg bg-forest-800 hover:bg-rose-950 text-forest-400 hover:text-rose-400 border border-forest-700 transition-colors"
                    title="Delete recording"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Waveform Player */}
              {audioUrl && (
                <WaveformPlayer
                  audioUrl={audioUrl}
                  highlightRegion={highlightRegion}
                />
              )}

              {/* Spectrogram View */}
              <SpectrogramView
                duration={activeAnalysis.duration_seconds || 30}
                highlightRange={highlightRegion}
                sampleRate={activeAnalysis.metrics_json?.sample_rate || 32000}
              />

              {/* Temporal Detections Timeline */}
              {activeAnalysis.detections && activeAnalysis.detections.length > 0 && (
                <DetectionsTimeline
                  detections={activeAnalysis.detections}
                  durationSeconds={activeAnalysis.duration_seconds || 60}
                  selectedId={selectedDetection?.id}
                  onSelectDetection={handleSelectDetection}
                />
              )}

              {/* Detections List */}
              <div className="p-5 rounded-xl bg-forest-900 border border-forest-750 space-y-4">
                <div className="flex items-center justify-between text-xs font-mono text-forest-300">
                  <span className="font-semibold text-gray-200">
                    Neural Detections ({activeAnalysis.detections?.length || 0})
                  </span>
                  <span className="text-[11px] text-forest-400">
                    Threshold: &gt; 25% confidence
                  </span>
                </div>

                {!activeAnalysis.detections || activeAnalysis.detections.length === 0 ? (
                  <p className="text-xs font-mono text-forest-400 py-4 text-center">
                    No acoustic vocalizations exceeded threshold in this file.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
                    {activeAnalysis.detections.map((det) => (
                      <DetectionCard
                        key={det.id}
                        detection={det}
                        isSelected={det.id === selectedDetection?.id}
                        onSelect={handleSelectDetection}
                        onPlay={(s, e) => setHighlightRegion({ start: s, end: e })}
                        onReview={handleReviewDetection}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
