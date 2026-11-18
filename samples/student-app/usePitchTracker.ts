import { useCallback, useEffect, useRef, useState } from 'react';

const noteNames = [
  'До',
  'До#',
  'Ре',
  'Ре#',
  'Ми',
  'Фа',
  'Фа#',
  'Соль',
  'Соль#',
  'Ля',
  'Ля#',
  'Си',
] as const;
const latinNoteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
const minPitch = 31;
const maxPitch = 1100;
const pitchUpdateIntervalMs = 120;
const maxMissedReadings = 3;
const octaveJumpRatio = 1.72;
const yinThreshold = 0.16;
const fallbackConfidence = 0.68;
const embeddedBrowserMicrophoneHint =
  'Во встроенном браузере Codex микрофон может быть недоступен. Откройте PWA в Chrome или Safari.';

export type PitchReading = {
  frequency: number;
  note: string;
  latinNote: string;
  midi: number;
  cents: number;
  clarity: number;
  volume: number;
};

export type TargetNote = {
  frequency: number;
  label: string;
  latinLabel: string;
  midi: number;
};

type AudioContextWithWebkit = typeof window & {
  webkitAudioContext?: typeof AudioContext;
};

type DetectedFrequency = {
  frequency: number;
  clarity: number;
  volume: number;
};

const latinSemitones: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
  H: 11,
};

const russianSemitones: Record<string, number> = {
  до: 0,
  ре: 2,
  ми: 4,
  фа: 5,
  соль: 7,
  сол: 7,
  ля: 9,
  си: 11,
};

export function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function formatMidiNote(midi: number) {
  const roundedMidi = Math.round(midi);
  const semitone = ((roundedMidi % 12) + 12) % 12;
  const octave = Math.floor(roundedMidi / 12) - 1;
  return {
    label: `${noteNames[semitone]}${octave}`,
    latinLabel: `${latinNoteNames[semitone]}${octave}`,
  };
}

export function frequencyToPitch(frequency: number, clarity: number, volume: number): PitchReading {
  const midiFloat = 69 + 12 * Math.log2(frequency / 440);
  const midi = Math.round(midiFloat);
  const note = formatMidiNote(midi);

  return {
    frequency,
    note: note.label,
    latinNote: note.latinLabel,
    midi,
    cents: Math.round((midiFloat - midi) * 100),
    clarity,
    volume,
  };
}

export function parseTargetNote(text: string): TargetNote | null {
  const notePattern = String.raw`(?:[A-Ha-h]\s*[#♯b♭]?\s*-?\d|(?:до|ре|ми|фа|соль|сол|ля|си)\s*[#♯b♭]?\s*-?\d)`;
  const rangePattern = new RegExp(
    String.raw`(?:^|[\s,.;:!?()[\]"'«»])(?:от|с)?\s*${notePattern}\s*(?:до|[-–—])\s*${notePattern}(?=$|[\s,.;:!?()[\]"'«»])`,
    'iu',
  );

  if (rangePattern.test(text)) {
    return null;
  }

  const latinMatch = text.match(
    /(?:^|[\s,.;:!?()[\]"'«»])([A-Ha-h])\s*([#♯b♭]?)\s*(-?\d)(?=$|[\s,.;:!?()[\]"'«»])/u,
  );
  if (latinMatch) {
    return makeTargetNote(
      latinSemitones[latinMatch[1].toUpperCase()],
      latinMatch[2],
      Number(latinMatch[3]),
    );
  }

  const russianMatch = text
    .toLowerCase()
    .match(
      /(?:^|[\s,.;:!?()[\]"'«»])(до|ре|ми|фа|соль|сол|ля|си)\s*([#♯b♭]?)\s*(-?\d)(?=$|[\s,.;:!?()[\]"'«»])/u,
    );
  if (russianMatch) {
    return makeTargetNote(
      russianSemitones[russianMatch[1]],
      russianMatch[2],
      Number(russianMatch[3]),
    );
  }

  return null;
}

export function centsFromTarget(frequency: number, targetFrequency: number) {
  return Math.round(1200 * Math.log2(frequency / targetFrequency));
}

function microphoneErrorMessage(error: unknown) {
  if (!window.isSecureContext) {
    return 'Микрофон работает только на HTTPS или localhost.';
  }

  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return `Разрешение на микрофон не получено. ${embeddedBrowserMicrophoneHint}`;
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return 'Микрофон не найден. Проверьте устройство ввода в системе.';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return 'Микрофон занят другим приложением или недоступен системе.';
    }
  }

  return `Микрофон недоступен. ${embeddedBrowserMicrophoneHint}`;
}

function makeTargetNote(
  semitone: number | undefined,
  accidental: string,
  octave: number,
): TargetNote | null {
  if (semitone === undefined || !Number.isFinite(octave)) {
    return null;
  }

  const accidentalShift =
    accidental === '#' || accidental === '♯'
      ? 1
      : accidental === 'b' || accidental === '♭'
        ? -1
        : 0;
  const midi = (octave + 1) * 12 + semitone + accidentalShift;

  if (midi < 0 || midi > 127) {
    return null;
  }

  return {
    frequency: midiToFrequency(midi),
    midi,
    ...formatMidiNote(midi),
  };
}

function refineLag(lag: number, normalizedDifference: Float32Array) {
  if (lag <= 1 || lag >= normalizedDifference.length - 1) {
    return lag;
  }

  const previous = normalizedDifference[lag - 1];
  const current = normalizedDifference[lag];
  const next = normalizedDifference[lag + 1];
  const denominator = previous - 2 * current + next;

  if (!Number.isFinite(denominator) || Math.abs(denominator) < 0.000001) {
    return lag;
  }

  const adjustment = (previous - next) / (2 * denominator);
  return Math.abs(adjustment) <= 1 ? lag + adjustment : lag;
}

function alignWithPreviousOctave(frequency: number, previousFrequency: number | null) {
  if (!previousFrequency) {
    return frequency;
  }

  let correctedFrequency = frequency;

  // The detector can briefly lock to a harmonic; keep sudden octave flips near the previous pitch.
  while (
    correctedFrequency / previousFrequency > octaveJumpRatio &&
    correctedFrequency / 2 >= minPitch
  ) {
    correctedFrequency /= 2;
  }

  while (
    previousFrequency / correctedFrequency > octaveJumpRatio &&
    correctedFrequency * 2 <= maxPitch
  ) {
    correctedFrequency *= 2;
  }

  return correctedFrequency;
}

function smoothFrequency(frequency: number, previousFrequency: number | null) {
  if (!previousFrequency) {
    return frequency;
  }

  const semitoneDistance = Math.abs(12 * Math.log2(frequency / previousFrequency));

  if (semitoneDistance <= 1.5) {
    return previousFrequency * 0.62 + frequency * 0.38;
  }

  if (semitoneDistance <= 4) {
    return previousFrequency * 0.35 + frequency * 0.65;
  }

  return frequency;
}

function stabilizeFrequency(frequency: number, previousFrequency: number | null) {
  return smoothFrequency(alignWithPreviousOctave(frequency, previousFrequency), previousFrequency);
}

function detectFrequency(buffer: Float32Array, sampleRate: number): DetectedFrequency | null {
  let volumeTotal = 0;

  for (const sample of buffer) {
    volumeTotal += sample * sample;
  }

  const volume = Math.sqrt(volumeTotal / buffer.length);
  if (volume < 0.012) {
    return null;
  }

  const minLag = Math.max(2, Math.floor(sampleRate / maxPitch));
  const maxLag = Math.min(buffer.length - 2, Math.ceil(sampleRate / minPitch));
  const difference = new Float32Array(maxLag + 1);
  const normalizedDifference = new Float32Array(maxLag + 1);

  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    const sampleCount = buffer.length - lag;

    for (let index = 0; index < sampleCount; index += 1) {
      const delta = buffer[index] - buffer[index + lag];
      sum += delta * delta;
    }

    difference[lag] = sum;
  }

  let runningDifference = 0;
  let bestLag = -1;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (let lag = 1; lag <= maxLag; lag += 1) {
    runningDifference += difference[lag];
    normalizedDifference[lag] =
      runningDifference > 0 ? (difference[lag] * lag) / runningDifference : 1;

    if (lag < minLag) {
      continue;
    }

    if (normalizedDifference[lag] < bestDifference) {
      bestDifference = normalizedDifference[lag];
      bestLag = lag;
    }
  }

  let selectedLag = -1;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    if (normalizedDifference[lag] >= yinThreshold) {
      continue;
    }

    selectedLag = lag;

    while (
      selectedLag + 1 <= maxLag &&
      normalizedDifference[selectedLag + 1] < normalizedDifference[selectedLag]
    ) {
      selectedLag += 1;
    }

    break;
  }

  if (selectedLag < 0) {
    selectedLag = bestLag;
  }

  const confidence = selectedLag > 0 ? 1 - normalizedDifference[selectedLag] : 0;

  if (selectedLag < 0 || confidence < fallbackConfidence) {
    return null;
  }

  const refinedLag = refineLag(selectedLag, normalizedDifference);

  return {
    frequency: sampleRate / refinedLag,
    clarity: confidence,
    volume,
  };
}

export function usePitchTracker() {
  const [isListening, setIsListening] = useState(false);
  const [hasSignal, setHasSignal] = useState(false);
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [error, setError] = useState('');
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const frameRef = useRef(0);
  const lastUpdateRef = useRef(0);
  const missedReadingsRef = useRef(0);
  const previousFrequencyRef = useRef<number | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }

    sourceRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const audioContext = audioContextRef.current;
    audioContextRef.current = null;
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(() => undefined);
    }

    setIsListening(false);
    setHasSignal(false);
    setReading(null);
    missedReadingsRef.current = 0;
    previousFrequencyRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (isListening) {
      return true;
    }

    const AudioContextConstructor =
      window.AudioContext ?? (window as AudioContextWithWebkit).webkitAudioContext;

    if (!navigator.mediaDevices?.getUserMedia || !AudioContextConstructor) {
      setError('Браузер не поддерживает тюнер.');
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
      const audioContext = new AudioContextConstructor();
      await audioContext.resume();

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const buffer = new Float32Array(analyser.fftSize);

      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      sourceRef.current = source;
      lastUpdateRef.current = 0;
      missedReadingsRef.current = 0;
      previousFrequencyRef.current = null;
      setError('');
      setIsListening(true);

      const readFrame = (time: number) => {
        if (time - lastUpdateRef.current >= pitchUpdateIntervalMs) {
          analyser.getFloatTimeDomainData(buffer);
          const detected = detectFrequency(buffer, audioContext.sampleRate);
          setHasSignal(Boolean(detected));

          if (detected) {
            const stableFrequency = stabilizeFrequency(
              detected.frequency,
              previousFrequencyRef.current,
            );
            const nextReading = frequencyToPitch(
              stableFrequency,
              detected.clarity,
              detected.volume,
            );
            previousFrequencyRef.current = stableFrequency;
            missedReadingsRef.current = 0;
            setReading(nextReading);
          } else {
            missedReadingsRef.current += 1;

            if (missedReadingsRef.current >= maxMissedReadings) {
              previousFrequencyRef.current = null;
              setReading(null);
            }
          }

          lastUpdateRef.current = time;
        }

        frameRef.current = window.requestAnimationFrame(readFrame);
      };

      frameRef.current = window.requestAnimationFrame(readFrame);
      return true;
    } catch (error) {
      stop();
      setError(microphoneErrorMessage(error));
      return false;
    }
  }, [isListening, stop]);

  const toggle = useCallback(async () => {
    if (isListening) {
      stop();
      return true;
    }

    return start();
  }, [isListening, start, stop]);

  useEffect(() => stop, [stop]);

  return {
    error,
    hasSignal,
    isListening,
    reading,
    start,
    stop,
    toggle,
  };
}
