import React, { useEffect, useRef, useState } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { formatSeconds } from '../../utils/formatters';

interface WaveformPlayerProps {
  audioUrl: string;
  onTimeUpdate?: (currentTime: number) => void;
  highlightRegion?: { start: number; end: number };
  autoPlay?: boolean;
  className?: string;
}

export const WaveformPlayer: React.FC<WaveformPlayerProps> = ({
  audioUrl,
  onTimeUpdate,
  highlightRegion,
  autoPlay = false,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    setIsLoaded(false);
    setError(null);

    // Initialize WaveSurfer
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: '#2e463c', // Muted forest green
      progressColor: '#10b981', // Emerald active
      cursorColor: '#34d399',
      cursorWidth: 2,
      barWidth: 2,
      barGap: 1.5,
      barRadius: 2,
      height: 72,
      normalize: true,
      backend: 'WebAudio',
    });

    wavesurferRef.current = ws;

    ws.load(audioUrl);

    ws.on('ready', () => {
      setIsLoaded(true);
      setDuration(ws.getDuration());
      if (autoPlay) {
        ws.play();
        setIsPlaying(true);
      }
    });

    ws.on('audioprocess', () => {
      const time = ws.getCurrentTime();
      setCurrentTime(time);
      if (onTimeUpdate) onTimeUpdate(time);
    });

    ws.on('seeking', () => {
      const time = ws.getCurrentTime();
      setCurrentTime(time);
      if (onTimeUpdate) onTimeUpdate(time);
    });

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    ws.on('error', (err) => {
      console.error('WaveSurfer error:', err);
      setError('Failed to decode audio waveform');
      setIsLoaded(false);
    });

    return () => {
      try {
        ws.destroy();
      } catch {
        // Safe destroy
      }
    };
  }, [audioUrl]);

  // Jump to highlight region if specified
  useEffect(() => {
    if (highlightRegion && wavesurferRef.current && isLoaded) {
      wavesurferRef.current.setTime(highlightRegion.start);
      wavesurferRef.current.play();
    }
  }, [highlightRegion, isLoaded]);

  const togglePlay = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.playPause();
  };

  const handleReset = () => {
    if (!wavesurferRef.current) return;
    wavesurferRef.current.stop();
    setCurrentTime(0);
    setIsPlaying(false);
  };

  const toggleMute = () => {
    if (!wavesurferRef.current) return;
    const next = !isMuted;
    wavesurferRef.current.setMuted(next);
    setIsMuted(next);
  };

  return (
    <div className={`p-4 rounded-xl bg-forest-900 border border-forest-750 space-y-3 ${className}`}>
      {/* Waveform Canvas */}
      <div className="relative">
        <div ref={containerRef} className="w-full" />

        {!isLoaded && !error && (
          <div className="absolute inset-0 flex items-center justify-center bg-forest-900/60 backdrop-blur-xs">
            <span className="text-xs font-mono text-forest-300 animate-pulse">
              Buffering acoustic signal...
            </span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-forest-900/80 text-xs font-mono text-rose-400">
            {error}
          </div>
        )}
      </div>

      {/* Playback Controls & Time Display */}
      <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-forest-800">
        <div className="flex items-center gap-2">
          <button
            onClick={togglePlay}
            disabled={!isLoaded}
            className="w-8 h-8 rounded-lg bg-bio-emerald hover:bg-bio-leaf disabled:opacity-40 text-forest-950 font-bold flex items-center justify-center transition-colors shadow-forest-glow"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            onClick={handleReset}
            disabled={!isLoaded}
            className="w-8 h-8 rounded-lg bg-forest-800 hover:bg-forest-750 disabled:opacity-40 text-forest-300 hover:text-white flex items-center justify-center transition-colors"
            title="Reset playback"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={toggleMute}
            disabled={!isLoaded}
            className="w-8 h-8 rounded-lg bg-forest-800 hover:bg-forest-750 disabled:opacity-40 text-forest-300 hover:text-white flex items-center justify-center transition-colors"
            title={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5 text-rose-400" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Time code */}
        <div className="flex items-center gap-1.5 text-forest-300">
          <span className="text-white font-semibold">{formatSeconds(currentTime)}</span>
          <span>/</span>
          <span>{formatSeconds(duration)}</span>
        </div>
      </div>
    </div>
  );
};
