export const FALLBACK_IMAGE_URL =
  "https://vgrutvaw2q.ufs.sh/f/X7AUkOrs4vhbLZJd0wWMZP0cAtUu7EI5sD2VGw41vjTYyfKL";
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const UNSPLASH_BASE_URL = "https://api.unsplash.com";

// UploadThing URLs that must never be flagged for deletion by /api/images/cleanup,
// even if no catalogue row references them — e.g. URLs that the frontend swaps in
// at render time and therefore never get persisted to the DB. Extend as needed.
export const PROTECTED_UPLOADTHING_URLS = [FALLBACK_IMAGE_URL];
