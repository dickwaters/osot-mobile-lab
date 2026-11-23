import type {
  E2F0Vote,
  E4StressVote,
  E5BoundaryVote,
  E7TrialRecord,
  RaterProfile,
  RecordedTake,
} from './types';

const DB_NAME = 'osot_mobile_lab_db';
const DB_VERSION = 1;
const STORE_TAKES = 'recorded_takes';

const KEY_PROFILE = 'osot_profile_v1';
const KEY_E2_F0 = 'osot_e2_f0_votes_v1';
const KEY_E4_STRESS = 'osot_e4_stress_votes_v1';
const KEY_E5_BOUNDARY = 'osot_e5_boundary_votes_v1';
const KEY_E7_TRIAL = 'osot_e7_trial_records_v1';

export function loadProfile(): RaterProfile {
  try {
    const raw = localStorage.getItem(KEY_PROFILE);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    rater_id: 'rater_A',
    role: 'rater_A',
    speaker_id: 'spk_user_water',
    session_id: `sess_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    update_mirror: 'https://ghfast.top/',
  };
}

export function saveProfile(p: RaterProfile) {
  localStorage.setItem(KEY_PROFILE, JSON.stringify(p));
}

function loadMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMap<T>(key: string, map: Record<string, T>) {
  localStorage.setItem(key, JSON.stringify(map));
}

export const loadE2F0Votes = () => loadMap<E2F0Vote>(KEY_E2_F0);
export const saveE2F0Votes = (m: Record<string, E2F0Vote>) => saveMap(KEY_E2_F0, m);

// Keyed by `${phrase_id}::${rater_id}` so two raters on the same phone stay strictly isolated!
export const loadE4StressVotes = () => loadMap<E4StressVote>(KEY_E4_STRESS);
export const saveE4StressVotes = (m: Record<string, E4StressVote>) => saveMap(KEY_E4_STRESS, m);

export const loadE5BoundaryVotes = () => loadMap<E5BoundaryVote>(KEY_E5_BOUNDARY);
export const saveE5BoundaryVotes = (m: Record<string, E5BoundaryVote>) => saveMap(KEY_E5_BOUNDARY, m);

export const loadE7TrialRecords = () => loadMap<E7TrialRecord>(KEY_E7_TRIAL);
export const saveE7TrialRecords = (m: Record<string, E7TrialRecord>) => saveMap(KEY_E7_TRIAL, m);

// ---------- IndexedDB for dry WAV recordings (avoids localStorage 5MB limit) ----------
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_TAKES)) {
        db.createObjectStore(STORE_TAKES, { keyPath: 'take_key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecordedTake(take: RecordedTake): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TAKES, 'readwrite');
    tx.objectStore(STORE_TAKES).put(take);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteRecordedTake(takeKey: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TAKES, 'readwrite');
    tx.objectStore(STORE_TAKES).delete(takeKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAllRecordedTakes(): Promise<RecordedTake[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_TAKES, 'readonly');
    const req = tx.objectStore(STORE_TAKES).getAll();
    req.onsuccess = () => resolve((req.result as RecordedTake[]) || []);
    req.onerror = () => reject(req.error);
  });
}
