import { openDB, type IDBPDatabase } from "idb";
import { initialProfile, type Profile } from "../domain/profile";

const DB_NAME = "piano-buddy";
const DB_VERSION = 1;
const STORE_NAME = "profile";
const PROFILE_KEY = "main";

type ProfileDB = {
  profile: {
    key: string;
    value: Profile;
  };
};

let dbPromise: Promise<IDBPDatabase<ProfileDB>> | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function getDb(): Promise<IDBPDatabase<ProfileDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ProfileDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function loadProfile(): Promise<Profile> {
  const db = await getDb();
  const stored = await db.get(STORE_NAME, PROFILE_KEY);
  return stored ?? initialProfile();
}

export async function saveProfile(profile: Profile): Promise<void> {
  const run = writeChain.then(async () => {
    const db = await getDb();
    await db.put(STORE_NAME, profile, PROFILE_KEY);
  });
  writeChain = run.then(() => undefined, () => undefined);
  await run;
}
