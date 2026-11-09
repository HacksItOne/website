# Hacksitone website

Node.js (20+) site backed by a Turso (libSQL) database.

## Run locally
    npm install
    ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='long-unique-password' node server.js
    # http://localhost:3000  (uses a local data.db file when TURSO_* vars are not set)

## Deploy (Render + Turso)
1. Push this repo to GitHub.
2. Render -> New -> Web Service -> pick the repo. Build: `npm install`. Start: `npm run start:prod`.
3. Add the environment variables listed in `.env.example`.

## Security implemented
- Passwords: scrypt, unique salt, constant-time comparison, 12+ character policy
- Parameterized SQL only, strict input validation, HTML output escaping
- CSRF token on every POST plus Origin check; HttpOnly, SameSite=Strict, Secure (prod) cookie
- Session ID rotated at login, 2-hour idle expiry, logout destroys session
- Rate limits (10 auth attempts / 15 min / IP), 5-failure account lockout, no user enumeration
- Strict CSP, HSTS, frame/MIME/referrer protections, 10 KB body limit, no stack traces leaked
- Admin credentials come from environment variables, never from source code
"# website" 
