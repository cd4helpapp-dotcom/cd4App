const light = {
  text: '#2C3E50',
  textSecondary: '#7F8C8D',
  background: '#F5F7FA',
  cardBackground: '#FFFFFF',
  tint: '#2ECC71',
  tabIconDefault: '#95A5A6',
  tabIconSelected: '#2ECC71',
  borderColor: '#E8E8E8',
  success: '#2ECC71',
  successLight: '#E8F6F3',
  successBorder: '#D1F2EB',
  badgeText: '#E74C3C',
  badgeBackground: '#FFEBEE',
  buttonPrimary: '#00C853',
  buttonText: '#FFFFFF',
  iconPrimary: '#2C3E50',
  error: '#E74C3C',
};

const dark = {
  text: '#ECF0F1',
  textSecondary: '#BDC3C7',
  background: '#121212',
  cardBackground: '#1E1E1E',
  tint: '#2ECC71',
  tabIconDefault: '#7F8C8D',
  tabIconSelected: '#2ECC71',
  borderColor: '#333333',
  success: '#2ECC71',
  successLight: '#1E3A2F',
  successBorder: '#27AE60',
  badgeText: '#FF8A80',
  badgeBackground: '#3E2723',
  buttonPrimary: '#00E676',
  buttonText: '#000000',
  iconPrimary: '#ECF0F1',
  error: '#FF8A80',
};

export type Theme = typeof light;
export default { light, dark };
