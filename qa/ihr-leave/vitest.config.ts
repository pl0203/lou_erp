import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
export default defineConfig({plugins:[react()],resolve:{alias:[{find:/.*\/AuthContext$/,replacement:path.resolve('qa/ihr-leave/auth.ts')},{find:/.*\/supabase$/,replacement:path.resolve('qa/ihr-leave/supabase.ts')}]},test:{environment:'jsdom',globals:true,include:['qa/ihr-leave/fixture.test.tsx','qa/ihr-leave/config.test.ts']}});
