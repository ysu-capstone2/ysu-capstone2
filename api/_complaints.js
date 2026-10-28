import { ApiError } from './_auth.js';
import { randomUUID } from 'node:crypto';

export function requestKey(value, { required = false } = {}) {
  if (value === undefined && !required) return randomUUID();
  if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError(400, '요청 번호를 확인해 주세요.');
  return value.toLowerCase();
}

export function listQuery(query = {}, { admin = false } = {}) {
  const page = Number(query.page ?? 1);
  const size = Number(query.pageSize ?? 20);
  const search = String(query.q || '').trim();
  const status = String(query.status || '');
  if (status && !['접수','처리중','보완요청','완료','취소'].includes(status)) throw new ApiError(400, '처리 상태를 확인해 주세요.');
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || !Number.isInteger(size) || size < 1 || size > 100 || search.length > 100) throw new ApiError(400, '검색어와 페이지를 확인해 주세요.');
  const params = new URLSearchParams({ order: 'created_at.desc,id.desc', limit: String(size + 1), offset: String((page - 1) * size) });
  if (status) params.set('process_status', `eq.${status}`);
  if (search) {
    // A quoted PostgREST value keeps punctuation out of its filter grammar.
    const literal = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[%_*]/g, '\\$&');
    const value = `"%${literal}%"`;
    params.set('or', `(${['complaint_no', 'summary', ...(admin ? ['citizen_name'] : [])].map(field => `${field}.ilike.${value}`).join(',')})`);
  }
  return { page, size, params };
}

export function listPage(rows, page, size) {
  return { rows: rows.slice(0, size), pagination: { page, pageSize: size, hasNext: rows.length > size } };
}

export function preferredTime(value, { required = false, now = Date.now(), validateWindow = true } = {}) {
  if (!value && !required) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) throw new ApiError(400, '상담 희망 일시를 확인해 주세요.');
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day) throw new ApiError(400, '존재하는 날짜를 선택해 주세요.');
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || (validateWindow && (timestamp <= now || timestamp > now + 90 * 86400000))) throw new ApiError(400, '상담 희망 일시는 현재 이후 90일 이내로 선택해 주세요.');
  return new Date(timestamp).toISOString();
}
