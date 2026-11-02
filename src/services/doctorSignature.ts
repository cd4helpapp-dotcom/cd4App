import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../lib/supabase';

const BUCKET = 'doctor-kyc';

export type PickedSignature = { uri: string; mimeType: 'image/png' | 'image/jpeg' };

// PDFs can only hold PNG or JPG, so other formats such as HEIC are refused here with a clear message.
export const pickSignatureImage = async (): Promise<PickedSignature | null> => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [3, 1],
    quality: 0.9,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const name = `${asset.fileName || asset.uri}`.toLowerCase();
  const mimeType = (asset.mimeType || '').toLowerCase();
  if (mimeType === 'image/png' || name.endsWith('.png')) return { uri: asset.uri, mimeType: 'image/png' };
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg' || /\.jpe?g$/.test(name) || asset.uri.startsWith('data:image/jpeg')) {
    return { uri: asset.uri, mimeType: 'image/jpeg' };
  }
  throw new Error('Please choose a PNG or JPG image.');
};

export const uploadDoctorSignature = async (doctorId: string, picked: PickedSignature): Promise<string> => {
  const blob = await (await fetch(picked.uri)).blob();
  const path = `${doctorId}/signature.${picked.mimeType === 'image/png' ? 'png' : 'jpg'}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: picked.mimeType, upsert: true });
  if (uploadError) throw uploadError;
  const { error } = await supabase.from('doctors').update({ signature_path: path }).eq('id', doctorId);
  if (error) throw error;
  return path;
};

export const removeDoctorSignature = async (doctorId: string, path: string): Promise<void> => {
  const { error } = await supabase.from('doctors').update({ signature_path: null }).eq('id', doctorId);
  if (error) throw error;
  await supabase.storage.from(BUCKET).remove([path]);
};

export const loadDoctorSignaturePath = async (doctorId: string): Promise<string | null> => {
  const { data } = await supabase.from('doctors').select('signature_path').eq('id', doctorId).maybeSingle();
  return data?.signature_path || null;
};

export const signatureViewUrl = async (path: string): Promise<string | null> => {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  return data?.signedUrl || null;
};
