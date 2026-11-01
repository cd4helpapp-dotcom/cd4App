import React from 'react';
import { Image, ImageSourcePropType, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Activity,
  Baby,
  Bone,
  Brain,
  Droplets,
  Eye,
  Flower2,
  HeartPulse,
  Pill,
  Sparkles,
  Stethoscope,
  Thermometer,
  Wind,
} from 'lucide-react-native';
import { useAppTheme } from '../../hooks/useAppTheme';

export type IconComponent = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
export type Tone = { fg: string; from: string; to: string };

// One shared palette for every icon/art tile so concerns, departments and lists read as one system.
const TONES_LIGHT: Tone[] = [
  { fg: '#059669', from: '#E7F8F0', to: '#BBF0D6' },
  { fg: '#1A56DB', from: '#E8F0FF', to: '#CCDCFF' },
  { fg: '#C2410C', from: '#FFF1E6', to: '#FFDCC2' },
  { fg: '#BE185D', from: '#FDEBF3', to: '#FACFE1' },
  { fg: '#6D28D9', from: '#F1EBFF', to: '#DDD0FF' },
  { fg: '#15803D', from: '#E8F8EC', to: '#C9EED3' },
  { fg: '#B45309', from: '#FFF7E0', to: '#FDE7A8' },
  { fg: '#0369A1', from: '#E6F5FD', to: '#C4E6FA' },
];
const TONES_DARK: Tone[] = [
  { fg: '#6EE7B7', from: '#12403D', to: '#0B2B29' },
  { fg: '#93B4FF', from: '#1B2C54', to: '#121D38' },
  { fg: '#FDBA74', from: '#45250F', to: '#2C180A' },
  { fg: '#F9A8D4', from: '#4A1730', to: '#300F20' },
  { fg: '#C4B5FD', from: '#30225A', to: '#1F173B' },
  { fg: '#86EFAC', from: '#173F25', to: '#0F2A19' },
  { fg: '#FCD34D', from: '#45360D', to: '#2D2309' },
  { fg: '#7DD3FC', from: '#0F3550', to: '#0A2335' },
];

export const useClayTones = () => {
  const { isDark } = useAppTheme();
  const tones = isDark ? TONES_DARK : TONES_LIGHT;
  return (index: number): Tone => tones[Math.abs(index) % tones.length];
};

const CONCERN_ICON_RULES: Array<[RegExp, IconComponent]> = [
  [/heart|cardi|bp|blood pressure|hypertension/i, HeartPulse],
  [/fever|bukhar|temperature|typhoid|dengue|malaria/i, Thermometer],
  [/diabet|sugar|thyroid|metabol/i, Droplets],
  [/pcos|period|women|pregnan|fertility|gyn/i, Flower2],
  [/skin|derma|eczema|acne|hair|twak/i, Sparkles],
  [/cough|cold|flu|breath|lung|asthma|pulmo/i, Wind],
  [/head|migraine|dizz|vertigo|brain|neuro|stress|anxiety|mental|sleep/i, Brain],
  [/bone|joint|back|knee|ortho|arthritis/i, Bone],
  [/eye|vision|ophthal/i, Eye],
  [/child|baby|pediat|kid/i, Baby],
  [/medicine|pharma|dose/i, Pill],
  [/assistant|general|consult/i, Stethoscope],
];

export const iconForConcern = (label: string): IconComponent =>
  CONCERN_ICON_RULES.find(([pattern]) => pattern.test(label))?.[1] || Activity;

// Soft "clay" tile: two-stop gradient, top highlight and a tinted drop shadow give a subtle 3D look.
export default function ClayIcon({ Icon, tone, size = 56 }: { Icon: IconComponent; tone: Tone; size?: number }) {
  const radius = size * 0.32;
  return (
    <View style={[styles.shadow, { width: size, height: size, borderRadius: radius, shadowColor: tone.fg }]}>
      <LinearGradient colors={[tone.from, tone.to]} start={{ x: 0.15, y: 0 }} end={{ x: 0.85, y: 1 }} style={[styles.tile, { borderRadius: radius }]}>
        <View pointerEvents="none" style={[styles.highlight, { borderTopLeftRadius: radius, borderTopRightRadius: radius }]} />
        <Icon size={Math.round(size * 0.44)} color={tone.fg} strokeWidth={2.1} />
      </LinearGradient>
    </View>
  );
}

// Circular artwork badge. The thumbnails in assets/thumbs are pre-cropped per image to the illustration
// only (the source art has captions printed into it), so the image simply fills the circle and the
// real label is rendered as text by the caller.
export function ArtBadge({ source, tone, size = 64 }: { source: ImageSourcePropType; tone: Tone; size?: number }) {
  const ring = Math.max(2, Math.round(size * 0.05));
  const inner = size - ring * 2;
  return (
    <View style={[styles.shadow, { width: size, height: size, borderRadius: size / 2, shadowColor: tone.fg }]}>
      <LinearGradient colors={[tone.to, tone.from]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.ring, { borderRadius: size / 2, padding: ring }]}>
        <View style={[styles.artCircle, { width: inner, height: inner, borderRadius: inner / 2 }]}>
          <Image source={source} resizeMode="cover" style={{ width: inner, height: inner }} />
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  tile: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  ring: {
    flex: 1,
  },
  artCircle: {
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
});
