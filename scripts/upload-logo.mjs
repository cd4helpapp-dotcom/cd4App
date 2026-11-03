import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

const SUPABASE_URL = 'https://prcpnwectrptrpblmezy.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByY3Bud2VjdHJwdHJwYmxtZXp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI4Mjc2NDUsImV4cCI6MjA4ODQwMzY0NX0.BEf7Er4A0g-gKM8rvhFYf_dTSOqTnXVaeK5np4JLKds';

const supabase = createClient(SUPABASE_URL, ANON_KEY);

async function checkAndUploadLogo() {
  const logoPath = path.resolve('assets/images/cd4_logo.png');
  const fileBytes = fs.readFileSync(logoPath);
  console.log(`Logo file loaded: ${fileBytes.length} bytes`);

  const { data, error } = await supabase.storage
    .from('cd4-storage')
    .upload('branding/cd4_logo.png', fileBytes, {
      contentType: 'image/png',
      upsert: true,
    });

  if (error) {
    console.log('Upload notice:', error.message);
  } else {
    console.log('Uploaded successfully:', data);
  }

  const { data: publicData } = supabase.storage
    .from('cd4-storage')
    .getPublicUrl('branding/cd4_logo.png');

  console.log('Public URL:', publicData.publicUrl);
}

checkAndUploadLogo();

