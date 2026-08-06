import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://uzyogbqxxqdurhcoyhzu.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'your-anon-key'; // This will be injected by the environment

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
export const supabaseAdmin = supabase; // Export for compatibility with existing components
