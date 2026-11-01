import type { ImageSourcePropType } from 'react-native';

// Neutral silhouette used when a person has no photo. Never substitute a stock/random face:
// on a health app that would misrepresent who the doctor or patient is.
export const AVATAR_PLACEHOLDER: ImageSourcePropType = require('../../assets/images/avatar_placeholder.png');

export const avatarSource = (uri?: string | null): ImageSourcePropType =>
  typeof uri === 'string' && uri.trim() ? { uri } : AVATAR_PLACEHOLDER;
