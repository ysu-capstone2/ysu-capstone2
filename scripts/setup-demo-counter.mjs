import { pathToFileURL } from 'node:url';
import { supabaseRequest } from '../api/_supabase.js';

export const demoCounter = Object.freeze({
  id:'68f50885-7082-43de-8de7-faa0bf6c6331',
  org_name:'캡스톤 시연 민원실', counter_name:'[시연] 민원 상담 창구',
  location:'온라인 시연 전용 · 실제 기관 아님',
});
export async function setupDemoCounter({request = supabaseRequest, apply = false} = {}) {
  const existing = await request(`service_counters?id=eq.${demoCounter.id}`);
  if (existing.length) {
    if (existing[0].org_name !== demoCounter.org_name) throw new Error('시연 창구 식별자가 다른 기관에서 사용 중입니다.');
    return { created:false, counter:existing[0] };
  }
  if (!apply) return { planned:true, counter:demoCounter };
  await request('service_counters?on_conflict=id', {method:'POST', headers:{Prefer:'resolution=ignore-duplicates,return=representation'}, body:JSON.stringify(demoCounter)});
  const [counter] = await request(`service_counters?id=eq.${demoCounter.id}`);
  if (!counter || counter.org_name !== demoCounter.org_name) throw new Error('시연 창구 등록을 확인하지 못했습니다.');
  return { created:true, counter };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await setupDemoCounter({apply:process.argv.includes('--apply')}),null,2)); }
  catch { console.error('시연 창구를 준비하지 못했습니다. 서버 전용 Supabase 설정을 확인하세요.'); process.exitCode=1; }
}
