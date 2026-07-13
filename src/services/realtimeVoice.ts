import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';

export type RealtimeVoiceCallbacks = {
  onInputTranscript?: (text: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onAssistantDone?: (text: string) => void;
  onToolCall?: (name: string, callId: string, argumentsJson: string) => Promise<unknown>;
  onToolResult?: (name: string, result: unknown) => void;
  onStatus?: (status: 'connecting' | 'connected' | 'speaking' | 'listening' | 'closed') => void;
  onError?: (error: Error) => void;
};

const EMERGENCY_PATTERN = /\b(chest pain|pressure in chest|severe breathing|difficulty breathing|shortness of breath|can't breathe|cannot breathe|fainted|unconscious|confusion|confused|stroke|face drooping|slurred speech|severe bleeding|bleeding heavily|bahut khoon|saans nahi|saans lene mein dikkat|behosh|hosh nahi|seene mein tez dard)\b/i;

export type RealtimeVoiceHandle = {
  close: () => Promise<void>;
  sendText: (text: string) => void;
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
  const { data, error } = await supabase.functions.invoke('voice-realtime-session', { body: context });
  const clientSecret = data?.data?.clientSecret;
  if (error || typeof clientSecret !== 'string' || !clientSecret) {
    throw new Error(error?.message || data?.message || 'Could not create realtime voice session');
  }

  // Keep the native package out of the web module graph. Metro otherwise
  // tries to bundle react-native-webrtc on web and fails on native-only files
  // such as RTCPIPView.
  const rtc: any = Platform.OS === 'web'
    ? {
        RTCPeerConnection: (globalThis as any).RTCPeerConnection,
        mediaDevices: (globalThis as any).navigator?.mediaDevices,
      }
    : (0, eval)('require')('react-native-webrtc');
  if (!rtc.RTCPeerConnection || !rtc.mediaDevices?.getUserMedia) {
    throw new Error('Realtime WebRTC is not available in this build');
  }

  const peer = new rtc.RTCPeerConnection();
  const localStream = await rtc.mediaDevices.getUserMedia({ audio: true, video: false });
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
  let lastAssistantDoneText = '';
  let lastAssistantDoneAt = 0;
  let userTurnSequence = 0;
  let lastDeliveredUserTurn = -1;
  let toolFollowUpExpected = false;
  let lastInputTranscript = '';
  let lastInputTranscriptAt = 0;
  const flushAssistantTranscript = (fallbackText = '') => {
    const completeText = String(fallbackText || assistantTranscriptBuffer || '').trim();
    const now = Date.now();
    const duplicateDone = completeText === lastAssistantDoneText && now - lastAssistantDoneAt < 2500;
    // Server VAD can occasionally produce a second response.done for the
    // same input turn. Do not show/speak that second normal response. A tool
    // result is the only valid reason to allow another response without a new
    // user utterance.
    const duplicateTurnResponse = lastDeliveredUserTurn === userTurnSequence && !toolFollowUpExpected;
    if (completeText && !duplicateDone && !duplicateTurnResponse) {
      lastAssistantDoneText = completeText;
      lastAssistantDoneAt = now;
      lastDeliveredUserTurn = userTurnSequence;
      callbacks.onAssistantDone?.(completeText);
    }
    toolFollowUpExpected = false;
    assistantTranscriptBuffer = '';
    assistantTranscriptMode = null;
    assistantResponseId = null;
  };
  channel.onopen = () => {
    callbacks.onStatus?.('connected');
  };
  channel.onmessage = async (event: any) => {
    const payload = parseEvent(typeof event.data === 'string' ? event.data : '');
    if (!payload) return;
    const type = String(payload.type || '');
    // Only persist the completed user turn. Processing delta/committed events
    // here creates duplicate user messages and can trigger duplicate replies.
    if (
      (type === 'conversation.item.input_audio_transcription.completed' || type.endsWith('.input_audio_transcription.completed')) &&
      typeof payload.transcript === 'string'
    ) {
      const transcript = payload.transcript.trim();
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
        channel.send(JSON.stringify({ type: 'response.cancel' }));
        channel.send(JSON.stringify({
          type: 'conversation.item.create',
          item: {
            type: 'message',
            role: 'user',
            content: [{
              type: 'input_text',
              text: 'URGENT SAFETY OVERRIDE: The patient reported a possible emergency red flag. Respond immediately and calmly: advise them to call local emergency services now or go to the nearest emergency department, not drive themselves if faint, and not wait for this chat. Ask no routine history questions. Do not diagnose or give medication doses.',
            }],
          },
        }));
        channel.send(JSON.stringify({ type: 'response.create' }));
      }
    }
    const isAudioTranscriptDelta = type === 'response.output_audio_transcript.delta' || type === 'response.audio_transcript.delta';
    // This session is configured for direct audio output. Realtime can also
    // emit response.output_text.* bookkeeping events; treating those as a
    // second transcript causes a short "Okay..." bubble before the complete
    // audio transcript arrives. Use the audio transcript as the single source
    // of truth for the voice UI.
    if (isAudioTranscriptDelta) {
      if (lastDeliveredUserTurn === userTurnSequence && !toolFollowUpExpected) {
        // A duplicate response for the same user turn has started. Cancel it
        // before more audio is delivered, otherwise the user hears a second
        // partial/duplicate answer even if the UI suppresses its transcript.
        if (channel.readyState === 'open') {
          channel.send(JSON.stringify({ type: 'response.cancel' }));
        }
        return;
      }
      const responseId = typeof payload.response_id === 'string' ? payload.response_id : null;
      // A new response must never inherit the previous response's transcript.
      // If the provider omitted response.done for the previous turn, flush it
      // before starting the next one.
      if (responseId && assistantResponseId && responseId !== assistantResponseId && assistantTranscriptBuffer.trim()) {
        flushAssistantTranscript();
      }
      assistantResponseId = responseId || assistantResponseId;
      assistantTranscriptMode = 'audio';
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
      flushAssistantTranscript();
    }
    if (type === 'response.function_call_arguments.done' && callbacks.onToolCall) {
      toolFollowUpExpected = true;
      const result = await callbacks.onToolCall(String(payload.name || ''), String(payload.call_id || ''), String(payload.arguments || '{}'));
      callbacks.onToolResult?.(String(payload.name || ''), result);
      channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: payload.call_id, output: JSON.stringify(result || {}) } }));
      channel.send(JSON.stringify({ type: 'response.create' }));
    }
    if (type === 'input_audio_buffer.speech_started') {
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

  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  const answerResponse = await fetch('https://api.openai.com/v1/realtime/calls', {
    method: 'POST',
    headers: { Authorization: `Bearer ${clientSecret}`, 'Content-Type': 'application/sdp' },
    body: offer.sdp,
  });
  if (!answerResponse.ok) throw new Error(await answerResponse.text());
  await peer.setRemoteDescription({ type: 'answer', sdp: await answerResponse.text() });

  return {
    sendText: (text: string) => {
      userTurnSequence += 1;
      toolFollowUpExpected = false;
      channel.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } }));
      channel.send(JSON.stringify({ type: 'response.create' }));
    },
    interrupt: () => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify({ type: 'response.cancel' }));
      }
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
