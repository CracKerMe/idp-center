import { useEffect, useRef, useState } from 'react';
import { RotateCw, ChevronsRight, Check, X } from 'lucide-react';
import { motion } from 'motion/react';
import clsx from 'clsx';
import { parseApiResponse } from '../utils/fetch';

interface ChallengeData {
  challenge_id: string;
  bg_image: string;
  piece_image: string;
  piece_y: number;
  canvas_width: number;
  canvas_height: number;
  piece_size: number;
}

interface TrailSample {
  x: number;
  y: number;
  t: number;
}

type VerifyState = 'idle' | 'checking' | 'success' | 'fail';

const KEYBOARD_STEP = 2;
const KEYBOARD_STEP_LARGE = 10;
const TRACK_HEIGHT = 44;
// A pointerup with no real drag (e.g. a stray click on the handle) shouldn't
// submit and burn one of the 3 verify attempts — require some actual movement.
const MIN_DRAG_DISTANCE = 3;

export function SliderCaptcha({
  username,
  onSuccess,
  onCancel,
}: {
  username: string;
  onSuccess: (captchaPass: string) => void;
  onCancel?: () => void;
}) {
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);
  const [sliderX, setSliderX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>('idle');
  const [shake, setShake] = useState(0);
  const [hintText, setHintText] = useState('Slide to complete the puzzle');
  const [announcement, setAnnouncement] = useState('');
  const [loadError, setLoadError] = useState('');

  const trackRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<TrailSample[]>([]);
  const startTRef = useRef(0);
  const inputModeRef = useRef<'pointer' | 'keyboard'>('pointer');
  const fetchedRef = useRef(false);

  const busy = verifyState === 'checking' || verifyState === 'success';
  const maxX = challenge ? challenge.canvas_width - challenge.piece_size : 0;

  async function fetchChallenge() {
    setLoadError('');
    setSliderX(0);
    setVerifyState('idle');
    setHintText('Slide to complete the puzzle');
    trailRef.current = [];
    try {
      const res = await fetch('/api/auth/captcha/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const result = await parseApiResponse<ChallengeData>(res);
      if (result.code === 0 && result.data) {
        setChallenge(result.data);
        setAnnouncement('Puzzle loaded. Drag the piece to align it with the notch.');
      } else {
        setLoadError(result.error || 'Failed to load puzzle');
      }
    } catch {
      setLoadError('Failed to load puzzle');
    }
  }

  useEffect(() => {
    // Guards against StrictMode's dev-only double-invoke of effects, which would
    // otherwise issue (and immediately orphan) a second challenge on every mount.
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addSample(x: number, y: number) {
    trailRef.current.push({ x, y, t: performance.now() - startTRef.current });
  }

  async function submit(finalX: number) {
    if (!challenge || busy) return;
    setVerifyState('checking');
    setAnnouncement('Verifying…');
    try {
      const res = await fetch('/api/auth/captcha/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challenge_id: challenge.challenge_id,
          x: Math.round(finalX),
          trail: trailRef.current,
          input_mode: inputModeRef.current,
        }),
      });
      const result = await parseApiResponse<{ captcha_pass?: string; attempts_remaining?: number }>(res);

      if (result.code === 0 && result.data?.captcha_pass) {
        setVerifyState('success');
        setHintText('Verified');
        setAnnouncement('Verified, continuing sign-in.');
        const pass = result.data.captcha_pass;
        // Brief confirmation flash before handing off, matching the pattern of
        // established slider captchas rather than cutting away instantly.
        setTimeout(() => onSuccess(pass), 400);
        return;
      }

      if (result.code === 'CAPTCHA_EXPIRED') {
        setAnnouncement('Puzzle expired, loading a new one.');
        await fetchChallenge();
        return;
      }

      const remaining = result.data?.attempts_remaining;
      setVerifyState('fail');
      setHintText('Try again');
      setAnnouncement(
        typeof remaining === 'number'
          ? `Not aligned, ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : 'Not aligned, try again.'
      );
      setShake((s) => s + 1);
      setTimeout(() => {
        setSliderX(0);
        trailRef.current = [];
        setVerifyState('idle');
        setHintText('Slide to complete the puzzle');
      }, 500);
    } catch {
      setVerifyState('idle');
      setAnnouncement('Verification failed, try again.');
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (busy || !challenge) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    inputModeRef.current = 'pointer';
    startTRef.current = performance.now();
    trailRef.current = [{ x: sliderX, y: 0, t: 0 }];
    setDragging(true);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(maxX, e.clientX - rect.left));
    const y = e.clientY - rect.top;
    addSample(x, y);
    setSliderX(x);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
    if (sliderX < MIN_DRAG_DISTANCE) return; // stray click/tap, not a real drag attempt
    submit(sliderX);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (busy || !challenge) return;
    if (inputModeRef.current !== 'keyboard') {
      inputModeRef.current = 'keyboard';
      startTRef.current = performance.now();
      trailRef.current = [{ x: sliderX, y: 0, t: 0 }];
    }

    let next = sliderX;
    switch (e.key) {
      case 'ArrowRight':
        next = Math.min(maxX, sliderX + (e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP));
        break;
      case 'ArrowLeft':
        next = Math.max(0, sliderX - (e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP));
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = maxX;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (sliderX < MIN_DRAG_DISTANCE) return;
        addSample(sliderX, 0);
        submit(sliderX);
        return;
      default:
        return;
    }
    e.preventDefault();
    addSample(next, 0);
    setSliderX(next);
  }

  if (loadError) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm text-red-600">{loadError}</p>
        <button
          type="button"
          onClick={fetchChallenge}
          className="text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" role="group" aria-describedby="slider-captcha-instructions">
      <h3 className="text-lg font-semibold text-zinc-900 dark:text-white">Verify it's you</h3>
      <span id="slider-captcha-instructions" className="sr-only">
        Drag the puzzle piece to align it with the notch, or focus the slider and use arrow keys, then press Enter.
      </span>
      <div aria-live="polite" className="sr-only">{announcement}</div>

      {challenge ? (
        <motion.div
          animate={shake ? { x: [0, -8, 8, -8, 0] } : {}}
          transition={{ duration: 0.3 }}
          onAnimationComplete={() => setShake(0)}
          className="rounded-lg overflow-hidden border border-zinc-300 dark:border-zinc-700 select-none"
          style={{ width: challenge.canvas_width }}
        >
          <div
            ref={trackRef}
            className="relative"
            style={{ width: challenge.canvas_width, height: challenge.canvas_height, touchAction: 'none' }}
          >
            <img
              src={challenge.bg_image}
              alt=""
              aria-hidden="true"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="absolute inset-0 w-full h-full"
            />
            <img
              src={challenge.piece_image}
              alt=""
              aria-hidden="true"
              draggable={false}
              onDragStart={(e) => e.preventDefault()}
              className="absolute pointer-events-none drop-shadow-md"
              style={{ left: sliderX, top: challenge.piece_y }}
            />

            <button
              type="button"
              onClick={fetchChallenge}
              disabled={busy}
              aria-label="Load a new puzzle"
              className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm disabled:opacity-50"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cancel and go back to login"
                className="absolute top-2 right-11 h-7 w-7 rounded-full bg-black/40 hover:bg-black/60 text-white flex items-center justify-center backdrop-blur-sm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div
            className={clsx(
              'relative border-t border-zinc-300 dark:border-zinc-700 transition-colors duration-200',
              verifyState === 'success' && 'bg-green-50 dark:bg-green-950/40',
              verifyState === 'fail' && 'bg-red-50 dark:bg-red-950/40',
              verifyState === 'idle' && 'bg-zinc-100 dark:bg-zinc-800',
              verifyState === 'checking' && 'bg-zinc-100 dark:bg-zinc-800'
            )}
            style={{ width: challenge.canvas_width, height: TRACK_HEIGHT }}
          >
            <div
              className={clsx(
                'absolute inset-y-0 left-0 transition-colors duration-200',
                verifyState === 'success' && 'bg-green-200/70 dark:bg-green-800/40',
                verifyState === 'fail' && 'bg-red-200/70 dark:bg-red-800/40',
                (verifyState === 'idle' || verifyState === 'checking') && 'bg-indigo-100 dark:bg-indigo-900/40'
              )}
              style={{ width: sliderX + TRACK_HEIGHT / 2 }}
            />

            <div
              className={clsx(
                'absolute inset-0 flex items-center justify-center text-xs font-medium pointer-events-none transition-opacity duration-150',
                sliderX > 4 ? 'opacity-0' : 'opacity-100',
                verifyState === 'success' && 'text-green-700 dark:text-green-400',
                verifyState === 'fail' && 'text-red-700 dark:text-red-400',
                (verifyState === 'idle' || verifyState === 'checking') && 'text-zinc-500 dark:text-zinc-400'
              )}
            >
              {hintText}
            </div>

            <div
              role="slider"
              tabIndex={busy ? -1 : 0}
              aria-label="Drag to align the puzzle piece"
              aria-valuemin={0}
              aria-valuemax={maxX}
              aria-valuenow={Math.round(sliderX)}
              aria-valuetext={`Slider position ${Math.round(sliderX)} of ${maxX}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onKeyDown={handleKeyDown}
              className={clsx(
                'absolute top-0 rounded-md border shadow flex items-center justify-center focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none',
                busy ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                verifyState === 'success'
                  ? 'bg-green-500 border-green-600 text-white'
                  : verifyState === 'fail'
                    ? 'bg-red-500 border-red-600 text-white'
                    : 'bg-white dark:bg-zinc-700 border-zinc-300 dark:border-zinc-600 text-zinc-500 dark:text-zinc-300'
              )}
              style={{ left: sliderX, width: TRACK_HEIGHT, height: TRACK_HEIGHT }}
            >
              {verifyState === 'success' ? <Check className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="h-[196px] flex items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
          Loading puzzle…
        </div>
      )}

    </div>
  );
}
