-- Migration number: 0001 	 2025-10-28T15:27:57.139Z
CREATE TABLE IF NOT EXISTS logs (
  name TEXT,
  status TEXT,
  date TEXT,
  log TEXT
);