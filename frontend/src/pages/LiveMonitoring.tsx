import React, { useEffect, useRef, useState } from 'react';
import {
  Radio,
  Play,
  Square,
  Pause,
  AlertTriangle,
  Activity,
  ShieldAlert,
  BarChart2,
  Clock,
  Layers,
  CheckCircle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useSiteContext } from '../context/SiteContext';
import { liveService } from '../services/liveService';
import { AudioStreamer, StreamerStatus } from '../services/audioStreamer';
import { LiveSession, LiveEvent, DisturbanceEvent, SoundscapeFingerprint } from '../types';
import { formatSeconds, formatConfidence } from '../utils/formatters';

export const LiveMonitoring: React.FC = () => {
  const { sites, selectedSite } = useSiteContext();

  const [session, setSession] = useState<LiveSession | null>(null);
  const [streamerStatus, setStreamerStatus] = useState<StreamerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Live telemetry metrics
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [audioPeak, setAudioPeak] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [processedSeconds, setProcessedSeconds] = useState<number>(0);
  const [framesSent, setFramesSent] = useState<number>(0);
  const [inferenceDurationMs, setInferenceDurationMs] = useState<number>(0);
  const [windowLagMs, setWindowLagMs] = useState<number>(0);
  const [queueLag, setQueueLag] = useState<number>(0);
  const [qualityWarning, setQualityWarning] = useState<string | null>(null);

  // Live incoming event streams
  const [detections, setDetections] = useState<LiveEvent[]>([]);
  const [disturbances, setDisturbances] = useState<DisturbanceEvent[]>([]);
  const [latestSoundscape, setLatestSoundscape] = useState<SoundscapeFingerprint | null>(null);

  const streamerRef = useRef<AudioStreamer | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformBufferRef = useRef<Float32Array>(new Float32Array(128));
  const timerRef = useRef<number | null>(null);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamerRef.current) {
        streamerRef.current.stop();
      }
    };
  }, []);

  // Continuous waveform oscilloscope drawing
  useEffect(() => {
    let animId: number;
    const renderWaveform = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const width = canvas.width;
          const height = canvas.height;
          ctx.fillStyle = '#0a0f0d';
          ctx.fillRect(0, 0, width, height);

          // Center baseline
          ctx.strokeStyle = '#1b2822';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, height / 2);
          ctx.lineTo(width, height / 2);
          ctx.stroke();

          // Live audio wave
          const buffer = waveformBufferRef.current;
          ctx.strokeStyle = streamerStatus === 'streaming' ? '#34d399' : '#4f7b6a';
          ctx.lineWidth = 2;
          ctx.beginPath();

          const sliceWidth = width / buffer.length;
          let x = 0;

          for (let i = 0; i < buffer.length; i++) {
            const v = buffer[i]; // range approx -1.0 to 1.0
            const y = (height / 2) + (v * (height / 2) * 0.9);

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth;
          }
          ctx.stroke();
        }
      }
      animId = requestAnimationFrame(renderWaveform);
    };

    renderWaveform();
    return () => cancelAnimationFrame(animId);
  }, [streamerStatus]);

  const handleStartMonitoring = async () => {
    setErrorMessage(null);
    setQualityWarning(null);
    setDetections([]);
    setDisturbances([]);
    setLatestSoundscape(null);
    setElapsedSeconds(0);
    setProcessedSeconds(0);

    try {
      // 1. Create a live session on the backend
      const newSession = await liveService.createSession({
        site_id: selectedSite?.id,
        source_type: 'browser_microphone',
        sample_rate: 32000,
        channels: 1,
      });
      setSession(newSession);

      // 2. Initialize the AudioStreamer
      const streamer = new AudioStreamer({
        sessionId: newSession.id,
        targetSampleRate: 32000,
        chunkDurationMs: 250,
        onStatusChange: (status, err) => {
          setStreamerStatus(status);
          if (err) setErrorMessage(err);
        },
        onAudioLevel: (rms, peak, waveform) => {
          setAudioLevel(rms);
          setAudioPeak(peak);
          waveformBufferRef.current = waveform;
          if (streamerRef.current) {
            setFramesSent(streamerRef.current.getStats().framesSent);
          }
        },
        onEvent: (event) => {
          handleIncomingEvent(event);
        },
        onError: (err) => {
          setErrorMessage(err.message || 'Audio streaming error.');
        },
      });

      streamerRef.current = streamer;
      await streamer.start();

      // Start elapsed timer
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      console.error('Failed to initiate live monitoring:', err);
      setErrorMessage(err.message || 'Microphone access denied or backend session creation failed.');
    }
  };

  const handleIncomingEvent = (ev: any) => {
    if (!ev || !ev.type) return;

    if (ev.type === 'detection') {
      const newDet: LiveEvent = {
        id: ev.event_id || Math.random().toString(),
        session_id: ev.session_id,
        start_seconds: ev.start_seconds,
        end_seconds: ev.end_seconds,
        class_label: ev.class_label,
        scientific_name: ev.scientific_name,
        common_name: ev.common_name,
        confidence_score: ev.confidence_score,
        taxon_group: ev.taxon_group,
        model_version: ev.model_version,
      };
      setDetections((prev) => [newDet, ...prev.slice(0, 49)]); // keep latest 50
    } else if (ev.type === 'disturbance_event') {
      const newDist: DisturbanceEvent = {
        event_id: ev.event_id || Math.random().toString(),
        session_id: ev.session_id,
        event_type: ev.event_type || 'disturbance',
        class_label: ev.class_label,
        category: ev.category,
        hazard_classification: ev.hazard_classification,
        start_seconds: ev.start_seconds,
        end_seconds: ev.end_seconds,
        confidence_score: ev.confidence_score,
        review_status: ev.review_status,
      };
      setDisturbances((prev) => [newDist, ...prev.slice(0, 29)]);
    } else if (ev.type === 'soundscape_measurement') {
      setLatestSoundscape({
        session_id: ev.session_id,
        measurement_id: ev.measurement_id,
        start_seconds: ev.start_seconds,
        end_seconds: ev.end_seconds,
        metrics: ev.metrics || {},
        frequency_bands: ev.frequency_bands || {},
        quality_flags: ev.quality_flags || [],
      });
    } else if (ev.type === 'processing_update') {
      if (typeof ev.processed_seconds === 'number') {
        setProcessedSeconds(ev.processed_seconds);
      }
      if (typeof ev.inference_duration_ms === 'number') {
        setInferenceDurationMs(ev.inference_duration_ms);
      }
      if (typeof ev.window_lag_ms === 'number') {
        setWindowLagMs(ev.window_lag_ms);
      }
      if (typeof ev.queue_size === 'number') {
        setQueueLag(ev.queue_size);
      }
    } else if (ev.type === 'audio_quality_warning') {
      setQualityWarning(ev.reason || 'Audio quality warning received');
    }
  };

  const handlePauseResume = () => {
    if (!streamerRef.current) return;
    if (streamerStatus === 'streaming') {
      streamerRef.current.pause();
    } else if (streamerStatus === 'paused') {
      streamerRef.current.resume();
    }
  };

  const handleStopMonitoring = async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamerRef.current) {
      await streamerRef.current.stop();
      streamerRef.current = null;
    }

    if (session) {
      try {
        const stopped = await liveService.stopSession(session.id);
        setSession(stopped);
      } catch (err) {
        console.warn('Failed to register session stop with backend:', err);
      }
    }
  };

  return (
    <div className="space-y-5 max-w-7xl mx-auto pb-8">
      {/* Header & Controls Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-forest-750">
        <div>
          <div className="flex items-center gap-2">
            <Radio
              className={`w-5 h-5 ${
                streamerStatus === 'streaming'
                  ? 'text-bio-leaf animate-pulse'
                  : streamerStatus === 'paused'
                  ? 'text-amber-400'
                  : 'text-forest-400'
              }`}
            />
            <h1 className="text-xl font-bold tracking-tight text-white">
              Real-Time Live Acoustic Monitoring
            </h1>
          </div>
          <p className="mt-1 text-xs text-forest-300 font-mono">
            32 kHz PCM16 Continuous Audio Ingestion & Live Inference Pipeline
          </p>
        </div>

        {/* Streaming Controls */}
        <div className="flex items-center gap-2.5">
          {streamerStatus === 'idle' || streamerStatus === 'stopped' || streamerStatus === 'error' ? (
            <button
              onClick={handleStartMonitoring}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-bio-emerald hover:bg-bio-leaf text-forest-950 font-bold text-xs font-mono transition-all shadow-forest-glow"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Start Live Stream</span>
            </button>
          ) : (
            <>
              <button
                onClick={handlePauseResume}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-forest-850 hover:bg-forest-800 text-xs font-mono text-gray-200 border border-forest-750 transition-colors"
              >
                {streamerStatus === 'paused' ? (
                  <>
                    <Play className="w-3.5 h-3.5 text-bio-leaf fill-current" />
                    <span>Resume</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5 text-amber-400 fill-current" />
                    <span>Pause</span>
                  </>
                )}
              </button>

              <button
                onClick={handleStopMonitoring}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono transition-colors shadow-lg"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Stop Stream</span>
              </button>
            </>
          )}
        </div>
      </div>

      {errorMessage && (
        <div className="p-3.5 rounded-lg bg-rose-950/80 border border-rose-800 text-xs text-rose-300 font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-[10px] text-rose-400 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {qualityWarning && (
        <div className="p-3 rounded-lg bg-amber-950/80 border border-amber-800/80 text-xs text-amber-300 font-mono flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>Signal Advisory: {qualityWarning}</span>
          </div>
          <button
            onClick={() => setQualityWarning(null)}
            className="text-[10px] text-amber-400 underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Real-time Oscilloscope & VU Meter */}
      <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2 text-forest-300">
            <Volume2 className="w-4 h-4 text-bio-emerald" />
            <span>Audio Ingestion Oscilloscope (32,000 Hz)</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-forest-400 uppercase">
              STATUS: <strong className="text-white">{streamerStatus.toUpperCase()}</strong>
            </span>
            <span className="text-[10px] text-forest-400 uppercase">
              RMS: <strong className="text-bio-leaf">{(audioLevel * 100).toFixed(1)}%</strong>
            </span>
          </div>
        </div>

        <div className="relative h-24 rounded-lg overflow-hidden border border-forest-800 bg-forest-950">
          <canvas
            ref={canvasRef}
            width={800}
            height={96}
            className="w-full h-full block"
          />
        </div>

        {/* VU Meter Bar */}
        <div className="space-y-1">
          <div className="h-2 w-full bg-forest-950 rounded-full overflow-hidden border border-forest-800 flex">
            <div
              className={`h-full transition-all duration-75 ${
                audioPeak > 0.95
                  ? 'bg-rose-500'
                  : audioPeak > 0.75
                  ? 'bg-amber-400'
                  : 'bg-bio-emerald'
              }`}
              style={{ width: `${Math.min(100, audioLevel * 250)}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-forest-500">
            <span>-60 dB</span>
            <span>-24 dB</span>
            <span>-12 dB</span>
            <span>-6 dB</span>
            <span>0 dB (CLIP)</span>
          </div>
        </div>
      </div>

      {/* Stream Hardware & Pipeline Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 rounded-lg bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">STREAM TIME</div>
          <div className="text-lg font-bold text-white mt-0.5">
            {formatSeconds(elapsedSeconds)}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">PROCESSED AUDIO</div>
          <div className="text-lg font-bold text-bio-leaf mt-0.5">
            {formatSeconds(processedSeconds)}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">FRAMES SENT</div>
          <div className="text-lg font-bold text-gray-200 mt-0.5">
            {framesSent.toLocaleString()}
          </div>
        </div>

        <div className="p-3 rounded-lg bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">INFERENCE LATENCY</div>
          <div className="text-lg font-bold text-cyan-400 mt-0.5">
            {inferenceDurationMs.toFixed(1)} ms
          </div>
        </div>

        <div className="p-3 rounded-lg bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">WINDOW LAG</div>
          <div
            className={`text-lg font-bold mt-0.5 ${
              windowLagMs > 500 ? 'text-amber-400' : 'text-gray-200'
            }`}
          >
            {windowLagMs.toFixed(1)} ms
          </div>
        </div>

        <div className="p-3 rounded-lg bg-forest-900 border border-forest-750 font-mono text-xs">
          <div className="text-forest-400 text-[10px]">QUEUE SIZE</div>
          <div
            className={`text-lg font-bold mt-0.5 ${
              queueLag > 2 ? 'text-rose-400' : 'text-gray-200'
            }`}
          >
            {queueLag}
          </div>
        </div>
      </div>

      {/* Main Dual Feed: Biological Detections & Disturbance Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left: Biological Detection Feed (7 cols) */}
        <div className="lg:col-span-7 p-4 rounded-xl bg-forest-900 border border-forest-750 flex flex-col space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-forest-800">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-bio-emerald" />
              <h2 className="text-sm font-bold text-white font-mono">
                Live Biological Detections ({detections.length})
              </h2>
            </div>
            <span className="text-[10px] font-mono text-forest-400">
              BirdNET+ V3.0 ONNX Rolling 3.0s
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px] space-y-2 pr-1">
            {detections.length > 0 ? (
              detections.map((det) => (
                <div
                  key={det.id}
                  className="p-3 rounded-lg bg-forest-950/70 border border-forest-800 flex items-center justify-between hover:border-bio-emerald/40 transition-colors"
                >
                  <div className="min-w-0 pr-3">
                    <div className="text-sm font-semibold text-white truncate">
                      {det.common_name || det.class_label}
                    </div>
                    <div className="text-xs text-forest-400 font-mono italic truncate">
                      {det.scientific_name}
                    </div>
                    <div className="text-[10px] text-forest-500 font-mono mt-1">
                      Time: {det.start_seconds.toFixed(1)}s - {det.end_seconds.toFixed(1)}s •{' '}
                      {det.taxon_group || 'Bird'}
                    </div>
                  </div>

                  <div className="text-right shrink-0 font-mono">
                    <div className="text-sm font-bold text-bio-leaf">
                      {formatConfidence(det.confidence_score)}
                    </div>
                    <span className="text-[10px] text-forest-400">Confidence</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-16 text-center text-xs font-mono text-forest-400 space-y-1">
                <VolumeX className="w-6 h-6 mx-auto text-forest-600 mb-2" />
                <p>
                  {streamerStatus === 'streaming'
                    ? 'Listening for biological vocalizations in live stream...'
                    : 'Stream offline. Click Start Live Stream to begin monitoring.'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: Disturbance Events & Soundscape (5 cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Disturbance Radar Feed */}
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-forest-800">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-bold text-white font-mono">
                  Disturbance Radar ({disturbances.length})
                </h2>
              </div>
              <span className="text-[10px] font-mono text-amber-400 uppercase">Anthrophony</span>
            </div>

            <div className="overflow-y-auto max-h-[220px] space-y-2 pr-1">
              {disturbances.length > 0 ? (
                disturbances.map((dist, idx) => (
                  <div
                    key={idx}
                    className="p-2.5 rounded-lg bg-forest-950/70 border border-forest-800 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-semibold text-gray-200 capitalize">
                        {dist.class_label.replace(/_/g, ' ')}
                      </div>
                      <div className="text-[10px] font-mono text-forest-400">
                        {dist.start_seconds.toFixed(1)}s - {dist.end_seconds.toFixed(1)}s
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                          dist.hazard_classification === 'critical'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {dist.hazard_classification || 'Alert'}
                      </span>
                      <div className="text-[10px] text-forest-300 mt-0.5">
                        {formatConfidence(dist.confidence_score)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="py-8 text-center text-xs font-mono text-forest-400">
                  No anthrophony or acoustic disturbances detected.
                </div>
              )}
            </div>
          </div>

          {/* Real-time Soundscape Fingerprint Card */}
          <div className="p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-forest-800">
              <div className="flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white font-mono">Soundscape Fingerprint</h2>
              </div>
              <span className="text-[10px] font-mono text-forest-400">10.0s Window</span>
            </div>

            {latestSoundscape ? (
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded bg-forest-950 border border-forest-800">
                  <span className="text-[10px] text-forest-400 block">ACI (Complexity)</span>
                  <span className="text-sm font-bold text-white">
                    {latestSoundscape.metrics.aci?.toFixed(2) ?? 'N/A'}
                  </span>
                </div>
                <div className="p-2 rounded bg-forest-950 border border-forest-800">
                  <span className="text-[10px] text-forest-400 block">NDSI (Soundscape)</span>
                  <span className="text-sm font-bold text-bio-leaf">
                    {latestSoundscape.metrics.ndsi?.toFixed(3) ?? 'N/A'}
                  </span>
                </div>
                <div className="p-2 rounded bg-forest-950 border border-forest-800">
                  <span className="text-[10px] text-forest-400 block">ADI (Diversity)</span>
                  <span className="text-sm font-bold text-white">
                    {latestSoundscape.metrics.adi?.toFixed(2) ?? 'N/A'}
                  </span>
                </div>
                <div className="p-2 rounded bg-forest-950 border border-forest-800">
                  <span className="text-[10px] text-forest-400 block">AEI (Evenness)</span>
                  <span className="text-sm font-bold text-white">
                    {latestSoundscape.metrics.aei?.toFixed(2) ?? 'N/A'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-xs font-mono text-forest-400">
                Accumulating 10s audio window for ecoacoustic fingerprint...
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
