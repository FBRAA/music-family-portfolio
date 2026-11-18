import { useEffect, useRef } from 'react';

export const YOUTUBE_PLAYER_STATE = {
  unstarted: -1,
  ended: 0,
  playing: 1,
  paused: 2,
  buffering: 3,
  cued: 5,
} as const;

interface YouTubePlayer {
  cueVideoById(videoId: string): void;
  destroy(): void;
}

interface YouTubePlayerEvent {
  data: number;
  target: YouTubePlayer;
}

interface YouTubePlayerErrorEvent {
  data: number;
}

interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: (event: YouTubePlayerEvent) => void;
        onStateChange: (event: YouTubePlayerEvent) => void;
        onError: (event: YouTubePlayerErrorEvent) => void;
        onAutoplayBlocked: () => void;
      };
    },
  ) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previousReady = window.onYouTubeIframeAPIReady;
    const timeout = window.setTimeout(() => {
      reject(new Error('YouTube долго не отвечает'));
    }, 15_000);

    window.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      window.clearTimeout(timeout);
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error('YouTube Player API не загрузился'));
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (existing) return;

    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error('Не удалось подключиться к YouTube'));
    };
    document.head.append(script);
  }).catch((error) => {
    youtubeApiPromise = null;
    throw error;
  });

  return youtubeApiPromise;
}

export function extractYouTubeVideoId(value: string): string | null {
  const clean = value.trim();
  if (/^[A-Za-z0-9_-]{11}$/u.test(clean)) return clean;

  let url: URL;
  try {
    url = new URL(clean);
  } catch {
    return null;
  }

  const host = url.hostname.toLocaleLowerCase('en').replace(/^www\./u, '');
  if (host === 'youtu.be') {
    return validVideoId(url.pathname.split('/').filter(Boolean)[0]);
  }
  if (
    host !== 'youtube.com' &&
    host !== 'm.youtube.com' &&
    host !== 'music.youtube.com' &&
    host !== 'youtube-nocookie.com'
  ) {
    return null;
  }

  const fromQuery = validVideoId(url.searchParams.get('v'));
  if (fromQuery) return fromQuery;

  const parts = url.pathname.split('/').filter(Boolean);
  if (['embed', 'shorts', 'live'].includes(parts[0] || '')) {
    return validVideoId(parts[1]);
  }
  return null;
}

function validVideoId(value: string | null | undefined): string | null {
  return value && /^[A-Za-z0-9_-]{11}$/u.test(value) ? value : null;
}

export function YouTubeEmbed({
  videoId,
  onReady,
  onStateChange,
  onError,
  onAutoplayBlocked,
}: {
  videoId: string;
  onReady: () => void;
  onStateChange: (state: number) => void;
  onError: (code: number) => void;
  onAutoplayBlocked: () => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const videoIdRef = useRef(videoId);
  const callbacksRef = useRef({
    onReady,
    onStateChange,
    onError,
    onAutoplayBlocked,
  });

  videoIdRef.current = videoId;
  callbacksRef.current = {
    onReady,
    onStateChange,
    onError,
    onAutoplayBlocked,
  };

  useEffect(() => {
    let cancelled = false;
    const mount = mountRef.current;
    if (!mount) return;
    const playerElement = document.createElement('div');
    mount.append(playerElement);

    loadYouTubeApi()
      .then((youtube) => {
        if (cancelled || !playerElement.isConnected) return;
        playerRef.current = new youtube.Player(playerElement, {
          videoId: videoIdRef.current,
          playerVars: {
            autoplay: 0,
            controls: 1,
            enablejsapi: 1,
            fs: 1,
            playsinline: 1,
            rel: 0,
            origin: window.location.origin,
          },
          events: {
            onReady: () => callbacksRef.current.onReady(),
            onStateChange: (event) => callbacksRef.current.onStateChange(event.data),
            onError: (event) => callbacksRef.current.onError(event.data),
            onAutoplayBlocked: () => callbacksRef.current.onAutoplayBlocked(),
          },
        });
      })
      .catch(() => {
        if (!cancelled) callbacksRef.current.onError(-1);
      });

    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
      playerElement.remove();
    };
  }, []);

  useEffect(() => {
    playerRef.current?.cueVideoById(videoId);
  }, [videoId]);

  return <div className="youtube-player__mount" ref={mountRef} />;
}
