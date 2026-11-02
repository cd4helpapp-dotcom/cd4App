import { Platform } from 'react-native';
import { findVoiceReplyProblem, isVoiceInjection, looksLikeEcho, VOICE_SAFE_REPLY } from './voiceGuard';
import type { SupabaseClient } from '@supabase/supabase-js';
import { setAudioModeAsync } from 'expo-audio';
import { enableSpeaker, resetSpeaker } from '../../modules/speaker-route';

export type RealtimeVoiceStatus = 'connecting' | 'connected' | 'listening' | 'thinking' | 'speaking' | 'closed';

export type RealtimeVoiceCallbacks = {
  onInputTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onAssistantDone?: (text: string) => void;
  onAssistantInterrupted?: () => void;
  // Fired when the assistant's audio has actually finished playing on the device (not just finished generating).
  // This is the safe moment to re-open the microphone without the assistant hearing its own voice.
  onPlaybackFinished?: () => void;
  onToolCall?: (name: string, callId: string, argumentsJson: string) => Promise<unknown>;
  onToolResult?: (name: string, result: unknown) => void;
  onStatus?: (status: RealtimeVoiceStatus) => void;
  onError?: (error: Error) => void;
};

const SESSION_REQUEST_TIMEOUT_MS = 15000;
const SDP_EXCHANGE_TIMEOUT_MS = 15000;
// After the SDP answer is applied the data channel should open within seconds; if not, fail loudly instead of
// leaving the patient on "Connecting…" forever (blocked network, VPN, captive Wi-Fi).
const CHANNEL_OPEN_TIMEOUT_MS = 20000;
// If the provider never reports the output buffer stopping, estimate playback from transcript length.
const PLAYBACK_FALLBACK_MS_PER_CHAR = 65;
const PLAYBACK_FALLBACK_MIN_MS = 1200;
const PLAYBACK_FALLBACK_MAX_MS = 25000;

// --- Audio routing -----------------------------------------------------------------------------
// WebRTC voice is "call" audio, which many phones play on the quiet earpiece. The local SpeakerRoute module
// (modules/speaker-route) moves it to the loudspeaker with plain AudioManager / AVAudioSession calls.
// react-native-incall-manager did this before, but its 4.3.0 native start() crashed the app the moment voice
// opened, so it was replaced. The expo-audio session mode is still set first as a fallback for older builds.
export async function ensureSpeakerAudioRoute(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'doNotMix',
      shouldRouteThroughEarpiece: false,
    });
  } catch (error) {
    if (__DEV__) console.warn('[RealtimeVoice] Could not configure speaker audio mode:', error);
  }
  enableSpeaker();
}

// --- Transcript hygiene --------------------------------------------------------------------------
const EMERGENCY_PATTERN = /\b(chest pain|pressure in chest|severe breathing|difficulty breathing|shortness of breath|can't breathe|cannot breathe|fainted|unconscious|loss of consciousness|confusion|confused|stroke|face drooping|slurred speech|severe bleeding|bleeding heavily|bahut khoon|saans nahi|saans lene mein dikkat|behosh|hosh nahi|seene mein tez dard|seizure|fit aa raha|severe dehydration|not passing urine|blue lips|throat swelling|face swelling|suicidal|kill myself|self harm|neck stiffness)\b/i;
const NOISE_TRANSCRIPT_PATTERN = /^(uh+|um+|hmm+|mm+|ah+|oh+|echo+|noise+|background noise|\.+|[-_.]+|thanks for watching[.!]*|thank you for watching[.!]*|please subscribe[.!]*|subscribe to (my|the) channel[.!]*|subtitles? by.*|\[?(music|applause|silence|noise)\]?)$/i;

const isLikelyNoiseTranscript = (value: string): boolean => {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return true;
  if (NOISE_TRANSCRIPT_PATTERN.test(text)) return true;
  if (/^(.)\1{3,}$/.test(text.replace(/\s/g, ''))) return true;
  return false;
};

// WebRTC can briefly capture a small part of the assistant audio before the local track is muted.
// Collapse only obvious repeated chunks so normal clinical wording stays unchanged.
const collapseRepeatedTranscript = (value: string): string => {
  const words = value.trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (words.length < 3) return words.join(' ');

  let changed = true;
  while (changed) {
    changed = false;
    for (let size = Math.min(8, Math.floor(words.length / 2)); size >= 2; size -= 1) {
      let found = false;
      for (let start = 0; start + size * 2 <= words.length; start += 1) {
        const left = words.slice(start, start + size).map((word) => word.toLowerCase());
        const right = words.slice(start + size, start + size * 2).map((word) => word.toLowerCase());
        if (left.join(' ') === right.join(' ')) {
          words.splice(start + size, size);
          changed = true;
          found = true;
          break;
        }
      }
      if (found) break;
    }
  }

  return words.join(' ');
};

export type RealtimeVoiceHandle = {
  close: () => Promise<void>;
  sendText: (text: string) => void;
  startAssistantResponse: () => void;
  // Stops the assistant immediately (generation and the audio already playing).
  interrupt: () => void;
  setInputEnabled: (enabled: boolean) => void;
};

const parseEvent = (raw: string): any | null => {
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
};

const withTimeout = async <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out. Check your internet connection and try again.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// WebRTC events, data-channel events and timers call back into React state synchronously. On web an exception
// there is only logged, but in an Android/iOS release build an uncaught error in such a callback is fatal and
// closes the whole app. Every callback and native handler therefore runs behind this guard.
const reportVoiceError = (where: string, cause: unknown, onError?: (error: Error) => void) => {
  console.warn(`[RealtimeVoice] ${where} failed:`, cause);
  try {
    onError?.(new Error(`Voice assistant ran into a problem (${where}). Please start again.`));
  } catch {
    // The error reporter itself must never take the app down.
  }
};

const guardCallbacks = (raw: RealtimeVoiceCallbacks): RealtimeVoiceCallbacks => {
  const wrap = <K extends keyof RealtimeVoiceCallbacks>(key: K) => {
    const fn = raw[key] as any;
    if (typeof fn !== 'function') return undefined;
    return ((...args: any[]) => {
      try {
        // onToolCall is async: a rejected promise stays a rejection (handled by the caller), not a crash.
        return fn(...args);
      } catch (cause) {
        if (key === 'onToolCall') return Promise.reject(cause);
        if (key !== 'onError') reportVoiceError(String(key), cause, raw.onError);
        return undefined;
      }
    }) as RealtimeVoiceCallbacks[K];
  };
  return {
    onInputTranscript: wrap('onInputTranscript'),
    onAssistantTranscript: wrap('onAssistantTranscript'),
    onAssistantDone: wrap('onAssistantDone'),
    onAssistantInterrupted: wrap('onAssistantInterrupted'),
    onPlaybackFinished: wrap('onPlaybackFinished'),
    onToolCall: wrap('onToolCall'),
    onToolResult: wrap('onToolResult'),
    onStatus: wrap('onStatus'),
    onError: wrap('onError'),
  };
};

export async function connectRealtimeVoice(
  supabase: SupabaseClient,
  context: Record<string, unknown>,
  rawCallbacks: RealtimeVoiceCallbacks = {},
): Promise<RealtimeVoiceHandle> {
  const callbacks = guardCallbacks(rawCallbacks);
  // Wraps a native event handler / timer body so an exception inside it cannot crash a release build.
  const guard = <A extends any[]>(where: string, fn: (...args: A) => void) => (...args: A) => {
    try {
      fn(...args);
    } catch (cause) {
      reportVoiceError(where, cause, rawCallbacks.onError);
    }
  };
  callbacks.onStatus?.('connecting');
  void ensureSpeakerAudioRoute();

  let data: any;
  let error: any;
  try {
    const response = await withTimeout(
      supabase.functions.invoke('voice-realtime-session', { body: context }),
      SESSION_REQUEST_TIMEOUT_MS,
      'Starting the voice session'
    );
    data = response.data;
    error = response.error;
  } catch (cause) {
    throw new Error(`Realtime session request failed: ${toErrorMessage(cause)}`);
  }
  const clientSecret = data?.data?.clientSecret;
  if (error || typeof clientSecret !== 'string' || !clientSecret) {
    // supabase-js hides the JSON body of a non-2xx reply inside error.context; read it so the patient sees
    // the real reason (e.g. the daily voice limit) instead of "Edge Function returned a non-2xx status code".
    let serverMessage = '';
    try {
      const body = await (error as any)?.context?.json?.();
      serverMessage = typeof body?.message === 'string' ? body.message : '';
      if (body?.code === 'voice_quota') {
        const quotaError = new Error(serverMessage || 'Daily voice limit reached.');
        (quotaError as any).code = 'voice_quota';
        throw quotaError;
      }
    } catch (parsed) {
      if ((parsed as any)?.code === 'voice_quota') throw parsed;
    }
    throw new Error(`Realtime session failed: ${serverMessage || error?.message || data?.message || 'client secret missing'}`);
  }

  // Keep the native package out of the web module graph (Metro would otherwise try to bundle
  // react-native-webrtc's native-only files for web).
  let rtc: any;
  if (Platform.OS === 'web') {
    rtc = {
      RTCPeerConnection: (globalThis as any).RTCPeerConnection,
      mediaDevices: (globalThis as any).navigator?.mediaDevices,
    };
  } else {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const loaded = require('react-native-webrtc');
      rtc = loaded?.default ?? loaded;
    } catch (cause) {
      throw new Error(`Native WebRTC module failed to load: ${toErrorMessage(cause)}`);
    }
  }
  const missing: string[] = [];
  if (!rtc?.RTCPeerConnection) missing.push('RTCPeerConnection');
  if (!rtc?.mediaDevices) missing.push('mediaDevices');
  if (!rtc?.mediaDevices?.getUserMedia) missing.push('mediaDevices.getUserMedia');
  if (missing.length > 0) {
    throw new Error(`Realtime WebRTC is unavailable: missing ${missing.join(', ')}`);
  }

  let peer: any;
  try {
    peer = new rtc.RTCPeerConnection();
  } catch (cause) {
    throw new Error(`WebRTC peer could not start: ${toErrorMessage(cause)}`);
  }
  let localStream: any;
  try {
    localStream = await rtc.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
      video: false,
    });
    void ensureSpeakerAudioRoute();
  } catch (cause) {
    peer.close?.();
    throw new Error(`Microphone capture failed: ${toErrorMessage(cause)}`);
  }
  localStream.getTracks().forEach((track: any) => peer.addTrack(track, localStream));

  const setMicEnabled = (enabled: boolean) => {
    localStream.getAudioTracks().forEach((track: any) => {
      track.enabled = enabled;
    });
  };

  if (Platform.OS === 'web') {
    peer.ontrack = (event: any) => {
      const stream = event.streams?.[0];
      if (!stream) return;
      // A reconnect must never leave an older audio element playing.
      document.querySelectorAll('[data-cd4-realtime-audio="true"]').forEach((node) => node.remove());
      const audio = document.createElement('audio');
      audio.autoplay = true;
      (audio as any).playsInline = true;
      audio.srcObject = stream;
      audio.setAttribute('data-cd4-realtime-audio', 'true');
      document.body.appendChild(audio);
    };
  } else {
    peer.addEventListener?.('track', guard('track', () => {
      void ensureSpeakerAudioRoute();
    }));
  }

  let isClosed = false;
  const channel = peer.createDataChannel('oai-events');
  let assistantTranscriptBuffer = '';
  let assistantResponseId: string | null = null;
  let assistantAudioActive = false;
  let lastAssistantDoneText = '';
  let lastAssistantDoneAt = 0;
  let lastCompletedAssistantResponseId: string | null = null;
  let lastInputTranscript = '';
  let lastInputTranscriptAt = 0;
  let assistantResponseQueued = false;
  let assistantResponseStarted = false;
  let playbackFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  let channelOpenTimer: ReturnType<typeof setTimeout> | null = null;
  let isPlaybackPending = false;
  const autoStartResponse = context?.autoStartResponse === true;

  const sendChannelEvent = (event: unknown): boolean => {
    if (channel.readyState !== 'open') return false;
    try {
      channel.send(JSON.stringify(event));
      return true;
    } catch {
      // The payment handoff and the user closing the sheet can close the channel between the
      // readyState check and send(). Voice cleanup must stay non-fatal to the rest of the app.
      return false;
    }
  };

  const clearPlaybackFallback = () => {
    if (playbackFallbackTimer) clearTimeout(playbackFallbackTimer);
    playbackFallbackTimer = null;
  };

  // Single exit point for "the assistant finished talking", whichever signal arrives first.
  const finishPlayback = () => {
    clearPlaybackFallback();
    if (!isPlaybackPending || isClosed) return;
    isPlaybackPending = false;
    assistantAudioActive = false;
    callbacks.onPlaybackFinished?.();
  };

  const schedulePlaybackFallback = (spokenText: string) => {
    clearPlaybackFallback();
    const estimate = Math.min(
      PLAYBACK_FALLBACK_MAX_MS,
      Math.max(PLAYBACK_FALLBACK_MIN_MS, spokenText.length * PLAYBACK_FALLBACK_MS_PER_CHAR)
    );
    playbackFallbackTimer = setTimeout(guard('playback timer', finishPlayback), estimate);
  };

  // Barge-in: the mic stays open while the assistant talks, so the patient can simply speak over it. If a phone's echo
  // cancellation is too weak and the assistant keeps hearing itself, this session falls back to closing the mic while it talks.
  // VOICE_BARGE_IN=off turns it off from the server without a new build.
  let bargeInActive = data?.data?.bargeIn !== false && context?.mode !== 'hospital';
  let echoCount = 0;
  let speechDuringReply = false;
  let recentAssistantSpeech = '';
  const MAX_ECHOES_BEFORE_FALLBACK = 2;

  const closeMicForAssistant = () => {
    if (!bargeInActive) setMicEnabled(false);
  };

  // Noise or an echo cut the reply off, not the patient, so the assistant carries on.
  const resumeInterruptedReply = () => {
    sendChannelEvent({
      type: 'response.create',
      response: { instructions: 'Continue your previous reply from where it stopped. Do not repeat what you already said, and do not mention the interruption.' },
    });
  };

  const requestAssistantResponse = () => {
    void ensureSpeakerAudioRoute();
    if (assistantResponseStarted) return;
    if (sendChannelEvent({ type: 'response.create' })) {
      assistantResponseStarted = true;
    } else {
      assistantResponseQueued = true;
    }
  };

  const flushAssistantTranscript = (fallbackText = '') => {
    const completeText = String(fallbackText || assistantTranscriptBuffer || '').trim();
    const now = Date.now();
    const duplicateDone = completeText === lastAssistantDoneText && now - lastAssistantDoneAt < 2500;
    // Realtime audio and input-transcription events can arrive out of order; de-duplicate completed
    // responses by text/response id instead of a user-turn counter.
    if (completeText && !duplicateDone) {
      lastAssistantDoneText = completeText;
      lastAssistantDoneAt = now;
      if (assistantResponseId) lastCompletedAssistantResponseId = assistantResponseId;
      callbacks.onAssistantDone?.(completeText);
    }
    assistantTranscriptBuffer = '';
    assistantResponseId = null;
    return completeText;
  };

  const failConnection = (message: string) => {
    if (isClosed) return;
    callbacks.onError?.(new Error(message));
    void handle.close();
  };

  peer.onconnectionstatechange = guard('connection state', () => {
    const state = String(peer.connectionState || '');
    if (state === 'failed') failConnection('Voice connection lost. Please check your internet and start again.');
  });

  channel.onopen = guard('channel open', () => {
    if (channelOpenTimer) clearTimeout(channelOpenTimer);
    channelOpenTimer = null;
    void ensureSpeakerAudioRoute();
    callbacks.onStatus?.('connected');
    if (autoStartResponse || assistantResponseQueued) {
      assistantResponseQueued = false;
      // Start the welcome turn at the data-channel boundary (no extra UI round trip).
      requestAssistantResponse();
    }
  });

  channel.onclose = guard('channel close', () => {
    if (!isClosed) failConnection('Voice session ended unexpectedly. Please start again.');
  });

  // Stops a reply that went wrong, removes it from the screen, and asks once for a safe one.
  let guardedResponseId: string | null = null;
  const stopReplyAndSpeakSafely = () => {
    sendChannelEvent({ type: 'response.cancel' });
    sendChannelEvent({ type: 'output_audio_buffer.clear' });
    assistantTranscriptBuffer = '';
    callbacks.onAssistantTranscript?.('');
    if (sendChannelEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: VOICE_SAFE_REPLY }] } })) {
      sendChannelEvent({ type: 'response.create' });
    }
  };

  const handleChannelMessage = async (event: any) => {
    const payload = parseEvent(typeof event.data === 'string' ? event.data : '');
    if (!payload) return;
    const type = String(payload.type || '');

    if (type === 'response.cancelled' || type === 'response.canceled') {
      // A cancelled partial response (e.g. an emergency override) must never become a visible bubble.
      assistantTranscriptBuffer = '';
      assistantResponseId = null;
      callbacks.onAssistantInterrupted?.();
      return;
    }

    if (type === 'response.created' || type === 'response.output_audio.started' || type === 'response.audio.started') {
      assistantAudioActive = true;
      isPlaybackPending = true;
      clearPlaybackFallback();
      closeMicForAssistant();
      void ensureSpeakerAudioRoute();
      callbacks.onStatus?.('speaking');
    }

    // WebRTC-only events that track the device's actual playback buffer.
    if (type === 'output_audio_buffer.started') {
      isPlaybackPending = true;
      clearPlaybackFallback();
      callbacks.onStatus?.('speaking');
    }
    if (type === 'output_audio_buffer.stopped' || type === 'output_audio_buffer.cleared') {
      finishPlayback();
    }

    // Only persist the completed user turn; delta/committed events would duplicate messages.
    if (
      (type === 'conversation.item.input_audio_transcription.completed' || type.endsWith('.input_audio_transcription.completed')) &&
      typeof payload.transcript === 'string'
    ) {
      const transcript = collapseRepeatedTranscript(payload.transcript);
      const cutOffReply = speechDuringReply;
      speechDuringReply = false;
      if (isLikelyNoiseTranscript(transcript)) {
        // VAD occasionally commits a fan/echo syllable. Cancel that auto-created turn.
        sendChannelEvent({ type: 'response.cancel' });
        if (cutOffReply) resumeInterruptedReply();
        return;
      }
      if (bargeInActive && cutOffReply && looksLikeEcho(transcript, recentAssistantSpeech)) {
        echoCount += 1;
        sendChannelEvent({ type: 'response.cancel' });
        if (typeof payload.item_id === 'string') sendChannelEvent({ type: 'conversation.item.delete', item_id: payload.item_id });
        if (echoCount >= MAX_ECHOES_BEFORE_FALLBACK) {
          bargeInActive = false;
          setMicEnabled(false);
        }
        resumeInterruptedReply();
        return;
      }
      const now = Date.now();
      if (transcript && transcript === lastInputTranscript && now - lastInputTranscriptAt < 3500) return;
      lastInputTranscript = transcript;
      lastInputTranscriptAt = now;
      callbacks.onInputTranscript?.(transcript);
      if (transcript && !EMERGENCY_PATTERN.test(transcript) && isVoiceInjection(transcript)) {
        stopReplyAndSpeakSafely();
        return;
      }
      if (transcript && EMERGENCY_PATTERN.test(transcript)) {
        // Stop any routine reply and force an immediate safety turn.
        sendChannelEvent({ type: 'response.cancel' });
        sendChannelEvent({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{
              type: 'input_text',
              text: context?.mode === 'hospital'
                ? 'URGENT HOSPITAL SAFETY OVERRIDE: The patient reported a possible emergency red flag while already under hospital care. Respond immediately and calmly: tell the patient or staff to alert the assigned doctor or hospital clinical team now and request urgent bedside assessment. Do not redirect them to another hospital, local emergency services, or outside care. Do not diagnose or give medication doses. After the team acknowledges the alert, continue the minimum relevant history one question at a time.'
                : 'URGENT SAFETY OVERRIDE: The patient reported a possible emergency red flag. Respond immediately and calmly: advise them to call local emergency services (112 in India) now or go to the nearest emergency department, not drive themselves if faint, and not wait for this chat. Ask no routine history questions. Do not diagnose or give medication doses.',
            }],
          },
        });
        sendChannelEvent({ type: 'response.create' });
      }
    }

    const isAudioTranscriptDelta = type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta';
    // The session outputs audio; the audio transcript is the single source of truth for the UI.
    // (Treating response.output_text.* as a second transcript caused a short duplicate bubble.)
    if (isAudioTranscriptDelta) {
      const responseId = typeof payload.response_id === 'string' ? payload.response_id : null;
      if (responseId && responseId === lastCompletedAssistantResponseId) {
        sendChannelEvent({ type: 'response.cancel' });
        return;
      }
      // A new response must never inherit the previous response's transcript.
      if (responseId && assistantResponseId && responseId !== assistantResponseId && assistantTranscriptBuffer.trim()) {
        flushAssistantTranscript();
      }
      assistantResponseId = responseId || assistantResponseId;
      assistantAudioActive = true;
      isPlaybackPending = true;
      assistantTranscriptBuffer += String(payload.delta || '');
      recentAssistantSpeech = `${recentAssistantSpeech}${String(payload.delta || '')}`.slice(-1200);
      if (responseId !== guardedResponseId && findVoiceReplyProblem(assistantTranscriptBuffer)) {
        guardedResponseId = responseId;
        stopReplyAndSpeakSafely();
        return;
      }
      closeMicForAssistant();
      callbacks.onAssistantTranscript?.(assistantTranscriptBuffer);
      callbacks.onStatus?.('speaking');
    }

    // response.done is the turn boundary. Audio may still be playing for several seconds after it,
    // so re-opening the mic waits for output_audio_buffer.stopped (or the estimated fallback).
    if (type === 'response.done') {
      const spoken = flushAssistantTranscript();
      const hadAudio = isPlaybackPending || Boolean(spoken);
      const hasPendingToolCall = Array.isArray(payload.response?.output)
        && payload.response.output.some((item: any) => item?.type === 'function_call');
      if (hasPendingToolCall) {
        callbacks.onStatus?.('thinking');
      } else if (hadAudio) {
        isPlaybackPending = true;
        schedulePlaybackFallback(spoken);
      } else {
        isPlaybackPending = true;
        finishPlayback();
      }
    }

    if (type === 'response.function_call_arguments.done' && callbacks.onToolCall) {
      callbacks.onStatus?.('thinking');
      let result: unknown;
      try {
        result = await callbacks.onToolCall(String(payload.name || ''), String(payload.call_id || ''), String(payload.arguments || '{}'));
      } catch (toolError) {
        result = { error: 'The request could not be completed right now. Apologise briefly and offer to try again.' };
        if (__DEV__) console.warn('[RealtimeVoice] tool call failed:', toolError);
      }
      callbacks.onToolResult?.(String(payload.name || ''), result);
      // onToolResult may close the session for the payment handoff; never write to a closed channel.
      if (sendChannelEvent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: payload.call_id, output: JSON.stringify(result || {}) } })) {
        sendChannelEvent({ type: 'response.create' });
      }
    }

    if (type === 'input_audio_buffer.speech_started') {
      speechDuringReply = assistantAudioActive;
      callbacks.onStatus?.('listening');
    }
    if (type === 'input_audio_buffer.speech_stopped' || type === 'input_audio_buffer.committed') {
      // End of the patient's turn: show that the assistant is preparing a reply.
      closeMicForAssistant();
      if (!assistantAudioActive) callbacks.onStatus?.('thinking');
    }
    if (type === 'error') {
      const message = String(payload.error?.message || 'Realtime voice error');
      // Cancelling when nothing is active is harmless; don't surface it to the patient.
      if (!/no active response|cancellation failed/i.test(message)) callbacks.onError?.(new Error(message));
    }
  };
  channel.onmessage = (event: any) => {
    handleChannelMessage(event).catch((cause) => reportVoiceError('voice message', cause, rawCallbacks.onError));
  };

  const handle: RealtimeVoiceHandle = {
    sendText: (text: string) => {
      if (channel.readyState !== 'open') return;
      if (sendChannelEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })) {
        sendChannelEvent({ type: 'response.create' });
      }
    },
    startAssistantResponse: () => {
      requestAssistantResponse();
    },
    interrupt: () => {
      // Cancel generation and drop the audio already queued on the device so the voice stops at once.
      sendChannelEvent({ type: 'response.cancel' });
      sendChannelEvent({ type: 'output_audio_buffer.clear' });
      assistantTranscriptBuffer = '';
      assistantResponseId = null;
      isPlaybackPending = true;
      finishPlayback();
    },
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      if (channelOpenTimer) clearTimeout(channelOpenTimer);
      clearPlaybackFallback();
      localStream.getTracks().forEach((track: any) => track.stop());
      channel.close?.();
      peer.close?.();
      if (Platform.OS === 'web') document.querySelectorAll('[data-cd4-realtime-audio="true"]').forEach((node) => node.remove());
      // Give the phone its normal audio routing back (music, videos) once voice chat ends.
      resetSpeaker();
      callbacks.onStatus?.('closed');
    },
    setInputEnabled: (enabled: boolean) => {
      if (isClosed) return;
      setMicEnabled(enabled);
    },
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answerResponse = await withTimeout(
      fetch('https://api.openai.com/v1/realtime/calls', {
        method: 'POST',
        headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      }),
      SDP_EXCHANGE_TIMEOUT_MS,
      'Connecting to the voice assistant'
    );
    const answerSdp = await answerResponse.text();
    if (!answerResponse.ok) throw new Error(`OpenAI returned ${answerResponse.status}: ${answerSdp.slice(0, 240)}`);
    await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
    channelOpenTimer = setTimeout(guard('connect timeout', () => {
      if (channel.readyState !== 'open') failConnection('Could not connect the voice call. Check your internet connection and try again.');
    }), CHANNEL_OPEN_TIMEOUT_MS);
  } catch (cause) {
    isClosed = true;
    localStream.getTracks().forEach((track: any) => track.stop());
    peer.close?.();
    throw new Error(`Realtime connection failed: ${toErrorMessage(cause)}`);
  }

  return handle;
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try { return JSON.stringify(cause); } catch { return 'Unknown error'; }
}
