---
title: "Tech Stack"
description: "Languages, frameworks, key dependencies, and versions"
---

# Tech Stack

Languages, frameworks, key dependencies, and versions used in cap4.

---

## Backend
| Component         | Technology                | Version                 |
| ----------------- | ------------------------- | ----------------------- |
| Runtime           | Node.js                   | 20+                     |
| Language          | TypeScript                | ^5.6.3 (strict mode)    |
| HTTP API          | Fastify                   | ^5.8.1                  |
| Rate limiting     | @fastify/rate-limit       | ^10.3.0                 |
| Database          | PostgreSQL                | 16                      |
| Object storage    | MinIO (S3-compatible)     | Latest                  |
| AWS SDK (S3)      | @aws-sdk/client-s3        | ^3.997.0                |
| Video processing  | FFmpeg (via media-server) | 6+                      |
| Transcription     | Deepgram API              | Nova-2 model            |
| AI generation     | Groq API                  | llama-3.3-70b-versatile |
| Schema validation | Zod                       | ^3.23.8                 |
| Logging           | Pino (via @cap/logger)    | Structured JSON         |
| Package manager   | pnpm workspaces           | 9.12.3                  |


## Frontend
| Component        | Technology                                       | Version              |
| ---------------- | ------------------------------------------------ | -------------------- |
| Framework        | React                                            | ^18.3.1              |
| Routing          | react-router-dom                                 | ^6.28.0              |
| Build tool       | Vite                                             | ^5.4.10              |
| Language         | TypeScript                                       | ^5.6.3 (strict mode) |
| CSS framework    | Tailwind CSS                                     | ^3.4.14              |
| CSS architecture | CSS custom properties + Tailwind semantic tokens | —                    |
| PostCSS          | postcss                                          | ^8.4.47              |
| Autoprefixer     | autoprefixer                                     | ^10.4.20             |


## Testing
| Component          | Technology             | Version |
| ------------------ | ---------------------- | ------- |
| Unit / integration | Vitest                 | ^4.0.18 |
| E2E                | Playwright             | ^1.58.2 |
| React testing      | @testing-library/react | ^16.3.2 |
| DOM environment    | happy-dom              | ^20.8.3 |


## Infrastructure
| Component     | Technology              |
| ------------- | ----------------------- |
| Containers    | Docker + Docker Compose |
| Reverse proxy | Nginx                   |
| CI/CD         | GitHub Actions workflows in `.github/workflows/` |
| Repository    | GitHub                  |
| Linting       | ESLint ^9.15.0          |
| Formatting    | Prettier ^3.3.3         |


## Workspace Packages
| Package             | Purpose                                       |
| ------------------- | --------------------------------------------- |
| `@cap/web`          | React/Vite frontend                           |
| `@cap/web-api`      | Fastify HTTP API                              |
| `@cap/worker`       | Background job runner                         |
| `@cap/media-server` | FFmpeg wrapper (worker calls POST /process)   |
| `@cap/config`       | Shared environment configuration              |
| `@cap/db`           | PostgreSQL access layer                       |
| `@cap/logger`       | Structured Pino logging with secret redaction |
