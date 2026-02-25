# Contributing to Claude Code Remote Access

Thank you for your interest in contributing! This document provides guidelines and information for contributors.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Documentation](#documentation)
- [Pull Request Process](#pull-request-process)
- [Code Style](#code-style)
- [Commit Messages](#commit-messages)

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers
- Focus on what is best for the community
- Show empathy towards others

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Public or private harassment
- Publishing others' private information

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- Git
- Basic understanding of WebSockets
- Familiarity with terminal/PTY concepts

### Fork and Clone

```bash
# Fork the repository on GitHub
# Then clone your fork
git clone https://github.com/YOUR-USERNAME/claude-code-anywhere.git
cd claude-code-anywhere

# Add upstream remote
git remote add upstream https://github.com/ORIGINAL-OWNER/claude-code-anywhere.git
```

### Install Dependencies

```bash
npm install
```

### Verify Setup

```bash
# Run tests
npm test

# Start server
npm run server

# In another terminal, start wrapper
npm run wrapper
```

## Development Workflow

### Create a Feature Branch

```bash
# Update main branch
git checkout main
git pull upstream main

# Create feature branch
git checkout -b feature/your-feature-name
```

### Make Changes

1. Write code
2. Add tests
3. Update documentation
4. Test locally

### Run Tests

```bash
# All tests
npm test

# Watch mode (auto-run on changes)
npm run test:watch

# Specific test suite
npm run test:server
npm run test:integration
```

### Commit Changes

```bash
git add .
git commit -m "Add feature: description"
```

See [Commit Messages](#commit-messages) for guidelines.

### Push and Create PR

```bash
# Push to your fork
git push origin feature/your-feature-name

# Create Pull Request on GitHub
```

## Testing

### Writing Tests

Use Node.js built-in test runner:

```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

describe('Feature Tests', () => {
  before(async () => {
    // Setup
  });

  after(() => {
    // Cleanup
  });

  test('does something', async () => {
    const result = await doSomething();
    assert.strictEqual(result, expected);
  });
});
```

### Test Coverage

- Add tests for all new features
- Maintain or improve existing coverage
- Include edge cases and error conditions
- Test both success and failure paths

### Integration Tests

For features that span multiple components:

```javascript
test('end-to-end workflow', async () => {
  // 1. Start server
  // 2. Create wrapper connection
  // 3. Connect viewer
  // 4. Verify communication
  // 5. Cleanup
});
```

## Documentation

### Update Documentation

When adding features, update:

- `README.md` - Main documentation
- `QUICKSTART.md` - If affecting quick start
- `SEAMLESS-MODE.md` - If affecting seamless mode
- `CLAUDE.md` - For architectural changes
- Inline code comments
- JSDoc for public functions

### Documentation Style

- Use clear, concise language
- Include code examples
- Add diagrams where helpful
- Keep formatting consistent

### Example Documentation

```javascript
/**
 * Creates a new session
 *
 * @param {WebSocket} wrapperWs - WebSocket connection from wrapper
 * @param {Object} metadata - Session metadata
 * @param {string} metadata.cwd - Current working directory
 * @param {string} metadata.hostname - Host machine name
 * @returns {Object} Session object with ID and metadata
 */
function createSession(wrapperWs, metadata) {
  // Implementation
}
```

## Pull Request Process

### Before Submitting

- [ ] Tests pass (`npm test`)
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] Commits are clean and descriptive
- [ ] No merge conflicts with main

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] Code follows style guide
- [ ] No console.log() left in code
```

### Review Process

1. Maintainer reviews code
2. Automated tests run
3. Discussion and revisions
4. Approval and merge

### After Merge

- Delete feature branch
- Update local main branch

## Code Style

### JavaScript Style

```javascript
// Use ES modules
import { something } from './module.js';

// Use modern JavaScript
const result = await asyncFunction();

// Descriptive names
function createSessionConnection(url) {
  // ...
}

// Constants in UPPER_CASE
const MAX_HISTORY = 10000;

// Private functions with underscore (optional)
function _internalHelper() {
  // ...
}
```

### Formatting

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Yes (or consistent without)
- **Line length**: 100 characters max
- **Trailing commas**: Yes in objects/arrays

### Comments

```javascript
// Good: Explain WHY, not WHAT
// Use TCP connection test instead of HTTP to reduce overhead
const isServerRunning = await checkTCPConnection(host, port);

// Bad: States the obvious
// Check if server is running
const isServerRunning = await checkTCPConnection(host, port);
```

### Naming Conventions

```javascript
// Variables and functions: camelCase
const sessionId = generateId();
function handleMessage(data) { }

// Classes: PascalCase
class SessionManager { }

// Constants: UPPER_SNAKE_CASE
const MAX_RETRY_ATTEMPTS = 3;

// Private: prefix with underscore
const _internalCache = new Map();
```

## Commit Messages

### Format

```
Type: Short description (50 chars max)

Longer description explaining what and why (optional)

- Bullet points for details
- Keep lines under 72 characters

Technical details (optional)
```

### Types

- **feat**: New feature
- **fix**: Bug fix
- **docs**: Documentation changes
- **test**: Adding/updating tests
- **refactor**: Code refactoring
- **perf**: Performance improvements
- **chore**: Maintenance tasks

### Examples

**Good:**
```
feat: Add session recording functionality

Implements session recording to allow playback of past sessions.
Sessions are stored as JSON with timestamps.

- Add startRecording() and stopRecording() methods
- Store to ~/.claude-remote/recordings/
- Add playback command to client
```

**Bad:**
```
Update stuff
```

```
Fixed bug
```

### Atomic Commits

- One logical change per commit
- Related changes together
- Each commit should build/test successfully

## Areas for Contribution

### High Priority

- [ ] Authentication system (JWT/OAuth)
- [ ] Session persistence (survive server restart)
- [ ] Web-based client (browser UI)
- [ ] Windows support improvements
- [ ] Performance optimizations

### Medium Priority

- [ ] Session recording/playback
- [ ] End-to-end encryption
- [ ] Docker/Kubernetes deployment
- [ ] Monitoring/metrics

### Documentation

- [ ] Video tutorials
- [ ] More deployment examples
- [ ] Troubleshooting guide expansion
- [ ] API documentation
- [ ] Architecture diagrams

### Testing

- [ ] Increase test coverage
- [ ] Performance benchmarks
- [ ] Load testing
- [ ] Security testing
- [ ] Browser client tests

## Questions?

- Open an issue for discussion
- Check existing issues and PRs
- Read documentation thoroughly
- Ask in pull request comments

## License

By contributing, you agree that your contributions will be licensed under the project's MIT License.

## Thank You!

Every contribution helps make this project better. We appreciate your time and effort! 🎉
