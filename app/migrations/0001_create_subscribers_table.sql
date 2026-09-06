-- Migration number: 0001 	 2026-09-05T20:14:44.408Z

CREATE TABLE subscribers (
	email TEXT PRIMARY KEY,
	token TEXT NOT NULL UNIQUE,
	created_at TEXT NOT NULL,
	confirmed_at TEXT,
	unsubscribed_at TEXT
);

