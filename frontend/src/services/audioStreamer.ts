/**
 * Browser Audio Acquisition and Real-Time WebSocket Streaming Client for EcoSonic 3.0.
 *
 * Implements:
 * - 32,000 Hz resampling from browser native hardware rate (44.1/48 kHz) using Web Audio API
 * - Mono downmixing
 * - Signed 16-bit little-endian PCM encoding (<i2)
 * - Binary WebSocket framing with 4-byte big-endian uint32 sequence header (>I)
 * - 250 ms chunk buffering (8,000 samples = 16,000 bytes PCM payload)
 * - Heartbeat and control message exchange (start, pause, resume, stop)
 * - RMS VU-meter calculation and live audio waveform sampling
 */

export type StreamerStatus =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'connected'
  | 'streaming'
  | 'paused'
  | 'stopped'
  | 'error';

export interface AudioStreamerConfig {
  sessionId: string;
  targetSampleRate?: number; // Default 32000
  chunkDurationMs?: number; // Default 250 ms
  wsBaseUrl?: string;
  onStatusChange?: (status: StreamerStatus, error?: string) => void;
  onAudioLevel?: (rms: number, peak: number, waveform: Float32Array) => void;
  onEvent?: (event: any) => void;
  onError?: (err: Error) => void;
}

export class AudioStreamer {
  private config: Required<AudioStreamerConfig>;
  private status: StreamerStatus = 'idle';
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private ws: WebSocket | null = null;

  private seqNum: number = 0;
  private resampleBuffer: number[] = [];
  private targetChunkSamples: number;
  private heartbeatTimer: number | null = null;
  private framesSent: number = 0;
  private bytesSent: number = 0;

  constructor(config: AudioStreamerConfig) {
    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const defaultWsHost = `${wsProto}//${window.location.host}`;

    this.config = {
      sessionId: config.sessionId,
      targetSampleRate: config.targetSampleRate || 32000,
      chunkDurationMs: config.chunkDurationMs || 250,
      wsBaseUrl: config.wsBaseUrl || defaultWsHost,
      onStatusChange: config.onStatusChange || (() => {}),
      onAudioLevel: config.onAudioLevel || (() => {}),
      onEvent: config.onEvent || (() => {}),
      onError: config.onError || (() => {}),
    };

    // Calculate samples per 250ms chunk at 32000 Hz: (32000 * 250) / 1000 = 8000 samples
    this.targetChunkSamples = Math.floor(
      (this.config.targetSampleRate * this.config.chunkDurationMs) / 1000
    );
  }

  public getStatus(): StreamerStatus {
    return this.status;
  }

  public getStats() {
    return {
      framesSent: this.framesSent,
      bytesSent: this.bytesSent,
      seqNum: this.seqNum,
      sampleRate: this.config.targetSampleRate,
    };
  }

  private setStatus(newStatus: StreamerStatus, error?: string) {
    this.status = newStatus;
    this.config.onStatusChange(newStatus, error);
  }

  /**
   * Linear interpolation resampler from source sample rate to target 32,000 Hz.
   */
  private resample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
    if (inputRate === outputRate) {
      return input;
    }
    const ratio = inputRate / outputRate;
    const outputLength = Math.round(input.length / ratio);
    const output = new Float32Array(outputLength);

    for (let i = 0; i < outputLength; i++) {
      const position = i * ratio;
      const index = Math.floor(position);
      const frac = position - index;

      if (index + 1 < input.length) {
        output[i] = input[index] * (1 - frac) + input[index + 1] * frac;
      } else {
        output[i] = input[index] || 0;
      }
    }
    return output;
  }

  /**
   * Convert normalized Float32 [-1.0, 1.0] to signed 16-bit integers.
   */
  private floatToInt16(samples: Float32Array): Int16Array {
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1.0, Math.min(1.0, samples[i]));
      pcm[i] = s < 0 ? Math.floor(s * 0x8000) : Math.floor(s * 0x7fff);
    }
    return pcm;
  }

  /**
   * Build binary frame matching backend expectation:
   * 4-byte big-endian uint32 sequence header + signed 16-bit little-endian PCM samples
   */
  private createBinaryFrame(seq: number, pcmSamples: Int16Array): ArrayBuffer {
    const buffer = new ArrayBuffer(4 + pcmSamples.length * 2);
    const view = new DataView(buffer);

    // Sequence number: 4 bytes unsigned big-endian (>I)
    view.setUint32(0, seq >>> 0, false);

    // Audio payload: signed 16-bit little-endian (<i2)
    for (let i = 0; i < pcmSamples.length; i++) {
      view.setInt16(4 + i * 2, pcmSamples[i], true);
    }

    return buffer;
  }

  /**
   * Connect to WebSocket and initialize microphone streaming.
   */
  public async start(): Promise<void> {
    if (this.status === 'streaming') return;

    try {
      this.setStatus('requesting_permission');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: { ideal: 1 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: { ideal: this.config.targetSampleRate },
        },
      });

      this.setStatus('connecting');
      await this.connectWebSocket();

      // Setup Web Audio processing graph
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Buffer size: 4096 samples provides low latency and stable callbacks
      this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);

      const inputRate = this.audioContext.sampleRate;
      const targetRate = this.config.targetSampleRate;

      this.processorNode.onaudioprocess = (e) => {
        if (this.status !== 'streaming') return;

        const inputData = e.inputBuffer.getChannelData(0);

        // Compute real-time RMS audio level and peak for VU meter
        let sum = 0;
        let peak = 0;
        for (let i = 0; i < inputData.length; i++) {
          const val = inputData[i];
          sum += val * val;
          const abs = Math.abs(val);
          if (abs > peak) peak = abs;
        }
        const rms = Math.sqrt(sum / inputData.length);
        this.config.onAudioLevel(rms, peak, inputData.slice(0, 128));

        // Resample input to target 32,000 Hz
        const resampled = this.resample(inputData, inputRate, targetRate);

        // Accumulate into resample buffer
        for (let i = 0; i < resampled.length; i++) {
          this.resampleBuffer.push(resampled[i]);
        }

        // When we have accumulated targetChunkSamples (e.g. 8000 = 250ms), dispatch frame
        while (this.resampleBuffer.length >= this.targetChunkSamples) {
          const chunkFloat = new Float32Array(this.resampleBuffer.splice(0, this.targetChunkSamples));
          const pcmChunk = this.floatToInt16(chunkFloat);
          this.sendPcmChunk(pcmChunk);
        }
      };

      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.setStatus('streaming');
      this.startHeartbeat();
    } catch (err: any) {
      this.cleanup();
      this.setStatus('error', err.message || 'Failed to start microphone or WebSocket.');
      this.config.onError(err);
      throw err;
    }
  }

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.config.wsBaseUrl}/api/v1/live/sessions/${this.config.sessionId}/stream`;
      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        // Send initial handshake
        this.ws?.send(JSON.stringify({ type: 'handshake' }));
        resolve();
      };

      this.ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data);
            this.handleServerMessage(data);
          } catch (e) {
            console.error('Failed to parse WebSocket JSON message:', e);
          }
        }
      };

      this.ws.onerror = (e) => {
        console.error('WebSocket error:', e);
        if (this.status === 'connecting') {
          reject(new Error('WebSocket connection failed'));
        }
      };

      this.ws.onclose = () => {
        if (this.status === 'streaming' || this.status === 'paused') {
          this.setStatus('stopped', 'WebSocket disconnected by server');
        }
      };
    });
  }

  private handleServerMessage(msg: any) {
    if (msg.type === 'handshake_ack') {
      // Send start command
      this.ws?.send(JSON.stringify({ type: 'start' }));
    } else if (msg.type === 'session_stopped') {
      this.setStatus('stopped');
    }
    this.config.onEvent(msg);
  }

  private sendPcmChunk(pcmSamples: Int16Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const frame = this.createBinaryFrame(this.seqNum, pcmSamples);
    this.ws.send(frame);

    this.seqNum = (this.seqNum + 1) >>> 0;
    this.framesSent++;
    this.bytesSent += frame.byteLength;
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() / 1000 }));
      }
    }, 15000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public pause() {
    if (this.status !== 'streaming') return;
    this.setStatus('paused');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'pause' }));
    }
  }

  public resume() {
    if (this.status !== 'paused') return;
    this.setStatus('streaming');
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'resume' }));
    }
  }

  public async stop(): Promise<void> {
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'stop' }));
      }
    } catch (e) {
      console.warn('Error sending stop control message:', e);
    } finally {
      this.cleanup();
      this.setStatus('stopped');
    }
  }

  private cleanup() {
    this.stopHeartbeat();

    if (this.processorNode) {
      try {
        this.processorNode.disconnect();
      } catch {}
      this.processorNode = null;
    }

    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {}
      this.sourceNode = null;
    }

    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch {}
      this.audioContext = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.ws) {
      try {
        if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
          this.ws.close();
        }
      } catch {}
      this.ws = null;
    }

    this.resampleBuffer = [];
  }
}
