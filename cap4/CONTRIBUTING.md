# Contributing to cap4

Thank you for wanting to improve cap4! This guide explains how to contribute code, report bugs, and improve documentation.

---

## Getting Started

### 1. Fork & Clone
```bash
git clone https://github.com/yourorg/cap4
cd cap4
```

### 2. Set Up Local Environment
```bash
# Install dependencies
pnpm install

# Copy environment template
cp .env.example .env

# Start dev environment
make up

# Verify it works
make smoke
```

### 3. Create Feature Branch
```bash
git checkout -b feature/your-feature-name
# OR
git checkout -b fix/your-bug-fix
```

---

## Development Workflow

### Making Changes

**File Structure:**
```
apps/web/            ← Frontend (React)
apps/web-api/        ← Backend API (Fastify)
apps/worker/         ← Background processor
apps/media-server/   ← FFmpeg wrapper
packages/            ← Shared utilities
```

**Code Standards:**
- Use TypeScript (no `any`)
- Follow ESLint rules (`pnpm lint`)
- Format with Prettier (`pnpm format`)
- Write tests for new features
- Keep functions pure when possible

### Testing Your Changes

```bash
# Run linter
pnpm lint

# Format code
pnpm format

# Run tests
pnpm test

# Run integration tests
pnpm test:integration

# End-to-end test
make smoke
```

### Before Pushing

```bash
# Ensure everything still works
make down && make up
make smoke

# Check logs for errors
docker compose logs
```

---

## Creating a Pull Request

### 1. Push Your Branch
```bash
git add .
git commit -m "feat: add chapter navigation UI"
git push origin feature/your-feature-name
```

### 2. Open PR on GitHub

**PR Title Format:**
```
[type]: Brief description

Types: feat, fix, refactor, docs, test, chore
Examples:
- feat: add webhook retry mechanism
- fix: resolve race condition in job leasing
- docs: clarify state machine transitions
```

### 3. PR Description Template
```markdown
## What
Brief description of what this PR changes.

## Why
Why is this change needed? What problem does it solve?

## How
How does it work? Key implementation details.

## Testing
How was this tested? Steps to verify.
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Smoke test passes
- [ ] Manual testing completed

## Checklist
- [ ] Code formatted (`pnpm format`)
- [ ] Linter passes (`pnpm lint`)
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Commit messages clear
```

### 4. Code Review
Maintainers will review within 24 hours. Be ready to:
- Answer questions about your implementation
- Make requested changes
- Discuss design decisions

### 5. Merge
Once approved, your PR will be merged to `main` and deployed.

---

## Reporting Bugs

### Before Reporting
1. **Check existing issues** — Someone may have already reported it
2. **Verify it's reproducible** — Can you create a minimal example?
3. **Check documentation** — The answer might already exist

### Reporting a Bug

**Use GitHub Issues** and include:

```markdown
## Bug Description
What happened? What did you expect?

## Steps to Reproduce
1. Do this...
2. Then this...
3. See this error...

## Environment
- OS: macOS 14 / Ubuntu 22 / Windows 11
- Docker version: x.x.x
- Node version: 20.x
- Commit: abc123def

## Logs
Relevant error messages or logs:
```
docker compose logs worker
```

## Expected Behavior
What should happen instead?

## Actual Behavior
What actually happened?
```

---

## Requesting Features

**Use GitHub Issues** with:

```markdown
## Feature Request
Brief description of what you want.

## Use Case
Why do you need this? What problem does it solve?

## Proposed Solution
How should it work? Any API examples?

## Alternatives Considered
Other approaches you've thought of.
```

---

## Documentation Changes

### Updating Docs
Documentation lives in `docs/` and is organized by audience:

- `docs/api/` — API documentation
- `docs/ops/` — Operations & deployment
- `docs/ui/` — Frontend design system
- `docs/DATABASE.md` — Schema reference
- `ARCHITECTURE.md` — System design
- `README.md` — Project overview

### Documentation Standards
1. **File names** = Page titles (all caps: ENDPOINTS.md)
2. **First heading** = File name (# ENDPOINTS)
3. **Clear headings** — Readers should scan and understand structure
4. **Code examples** — Include bash, curl, or TypeScript samples
5. **Links** — Use relative paths (`../ops/DEPLOYMENT.md`)
6. **Keep it accurate** — Stale docs are worse than no docs

### Writing Documentation
```bash
# Edit docs
vim docs/api/ENDPOINTS.md

# Preview locally (if GitHub renders on push)
git push origin feature/update-docs

# Or use a markdown viewer
```

---

## Code Style & Standards

### TypeScript
```typescript
// ✓ Good: clear naming, proper types
interface ProcessingJob {
  id: string;
  videoId: string;
  phase: ProcessingPhase;
  createdAt: Date;
}

async function processVideo(
  videoId: string,
  config: ProcessingConfig
): Promise<ProcessedVideo> {
  // implementation
}

// ✗ Bad: unclear, uses any, poor naming
async function process(id: any, c: any): any {
  // implementation
}
```

### Error Handling
```typescript
// ✓ Good: clear error, easy to debug
throw new Error(
  `Failed to process video ${videoId}: S3 upload timed out after ${timeout}ms`
);

// ✓ Good: typed errors
class ProcessingError extends Error {
  constructor(
    public videoId: string,
    public phase: ProcessingPhase,
    message: string
  ) {
    super(message);
  }
}

// ✗ Bad: vague error
throw new Error("failed");
```

### Comments
```typescript
// ✓ Good: explains WHY, not WHAT
// We use FOR UPDATE SKIP LOCKED to prevent thundering herd
// when multiple workers poll the same job
const job = await db.query(
  'SELECT * FROM jobs WHERE status = $1 FOR UPDATE SKIP LOCKED LIMIT 1',
  ['pending']
);

// ✗ Bad: explains obvious code
// Get the job
const job = await db.query(...);
```

---

## Commit Message Standards

```
feat(worker): add exponential backoff for failed jobs

- Implements backoff strategy with max 5 retries
- Adds jitter to prevent thundering herd
- Fixes #42

Commit format:
<type>(<scope>): <subject>

<body>

<footer>

Types:
- feat: new feature
- fix: bug fix
- refactor: code restructuring
- docs: documentation
- test: tests
- chore: build, deps, etc.

Scopes:
- worker
- api
- frontend
- db
- docker
- etc.

Subject (50 chars max):
- Use imperative mood ("add" not "added")
- Don't capitalize first letter
- No period at end

Body (wrap at 72 chars):
- Explain what and why, not how
- Reference related issues: Fixes #42

Footer:
- BREAKING CHANGE: description (if applicable)
```

---

## Release Process

### Versioning
We use semantic versioning: `major.minor.patch`

- **major** (1.0.0 → 2.0.0) — Breaking changes
- **minor** (1.0.0 → 1.1.0) — New features (backward compatible)
- **patch** (1.0.0 → 1.0.1) — Bug fixes

### Release Cadence
- Weekly releases (Friday)
- Security fixes released immediately
- Major releases every quarter (planned)

### Making a Release (Maintainers Only)
```bash
# Create release branch
git checkout -b release/v1.2.0

# Update version
pnpm version minor

# Update CHANGELOG
vim CHANGELOG.md

# Create PR and merge
git push origin release/v1.2.0

# Tag on main
git tag v1.2.0
git push origin v1.2.0
```

---

## Getting Help

- 💬 **GitHub Discussions** — Ask questions
- 🐛 **GitHub Issues** — Report bugs
- 📚 **Documentation** — Check `docs/` first
- 📧 **Email** — questions@yourorg.com

---

## Code of Conduct

We're committed to providing a welcoming environment. All contributors must follow our Code of Conduct:

1. **Be respectful** — Disagree constructively
2. **Be inclusive** — Welcome diverse perspectives
3. **Be helpful** — Assist others
4. **Report abuse** — Use our reporting mechanism (see CODE_OF_CONDUCT.md)

---

## FAQ

### How long does code review take?
Typically 24-48 hours. Critical fixes reviewed faster.

### What if my PR gets rejected?
That's OK! We'll explain why and suggest improvements. Most rejections are about scope or approach, not code quality.

### Can I work on multiple features?
Yes, create separate branches for each feature. This keeps PRs focused and easier to review.

### How do I stay updated?
- Watch the repository on GitHub
- Join GitHub Discussions
- Follow our release announcements

### Where's the roadmap?
In README.md under "Roadmap" section. GitHub Issues also track planned work.

---

## Maintainers

Current maintainers:
- @yourname — Architecture, core systems
- @othername — Frontend, UX

Becoming a maintainer:
- Consistent contributions (3+ merged PRs)
- Deep knowledge of codebase
- Agreement to support community

---

## Recognition

Contributors are recognized in:
1. Commit history (GitHub)
2. CHANGELOG.md (release notes)
3. README.md contributors section (major contributions)

Thank you for contributing to cap4! 🎉
