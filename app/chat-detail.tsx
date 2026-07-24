import React, { useState, useRef, useEffect, useCallback } from 'react';
import Toast from 'react-native-toast-message';
import { View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity, ActivityIndicator, Platform, Image, KeyboardAvoidingView, Modal, Alert, Linking, Keyboard, ScrollView, LayoutAnimation, UIManager } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useColorScheme } from 'react-native';
import Colors from '../constants/Colors';
import { getImageUrl } from '../constants/Config';
import { ArrowLeft, Video, Phone, Send, Paperclip, MoreVertical, FileText, X, Mic, MicOff, VideoOff, Volume2, VolumeX, CheckCheck, ChevronRight, ChevronUp, ChevronDown, Maximize2, MessageCircle } from 'lucide-react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { PanResponder, Animated } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext } from '../context/AuthContext';
import { useAppLanguage } from '../context/AppLanguageContext';
import { useChatMessages, useSendMessage, useGetOrCreateRoom, useMarkAsRead, useChatRooms, useSendPrescriptionPdfToChat } from '../hooks/useChat';
import { useCall } from '../hooks/useCall';
import { usePresence } from '../hooks/usePresence';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { useParseDoctorPrescription, type ParsedPrescriptionSummary } from '../hooks/useMedicalReports';
import { setActiveRoomId } from '../hooks/usePushNotifications';
import { supabase } from '../src/lib/supabase';
import { RtcSurfaceView, RtcTextureView } from '../src/lib/agora';
import { getLocalizedDoctorName } from '../src/i18n/nameLocalization';

type SpeechRecognitionModule = {
    isRecognitionAvailable: () => boolean;
    requestPermissionsAsync: () => Promise<{ granted?: boolean }>;
    start: (options?: Record<string, any>) => void;
    stop: () => void;
    abort?: () => void;
    addListener: (eventName: string, listener: (event: any) => void) => { remove: () => void };
};

const loadSpeechRecognitionModule = (): SpeechRecognitionModule | null => {
    try {
        const speechRecognition = require('expo-speech-recognition') as {
            ExpoSpeechRecognitionModule?: SpeechRecognitionModule;
        };
        return speechRecognition.ExpoSpeechRecognitionModule ?? null;
    } catch {
        return null;
    }
};

const ExpoSpeechRecognitionModule = loadSpeechRecognitionModule();

const extractSpeechText = (event: any): string => {
    const direct = typeof event?.transcript === 'string' ? event.transcript.trim() : '';
    if (direct) return direct;

    const resultList = Array.isArray(event?.results) ? event.results : [];
    if (!resultList.length) return '';

    // Prefer the latest result only; do not join all alternatives/partials.
    const latest = resultList[resultList.length - 1];
    if (!latest) return '';

    if (typeof latest === 'string') return latest.trim();

    if (Array.isArray(latest)) {
        const firstAlt = latest[0];
        if (typeof firstAlt === 'string') return firstAlt.trim();
        if (firstAlt && typeof firstAlt === 'object') {
            const t = typeof firstAlt.transcript === 'string' ? firstAlt.transcript.trim() : '';
            return t;
        }
        return '';
    }

    if (latest && typeof latest === 'object') {
        const t = typeof latest.transcript === 'string' ? latest.transcript.trim() : '';
        if (t) return t;
        // Fallback for nested alt payloads.
        const alt0 = Array.isArray((latest as any).alternatives) ? (latest as any).alternatives[0] : null;
        if (alt0 && typeof alt0 === 'object' && typeof alt0.transcript === 'string') {
            return alt0.transcript.trim();
        }
    }

    return '';
};

const normalizeSpacing = (value: string): string =>
    (value || '').replace(/\s+/g, ' ').trim();

const collapseRepeatedTail = (value: string): string => {
    const text = normalizeSpacing(value);
    if (!text) return '';
    const words = text.split(' ');
    const maxWindow = Math.min(16, Math.floor(words.length / 2));
    for (let size = maxWindow; size >= 3; size -= 1) {
        const tail = words.slice(words.length - size).join(' ');
        const prev = words.slice(words.length - 2 * size, words.length - size).join(' ');
        if (tail && tail === prev) {
            return words.slice(0, words.length - size).join(' ');
        }
    }
    return text;
};

const sanitizeTranscriptText = (value: string): string => {
    const text = normalizeSpacing(value);
    if (!text) return '';
    // Keep transcript natural; only trim clear tail repetition loops.
    return collapseRepeatedTail(text);
};

const MEDICAL_ASR_FIXES: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\bparacitamol\b/gi, replacement: 'paracetamol' },
    { pattern: /\bparacetemol\b/gi, replacement: 'paracetamol' },
    { pattern: /\bparaceta\s?mol\b/gi, replacement: 'paracetamol' },
    { pattern: /\bdolo\s?six\s?fifty\b/gi, replacement: 'dolo 650' },
    { pattern: /\bajithromycin\b/gi, replacement: 'azithromycin' },
    { pattern: /\bamoxycillin\b/gi, replacement: 'amoxicillin' },
    { pattern: /\bmontelucast\b/gi, replacement: 'montelukast' },
    { pattern: /\blevocetrizine\b/gi, replacement: 'levocetirizine' },
    { pattern: /\bb p\b/gi, replacement: 'BP' },
    { pattern: /\bod\b/gi, replacement: 'OD' },
    { pattern: /\bbd\b/gi, replacement: 'BD' },
    { pattern: /\btds\b/gi, replacement: 'TDS' },
    { pattern: /\bsos\b/gi, replacement: 'SOS' },
];

const toSentenceCase = (value: string): string =>
    value
        .split(/([.!?]\s+)/)
        .map((chunk, index) => {
            if (index % 2 === 1) return chunk;
            const trimmed = chunk.trim();
            if (!trimmed) return chunk;
            return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
        })
        .join('')
        .replace(/\s+/g, ' ')
        .trim();

const normalizeMedicalDictation = (value: string): string => {
    let text = sanitizeTranscriptText(value);
    if (!text) return '';

    MEDICAL_ASR_FIXES.forEach(({ pattern, replacement }) => {
        text = text.replace(pattern, replacement);
    });

    text = text
        .replace(/\s*,\s*/g, ', ')
        .replace(/\s*;\s*/g, '; ')
        .replace(/\s*:\s*/g, ': ')
        .replace(/\s+/g, ' ')
        .trim();

    return toSentenceCase(text);
};

const formatPrescriptionForDisplay = (value: string): string => {
    const normalized = normalizeMedicalDictation(value);
    if (!normalized) return '';

    const segmented = normalized
        .replace(/\b(and then|then|also|additionally|plus)\b/gi, '. ')
        .replace(/\b(after food|before food|once daily|twice daily|three times daily|at night)\b/gi, '$1.')
        .replace(/\.\s*\./g, '.')
        .replace(/\s+\./g, '.')
        .replace(/\s+/g, ' ')
        .trim();

    const sentences = segmented
        .split(/[.?!]\s+/)
        .map((item) => item.trim())
        .filter(Boolean);

    if (!sentences.length) return normalized;
    return sentences.map((line) => `- ${line}`).join('\n');
};

const RX_TEMPLATE = `CHIEF COMPLAINTS:
-

HISTORY (SUMMARY):
-

EXAMINATION:
-

DIAGNOSIS:
-

MEDICATIONS:
1. Medicine | Dose | Frequency | Duration | Timing/Instructions

GENERAL ADVICE:
-

PRECAUTIONS:
-

FOLLOW-UP:
-

DOCTOR NOTES:
-`;

const toUniqueLines = (rows: string[], max = 3): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const line = row.trim();
        if (!line) continue;
        const key = line.toLowerCase()
            .replace(/^(?:like|it is|i said|medicine is|prescribe)\s+/i, '')
            .replace(/\b(?:tablet|tab|capsule|cap)\b/g, ' ')
            .replace(/[^a-z0-9]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(line);
        if (out.length >= max) break;
    }
    return out;
};

const MEDICATION_DICTATION_PATTERN = /\b(paracetamol|pcm|dolo|azithromycin|amoxicillin|cetirizine|levocetirizine|montelukast|pantoprazole|rabeprazole|ibuprofen|tablet|tab\.?|capsule|cap\.?|syrup|injection|ointment|cream|drops?|inhaler|mg|mcg|ml|od|bd|tds|sos|once daily|twice daily|three times daily|after food|before food)\b/i;

const cleanMedicineDraftLine = (value: string): string => value
    .replace(/^\s*(?:like|it is|i said|medicine is|prescribe|the medicine is|this is|is)\s+/i, '')
    .replace(/^\s*(?:a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const medicineNameKey = (value: string): string => {
    const normalized = cleanMedicineDraftLine(value)
    .toLowerCase()
    .replace(/\b(?:tablet|tab|capsule|cap|syrup|syp|injection|inj|cream|ointment|drops?)\b/g, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g|gm|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
    // Common dictation variants must collapse before the generic fuzzy check.
    if (/^(?:azithromycin|azithro|azee|azentrom|azentromycin)$/.test(normalized)) return 'azithromycin';
    if (/^(?:paracetamol|paracitamol|pcm|dolo|tolo)$/.test(normalized)) return 'paracetamol';
    return normalized;
};

const medicineNameDistance = (left: string, right: string): number => {
    const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
    for (let i = 0; i < left.length; i += 1) {
        const current = [i + 1];
        for (let j = 0; j < right.length; j += 1) {
            current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + (left[i] === right[j] ? 0 : 1)));
        }
        for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
    }
    return previous[right.length];
};

const dedupeMedicineDraftLines = (rows: string[], max = 6): string[] => {
    const output: string[] = [];
    const keys: string[] = [];
    const noise = new Set(['is', 'is a', 'is an', 'a', 'an', 'the', 'medicine', 'medication', 'dose', 'frequency', 'duration', 'tablet', 'capsule']);
    for (const rawRow of rows) {
        const cleaned = cleanMedicineDraftLine(rawRow);
        const medicinePart = cleaned.split('|')[0]?.trim() || cleaned;
        const key = medicineNameKey(medicinePart);
        if (!key || key.length < 3 || noise.has(key)) continue;
        const duplicate = keys.some((existing) => {
            if (existing === key) return true;
            const distance = medicineNameDistance(existing, key);
            return Math.max(existing.length, key.length) >= 7 && distance / Math.max(existing.length, key.length) <= 0.22;
        });
        if (duplicate) continue;
        keys.push(key);
        output.push(cleaned);
        if (output.length >= max) break;
    }
    return output;
};

type PrescriptionSectionKey = 'complaints' | 'history' | 'examination' | 'diagnosis' | 'medications' | 'advice' | 'precautions' | 'followUp' | 'notes';

const extractExplicitPrescriptionSections = (text: string): Partial<Record<PrescriptionSectionKey, string[]>> => {
    const markerPattern = /\b(chief complaints?|complaints?|history(?:\s*summary)?(?:\s*\([^)]*\))?|examination|exam|diagnosis|medications?|medicines?|general advice|advice|precautions?|follow[-\s]?up|doctor notes?|additional notes?)\s*[:\-]?/gi;
    const matches = Array.from(text.matchAll(markerPattern));
    const result: Partial<Record<PrescriptionSectionKey, string[]>> = {};
    const sectionFor = (label: string): PrescriptionSectionKey => {
        const key = label.toLowerCase().replace(/[-\s]+/g, ' ');
        if (key.includes('chief') || key === 'complaint' || key === 'complaints') return 'complaints';
        if (key.startsWith('history')) return 'history';
        if (key === 'exam' || key === 'examination') return 'examination';
        if (key === 'diagnosis') return 'diagnosis';
        if (key.startsWith('medic')) return 'medications';
        if (key.startsWith('advice')) return 'advice';
        if (key.startsWith('precaution')) return 'precautions';
        if (key.startsWith('follow')) return 'followUp';
        return 'notes';
    };

    matches.forEach((match, index) => {
        const start = (match.index || 0) + match[0].length;
        const end = index + 1 < matches.length ? (matches[index + 1].index || text.length) : text.length;
        const value = text.slice(start, end).replace(/[,:;]+/g, ' ').trim();
        if (!value) return;
        const key = sectionFor(match[1]);
        const rows = value.split(/[.!?\n]+/).map((item) => item.trim()).filter(Boolean);
        result[key] = [...(result[key] || []), ...rows];
    });
    return result;
};

const buildStructuredPrescriptionDraft = (rawText: string, aiSummary?: ParsedPrescriptionSummary, aiMedicines?: Array<{ medicine_name?: string | null; dosage?: string | null; frequency?: string | null; duration?: string | null; instructions?: string | null }>): string => {
    const raw = normalizeMedicalDictation(rawText);
    if (!raw) return RX_TEMPLATE;

    const parts = raw
        .split(/[.?!]\s+/)
        .map((item) => item.trim())
        .filter(Boolean);
    const explicit = extractExplicitPrescriptionSections(raw);

    // Keep a spoken clinical sentence in its relevant section only. The old
    // builder converted the entire dictation into medicine rows, which caused
    // complaints, history, and advice to be duplicated in the PDF.
    const medicationParts = parts.filter((part) => MEDICATION_DICTATION_PATTERN.test(part));
    // Keep mixed sentences in the clinical scan so "fever for 2 days, give
    // paracetamol" does not lose the fever/duration details; only pure
    // medication instructions stay out of symptom sections.
    const clinicalParts = parts.filter((part) =>
        !MEDICATION_DICTATION_PATTERN.test(part) || /(fever|bukhar|pain|cough|cold|vomit|nausea|headache|weakness|acidity|sore throat|since|day|days|week|history|onset|bp|pulse|temperature|spo2|exam|diagnosis|viral|infection|flu|allergy|gastritis|migraine|hypertension|diabetes)/i.test(part)
    );
    const aiMedicineLines = dedupeMedicineDraftLines((aiMedicines || []).map((item) => [item.medicine_name, item.dosage, item.frequency, item.duration, item.instructions].filter(Boolean).join(' | ')));
    const complaints = toUniqueLines([...(aiSummary?.chief_complaints || []), ...(explicit.complaints || []), ...clinicalParts.filter((p) => /(fever|bukhar|pain|cough|cold|vomit|nausea|headache|weakness|acidity|sore throat)/i.test(p))], 4);
    const history = toUniqueLines([...(aiSummary?.history_summary || []), ...(explicit.history || []), ...clinicalParts.filter((p) => /(since|from last|day|days|week|history|onset)/i.test(p))], 4);
    const exam = toUniqueLines([...(aiSummary?.examination || []), ...(explicit.examination || []), ...clinicalParts.filter((p) => /(bp|pulse|temperature|spo2|exam|examination)/i.test(p))], 3);
    const diagnosis = toUniqueLines([...(aiSummary?.diagnosis ? [aiSummary.diagnosis] : []), ...(explicit.diagnosis || []), ...clinicalParts.filter((p) => /(viral|infection|flu|allergy|gastritis|migraine|hypertension|diabetes|diagnosis)/i.test(p))], 2);
    const advice = toUniqueLines([...(aiSummary?.general_advice || []), ...(explicit.advice || []), ...clinicalParts.filter((p) => /(rest|water|hydrate|sleep|diet|steam|light food)/i.test(p))], 4);
    const precautions = toUniqueLines([...(aiSummary?.precautions || []), ...(explicit.precautions || []), ...clinicalParts.filter((p) => /(avoid|don't|dont|mat|careful|precaution)/i.test(p))], 4);
    const followUp = toUniqueLines([...(aiSummary?.follow_up || []), ...(explicit.followUp || []), ...clinicalParts.filter((p) => /(follow up|review|revisit|dobara|wapis|after \d+ day)/i.test(p))], 2);
    // Prefer verified AI medicine rows. Raw local rows are only a fallback;
    // otherwise speech noise such as "like Dolo 650" gets added beside the
    // normalized "Dolo | 650" row.
    const meds = dedupeMedicineDraftLines([
        ...aiMedicineLines,
        ...(explicit.medications || []),
        ...(aiMedicineLines.length ? [] : medicationParts),
    ], 6);
    const knownClinicalSignal = /(fever|bukhar|pain|cough|cold|vomit|nausea|headache|weakness|acidity|sore throat|since|day|days|week|history|onset|bp|pulse|temperature|spo2|exam|diagnosis|viral|infection|flu|allergy|gastritis|migraine|hypertension|diabetes|rest|water|hydrate|sleep|diet|steam|light food|avoid|don't|dont|mat|careful|precaution|follow up|review|revisit|dobara|wapis|after \d+ day)/i;
    const notes = toUniqueLines([...(explicit.notes || []), ...clinicalParts.filter((p) => !knownClinicalSignal.test(p) && !MEDICATION_DICTATION_PATTERN.test(p))], 6);

    const section = (title: string, rows: string[], fallback = '-') =>
        `${title}\n${rows.length ? rows.map((row) => `- ${row}`).join('\n') : fallback}\n`;

    return [
        section('CHIEF COMPLAINTS:', complaints),
        section('HISTORY (SUMMARY):', history),
        section('EXAMINATION:', exam),
        section('DIAGNOSIS:', diagnosis),
        `MEDICATIONS:\n${meds.length ? meds.map((row, index) => `${index + 1}. ${row}`).join('\n') : '1. Medicine | Dose | Frequency | Duration | Timing/Instructions'}\n`,
        section('GENERAL ADVICE:', advice),
        section('PRECAUTIONS:', precautions),
        section('FOLLOW-UP:', followUp),
        section('DOCTOR NOTES:', notes),
    ].join('\n');
};

const hasMeaningfulPrescriptionDraft = (value: string): boolean => {
    const lines = String(value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const contentLines = lines.filter((line) => {
        const normalized = line.toLowerCase();
        if (normalized === '-') return false;
        if (normalized.endsWith(':')) return false;
        if (normalized.includes('medicine | dose | frequency | duration | timing/instructions')) return false;
        return true;
    });
    return contentLines.length > 0;
};

const appendMedicationLineToDraft = (draft: string, line: string): string => {
    const base = (draft || '').trim() || RX_TEMPLATE;
    const lines = base.split('\n');
    const medsHeaderIndex = lines.findIndex((row) => row.trim().toUpperCase() === 'MEDICATIONS:');
    if (medsHeaderIndex < 0) {
        return `${base}\n\nMEDICATIONS:\n1. ${line}`;
    }

    const nextSectionIndex = lines.findIndex((row, index) => index > medsHeaderIndex && /^[A-Z][A-Z\s()/-]+:$/.test(row.trim()));
    const start = lines.slice(0, medsHeaderIndex + 1);
    const medsBlock = lines.slice(
        medsHeaderIndex + 1,
        nextSectionIndex > -1 ? nextSectionIndex : lines.length
    );
    const end = nextSectionIndex > -1 ? lines.slice(nextSectionIndex) : [];

    const existingRows = medsBlock
        .map((row) => row.trim())
        .filter((row) =>
            row &&
            !row.includes('Medicine | Dose | Frequency | Duration | Timing/Instructions') &&
            /^\d+\./.test(row)
        );

    const nextNumber = existingRows.length + 1;
    const rebuiltMeds = [
        ...existingRows,
        `${nextNumber}. ${line}`,
    ];

    const duplicate = existingRows.some((row) => row.replace(/^\d+\.\s*/, '').toLowerCase() === line.toLowerCase());
    if (duplicate) return base;

    return [...start, ...rebuiltMeds, ...end].join('\n').replace(/\n{3,}/g, '\n\n');
};

const getSectionBounds = (lines: string[], sectionTitle: string): { headerIndex: number; nextSectionIndex: number } => {
    const headerIndex = lines.findIndex((row) => row.trim().toUpperCase() === sectionTitle.toUpperCase());
    if (headerIndex < 0) return { headerIndex: -1, nextSectionIndex: -1 };
    const nextSectionIndex = lines.findIndex((row, index) => index > headerIndex && /^[A-Z][A-Z\s()/-]+:$/.test(row.trim()));
    return { headerIndex, nextSectionIndex };
};

const appendBulletToSection = (draft: string, sectionTitle: string, bulletText: string): string => {
    const text = (bulletText || '').trim();
    if (!text) return draft;
    const base = (draft || '').trim() || RX_TEMPLATE;
    const lines = base.split('\n');
    const { headerIndex, nextSectionIndex } = getSectionBounds(lines, sectionTitle);
    if (headerIndex < 0) return `${base}\n\n${sectionTitle}\n- ${text}`;
    const start = lines.slice(0, headerIndex + 1);
    const block = lines.slice(headerIndex + 1, nextSectionIndex > -1 ? nextSectionIndex : lines.length);
    const end = nextSectionIndex > -1 ? lines.slice(nextSectionIndex) : [];
    const bullets = block
        .map((row) => row.trim())
        .filter((row) => row.startsWith('-'))
        .filter((row) => row !== '-');
    if (bullets.some((row) => row.replace(/^-\s*/, '').trim().toLowerCase() === text.toLowerCase())) return base;
    bullets.push(`- ${text}`);
    return [...start, ...bullets, ...end].join('\n').replace(/\n{3,}/g, '\n\n');
};

const removeLastMedicationLineFromDraft = (draft: string): string => {
    const base = (draft || '').trim() || RX_TEMPLATE;
    const lines = base.split('\n');
    const { headerIndex, nextSectionIndex } = getSectionBounds(lines, 'MEDICATIONS:');
    if (headerIndex < 0) return base;
    const start = lines.slice(0, headerIndex + 1);
    const block = lines.slice(headerIndex + 1, nextSectionIndex > -1 ? nextSectionIndex : lines.length);
    const end = nextSectionIndex > -1 ? lines.slice(nextSectionIndex) : [];
    const meds = block.map((row) => row.trim()).filter((row) => /^\d+\./.test(row));
    if (meds.length > 0) meds.pop();
    const rebuilt = meds.length ? meds : ['1. Medicine | Dose | Frequency | Duration | Timing/Instructions'];
    return [...start, ...rebuilt, ...end].join('\n').replace(/\n{3,}/g, '\n\n');
};

const mergeSpeechTranscript = (previous: string, latest: string): string => {
    const prev = normalizeSpacing(previous);
    const next = normalizeSpacing(latest);
    if (!next) return prev;
    if (!prev) return next;

    // Most engines send improved full hypothesis; prefer latest when it extends previous.
    if (next.startsWith(prev)) return next;
    if (prev.startsWith(next)) return prev;

    // If latest already contains previous tail context, trust latest.
    const prevTail = prev.split(' ').slice(-4).join(' ');
    if (prevTail && next.includes(prevTail)) return next;

    // Fallback append for segmented results.
    return `${prev} ${next}`.replace(/\s+/g, ' ').trim();
};

const RX_SPEECH_START_OPTIONS = {
    lang: 'en-IN',
    interimResults: true,
    maxAlternatives: 1,
    continuous: true,
    addsPunctuation: true,
    // Context hints improve medical term capture on supported engines.
    contextualStrings: [
        'paracetamol', 'azithromycin', 'amoxicillin', 'pantoprazole', 'rabeprazole',
        'cetirizine', 'levocetirizine', 'montelukast', 'dolo 650', 'pcm',
        'once daily', 'twice daily', 'three times daily', 'after food', 'before food',
        'SOS', 'OD', 'BD', 'TDS', 'follow up', 'red flag', 'bp', 'pulse',
    ],
};

const resolveChatAttachmentPathForOpen = (rawUrl?: string | null): { path: string | null; directUrl?: string } => {
    const value = String(rawUrl || '').trim();
    if (!value) return { path: null };
    if (/^https?:\/\//i.test(value) || /^file:\/\//i.test(value) || /^content:\/\//i.test(value)) {
        try {
            const parsed = new URL(value);
            const marker = ['/storage/v1/object/public/chat-attachments/', '/storage/v1/object/sign/chat-attachments/', '/storage/v1/object/authenticated/chat-attachments/']
                .find((prefix) => parsed.pathname.includes(prefix));
            if (marker) {
                const [, tail = ''] = parsed.pathname.split(marker);
                const path = decodeURIComponent(tail.split('/').filter(Boolean).join('/'));
                if (path) return { path, directUrl: value };
            }
            return { path: null, directUrl: value };
        } catch {
            return { path: null, directUrl: value };
        }
    }
    return { path: value };
};

const ensureOpenableAttachmentUrl = async (attachmentUrl?: string | null): Promise<string | null> => {
    const resolved = resolveChatAttachmentPathForOpen(attachmentUrl);
    if (resolved.directUrl && /^https?:\/\//i.test(resolved.directUrl)) return resolved.directUrl;
    if (!resolved.path) return null;
    const { data, error } = await supabase.storage
        .from('chat-attachments')
        .createSignedUrl(resolved.path, 60 * 30);
    if (error || !data?.signedUrl) {
        throw error || new Error('Could not generate secure file link.');
    }
    return data.signedUrl;
};

const openUrlCrossPlatform = async (url: string): Promise<void> => {
    const target = (url || '').trim();
    if (!target) throw new Error('missing_url');

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const opened = window.open(target, '_blank', 'noopener,noreferrer');
        if (!opened) {
            window.location.assign(target);
        }
        return;
    }

    const canOpen = await Linking.canOpenURL(target).catch(() => true);
    if (!canOpen) throw new Error('cannot_open_url');
    await Linking.openURL(target);
};

const downloadUrlCrossPlatform = async (url: string, fileName: string): Promise<void> => {
    const target = (url || '').trim();
    if (!target) throw new Error('missing_url');

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const anchor = document.createElement('a');
        anchor.href = target;
        anchor.download = fileName || 'report.pdf';
        anchor.rel = 'noopener noreferrer';
        anchor.target = '_blank';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        return;
    }

    await openUrlCrossPlatform(target);
};

const PiPView = ({ 
    callType, 
    callStatus, 
    remoteUid, 
    isJoined, 
    isCaller, 
    otherPartyName, 
    onMaximize, 
    onEndCall, 
    theme,
    RtcSurfaceView,
    isRemoteVideoMuted,
    headerAvatarUrl
}: any) => {
    const pan = useRef(new Animated.ValueXY({ x: 200, y: 150 })).current;

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                pan.extractOffset();
            },
            onPanResponderMove: Animated.event(
                [null, { dx: pan.x, dy: pan.y }],
                { useNativeDriver: false }
            ),
            onPanResponderRelease: () => {
                pan.flattenOffset();
            },
        })
    ).current;

    return (
        <Animated.View
            {...panResponder.panHandlers}
            style={[
                styles.pipContainer,
                {
                    transform: [{ translateX: pan.x }, { translateY: pan.y }],
                },
            ]}
        >
            <TouchableOpacity 
                activeOpacity={1} 
                onPress={onMaximize}
                style={StyleSheet.absoluteFill}
            >
                {callType === 'video' && remoteUid !== 0 && isJoined && RtcSurfaceView && !isRemoteVideoMuted ? (
                    <RtcSurfaceView
                        canvas={{ uid: remoteUid }}
                        style={StyleSheet.absoluteFill}
                    />
                ) : (
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#1A1A1A', justifyContent: 'center', alignItems: 'center' }]}>
                        {headerAvatarUrl && (
                            <Image source={{ uri: headerAvatarUrl }} style={[StyleSheet.absoluteFill, { opacity: 0.4 }]} blurRadius={8} />
                        )}
                        <View style={[styles.avatar, { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.tint + '40' }]}>
                            {headerAvatarUrl ? (
                                <Image source={{ uri: headerAvatarUrl }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                            ) : (
                                <Text style={{ color: theme.tint, fontWeight: 'bold' }}>{otherPartyName.charAt(0)}</Text>
                            )}
                        </View>
                    </View>
                )}
            </TouchableOpacity>

            <View style={styles.pipOverlay}>
                <TouchableOpacity onPress={onMaximize} style={styles.pipActionBtn}>
                    <Maximize2 size={16} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={onEndCall} style={[styles.pipActionBtn, { backgroundColor: '#FF3B30' }]}>
                    <X size={16} color="#fff" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );
};



const MessageItem = React.memo(({ msg, isMe, theme, otherPartyName, onLongPress, onImagePress }: any) => {
    const attachmentUri = msg.attachment_access_url || msg.attachment_url;
    const systemMessageSet = new Set([
        'Waiting for this message. This may take a while.',
        'Message unavailable. Please ask the sender to resend.',
        'Secure chat key was refreshed on this device. Please ask sender to resend this message.',
    ]);
    const isSystemMessage = typeof msg.text === 'string' && systemMessageSet.has(msg.text);
    const isEncryptedAttachment = (msg.type === 'image' || msg.type === 'file') && msg.is_encrypted && isSystemMessage;
    const assistantMarkdownStyles = React.useMemo(
        () => ({
            body: {
                color: isMe ? '#fff' : theme.text,
                fontSize: 16,
                lineHeight: 22,
            },
            paragraph: {
                marginTop: 0,
                marginBottom: 8,
            },
            heading1: {
                color: isMe ? '#fff' : theme.text,
                fontSize: 18,
                lineHeight: 24,
                fontWeight: '800' as const,
                marginTop: 2,
                marginBottom: 8,
            },
            heading2: {
                color: isMe ? '#fff' : theme.text,
                fontSize: 16,
                lineHeight: 22,
                fontWeight: '800' as const,
                marginTop: 2,
                marginBottom: 6,
            },
            heading3: {
                color: isMe ? '#fff' : theme.text,
                fontSize: 15,
                lineHeight: 21,
                fontWeight: '700' as const,
                marginTop: 2,
                marginBottom: 5,
            },
            strong: {
                color: isMe ? '#fff' : theme.text,
                fontWeight: '800' as const,
            },
            em: {
                color: isMe ? '#fff' : theme.text,
                fontStyle: 'italic' as const,
            },
            link: {
                color: isMe ? '#fff' : theme.tint,
                textDecorationLine: 'underline' as const,
            },
            bullet_list: {
                marginTop: 2,
                marginBottom: 8,
            },
            bullet_list_icon: {
                color: isMe ? 'rgba(255,255,255,0.8)' : theme.tint,
            },
            bullet_list_content: {
                color: isMe ? '#fff' : theme.text,
            },
            ordered_list: {
                marginTop: 2,
                marginBottom: 8,
            },
            ordered_list_icon: {
                color: isMe ? 'rgba(255,255,255,0.8)' : theme.tint,
            },
            ordered_list_content: {
                color: isMe ? '#fff' : theme.text,
            },
            list_item: {
                flexDirection: 'row' as const,
                alignItems: 'flex-start' as const,
                marginTop: 2,
                marginBottom: 2,
            },
            blockquote: {
                borderLeftWidth: 3,
                borderLeftColor: theme.tint,
                backgroundColor: isMe ? 'rgba(255,255,255,0.12)' : theme.tint + '12',
                paddingHorizontal: 10,
                paddingVertical: 8,
                marginTop: 4,
                marginBottom: 8,
            },
            code_inline: {
                color: isMe ? '#fff' : theme.text,
                backgroundColor: isMe ? 'rgba(255,255,255,0.12)' : theme.background,
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 2,
            },
            code_block: {
                color: isMe ? '#fff' : theme.text,
                backgroundColor: isMe ? 'rgba(255,255,255,0.12)' : theme.background,
                borderWidth: 1,
                borderColor: theme.borderColor,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 8,
                marginTop: 4,
                marginBottom: 8,
            },
            fence: {
                color: isMe ? '#fff' : theme.text,
                backgroundColor: isMe ? 'rgba(255,255,255,0.12)' : theme.background,
                borderWidth: 1,
                borderColor: theme.borderColor,
                borderRadius: 10,
                paddingHorizontal: 10,
                paddingVertical: 8,
                marginTop: 4,
                marginBottom: 8,
            },
            hr: {
                backgroundColor: theme.borderColor,
                height: 1,
                marginTop: 8,
                marginBottom: 8,
            },
        }),
        [isMe, theme]
    );

    if (isSystemMessage || isEncryptedAttachment) {
         const label = (msg.type === 'image')
             ? '🔒 📷 ' + msg.text
             : (msg.type === 'file')
                 ? '🔒 📄 ' + msg.text
                 : `🔒 ${msg.text}`;
         return (
             <View style={{ alignSelf: 'center', backgroundColor: theme.cardBackground, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, marginVertical: 8, maxWidth: '85%' }}>
                 <Text style={{ fontSize: 12, color: theme.textSecondary, textAlign: 'center', fontStyle: 'italic' }}>{label}</Text>
             </View>
         );
    }
    return (
        <TouchableOpacity onLongPress={() => onLongPress(msg)} delayLongPress={300} activeOpacity={0.9} style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage, { backgroundColor: isMe ? theme.tint : theme.cardBackground }]}>
            {msg.reply_to && (
                <View style={[styles.replyBubble, { backgroundColor: isMe ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.05)' }]}>
                    <Text style={[styles.replyText, { color: isMe ? 'rgba(255,255,255,0.7)' : theme.textSecondary }]} numberOfLines={1}>
                        <Text style={{fontWeight: 'bold'}}>{msg.reply_to.sender_id === msg.sender_id ? 'You' : otherPartyName}</Text>
                        {msg.reply_to.type === 'image' ? ' 📷 Photo' : `: ${msg.reply_to.text}`}
                    </Text>
                </View>
            )}
            {msg.type === 'image' && attachmentUri ? (
                <TouchableOpacity onPress={() => onImagePress(attachmentUri)}>
                    <Image source={{ uri: attachmentUri }} style={styles.messageImage} resizeMode="cover" />
                </TouchableOpacity>
            ) : null}
            {msg.type === 'file' && attachmentUri ? (
                <TouchableOpacity style={styles.fileAttachment} onPress={async () => {
                    try {
                        const openUrl = await ensureOpenableAttachmentUrl(attachmentUri);
                        if (!openUrl) {
                            Alert.alert('File unavailable', 'Secure file link is not ready yet. Please try again.');
                            return;
                        }
                        await openUrlCrossPlatform(openUrl);
                    } catch (error) {
                        console.warn("Couldn't resolve secure file URL", error);
                        Alert.alert('File unavailable', 'Could not prepare secure link. Please try again.');
                    }
                }}>
                    <FileText size={24} color={isMe ? '#fff' : theme.tint} />
                    <Text style={[styles.fileNameText, { color: isMe ? '#fff' : theme.tint }]} numberOfLines={1}>{msg.text || 'Document'}</Text>
                </TouchableOpacity>
            ) : null}
            {msg.type === 'text' && msg.text ? (
                isMe ? (
                    <Text style={[styles.messageText, { color: '#fff' }]}>{msg.text}</Text>
                ) : (
                    <Markdown style={assistantMarkdownStyles}>
                        {msg.text}
                    </Markdown>
                )
            ) : null}
            {msg.is_pending ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}><Text style={{ fontSize: 11, color: isMe ? 'rgba(255,255,255,0.75)' : theme.textSecondary }}>{msg.type === 'text' ? 'Sending...' : 'Uploading...'}</Text></View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', marginTop: 4, gap: 4 }}>
                <Text style={[styles.timeText, { color: isMe ? 'rgba(255,255,255,0.7)' : theme.textSecondary, marginTop: 0 }]}>{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
                {isMe && !msg.is_pending && (<CheckCheck size={14} color={msg.is_read ? "#34B7F1" : "rgba(255,255,255,0.7)"} />)}
            </View>
        </TouchableOpacity>
    );
}, (prevProps, nextProps) => {
    return prevProps.msg.id === nextProps.msg.id && prevProps.msg.is_read === nextProps.msg.is_read && prevProps.msg.is_pending === nextProps.msg.is_pending && prevProps.msg.text === nextProps.msg.text;
});

export default function ChatDetailScreen() {
    const router = useRouter();
    const queryClient = useQueryClient();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const { language } = useAppLanguage();
    const params = useLocalSearchParams<{ roomId: string; name: string; otherId: string; autoAccept?: string }>();
    const [roomId, setRoomId] = useState(params.roomId || '');
    const { autoAccept } = params;
    const otherId = params.otherId;
    const insets = useSafeAreaInsets();
    const { user } = useAuthContext();
    const flatListRef = useRef<FlatList>(null);
    const [isResolvingRoom, setIsResolvingRoom] = useState(!roomId && !!otherId);
    const [isCallMinimized, setIsCallMinimized] = useState(false);
    const [isTyping, setIsTyping] = useState(false);
    const [isHeaderAvatarBroken, setIsHeaderAvatarBroken] = useState(false);
    const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const typingChannelRef = useRef<any>(null);

    // Manual keyboard height tracking for Android (same behavior as AI Assistant chat).
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    useEffect(() => {
        if (Platform.OS !== 'android') return;
        const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
            if (e?.endCoordinates?.height >= 0) {
                setKeyboardHeight(e.endCoordinates.height);
            }
        });
        const hideSub = Keyboard.addListener('keyboardDidHide', () => {
            setKeyboardHeight(0);
        });
        return () => { showSub.remove(); hideSub.remove(); };
    }, []);

    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [replyingTo, setReplyingTo] = useState<any>(null);
    const [isRxVoiceModalVisible, setIsRxVoiceModalVisible] = useState(false);
    const [isRxReviewModalVisible, setIsRxReviewModalVisible] = useState(false);
    const [isRxListening, setIsRxListening] = useState(false);
    const [rxTranscript, setRxTranscript] = useState('');
    const [rxMedName, setRxMedName] = useState('');
    const [rxMedDose, setRxMedDose] = useState('');
    const [rxMedFrequency, setRxMedFrequency] = useState('BD');
    const [rxMedDuration, setRxMedDuration] = useState('');
    const [rxMedInstructions, setRxMedInstructions] = useState('');
    const [isRxMedicineFormOpen, setIsRxMedicineFormOpen] = useState(false);
    const [isRxSectionsFormOpen, setIsRxSectionsFormOpen] = useState(false);
    const [rxExpandedSection, setRxExpandedSection] = useState<string | null>(null);
    const rxListeningPulse = useRef(new Animated.Value(1)).current;

    const toggleRxSection = useCallback((section: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setRxExpandedSection((current) => current === section ? null : section);
    }, []);

    useEffect(() => {
        if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
            UIManager.setLayoutAnimationEnabledExperimental(true);
        }
    }, []);

    useEffect(() => {
        if (!isRxListening) {
            rxListeningPulse.stopAnimation();
            rxListeningPulse.setValue(1);
            return;
        }
        const pulse = Animated.loop(
            Animated.sequence([
                Animated.timing(rxListeningPulse, { toValue: 1.08, duration: 700, useNativeDriver: true }),
                Animated.timing(rxListeningPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
            ])
        );
        pulse.start();
        return () => pulse.stop();
    }, [isRxListening, rxListeningPulse]);
    const [rxSectionNotes, setRxSectionNotes] = useState({
        complaints: '',
        history: '',
        examination: '',
        diagnosis: '',
        advice: '',
        precautions: '',
        followUp: '',
    });
    const lastRxSpeechRef = useRef('');
    const rawRxSpeechRef = useRef('');
    const rxKeepListeningRef = useRef(false);
    const rxModalVisibleRef = useRef(false);
    const rxRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rxAiParseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const rxAiParseRequestRef = useRef(0);
    const [isRxAiParsing, setIsRxAiParsing] = useState(false);
    const [rxMedicineNeedsConfirmation, setRxMedicineNeedsConfirmation] = useState(false);

    const {
        data: messages = [],
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage
    } = useChatMessages(roomId, 40);
    const sendMessageMutation = useSendMessage();
    const sendPrescriptionPdfMutation = useSendPrescriptionPdfToChat();
    const { mutateAsync: parseDoctorPrescription } = useParseDoctorPrescription();
    const { mutate: markAsRead } = useMarkAsRead();
    const { data: allRooms = [] } = useChatRooms();
    const { isUserOnline } = usePresence();

    const currentRoom = allRooms.find(r => r.id === roomId);
    const headerAvatarUrl = isHeaderAvatarBroken ? null : getImageUrl(currentRoom?.other_party?.profilePicture);
    const targetOtherId = otherId || currentRoom?.other_party?.id;
    const isOnline = targetOtherId ? isUserOnline(targetOtherId) : false;
    const lastSeenAt = currentRoom?.other_party?.lastSeenAt;
    const isChatEnabled = currentRoom?.chat_enabled !== false;
    const chatDisabledReason = currentRoom?.chat_disabled_reason || 'Chat is disabled for this consultation window.';
    const isDoctorUser = String(user?.role || '').toLowerCase() === 'doctor';

    // Resolve name: use params.name if available, otherwise fetch from currentRoom
    const fallbackName = currentRoom?.other_party 
        ? getLocalizedDoctorName(
            {
                firstName: currentRoom.other_party.firstName,
                lastName: currentRoom.other_party.lastName,
            },
            language,
            { fallbackName: 'Chat' }
        )
        : 'Chat';
    const otherPartyName = getLocalizedDoctorName(
        { fullName: params.name || fallbackName },
        language,
        { fallbackName: 'Chat' }
    );

    useEffect(() => {
        setIsHeaderAvatarBroken(false);
    }, [currentRoom?.other_party?.profilePicture, roomId]);

    const prevIsOnlineRef = useRef(isOnline);
    useEffect(() => {
        // When user transitions from Online to Offline, refetch chat rooms to update last_seen_at
        if (prevIsOnlineRef.current && !isOnline && roomId) {
            queryClient.invalidateQueries({ queryKey: ['chat-rooms'] });
        }
        prevIsOnlineRef.current = isOnline;
    }, [isOnline, roomId, queryClient]);

    const getStatusText = () => {
        if (isOnline) return 'Online';
        if (!lastSeenAt) return '';

        const lastSeenDate = new Date(lastSeenAt);
        const now = new Date();
        
        // Normalize dates to midnight for accurate day comparison
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        
        const dateAtMidnight = new Date(lastSeenDate.getFullYear(), lastSeenDate.getMonth(), lastSeenDate.getDate());

        const timeStr = lastSeenDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        if (dateAtMidnight.getTime() === today.getTime()) {
            return `Last seen today at ${timeStr}`;
        } else if (dateAtMidnight.getTime() === yesterday.getTime()) {
            return `Last seen yesterday at ${timeStr}`;
        } else {
            return `Last seen on ${lastSeenDate.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${timeStr}`;
        }
    };

    const {
        startCall,
        callStatus,
        callType,
        isCaller,
        agoraToken,
        remoteUid,
        isJoined,
        acceptCall,
        endCall,
        declineCall,
        isAudioMuted,
        isVideoMuted,
        isRemoteVideoMuted,
        isSpeakerOn,
        toggleAudio,
        toggleVideo,
        toggleSpeaker,
    } = useCall(roomId);

    const hasLiveCall = callStatus === 'ringing' || callStatus === 'active';

    const handleBackNavigation = useCallback(() => {
        if (hasLiveCall) {
            Alert.alert(
                'Ongoing Call',
                'Please end the call before leaving this screen.',
                [{ text: 'OK', style: 'default' }]
            );
            return;
        }
        router.back();
    }, [hasLiveCall, router]);

    useEffect(() => {
        const { BackHandler } = require('react-native');
        const onBackPress = () => {
            if (hasLiveCall) {
                Alert.alert(
                    'Ongoing Call',
                    'Please end the call before leaving this screen.',
                    [{ text: 'OK', style: 'default' }]
                );
                return true;
            }
            router.back();
            return true;
        };

        const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
        return () => backHandler.remove();
    }, [hasLiveCall, router]);

    // Reset minimized state and dismiss keyboard when call status changes
    useEffect(() => {
        if (callStatus === 'idle' || callStatus === 'ended') {
            setIsCallMinimized(false);
        }
        if (callStatus !== 'idle') {
            Keyboard.dismiss();
        }
    }, [callStatus]);

    useFocusEffect(
        useCallback(() => {
            if (roomId) {
                markAsRead(roomId);
                setActiveRoomId(roomId);
            } else {
                setActiveRoomId(null);
            }

            return () => {
                setActiveRoomId(null);
            };
        }, [roomId, markAsRead])
    );

    // Continuously mark as read if new messages arrive while user is inside the chat
    useEffect(() => {
        if (roomId && messages.length > 0) {
            const hasUnreadFromOther = messages.some(m => !m.is_read && m.sender_id !== user?.id);
            if (hasUnreadFromOther) {
                markAsRead(roomId);
            }
        }
    }, [messages, roomId, user?.id]);

    useEffect(() => {
        // Resolve logic handled by resolveRoom effect below
        if (roomId) {
            console.log('Chat Detail: roomId available:', roomId);
        } else if (!otherId) {
            console.warn('Chat Detail: Both roomId and otherId are missing');
        }
    }, [roomId, otherId]);

    useEffect(() => {
        if (!roomId || !user) return;
        
        // Setup typing broadcast channel
        const channel = supabase.channel(`typing:${roomId}`);
        typingChannelRef.current = channel;
        
        channel
            .on('broadcast', { event: 'typing' }, (payload) => {
                if (payload.payload.user_id !== user.id) {
                    setIsTyping(true);
                    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
                    typingTimeoutRef.current = setTimeout(() => {
                        setIsTyping(false);
                    }, 3000);
                }
            })
            .subscribe();
            
        return () => {
            supabase.removeChannel(channel);
            typingChannelRef.current = null;
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
        }
    }, [roomId, user]);

    const clearRxRestartTimer = useCallback(() => {
        if (rxRestartTimerRef.current) {
            clearTimeout(rxRestartTimerRef.current);
            rxRestartTimerRef.current = null;
        }
    }, []);

    const stopRxVoiceCapture = useCallback((keepTranscript = true) => {
        rxKeepListeningRef.current = false;
        // Invalidate any parser response that is still in flight. A late AI
        // response must never overwrite the doctor's reviewed draft.
        rxAiParseRequestRef.current += 1;
        setIsRxAiParsing(false);
        clearRxRestartTimer();
        if (rxAiParseTimerRef.current) {
            clearTimeout(rxAiParseTimerRef.current);
            rxAiParseTimerRef.current = null;
        }
        try {
            ExpoSpeechRecognitionModule?.stop?.();
        } catch {
            // no-op
        }
        setIsRxListening(false);
        if (!keepTranscript) {
            setRxTranscript('');
            lastRxSpeechRef.current = '';
            rawRxSpeechRef.current = '';
        }
    }, [clearRxRestartTimer]);

    const startRxVoiceCapture = useCallback(async () => {
        if (!isDoctorUser) return;
        if (!ExpoSpeechRecognitionModule || !ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
            Alert.alert(
                'Voice unavailable',
                'Voice recognition needs a dev build with expo-speech-recognition.'
            );
            return;
        }

        const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!permission?.granted) {
            Alert.alert('Permission denied', 'Please allow microphone access.');
            return;
        }

        rxKeepListeningRef.current = true;
        clearRxRestartTimer();
        setIsRxListening(true);
        try {
            ExpoSpeechRecognitionModule.start(RX_SPEECH_START_OPTIONS);
        } catch (error: any) {
            rxKeepListeningRef.current = false;
            setIsRxListening(false);
            Toast.show({
                type: 'error',
                text1: 'Voice input error',
                text2: error?.message || 'Could not start voice input.',
            });
        }
    }, [clearRxRestartTimer, isDoctorUser]);

    useEffect(() => {
        rxModalVisibleRef.current = isRxVoiceModalVisible;
        if (!isRxVoiceModalVisible) {
            stopRxVoiceCapture(true);
        }
    }, [isRxVoiceModalVisible, stopRxVoiceCapture]);

    useEffect(() => {
        if (!ExpoSpeechRecognitionModule?.addListener) return;

        const resultSub = ExpoSpeechRecognitionModule.addListener('result', (event: any) => {
            const transcript = extractSpeechText(event);
            if (!transcript) return;
            const mergedRaw = mergeSpeechTranscript(rawRxSpeechRef.current, transcript);
            rawRxSpeechRef.current = mergedRaw;
            const next = buildStructuredPrescriptionDraft(mergedRaw);
            lastRxSpeechRef.current = next;
            setRxTranscript(next);
            // Any new dictation invalidates the previous medicine review until
            // the latest parse completes.
            setRxMedicineNeedsConfirmation(true);
            if (mergedRaw.length >= 12) {
                if (rxAiParseTimerRef.current) clearTimeout(rxAiParseTimerRef.current);
                const requestId = ++rxAiParseRequestRef.current;
                setIsRxAiParsing(true);
                rxAiParseTimerRef.current = setTimeout(() => {
                    rxAiParseTimerRef.current = null;
                    void parseDoctorPrescription({ doctorText: mergedRaw }).then((parsed) => {
                        if (requestId !== rxAiParseRequestRef.current || rawRxSpeechRef.current !== mergedRaw) return;
                        const aiDraft = buildStructuredPrescriptionDraft(mergedRaw, parsed.clinical_summary, parsed.medicines);
                        lastRxSpeechRef.current = aiDraft;
                        setRxTranscript(aiDraft);
                        setRxMedicineNeedsConfirmation(
                            Array.isArray(parsed?.medicines) && parsed.medicines.some((medicine: any) => medicine?.doctor_confirmation_required)
                        );
                    }).catch(() => {
                        // Local section routing remains available when the AI
                        // parser is slow or temporarily unavailable, but the
                        // final PDF must require an explicit doctor review.
                        if (requestId === rxAiParseRequestRef.current && rawRxSpeechRef.current === mergedRaw) {
                            setRxMedicineNeedsConfirmation(true);
                        }
                    }).finally(() => {
                        if (requestId === rxAiParseRequestRef.current) setIsRxAiParsing(false);
                    });
                }, 900);
            }
        });

        const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
            setIsRxListening(false);
            if (!rxKeepListeningRef.current || !rxModalVisibleRef.current) return;
            clearRxRestartTimer();
            rxRestartTimerRef.current = setTimeout(() => {
                rxRestartTimerRef.current = null;
                if (!rxKeepListeningRef.current || !rxModalVisibleRef.current) return;
                try {
                    ExpoSpeechRecognitionModule.start(RX_SPEECH_START_OPTIONS);
                    setIsRxListening(true);
                } catch {
                    rxKeepListeningRef.current = false;
                    setIsRxListening(false);
                }
            }, 250);
        });
        const errorSub = ExpoSpeechRecognitionModule.addListener('error', (event: any) => {
            setIsRxListening(false);
            const message = String(event?.message || event?.error || '').trim();
            const normalizedMessage = message.toLowerCase();
            const nonRecoverable =
                normalizedMessage.includes('permission') ||
                normalizedMessage.includes('not allowed') ||
                normalizedMessage.includes('service unavailable');
            rxKeepListeningRef.current = false;
            Toast.show({
                type: 'error',
                text1: 'Voice input error',
                text2: nonRecoverable
                    ? (message || 'Could not capture voice input.')
                    : 'Listening stopped. Tap Start to continue.',
            });
        });

        return () => {
            clearRxRestartTimer();
            resultSub?.remove?.();
            endSub?.remove?.();
            errorSub?.remove?.();
        };
    }, [clearRxRestartTimer, parseDoctorPrescription]);


    const handleAcceptCall = useCallback(async () => {
        try {
            await acceptCall();
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Call Error',
                text2: error?.message || 'Could not accept the call.',
            });
        }
    }, [acceptCall]);

    useEffect(() => {
        // Auto-accept call if triggered from notification
        if (autoAccept === 'true' && callStatus === 'ringing' && !isCaller) {
            console.log('Auto-accepting call from notification param');
            void handleAcceptCall();
        }
    }, [autoAccept, callStatus, handleAcceptCall, isCaller]);

    // Removed the scrollToEnd manual hack since FlatList inverted handles layout anchors natively.

    const { mutateAsync: getRoom } = useGetOrCreateRoom();

    useEffect(() => {
        const resolveRoomId = async () => {
            if (!roomId && otherId && user) {
                console.log('Resolving room for otherId:', otherId);
                setIsResolvingRoom(true);
                try {
                    const isDoctor = String(user.role || '').toLowerCase() === 'doctor';
                    const patientId = isDoctor ? otherId : user.id;
                    const doctorId = isDoctor ? user.id : otherId;

                    const newRoomId = await getRoom({ doctorId, patientId });
                    if (newRoomId) {
                        setRoomId(newRoomId);
                    }
                } catch (error) {
                    console.error('Room resolution failed:', error);
                    Toast.show({
                        type: 'error',
                        text1: 'Chat Error',
                        text2: 'Could not connect to the chat room.',
                    });
                } finally {
                    setIsResolvingRoom(false);
                }
            }
        };
        resolveRoomId();
    }, [roomId, otherId, user]);


    const { isUploading, pickImage, pickDocument } = useFileTransfer();

    const [inputText, setInputText] = useState('');

    const handleTyping = (text: string) => {
        setInputText(text);
        if (text.length > 0 && roomId && user && typingChannelRef.current) {
            typingChannelRef.current.send({
                type: 'broadcast',
                event: 'typing',
                payload: { user_id: user.id },
            }).catch((err: any) => console.log('Typing broadcast error (ignored):', err));
        }
    };



    const handleSend = async () => {
        if (!inputText.trim() || !roomId) return;
        if (!isChatEnabled) {
            Alert.alert('Chat disabled', chatDisabledReason);
            return;
        }
        const text = inputText.trim();
        setInputText('');
        
        const currentReplyId = replyingTo?.id;
        setReplyingTo(null);

        try {
            await sendMessageMutation.mutateAsync({ roomId, text, replyToId: currentReplyId });
        } catch (error: any) {
            console.error('Failed to send message:', error);
            const errorMsg = error.message || JSON.stringify(error);
            import('react-native').then(({ Alert }) => {
                Alert.alert('Send Error', errorMsg);
            });
        }
    };

    const handleDoctorPrescriptionSend = async () => {
        if (!isDoctorUser) return;
        if (!roomId) return;
        if (!isChatEnabled) {
            Alert.alert('Chat disabled', chatDisabledReason);
            return;
        }

        const doctorText = inputText.trim();
        if (!doctorText) {
            Alert.alert('Prescription required', 'Please speak or type prescription text first.');
            return;
        }

        try {
            const result = await sendPrescriptionPdfMutation.mutateAsync({
                roomId,
                doctorText,
                patientName: currentRoom?.other_party
                    ? `${currentRoom.other_party.firstName || ''} ${currentRoom.other_party.lastName || ''}`.trim()
                    : undefined,
            });
            setInputText('');
            Toast.show({
                type: 'success',
                text1: 'Prescription sent',
                text2: 'Prescription PDF shared in chat.',
            });
            const sentPath = typeof result?.attachmentPath === 'string' ? result.attachmentPath : '';
            if (sentPath) {
                const openUrl = await ensureOpenableAttachmentUrl(sentPath);
                if (openUrl) {
                    const safeDownloadName = `${(currentRoom?.other_party?.firstName || 'patient').trim() || 'patient'}-prescription.pdf`;
                    const downloadUrl = `${openUrl}${openUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(safeDownloadName)}`;
                    Alert.alert('Prescription PDF', 'PDF sent successfully. Open now?', [
                        { text: 'Open', onPress: () => void openUrlCrossPlatform(openUrl) },
                        { text: 'Download', onPress: () => void downloadUrlCrossPlatform(downloadUrl, safeDownloadName) },
                        { text: 'Later', style: 'cancel' },
                    ]);
                }
            }
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Prescription failed',
                text2: error?.message || 'Could not generate prescription PDF.',
            });
        }
    };

    const handleRxVoiceStart = async () => {
        await startRxVoiceCapture();
    };

    const handleRxVoiceStop = () => {
        stopRxVoiceCapture(true);
    };

    const handleAddMedicationFromForm = () => {
        const name = rxMedName.trim();
        if (!name) {
            Alert.alert('Medicine name required', 'Please enter medicine name first.');
            return;
        }
        const dose = rxMedDose.trim() || '-';
        const frequency = rxMedFrequency.trim() || '-';
        const duration = rxMedDuration.trim() || '-';
        const instructions = rxMedInstructions.trim() || '-';
        const line = `${name} | ${dose} | ${frequency} | ${duration} | ${instructions}`;
        const nextDraft = appendMedicationLineToDraft(rxTranscript, line);
        setRxTranscript(nextDraft);
        lastRxSpeechRef.current = nextDraft;
        rawRxSpeechRef.current = nextDraft;
        setRxMedicineNeedsConfirmation(false);
        setRxMedName('');
        setRxMedDose('');
        setRxMedFrequency('BD');
        setRxMedDuration('');
        setRxMedInstructions('');
    };

    const handleApplySectionNotes = () => {
        let nextDraft = rxTranscript || RX_TEMPLATE;
        const mapping: Array<{ key: keyof typeof rxSectionNotes; title: string }> = [
            { key: 'complaints', title: 'CHIEF COMPLAINTS:' },
            { key: 'history', title: 'HISTORY (SUMMARY):' },
            { key: 'examination', title: 'EXAMINATION:' },
            { key: 'diagnosis', title: 'DIAGNOSIS:' },
            { key: 'advice', title: 'GENERAL ADVICE:' },
            { key: 'precautions', title: 'PRECAUTIONS:' },
            { key: 'followUp', title: 'FOLLOW-UP:' },
        ];
        mapping.forEach(({ key, title }) => {
            const value = rxSectionNotes[key].trim();
            if (!value) return;
            nextDraft = appendBulletToSection(nextDraft, title, value);
        });
        setRxTranscript(nextDraft);
        lastRxSpeechRef.current = nextDraft;
        rawRxSpeechRef.current = nextDraft;
        setRxMedicineNeedsConfirmation(false);
        setRxSectionNotes({
            complaints: '',
            history: '',
            examination: '',
            diagnosis: '',
            advice: '',
            precautions: '',
            followUp: '',
        });
    };

    const handleSendVoicePrescriptionPdf = () => {
        if (!roomId || !isDoctorUser) return;
        if (!isChatEnabled) {
            Alert.alert('Chat disabled', chatDisabledReason);
            return;
        }
        if (!hasMeaningfulPrescriptionDraft(rxTranscript.trim())) {
            Alert.alert('Prescription required', 'Please speak or type prescription first.');
            return;
        }
        if (isRxAiParsing) {
            Alert.alert('Analysis in progress', 'Please wait for medicine analysis to finish, then review the draft before sending.');
            return;
        }
        if (isRxListening) stopRxVoiceCapture(true);
        setIsRxReviewModalVisible(true);
    };

    const handleConfirmSendVoicePrescriptionPdf = async () => {
        if (!roomId || !isDoctorUser) return;
        if (!isChatEnabled) {
            Alert.alert('Chat disabled', chatDisabledReason);
            return;
        }
        const doctorText = rxTranscript.trim();
        if (!hasMeaningfulPrescriptionDraft(doctorText)) {
            Alert.alert('Prescription required', 'Please speak prescription first.');
            return;
        }
        if (isRxAiParsing) {
            Alert.alert('Analysis in progress', 'Please wait for medicine analysis to finish, then review the draft before sending.');
            return;
        }
        if (rxMedicineNeedsConfirmation) {
            Alert.alert(
                'Review medicine name',
                'AI verification is incomplete or a medicine may be a speech variant. Please verify or edit every medicine name and detail, then confirm before sending the PDF.'
            );
            return;
        }
        if (isRxListening) stopRxVoiceCapture(true);
        // Freeze the reviewed draft while the final PDF is being generated.
        rxAiParseRequestRef.current += 1;
        setIsRxAiParsing(false);
        try {
            const result = await sendPrescriptionPdfMutation.mutateAsync({
                roomId,
                doctorText,
                medicineConfirmationPending: rxMedicineNeedsConfirmation,
                patientName: currentRoom?.other_party
                    ? `${currentRoom.other_party.firstName || ''} ${currentRoom.other_party.lastName || ''}`.trim()
                    : undefined,
            });
            setRxTranscript('');
            lastRxSpeechRef.current = '';
            setIsRxVoiceModalVisible(false);
            setIsRxReviewModalVisible(false);
            Toast.show({
                type: 'success',
                text1: 'Prescription sent',
                text2: 'Voice prescription PDF shared with patient.',
            });
            const sentPath = typeof result?.attachmentPath === 'string' ? result.attachmentPath : '';
            if (sentPath) {
                const openUrl = await ensureOpenableAttachmentUrl(sentPath);
                if (openUrl) {
                    const safeDownloadName = `${(currentRoom?.other_party?.firstName || 'patient').trim() || 'patient'}-prescription.pdf`;
                    const downloadUrl = `${openUrl}${openUrl.includes('?') ? '&' : '?'}download=${encodeURIComponent(safeDownloadName)}`;
                    Alert.alert('Prescription PDF', 'PDF sent successfully. Open now?', [
                        { text: 'Open', onPress: () => void openUrlCrossPlatform(openUrl) },
                        { text: 'Download', onPress: () => void downloadUrlCrossPlatform(downloadUrl, safeDownloadName) },
                        { text: 'Later', style: 'cancel' },
                    ]);
                }
            }
        } catch (error: any) {
            Toast.show({
                type: 'error',
                text1: 'Prescription failed',
                text2: error?.message || 'Could not generate prescription PDF.',
            });
        }
    };

    const handleStartCall = async (type: 'audio' | 'video') => {
        console.log('handleStartCall called:', type, 'roomId:', roomId);
        if (!isChatEnabled) {
            Alert.alert('Consultation window closed', chatDisabledReason);
            return;
        }
        if (!roomId) {
            import('react-native').then(({ Alert }) => {
                Alert.alert('Error', 'Room ID is missing');
            });
            return;
        }
        try {
            await startCall(type);
        } catch (error: any) {
            console.error('Failed to start call:', error);
            const errorMsg = error.message || JSON.stringify(error);
            import('react-native').then(({ Alert }) => {
                Alert.alert('Call Error', errorMsg);
            });
        }
    };


    const handlePickFile = () => {
        if (!isChatEnabled) {
            Alert.alert('Chat disabled', chatDisabledReason);
            return;
        }
        Alert.alert('Send Attachment', 'Choose attachment type', [
            { 
                text: 'Photo/Image', 
                onPress: async () => {
                    try { await pickImage(roomId); } 
                    catch (error: any) {
                        const message = typeof error?.message === 'string' && error.message.trim()
                            ? error.message.trim()
                            : 'Failed to send image. Please try again.';
                        console.warn('Image upload skipped:', message);
                        Alert.alert('Upload Error', message);
                    }
                }
            },
            {
                text: 'Document (PDF, Word, etc.)', 
                onPress: async () => {
                    try { await pickDocument(roomId); } 
                    catch (error: any) {
                        const message = typeof error?.message === 'string' && error.message.trim()
                            ? error.message.trim()
                            : 'Failed to send document. Please try again.';
                        console.warn('Document upload skipped:', message);
                        Alert.alert('Upload Error', message);
                    }
                }
            },
            { text: 'Cancel', style: 'cancel' }
        ]);
    };

    const handleLongPress = useCallback((msg: any) => {
        Alert.alert('Message Options', '', [
            { text: 'Reply', onPress: () => setReplyingTo(msg) },
            { text: 'Cancel', style: 'cancel' }
        ]);
    }, []);

    const renderMessageItem = useCallback(({ item }: { item: any }) => {
        const isMe = item.sender_id === user?.id;
        return (
            <MessageItem 
                msg={item}
                isMe={isMe}
                theme={theme}
                otherPartyName={otherPartyName}
                onLongPress={handleLongPress}
                onImagePress={setSelectedImage}
            />
        );
    }, [user?.id, theme, otherPartyName, handleLongPress]);

    // On Android, use a plain View with manual keyboard padding
    // On iOS, use KeyboardAvoidingView with padding behavior
    const Wrapper = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
    const wrapperProps = Platform.OS === 'ios' ? { behavior: 'padding' as const, keyboardVerticalOffset: 0 } : {};

    return (
        <Wrapper
            style={[styles.container, { backgroundColor: theme.background, paddingBottom: Platform.OS === 'android' ? (keyboardHeight > 0 ? keyboardHeight + 2 : 0) : 0 }]}
            {...wrapperProps}
        >
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: theme.borderColor, paddingTop: insets.top, height: 60 + insets.top }]}>
                <TouchableOpacity style={styles.backButton} onPress={handleBackNavigation}>
                    <ArrowLeft size={24} color={theme.text} />
                </TouchableOpacity>

                <TouchableOpacity 
                    style={styles.headerInfo} 
                    onPress={() => targetOtherId && router.push(`/user/${targetOtherId}` as any)}
                    activeOpacity={0.7}
                >
                    <View style={[styles.avatar, { backgroundColor: theme.tint + '20' }]}>
                        {headerAvatarUrl ? (
                            <Image
                                source={{ uri: headerAvatarUrl }}
                                style={styles.avatarImage}
                                onError={() => setIsHeaderAvatarBroken(true)}
                            />
                        ) : (
                            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.tint }}>
                                {otherPartyName.charAt(0)}
                            </Text>
                        )}
                    </View>
                    <View style={{ marginLeft: 12, flex: 1 }}>
                        <Text style={[styles.name, { color: theme.text, fontSize: 18, fontWeight: 'bold' }]} numberOfLines={1}>
                            {otherPartyName}
                        </Text>
                        <Text style={[styles.status, { color: theme.textSecondary, fontSize: 12 }]} numberOfLines={1}>
                            {isResolvingRoom ? 'Connecting...' : (isTyping ? <Text style={{color: theme.tint}}>typing...</Text> : getStatusText())}
                        </Text>
                    </View>
                </TouchableOpacity>

                <View style={{ flexDirection: 'row', gap: 16 }}>
                    {isDoctorUser && (
                        <TouchableOpacity
                            onPress={() => {
                                lastRxSpeechRef.current = '';
                                rawRxSpeechRef.current = '';
                                // Show the structured fields immediately so
                                // the doctor knows exactly what will be sent.
                                // The draft stays non-sendable until real notes are added.
                                setRxTranscript(RX_TEMPLATE);
                                setRxMedicineNeedsConfirmation(false);
                                setIsRxSectionsFormOpen(false);
                                setRxExpandedSection(null);
                                setIsRxMedicineFormOpen(false);
                                setRxSectionNotes({
                                    complaints: '',
                                    history: '',
                                    examination: '',
                                    diagnosis: '',
                                    advice: '',
                                    precautions: '',
                                    followUp: '',
                                });
                                setIsRxVoiceModalVisible(true);
                            }}
                            disabled={!isChatEnabled}
                            style={{ opacity: isChatEnabled ? 1 : 0.45 }}
                        >
                            <Mic size={22} color={theme.tint} />
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => handleStartCall('video')} disabled={!isChatEnabled} style={{ opacity: isChatEnabled ? 1 : 0.45 }}>
                        <Video size={24} color={theme.tint} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleStartCall('audio')} disabled={!isChatEnabled} style={{ opacity: isChatEnabled ? 1 : 0.45 }}>
                        <Phone size={22} color={theme.tint} />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Messages */}
            {isResolvingRoom ? (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={theme.tint} />
                    <Text style={{ marginTop: 10, color: theme.textSecondary }}>Setting up chat...</Text>
                </View>
            ) : (
                <View style={{ flex: 1 }}>
                    {messages.length === 0 && !isLoading ? (
                        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
                            <MessageCircle size={48} color={theme.textSecondary} style={{ opacity: 0.3, marginBottom: 16 }} />
                            <Text style={{ fontSize: 16, fontWeight: '600', color: theme.textSecondary, textAlign: 'center' }}>
                                No messages yet
                            </Text>
                            <Text style={{ fontSize: 14, color: theme.textSecondary, textAlign: 'center', marginTop: 8, opacity: 0.7 }}>
                                Start a conversation with {otherPartyName || 'this doctor'}!
                            </Text>
                        </View>
                    ) : (
                        <FlatList
                            ref={flatListRef}
                            inverted
                            style={{ flex: 1 }}
                            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 32, flexGrow: 1 }}
                            data={messages}
                            keyExtractor={(item) => item.id}
                            renderItem={renderMessageItem}
                            removeClippedSubviews={Platform.OS === 'android'}
                            initialNumToRender={15}
                            maxToRenderPerBatch={10}
                            windowSize={10}
                            showsVerticalScrollIndicator={false}
                            onEndReached={() => {
                                if (!isLoading && hasNextPage && !isFetchingNextPage) {
                                    fetchNextPage();
                                }
                            }}
                            onEndReachedThreshold={0.5}
                            ListFooterComponent={() => (
                                isFetchingNextPage ? (
                                    <ActivityIndicator size="small" color={theme.tint} style={{ marginBottom: 10, marginTop: 10 }} />
                                ) : null
                            )}
                        />
                    )}
                </View>
            )}

            {!isResolvingRoom && !isChatEnabled && (
                <View style={{
                    marginHorizontal: 16,
                    marginBottom: 8,
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: theme.cardBackground,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderColor: theme.borderColor,
                }}>
                    <Text style={{ color: theme.textSecondary, fontSize: 12 }}>{chatDisabledReason}</Text>
                </View>
            )}

            {/* Reply Preview Bar */}
            {replyingTo && (
                <View style={[styles.replyPreviewBar, { backgroundColor: theme.cardBackground, borderTopColor: theme.borderColor }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12, color: theme.tint, fontWeight: 'bold', marginBottom: 2 }}>
                            Replying to {replyingTo.sender_id === user?.id ? 'Yourself' : otherPartyName}
                        </Text>
                        <Text style={{ fontSize: 14, color: theme.textSecondary }} numberOfLines={1}>
                            {replyingTo.type === 'image' ? '📷 Photo' : replyingTo.text}
                        </Text>
                    </View>
                    <TouchableOpacity onPress={() => setReplyingTo(null)} style={{ padding: 4 }}>
                        <X size={20} color={theme.textSecondary} />
                    </TouchableOpacity>
                </View>
            )}


            {/* Input Area */}
            <View style={[
                styles.inputContainer,
                {
                    backgroundColor: theme.cardBackground,
                    borderTopColor: theme.borderColor,
                    paddingBottom: Math.max(insets.bottom, Platform.OS === 'ios' ? 20 : 12),
                    paddingTop: 8
                }
            ]}>
                <TouchableOpacity
                    style={styles.iconButton}
                    onPress={handlePickFile}
                    disabled={isUploading || !isChatEnabled}
                >
                    {isUploading ? (
                        <ActivityIndicator size="small" color={theme.tint} />
                    ) : (
                        <Paperclip size={22} color={isChatEnabled ? theme.textSecondary : theme.borderColor} />
                    )}
                </TouchableOpacity>
                <TextInput
                    style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                    placeholder={isChatEnabled ? "Type a message..." : "Chat disabled"}
                    placeholderTextColor={theme.textSecondary}
                    value={inputText}
                    onChangeText={handleTyping}
                    multiline
                    editable={isChatEnabled}
                />
                <TouchableOpacity
                    onPress={handleSend}
                    style={[styles.sendButton, { backgroundColor: (inputText.trim() && isChatEnabled) ? theme.tint : theme.borderColor }]}
                    disabled={!inputText.trim() || !isChatEnabled}
                >
                    <Send size={18} color="#fff" />
                </TouchableOpacity>
            </View>

            {/* Call Overlay */}
            {callStatus !== 'idle' && !isCallMinimized && (
                <View style={[StyleSheet.absoluteFill, styles.callOverlay, { backgroundColor: '#000' }]}>
                    {headerAvatarUrl && (
                        <Image 
                            source={{ uri: headerAvatarUrl }} 
                            style={[StyleSheet.absoluteFill, { opacity: 0.35 }]} 
                            blurRadius={15} 
                        />
                    )}
                    {/* Minimize Button */}
                    <TouchableOpacity 
                        style={[styles.minimizeButton, { top: insets.top + 10 }]} 
                        onPress={() => setIsCallMinimized(true)}
                    >
                        <ChevronRight size={28} color="#fff" style={{ transform: [{ rotate: '90deg' }] }} />
                    </TouchableOpacity>

                    {callStatus === 'active' && isJoined ? (
                        <View style={StyleSheet.absoluteFill}>
                            {/* Remote Video (Full Screen) */}
                            {remoteUid !== 0 && callType === 'video' && !isRemoteVideoMuted ? (
                                RtcSurfaceView ? (
                                    <RtcSurfaceView
                                        canvas={{ uid: remoteUid }}
                                        style={StyleSheet.absoluteFill}
                                    />
                                ) : (
                                    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#222', justifyContent: 'center', alignItems: 'center' }]}>
                                        <Text style={{ color: '#fff' }}>Remote Video (SDK not available)</Text>
                                    </View>
                                )
                            ) : (
                                <View style={[StyleSheet.absoluteFill, styles.callContent, { justifyContent: 'center' }]}>
                                    <View style={styles.callAvatarLarge}>
                                        {headerAvatarUrl ? (
                                            <Image source={{ uri: headerAvatarUrl }} style={{ width: 120, height: 120, borderRadius: 60 }} />
                                        ) : (
                                            <Text style={styles.callAvatarTextLarge}>{otherPartyName.charAt(0)}</Text>
                                        )}
                                    </View>
                                    <Text style={styles.callNameLarge}>{otherPartyName}</Text>
                                    <Text style={styles.callStatusText}>
                                        {callStatus === 'active' 
                                            ? (callType === 'audio' ? 'Audio Call Active' : 'Remote Camera Off') 
                                            : 'Connecting stream...'}
                                    </Text>
                                </View>
                            )}

                            {/* Local Video (Floating Window) */}
                            {callType === 'video' && (
                                <View style={styles.localVideoContainer}>
                                    {RtcTextureView && !isVideoMuted ? (
                                        <RtcTextureView
                                            canvas={{ uid: 0 }}
                                            style={styles.localVideo}
                                        />
                                    ) : (
                                        <View style={[styles.localVideo, { backgroundColor: '#444', justifyContent: 'center', alignItems: 'center' }]}>
                                            <Text style={{ color: '#fff', fontSize: 10 }}>Camera Off</Text>
                                        </View>
                                    )}
                                </View>
                            )}
                        </View>
                    ) : (
                        <View style={styles.callContent}>
                            <View style={styles.callAvatarLarge}>
                                {headerAvatarUrl ? (
                                    <Image source={{ uri: headerAvatarUrl }} style={{ width: 120, height: 120, borderRadius: 60 }} />
                                ) : (
                                    <Text style={styles.callAvatarTextLarge}>{otherPartyName.charAt(0)}</Text>
                                )}
                            </View>
                            <Text style={styles.callNameLarge}>{otherPartyName}</Text>

                            {callStatus === 'ringing' && (
                                <Text style={styles.callStatusText}>
                                    {callType === 'video' ? 'Video Calling...' : 'Audio Calling...'}
                                </Text>
                            )}
                            {callStatus === 'declined' && (
                                <Text style={[styles.callStatusText, { color: theme.error }]}>Call Declined</Text>
                            )}
                            {callStatus === 'ended' && (
                                <Text style={[styles.callStatusText, { color: theme.textSecondary }]}>Call Ended</Text>
                            )}
                        </View>
                    )}

                    <View style={styles.callActions}>
                        {callStatus === 'ringing' && !isCaller && (
                            <View style={{ flexDirection: 'row', gap: 40 }}>
                                <TouchableOpacity onPress={declineCall} style={[styles.callActionButton, { backgroundColor: theme.error }]}>
                                    <X size={32} color="#fff" />
                                </TouchableOpacity>
                                <TouchableOpacity onPress={handleAcceptCall} style={[styles.callActionButton, { backgroundColor: theme.success }]}>
                                    {callType === 'video' ? (
                                        <Video size={32} color="#fff" />
                                    ) : (
                                        <Phone size={32} color="#fff" />
                                    )}
                                </TouchableOpacity>
                            </View>
                        )}
                        {(callStatus === 'active' || (callStatus === 'ringing' && isCaller)) && (
                            <View style={styles.activeCallControls}>
                                {callType === 'video' && callStatus === 'active' && (
                                    <TouchableOpacity onPress={toggleVideo} style={[styles.controlButton, isVideoMuted && styles.controlButtonActive]}>
                                        {isVideoMuted ? <VideoOff size={24} color="#fff" /> : <Video size={24} color="#fff" />}
                                    </TouchableOpacity>
                                )}
                                
                                {callStatus === 'active' && (
                                    <TouchableOpacity onPress={toggleAudio} style={[styles.controlButton, isAudioMuted && styles.controlButtonActive]}>
                                        {isAudioMuted ? <MicOff size={24} color="#fff" /> : <Mic size={24} color="#fff" />}
                                    </TouchableOpacity>
                                )}

                                <TouchableOpacity onPress={endCall} style={[styles.callActionButton, { backgroundColor: theme.error }]}>
                                    <X size={32} color="#fff" />
                                </TouchableOpacity>

                                {callStatus === 'active' && (
                                    <TouchableOpacity onPress={toggleSpeaker} style={[styles.controlButton, !isSpeakerOn && styles.controlButtonActive]}>
                                        {isSpeakerOn ? <Volume2 size={24} color="#fff" /> : <VolumeX size={24} color="#fff" />}
                                    </TouchableOpacity>
                                )}
                            </View>
                        )}
                    </View>
                </View>
            )}

            {/* Minimized PiP Window */}
            {callStatus !== 'idle' && isCallMinimized && (
                <PiPView 
                    callType={callType}
                    callStatus={callStatus}
                    remoteUid={remoteUid}
                    isJoined={isJoined}
                    isCaller={isCaller}
                    isRemoteVideoMuted={isRemoteVideoMuted}
                    otherPartyName={otherPartyName}
                    onMaximize={() => setIsCallMinimized(false)}
                    onEndCall={endCall}
                    theme={theme}
                    RtcSurfaceView={RtcSurfaceView}
                    headerAvatarUrl={headerAvatarUrl}
                />
            )}
            {/* Full Screen Image Viewer Modal */}
            <Modal visible={!!selectedImage} transparent={true} animationType="fade" onRequestClose={() => setSelectedImage(null)}>
                <View style={styles.fullScreenImageContainer}>
                    <TouchableOpacity style={styles.closeImageButton} onPress={() => setSelectedImage(null)}>
                        <X size={32} color="#fff" />
                    </TouchableOpacity>
                    {selectedImage && (
                        <Image source={{ uri: selectedImage }} style={styles.fullScreenImage} resizeMode="contain" />
                    )}
                </View>
            </Modal>
            <Modal
                visible={isRxReviewModalVisible}
                transparent
                animationType="slide"
                onRequestClose={() => setIsRxReviewModalVisible(false)}
            >
                <View style={styles.rxReviewOverlay}>
                    <View style={[styles.rxReviewCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <View style={[styles.rxReviewHeader, { borderBottomColor: theme.borderColor }]}>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.rxReviewTitle, { color: theme.text }]}>Review prescription</Text>
                                <Text style={[styles.rxReviewSubtitle, { color: theme.textSecondary }]}>Check every section and medicine field before the PDF is sent.</Text>
                            </View>
                            <TouchableOpacity
                                onPress={() => setIsRxReviewModalVisible(false)}
                                style={[styles.rxReviewClose, { borderColor: theme.borderColor }]}
                            >
                                <X size={16} color={theme.textSecondary} />
                            </TouchableOpacity>
                        </View>
                        <ScrollView
                            style={styles.rxReviewScroll}
                            contentContainerStyle={styles.rxReviewScrollContent}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={[styles.rxReviewLabel, { color: theme.textSecondary }]}>Final editable draft</Text>
                            <TextInput
                                value={rxTranscript}
                                onChangeText={(text) => {
                                    setRxTranscript(text);
                                    lastRxSpeechRef.current = text;
                                    rawRxSpeechRef.current = text;
                                    setRxMedicineNeedsConfirmation(false);
                                }}
                                multiline
                                textAlignVertical="top"
                                placeholder="Prescription draft"
                                placeholderTextColor={theme.textSecondary}
                                style={[styles.rxReviewInput, { color: theme.text, backgroundColor: theme.background, borderColor: theme.borderColor }]}
                            />
                            {rxMedicineNeedsConfirmation ? (
                                <View style={styles.rxReviewWarning}>
                                    <Text style={styles.rxReviewWarningTitle}>Medicine review required</Text>
                                    <Text style={styles.rxReviewWarningText}>Verify medicine name, strength, dose, frequency and duration before sending.</Text>
                                    <TouchableOpacity onPress={() => setRxMedicineNeedsConfirmation(false)} style={styles.rxReviewReviewButton}>
                                        <Text style={styles.rxReviewReviewButtonText}>I reviewed the medicine fields</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : null}
                        </ScrollView>
                        <View style={[styles.rxReviewFooter, { borderTopColor: theme.borderColor }]}>
                            <TouchableOpacity
                                onPress={() => setIsRxReviewModalVisible(false)}
                                style={[styles.rxReviewCancelButton, { borderColor: theme.borderColor }]}
                            >
                                <Text style={[styles.rxReviewCancelText, { color: theme.textSecondary }]}>Back to edit</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleConfirmSendVoicePrescriptionPdf}
                                disabled={rxMedicineNeedsConfirmation || sendPrescriptionPdfMutation.isPending}
                                style={[styles.rxReviewConfirmButton, { backgroundColor: theme.tint, opacity: rxMedicineNeedsConfirmation || sendPrescriptionPdfMutation.isPending ? 0.45 : 1 }]}
                            >
                                {sendPrescriptionPdfMutation.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.rxReviewConfirmText}>Confirm & Send PDF</Text>}
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
            {isRxVoiceModalVisible ? (
                <View style={[styles.rxFullScreenWrap, { backgroundColor: theme.background }]}>
                    <View style={[styles.rxFullScreenHeader, { borderBottomColor: theme.borderColor }]}>
                        <Text style={[styles.rxFullScreenTitle, { color: theme.text }]}>Voice Prescription</Text>
                        <TouchableOpacity
                            onPress={() => {
                                setIsRxVoiceModalVisible(false);
                                stopRxVoiceCapture(true);
                                setRxMedicineNeedsConfirmation(false);
                                setRxExpandedSection(null);
                            }}
                            style={[styles.rxHeaderCloseButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                        >
                            <X size={14} color={theme.textSecondary} />
                            <Text style={[styles.rxHeaderCloseText, { color: theme.textSecondary }]}>Close</Text>
                        </TouchableOpacity>
                    </View>
                    <View style={styles.rxFullScreenBody}>
                    <View style={[styles.rxModalCard, { backgroundColor: theme.cardBackground, borderColor: theme.borderColor }]}>
                        <View style={[styles.rxInfoBanner, { backgroundColor: theme.successLight, borderColor: theme.success }]}>
                            <Animated.View
                                style={[styles.rxInfoBadge, { backgroundColor: theme.successLight, transform: [{ scale: rxListeningPulse }] }]}
                            >
                                <Mic size={14} color={theme.success} />
                            </Animated.View>
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.rxInfoTitle, { color: theme.text }]}>Speak the prescription naturally</Text>
                                <Text style={[styles.rxInfoText, { color: theme.textSecondary }]}>Pause or stop when finished. Review every detail before sending.</Text>
                            </View>
                        </View>
                        <View style={styles.rxStatusRow}>
                            <View
                                style={[
                                    styles.rxStatusPill,
                                    { backgroundColor: isRxListening ? theme.successLight : theme.background, borderColor: theme.borderColor },
                                ]}
                            >
                                <View style={[styles.rxStatusDot, { backgroundColor: isRxListening ? theme.success : theme.textSecondary }]} />
                                <Text style={[styles.rxStatusText, { color: isRxListening ? theme.success : theme.textSecondary }]}>
                                    {isRxAiParsing ? 'Analyzing prescription…' : isRxListening ? 'Listening' : 'Ready'}
                                </Text>
                            </View>
                        </View>
                        <ScrollView
                            style={styles.rxFormScroll}
                            contentContainerStyle={styles.rxFormScrollContent}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                        >
                            <View style={styles.rxEditorHeader}>
                                <Text style={[styles.rxEditorLabel, { color: theme.success }]}>Live transcription</Text>
                                <Text style={[styles.rxEditorHint, { color: theme.textSecondary }]}>Tap to edit</Text>
                            </View>
                            <View style={[styles.rxTranscriptBox, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                                <TextInput
                                    value={rxTranscript}
                                    onChangeText={(text) => {
                                    setRxTranscript(text);
                                    lastRxSpeechRef.current = text;
                                    rawRxSpeechRef.current = text;
                                    setRxMedicineNeedsConfirmation(false);
                                }}
                                    placeholder="Your prescription will appear here after dictation…"
                                    placeholderTextColor={theme.textSecondary}
                                    multiline
                                    textAlignVertical="top"
                                    style={[styles.rxTranscriptInput, { color: theme.text }]}
                                />
                                <View style={[styles.rxWaveform, { opacity: isRxListening ? 1 : 0.35 }]} pointerEvents="none">
                                    {[8, 18, 30, 14, 24].map((height, index) => (
                                        <View key={index} style={[styles.rxWaveformBar, { height, backgroundColor: theme.success }]} />
                                    ))}
                                </View>
                            </View>
                            {rxMedicineNeedsConfirmation ? (
                                <View style={[styles.rxSafetyWarning, { backgroundColor: '#FFF7ED', borderColor: '#F59E0B' }]}>
                                    <Text style={[styles.rxSafetyWarningTitle, { color: theme.text }]}>Medicine review required</Text>
                                    <Text style={[styles.rxSafetyWarningText, { color: theme.textSecondary }]}>AI verification is incomplete or a speech variant may be present. Verify every medicine name and detail before sending.</Text>
                                    <TouchableOpacity onPress={() => setRxMedicineNeedsConfirmation(false)} style={[styles.rxSafetyConfirmButton, { backgroundColor: theme.tint }]}>
                                        <Text style={styles.rxSafetyConfirmText}>I reviewed the medicine</Text>
                                    </TouchableOpacity>
                                </View>
                            ) : null}

                            <View style={styles.rxClinicalHeader}>
                                <Text style={[styles.rxClinicalTitle, { color: theme.text }]}>Clinical details</Text>
                                <TouchableOpacity onPress={() => toggleRxSection('complaints')} style={styles.rxAddSectionButton}>
                                    <Text style={[styles.rxAddSectionPlus, { color: theme.success }]}>＋</Text>
                                    <Text style={[styles.rxAddSectionText, { color: theme.success }]}>Add section</Text>
                                </TouchableOpacity>
                            </View>

                            <View style={styles.rxClinicalSectionsList}>
                                {([
                                    ['complaints', 'Chief complaints', 'Describe current patient complaints...'],
                                    ['history', 'History summary', 'Enter patient history summary...'],
                                    ['examination', 'Examination finding', 'Physical examination observations...'],
                                    ['diagnosis', 'Diagnosis', 'Enter diagnosis...'],
                                    ['advice', 'General advice', 'Add general advice...'],
                                    ['precautions', 'Precautions', 'Add precautions...'],
                                    ['followUp', 'Follow-up', 'Add follow-up plan...'],
                                ] as const).map(([key, label, placeholder]) => {
                                    const expanded = rxExpandedSection === key;
                                    return (
                                        <View key={key} style={[styles.rxAccordionCard, { backgroundColor: theme.cardBackground, borderColor: expanded ? theme.success : theme.borderColor }]}>
                                            <TouchableOpacity
                                                onPress={() => toggleRxSection(key)}
                                                style={styles.rxAccordionHeader}
                                                activeOpacity={0.86}
                                            >
                                                <Text style={[styles.rxAccordionTitle, { color: expanded ? theme.success : theme.text }]}>{label}</Text>
                                                <View style={[styles.rxAccordionIcon, { borderColor: expanded ? theme.success : theme.textSecondary }]}>
                                                    {expanded ? <ChevronUp size={13} color={theme.success} strokeWidth={2.5} /> : <ChevronDown size={13} color={theme.textSecondary} strokeWidth={2.5} />}
                                                </View>
                                            </TouchableOpacity>
                                            {expanded ? (
                                                <View style={styles.rxAccordionBody}>
                                                    <TextInput
                                                        value={rxSectionNotes[key]}
                                                        onChangeText={(text) => setRxSectionNotes((prev) => ({ ...prev, [key]: text }))}
                                                        placeholder={placeholder}
                                                        placeholderTextColor={theme.textSecondary}
                                                        multiline
                                                        textAlignVertical="top"
                                                        style={[styles.rxSectionTextarea, { color: theme.text, borderColor: theme.success, backgroundColor: theme.cardBackground }]}
                                                    />
                                                    <TouchableOpacity onPress={handleApplySectionNotes} style={[styles.rxSectionApplyButton, { backgroundColor: theme.success }]}>
                                                        <Text style={styles.rxMedAddButtonText}>Apply to draft</Text>
                                                    </TouchableOpacity>
                                                </View>
                                            ) : null}
                                        </View>
                                    );
                                })}
                            </View>

                            <View style={[styles.rxMedFormCard, { backgroundColor: theme.background, borderColor: theme.borderColor }]}>
                            <TouchableOpacity
                                style={[styles.rxMedToggleRow, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                onPress={() => setIsRxMedicineFormOpen((prev) => !prev)}
                                activeOpacity={0.86}
                            >
                                <View style={styles.rxMedicationRowContent}>
                                    <View style={[styles.rxMedicationIcon, { backgroundColor: theme.successLight }]}>
                                        <FileText size={17} color={theme.success} />
                                    </View>
                                <View>
                                    <Text style={[styles.rxMedFormTitle, { color: theme.text }]}>Medications</Text>
                                    <Text style={[styles.rxMedFormSubtitle, { color: theme.textSecondary }]}>Add medicine, dose and schedule</Text>
                                </View>
                                </View>
                                <View style={[styles.rxMedToggleBadge, { backgroundColor: theme.tint }]}>
                                    <Text style={styles.rxMedToggleBadgeText}>{isRxMedicineFormOpen ? '-' : '+'}</Text>
                                </View>
                            </TouchableOpacity>
                            {isRxMedicineFormOpen ? (
                                <>
                            <TextInput
                                value={rxMedName}
                                onChangeText={setRxMedName}
                                placeholder="Medicine name (e.g. Paracetamol)"
                                placeholderTextColor={theme.textSecondary}
                                style={[styles.rxMedInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                            />
                            <View style={styles.rxMedInlineRow}>
                                <TextInput
                                    value={rxMedDose}
                                    onChangeText={setRxMedDose}
                                    placeholder="Dose (650 mg)"
                                    placeholderTextColor={theme.textSecondary}
                                    style={[styles.rxMedInput, styles.rxMedInlineInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                />
                                <TextInput
                                    value={rxMedDuration}
                                    onChangeText={setRxMedDuration}
                                    placeholder="Duration (5 days)"
                                    placeholderTextColor={theme.textSecondary}
                                    style={[styles.rxMedInput, styles.rxMedInlineInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                                />
                            </View>
                            <View style={styles.rxFreqRow}>
                                {['OD', 'BD', 'TDS', 'SOS'].map((option) => {
                                    const isActive = rxMedFrequency === option;
                                    return (
                                        <TouchableOpacity
                                            key={option}
                                            onPress={() => setRxMedFrequency(option)}
                                            style={[
                                                styles.rxFreqChip,
                                                {
                                                    backgroundColor: isActive ? theme.successLight : theme.cardBackground,
                                                    borderColor: isActive ? theme.success : theme.borderColor,
                                                },
                                            ]}
                                        >
                                            <Text style={{ color: isActive ? theme.success : theme.textSecondary, fontSize: 11, fontWeight: '700' }}>
                                                {option}
                                            </Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                            <TextInput
                                value={rxMedInstructions}
                                onChangeText={setRxMedInstructions}
                                placeholder="Timing/Instructions (after food, night)"
                                placeholderTextColor={theme.textSecondary}
                                style={[styles.rxMedInput, { color: theme.text, borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                            />
                            <TouchableOpacity
                                onPress={handleAddMedicationFromForm}
                                style={[styles.rxMedAddButton, { backgroundColor: theme.tint }]}
                            >
                                <Text style={styles.rxMedAddButtonText}>Add medicine</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => {
                                    const nextDraft = removeLastMedicationLineFromDraft(rxTranscript);
                                    setRxTranscript(nextDraft);
                                    lastRxSpeechRef.current = nextDraft;
                                    rawRxSpeechRef.current = nextDraft;
                                }}
                                style={[styles.rxMedRemoveButton, { borderColor: theme.borderColor, backgroundColor: theme.cardBackground }]}
                            >
                                <Text style={[styles.rxMedRemoveButtonText, { color: theme.textSecondary }]}>- Remove Last Medicine</Text>
                            </TouchableOpacity>
                                </>
                            ) : null}
                            </View>
                        </ScrollView>
                        <View style={[styles.rxBottomActionBar, { borderTopColor: theme.borderColor, backgroundColor: theme.cardBackground }]}>
                        <View style={styles.rxVoiceControlsRow}>
                            <TouchableOpacity
                                onPress={handleRxVoiceStart}
                                style={[styles.rxVoiceControlButton, { backgroundColor: theme.tint }]}
                                disabled={isRxListening}
                            >
                                <Mic size={16} color="#fff" />
                                <Text style={styles.rxVoiceControlButtonText}>Start voice</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleRxVoiceStop}
                                disabled={!isRxListening}
                                style={[styles.rxVoiceControlButton, styles.rxStopVoiceButton, { borderColor: theme.error, opacity: isRxListening ? 1 : 0.45 }]}
                            >
                                <View style={[styles.rxStopIcon, { borderColor: theme.error }]}>
                                    <View style={[styles.rxStopIconSquare, { backgroundColor: theme.error }]} />
                                </View>
                                <Text style={[styles.rxVoiceControlButtonText, { color: theme.text }]}>Stop</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.rxModalActions}>
                            <TouchableOpacity
                                onPress={handleSendVoicePrescriptionPdf}
                                style={[styles.rxSendButton, { backgroundColor: hasMeaningfulPrescriptionDraft(rxTranscript) ? '#1E293B' : theme.borderColor, opacity: sendPrescriptionPdfMutation.isPending ? 0.75 : 1 }]}
                                disabled={!hasMeaningfulPrescriptionDraft(rxTranscript) || sendPrescriptionPdfMutation.isPending}
                            >
                                {sendPrescriptionPdfMutation.isPending ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <>
                                        <FileText size={16} color={hasMeaningfulPrescriptionDraft(rxTranscript) ? '#fff' : theme.textSecondary} />
                                        <Text style={[styles.rxSendButtonText, { color: hasMeaningfulPrescriptionDraft(rxTranscript) ? '#fff' : theme.textSecondary }]}>REVIEW & SEND PDF</Text>
                                    </>
                                )}
                            </TouchableOpacity>
                        </View>
                        </View>
                    </View>
                </View>
                </View>
            ) : null}
        </Wrapper>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        borderBottomWidth: 1,
        zIndex: 50,
    },
    backButton: {
        padding: 8,
        marginLeft: -8,
    },
    headerInfo: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 4,
    },
    name: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    status: {
        fontSize: 12,
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    avatarText: {
        fontSize: 16,
        fontWeight: 'bold',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    messageBubble: {
        maxWidth: '80%',
        padding: 12,
        borderRadius: 16,
        marginBottom: 8
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
        lineHeight: 24,
    },
    myMessage: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
    theirMessage: { alignSelf: 'flex-start', borderBottomLeftRadius: 4 },
    messageText: { fontSize: 16 },
    messageImage: {
        width: 200,
        height: 150,
        borderRadius: 8,
        marginBottom: 4,
    },
    timeText: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
    replyPreviewBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        borderTopWidth: 1,
    },
    replyBubble: {
        borderRadius: 8,
        padding: 8,
        marginBottom: 8,
        borderLeftWidth: 4,
        borderLeftColor: 'rgba(255,255,255,0.5)',
    },
    replyText: {
        fontSize: 13,
        opacity: 0.9,
    },
    fileAttachment: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.15)',
        padding: 10,
        borderRadius: 8,
        gap: 8,
        marginVertical: 4,
    },
    fileNameText: {
        fontSize: 14,
        fontWeight: '500',
        textDecorationLine: 'underline',
        flexShrink: 1,
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingTop: 8,
        borderTopWidth: 1,
        zIndex: 50,
        elevation: 5,
    },
    iconButton: {
        padding: 12,
    },
    input: {
        flex: 1,
        minHeight: 40,
        maxHeight: 100,
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 8,
        marginHorizontal: 8,
        fontSize: 16,
    },
    sendButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        alignItems: 'center',
        justifyContent: 'center'
    },
    callOverlay: {
        zIndex: 1000,
        justifyContent: 'space-around',
        alignItems: 'center',
        paddingVertical: 100
    },
    callContent: {
        flex: 1,
        alignItems: 'center',
        paddingTop: 100,
    },
    callAvatarLarge: {
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: 'rgba(255,255,255,0.1)',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 20
    },
    callAvatarTextLarge: {
        fontSize: 48,
        fontWeight: 'bold',
        color: '#fff'
    },
    callNameLarge: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#fff'
    },
    callStatusText: {
        fontSize: 18,
        color: 'rgba(255,255,255,0.7)',
        marginTop: 10
    },
    callActions: {
        position: 'absolute',
        bottom: 50,
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
    activeCallControls: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
    },
    controlButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: 'rgba(255,255,255,0.2)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    controlButtonActive: {
        backgroundColor: 'rgba(255,255,255,0.6)',
    },
    minimizeButton: {
        position: 'absolute',
        top: 20,
        left: 20,
        zIndex: 100,
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    pipContainer: {
        position: 'absolute',
        width: 120,
        height: 180,
        borderRadius: 16,
        backgroundColor: '#000',
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.2)',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 5 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
        zIndex: 2000,
    },
    pipOverlay: {
        position: 'absolute',
        bottom: 8,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 12,
    },
    pipActionBtn: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    callActionButton: {
        width: 70,
        height: 70,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center'
    },
    fullScreenImageContainer: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.95)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    fullScreenImage: {
        width: '100%',
        height: '80%',
    },
    closeImageButton: {
        position: 'absolute',
        top: 50,
        left: 20,
        zIndex: 10,
        padding: 8,
    },
    localVideoContainer: {
        position: 'absolute',
        top: 60,
        right: 20,
        width: 120,
        height: 180,
        borderRadius: 12,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: '#fff',
        zIndex: 10,
    },
    localVideo: {
        flex: 1,
    },
    rxModalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    rxFullScreenWrap: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 3000,
        elevation: 30,
    },
    rxFullScreenHeader: {
        minHeight: 58,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottomWidth: 1,
    },
    rxFullScreenTitle: {
        fontSize: 16,
        fontWeight: '800',
    },
    rxHeaderCloseButton: {
        width: 74,
        height: 34,
        borderWidth: 1,
        borderRadius: 18,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 5,
    },
    rxHeaderCloseText: {
        fontSize: 12,
        fontWeight: '700',
    },
    rxFullScreenBody: {
        flex: 1,
        paddingHorizontal: 12,
        paddingTop: 12,
        paddingBottom: 14,
    },
    rxModalCard: {
        flex: 1,
        borderRadius: 14,
        borderWidth: 1,
        padding: 12,
        gap: 10,
    },
    rxModalHint: {
        fontSize: 12,
        lineHeight: 16,
    },
    rxInfoBanner: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
    },
    rxInfoBadge: {
        width: 30,
        height: 30,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxInfoTitle: {
        fontSize: 12,
        fontWeight: '800',
    },
    rxInfoText: {
        fontSize: 11,
        lineHeight: 15,
        marginTop: 2,
    },
    rxEditorHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rxEditorHint: {
        fontSize: 10,
        fontWeight: '700',
    },
    rxClinicalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 2,
        paddingTop: 3,
    },
    rxClinicalTitle: {
        fontSize: 18,
        fontWeight: '800',
        letterSpacing: -0.2,
    },
    rxClinicalSectionsList: {
        gap: 10,
    },
    rxAccordionCard: {
        borderRadius: 13,
        borderWidth: 1,
        overflow: 'hidden',
        shadowColor: '#0B1C30',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.04,
        shadowRadius: 7,
        elevation: 1,
    },
    rxAccordionHeader: {
        minHeight: 54,
        paddingHorizontal: 14,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rxAccordionTitle: {
        fontSize: 11,
        fontWeight: '800',
        letterSpacing: 0.25,
        textTransform: 'uppercase',
    },
    rxAccordionIcon: {
        width: 22,
        height: 22,
        borderRadius: 11,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxAccordionIconText: {
        fontSize: 14,
        fontWeight: '800',
        lineHeight: 17,
    },
    rxAccordionBody: {
        paddingHorizontal: 14,
        paddingBottom: 14,
        gap: 9,
    },
    rxSectionTextarea: {
        minHeight: 70,
        borderWidth: 1,
        borderRadius: 9,
        padding: 10,
        fontSize: 12,
        lineHeight: 17,
    },
    rxSectionApplyButton: {
        alignSelf: 'flex-end',
        borderRadius: 9,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    rxAddSectionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 4,
        paddingHorizontal: 2,
        gap: 3,
    },
    rxAddSectionPlus: {
        fontSize: 21,
        lineHeight: 21,
        fontWeight: '800',
    },
    rxAddSectionText: {
        fontSize: 12,
        fontWeight: '800',
    },
    rxEditorLabel: {
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.2,
        textTransform: 'uppercase',
    },
    rxFormScroll: {
        flex: 1,
    },
    rxFormScrollContent: {
        paddingBottom: 14,
        gap: 10,
    },
    rxStatusRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    rxStatusPill: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 999,
        borderWidth: 1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        gap: 8,
    },
    rxStatusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    rxStatusText: {
        fontSize: 12,
        fontWeight: '700',
    },
    rxTranscriptBox: {
        minHeight: 175,
        borderRadius: 12,
        borderWidth: 1,
        padding: 10,
    },
    rxTranscriptInput: {
        minHeight: 152,
        fontSize: 13,
        lineHeight: 18,
        paddingTop: 2,
        paddingBottom: 28,
    },
    rxWaveform: {
        position: 'absolute',
        right: 14,
        bottom: 13,
        height: 30,
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: 4,
    },
    rxWaveformBar: {
        width: 3,
        borderRadius: 99,
    },
    rxSafetyWarning: {
        borderRadius: 10,
        borderWidth: 1,
        padding: 10,
        gap: 6,
    },
    rxSafetyWarningTitle: {
        fontSize: 12,
        fontWeight: '800',
    },
    rxSafetyWarningText: {
        fontSize: 11,
        lineHeight: 15,
    },
    rxSafetyConfirmButton: {
        alignSelf: 'flex-start',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 7,
    },
    rxSafetyConfirmText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
    },
    rxMedFormCard: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 8,
        gap: 7,
    },
    rxMedFormTitle: {
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    rxMedFormSubtitle: {
        fontSize: 10,
        lineHeight: 14,
        marginTop: 2,
    },
    rxMedicationRowContent: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    rxMedicationIcon: {
        width: 34,
        height: 34,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxMedInput: {
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        fontSize: 12,
        minHeight: 38,
    },
    rxMedInlineRow: {
        flexDirection: 'row',
        gap: 8,
    },
    rxMedToggleRow: {
        minHeight: 40,
        borderRadius: 10,
        borderWidth: 1,
        paddingHorizontal: 10,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    rxMedToggleBadge: {
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxMedToggleBadgeText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '800',
        marginTop: -1,
    },
    rxMedInlineInput: {
        flex: 1,
    },
    rxFreqRow: {
        flexDirection: 'row',
        gap: 8,
        flexWrap: 'wrap',
    },
    rxFreqChip: {
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 6,
    },
    rxMedAddButton: {
        height: 38,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxMedAddButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
        letterSpacing: 0.2,
    },
    rxMedRemoveButton: {
        height: 34,
        borderRadius: 10,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxMedRemoveButtonText: {
        fontSize: 11,
        fontWeight: '700',
    },
    rxVoiceControlsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    rxBottomActionBar: {
        borderTopWidth: 0,
        paddingTop: 14,
        gap: 14,
        marginHorizontal: -12,
        marginBottom: -12,
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        elevation: 8,
        shadowColor: '#0B1C30',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
    },
    rxVoiceControlButton: {
        flex: 1,
        height: 54,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
    },
    rxStopVoiceButton: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
    },
    rxStopIcon: {
        width: 23,
        height: 23,
        borderRadius: 12,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxStopIconSquare: {
        width: 8,
        height: 8,
        borderRadius: 2,
    },
    rxVoiceControlButtonText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '700',
    },
    rxModalActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 0,
    },
    rxSendButton: {
        flex: 1,
        height: 56,
        borderRadius: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 9,
        paddingHorizontal: 16,
    },
    rxSendButtonText: {
        fontSize: 13,
        fontWeight: '800',
        letterSpacing: 0.1,
    },
    rxCloseButton: {
        height: 42,
        borderRadius: 21,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 12,
    },
    rxCloseButtonText: {
        fontSize: 12,
        fontWeight: '600',
    },
    rxReviewOverlay: {
        flex: 1,
        backgroundColor: 'rgba(15, 23, 42, 0.52)',
        justifyContent: 'flex-end',
    },
    rxReviewCard: {
        maxHeight: '92%',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        borderWidth: 1,
        overflow: 'hidden',
    },
    rxReviewHeader: {
        minHeight: 72,
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    rxReviewTitle: {
        fontSize: 17,
        fontWeight: '800',
    },
    rxReviewSubtitle: {
        fontSize: 11,
        lineHeight: 15,
        marginTop: 3,
    },
    rxReviewClose: {
        width: 32,
        height: 32,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxReviewScroll: {
        maxHeight: 520,
    },
    rxReviewScrollContent: {
        padding: 16,
        gap: 8,
    },
    rxReviewLabel: {
        fontSize: 11,
        fontWeight: '800',
        textTransform: 'uppercase',
        letterSpacing: 0.3,
    },
    rxReviewInput: {
        minHeight: 300,
        borderWidth: 1,
        borderRadius: 12,
        padding: 12,
        fontSize: 13,
        lineHeight: 19,
    },
    rxReviewWarning: {
        borderRadius: 10,
        borderWidth: 1,
        borderColor: '#F59E0B',
        backgroundColor: '#FFF7ED',
        padding: 10,
        gap: 5,
    },
    rxReviewWarningTitle: {
        color: '#9A3412',
        fontSize: 12,
        fontWeight: '800',
    },
    rxReviewWarningText: {
        color: '#9A3412',
        fontSize: 11,
        lineHeight: 15,
    },
    rxReviewReviewButton: {
        alignSelf: 'flex-start',
        borderRadius: 8,
        backgroundColor: '#EA580C',
        paddingHorizontal: 10,
        paddingVertical: 7,
        marginTop: 2,
    },
    rxReviewReviewButtonText: {
        color: '#fff',
        fontSize: 11,
        fontWeight: '800',
    },
    rxReviewFooter: {
        borderTopWidth: 1,
        padding: 12,
        flexDirection: 'row',
        gap: 8,
    },
    rxReviewCancelButton: {
        flex: 1,
        height: 44,
        borderRadius: 11,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxReviewCancelText: {
        fontSize: 12,
        fontWeight: '700',
    },
    rxReviewConfirmButton: {
        flex: 1.4,
        height: 44,
        borderRadius: 11,
        alignItems: 'center',
        justifyContent: 'center',
    },
    rxReviewConfirmText: {
        color: '#fff',
        fontSize: 12,
        fontWeight: '800',
    },

});
