import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

export type RealtimeVoiceCallbacks = {
  onInputTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onAssistantDone?: (text: string) => void;
  onAssistantInterrupted?: () => void;
  onToolCall?: (name: string, callId: string, argumentsJson: string) => Promise<unknown>;
  onToolResult?: (name: string, result: unknown) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'speaking' | 'listening' | 'closed') => void;
  onError?: (error: Error) => void;
};

const EMERGENCY_PATTERN = /\b(chest pain|pressure in chest|severe breathing|difficulty breathing|shortness of breath|can't breathe|cannot breathe|fainted|unconscious|loss of consciousness|confusion|confused|stroke|face drooping|slurred speech|severe bleeding|bleeding heavily|bahut khoon|saans nahi|saans lene mein dikkat|behosh|hosh nahi|seene mein tez dard|seizure|fit aa raha|severe dehydration|not passing urine|blue lips|throat swelling|face swelling|suicidal|kill myself|self harm|neck stiffness)\b/i;
const NOISE_TRANSCRIPT_PATTERN = /^(uh+|um+|hmm+|mm+|ah+|oh+|echo+|noise+|background noise|\.+|[-_.]+)$/i;

const isLikelyNoiseTranscript = (value: string): boolean => {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return true;
  if (NOISE_TRANSCRIPT_PATTERN.test(text)) return true;
  if (/^(.)\1{3,}$/.test(text.replace(/\s/g, ''))) return true;
  return false;
};

// WebRTC can briefly capture a small part of the assistant audio before the
// local track is muted. Collapse only obvious repeated chunks so normal
// clinical wording and the user's meaning remain unchanged.
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

export async function connectRealtimeVoice(
  supabase: SupabaseClient,
  context: Record<string, unknown>,
  callbacks: RealtimeVoiceCallbacks = {},
): Promise<RealtimeVoiceHandle> {
  callbacks.onStatus?.('connecting');
  let data: any;
  let error: any;
  try {
    const response = await supabase.functions.invoke('voice-realtime-session', { body: context });
    data = response.data;
    error = response.error;
  } catch (cause) {
    throw new Error(`Realtime session request failed: ${toErrorMessage(cause)}`);
  }
  const clientSecret = data?.data?.clientSecret;
  if (error || typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error(`Realtime session failed: ${error?.message || data?.message || 'client secret missing'}`);
  }

  // Keep the native package out of the web module graph. Metro otherwise
  // tries to bundle react-native-webrtc on web and fails on native-only files
  // such as RTCPIPView.
  let rtc: any;
  if (Platform.OS === 'web') {
    rtc = {
      RTCPeerConnection: (globalThis as any).RTCPeerConnection,
      mediaDevices: (globalThis as any).navigator?.mediaDevices,
    };
  } else {
    try {
      // Keep this require conditional so the native module is bundled in an
      // Android/iOS build without being initialized by the web bundle.
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
  } catch (cause) {
    peer.close?.();
    throw new Error(`Microphone capture failed: ${toErrorMessage(cause)}`);
  }
  localStream.getTracks().forEach((track: any) => peer.addTrack(track, localStream));

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
    const { RTCView } = rtc;
    void RTCView;
    peer.addEventListener?.('track', () => undefined);
  }

  const channel = peer.createDataChannel('oai-events');
  let assistantTranscriptBuffer = '';
  let assistantTranscriptMode: 'audio' | 'text' | null = null;
  let assistantResponseId: string | null = null;
  let assistantAudioActive = false;
  let lastAssistantDoneText = '';
  let lastAssistantDoneAt = 0;
  let userTurnSequence = 0;
  let lastCompletedAssistantResponseId: string | null = null;
  let toolFollowUpExpected = false;
  let lastInputTranscript = '';
  let lastInputTranscriptAt = 0;
  let assistantResponseQueued = false;
  let assistantResponseStarted = false;
  const autoStartResponse = context?.autoStartResponse === true;
  const sendChannelEvent = (event: unknown): boolean => {
    if (channel.readyState !== 'open') return false;
    try {
      channel.send(JSON.stringify(event));
      return true;
    } catch {
      // The payment handoff and user closing the modal can close the channel
      // between the readyState check and send(). Voice cleanup must stay
      // non-fatal to the rest of the app.
      return false;
    }
  };
  const requestAssistantResponse = () => {
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
    // Realtime audio and input-transcription events can arrive out of order.
    // Do not use the user-turn counter to cancel audio; deduplicate completed
    // responses by text/response id instead.
    if (completeText && !duplicateDone) {
      lastAssistantDoneText = completeText;
      lastAssistantDoneAt = now;
      if (assistantResponseId) lastCompletedAssistantResponseId = assistantResponseId;
      callbacks.onAssistantDone?.(completeText);
    }
    toolFollowUpExpected = false;
    assistantTranscriptBuffer = '';
    assistantTranscriptMode = null;
    assistantResponseId = null;
  };
  channel.onopen = () => {
    callbacks.onStatus?.('connected');
    if (autoStartResponse || assistantResponseQueued) {
      assistantResponseQueued = false;
      // Start the welcome turn at the data-channel boundary. This removes
      // the extra UI/JS round trip after the WebRTC handshake completes.
      requestAssistantResponse();
    }
  };
  channel.onmessage = async (event: any) => {
    const payload = parseEvent(typeof event.data === 'string' ? event.data : '');
    if (!payload) return;
    const type = String(payload.type || '');
    if (type === 'response.cancelled' || type === 'response.canceled') {
      // A cancelled partial response (especially an emergency override) must
      // never become a visible second assistant bubble.
      assistantAudioActive = false;
      assistantTranscriptBuffer = '';
      assistantTranscriptMode = null;
      assistantResponseId = null;
      callbacks.onAssistantInterrupted?.();
      return;
    }
    if (type === 'response.created' || type === 'response.output_audio.started' || type === 'response.audio.started') {
      assistantAudioActive = true;
      localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = false;
      });
      callbacks.onStatus?.('speaking');
    }
    // Only persist the completed user turn. Processing delta/committed events
    // here creates duplicate user messages and can trigger duplicate replies.
    if (
      (type === 'conversation.item.input_audio_transcription.completed' || type.endsWith('.input_audio_transcription.completed')) &&
      typeof payload.transcript === 'string'
    ) {
      const transcript = collapseRepeatedTranscript(payload.transcript);
      if (isLikelyNoiseTranscript(transcript)) {
        // Server VAD can occasionally commit a fan/echo syllable. Cancel the
        // automatically-created turn instead of sending a meaningless reply.
        sendChannelEvent({ type: 'response.cancel' });
        return;
      }
      const now = Date.now();
      if (transcript && transcript === lastInputTranscript && now - lastInputTranscriptAt < 3500) {
        return;
      }
      lastInputTranscript = transcript;
      lastInputTranscriptAt = now;
      userTurnSequence += 1;
      toolFollowUpExpected = false;
      callbacks.onInputTranscript?.(transcript);
      if (transcript && EMERGENCY_PATTERN.test(transcript)) {
        // Stop any response already speaking and force an immediate safety
        // turn. The deterministic text prevents the model from continuing a
        // routine triage flow after a red flag is detected.
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
                : 'URGENT SAFETY OVERRIDE: The patient reported a possible emergency red flag. Respond immediately and calmly: advise them to call local emergency services now or go to the nearest emergency department, not drive themselves if faint, and not wait for this chat. Ask no routine history questions. Do not diagnose or give medication doses.',
            }],
          },
        });
        sendChannelEvent({ type: 'response.create' });
      }
    }
    const isAudioTranscriptDelta = type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta';
    // This session is configured for direct audio output. Realtime can also
    // emit response.output_text.* bookkeeping events; treating those as a
    // second transcript causes a short "Okay..." bubble before the complete
    // audio transcript arrives. Use the audio transcript as the single source
    // of truth for the voice UI.
    if (isAudioTranscriptDelta) {
      const responseId = typeof payload.response_id === 'string' ? payload.response_id : null;
      if (responseId && responseId === lastCompletedAssistantResponseId) {
        // Only cancel an actually repeated response ID. Transcript timing is
        // asynchronous, so a user-turn counter is not a safe dedupe key.
        sendChannelEvent({ type: 'response.cancel' });
        return;
      }
      // A new response must never inherit the previous response's transcript.
      // If the provider omitted response.done for the previous turn, flush it
      // before starting the next one.
      if (responseId && assistantResponseId && responseId !== assistantResponseId && assistantTranscriptBuffer.trim()) {
        flushAssistantTranscript();
      }
      assistantResponseId = responseId || assistantResponseId;
      assistantTranscriptMode = 'audio';
      assistantAudioActive = true;
      const delta = String(payload.delta || '');
      assistantTranscriptBuffer += delta;
      // Mute locally as soon as the assistant starts speaking. This avoids
      // background sound being captured during the response even before the
      // UI status callback has rendered.
      localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = false;
      });
      callbacks.onAssistantTranscript?.(assistantTranscriptBuffer);
      callbacks.onStatus?.('speaking');
    }
    // Transcript-done can be emitted once per output item. It is not always
    // the end of the whole assistant turn, so do not create a chat bubble here.
    // response.done is the turn boundary and flushes the complete transcript.
    if (type === 'response.done') {
      assistantAudioActive = false;
      flushAssistantTranscript();
    }
    if (type === 'response.function_call_arguments.done' && callbacks.onToolCall) {
      toolFollowUpExpected = true;
      const result = await callbacks.onToolCall(String(payload.name || ''), String(payload.call_id || ''), String(payload.arguments || '{}'));
      callbacks.onToolResult?.(String(payload.name || ''), result);
      // onToolResult may intentionally close the voice session while handing
      // off to payment. Never send the function output to a closed channel.
      if (sendChannelEvent({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: payload.call_id, output: JSON.stringify(result || {}) } })) {
        sendChannelEvent({ type: 'response.create' });
      }
    }
    if (type === 'input_audio_buffer.speech_started') {
      // Barge-in: stop the old assistant output, discard its unfinished
      // transcript, and let the new user turn become the only active turn.
      // This avoids leaving a partial answer in the chat when the user
      // interrupts the assistant.
      if (assistantAudioActive) {
        sendChannelEvent({ type: 'response.cancel' });
        assistantAudioActive = false;
        assistantTranscriptBuffer = '';
        assistantTranscriptMode = null;
        assistantResponseId = null;
        callbacks.onAssistantInterrupted?.();
      }
      // The user arms the microphone explicitly via setInputEnabled(true).
      // Do not re-enable it from a late VAD event after speech has ended.
      callbacks.onStatus?.('listening');
    }
    if (type === 'input_audio_buffer.speech_stopped') {
      // Server VAD has detected the end of the user's turn. Mute the local
      // track immediately so the following AI response cannot be interrupted
      // by background speech or room noise.
      localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = false;
      });
      callbacks.onStatus?.('speaking');
    }
    if (type === 'input_audio_buffer.committed') {
      // Treat commit as a second reliable turn boundary. Some WebRTC
      // sessions deliver committed without a separately observable
      // speech_stopped event.
      localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = false;
      });
      callbacks.onStatus?.('speaking');
    }
    if (type === 'error') callbacks.onError?.(new Error(payload.error?.message || 'Realtime voice error'));
  };

  try {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
      body: offer.sdp,
    });
    const answerSdp = await answerResponse.text();
    if (!answerResponse.ok) throw new Error(`OpenAI returned ${answerResponse.status}: ${answerSdp.slice(0, 240)}`);
    await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
  } catch (cause) {
    localStream.getTracks().forEach((track: any) => track.stop());
    peer.close?.();
    throw new Error(`Realtime connection failed: ${toErrorMessage(cause)}`);
  }

  return {
    sendText: (text: string) => {
      if (channel.readyState !== 'open') return;
      userTurnSequence += 1;
      toolFollowUpExpected = false;
      if (sendChannelEvent({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })) {
        sendChannelEvent({ type: 'response.create' });
      }
    },
    startAssistantResponse: () => {
      requestAssistantResponse();
    },
    interrupt: () => {
      sendChannelEvent({ type: 'response.cancel' });
    },
    close: async () => {
      localStream.getTracks().forEach((track: any) => track.stop());
      channel.close?.();
      peer.close?.();
      if (Platform.OS === 'web') document.querySelectorAll('[data-cd4-realtime-audio="true"]').forEach((node) => node.remove());
      callbacks.onStatus?.('closed');
    },
    setInputEnabled: (enabled: boolean) => {
      localStream.getAudioTracks().forEach((track: any) => {
        track.enabled = enabled;
      });
    },
  };
}

function toErrorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === 'string') return cause;
  try { return JSON.stringify(cause); } catch { return 'Unknown error'; }
}
