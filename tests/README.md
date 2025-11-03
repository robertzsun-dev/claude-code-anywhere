# Tests

Comprehensive test suite for Claude Code Remote Access.

## Running Tests

### All Tests

```bash
npm test
```

### Watch Mode

Auto-run tests on file changes:

```bash
npm run test:watch
```

### Individual Test Suites

```bash
# Server tests
npm run test:server

# Wrapper tests
npm run test:wrapper

# Integration tests
npm run test:integration
```

## Test Structure

```
tests/
├── server.test.js        - WebSocket server tests
├── wrapper.test.js       - PTY wrapper tests
├── integration.test.js   - End-to-end system tests
└── README.md            - This file
```

## Test Coverage

### Server Tests (`server.test.js`)

Tests for the WebSocket session server:

- ✅ Health endpoint returns correct status
- ✅ Sessions endpoint returns session list
- ✅ Wrapper connection creates session
- ✅ Viewer can list sessions
- ✅ Viewer can attach to session
- ✅ Messages broadcast from wrapper to viewers
- ✅ Session history is preserved
- ✅ Invalid role returns error
- ✅ Non-existent session returns error

### Wrapper Tests (`wrapper.test.js`)

Tests for the PTY wrapper component:

- ✅ Module syntax is valid
- ✅ CLAUDE_SEAMLESS_MODE controls logging
- ✅ CLAUDE_REMOTE_SERVER environment variable
- ✅ CLAUDE_CMD environment variable
- ✅ Configuration structure validation

### Integration Tests (`integration.test.js`)

End-to-end system tests:

- ✅ Complete workflow (wrapper → viewer → communication)
- ✅ Multiple viewers per session
- ✅ Session metadata storage and transmission
- ✅ History buffer (10,000 line capacity)

## Test Requirements

### Node.js Built-in Test Runner

Uses Node.js v18+ built-in test runner (no external dependencies).

**Features:**
- Native test runner
- Parallel execution
- Watch mode
- Descriptive output

### Dependencies

Tests use the same dependencies as the main application:
- `ws` - WebSocket connections
- Standard Node.js modules

## Writing Tests

### Test Structure

```javascript
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';

describe('Feature Tests', () => {
  before(async () => {
    // Setup before all tests
  });

  after(() => {
    // Cleanup after all tests
  });

  test('Test description', async () => {
    // Test code
    assert.strictEqual(actual, expected);
  });
});
```

### Assertions

Use Node.js built-in `assert` module:

```javascript
import assert from 'node:assert';

// Equality
assert.strictEqual(actual, expected);
assert.deepStrictEqual(obj1, obj2);

// Truthiness
assert.ok(value, 'message');

// Errors
assert.throws(() => { throw new Error(); });
assert.rejects(async () => { throw new Error(); });
```

## Test Ports

Tests use different ports to avoid conflicts:

- `server.test.js`: Port 8766
- `integration.test.js`: Port 8767
- Production: Port 8085 (default)

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm test
```

### GitLab CI Example

```yaml
test:
  image: node:18
  script:
    - npm install
    - npm test
```

## Debugging Tests

### Verbose Output

```bash
# Run with more detail
node --test --test-reporter=spec tests/**/*.test.js
```

### Single Test

```bash
# Run specific test file
node --test tests/server.test.js
```

### Debug Mode

```bash
# Run with Node.js debugger
node --test --inspect-brk tests/server.test.js
```

## Common Issues

### Port Already in Use

If tests fail with `EADDRINUSE`:

```bash
# Kill process using port
lsof -ti:8766 | xargs kill -9
lsof -ti:8767 | xargs kill -9

# Then run tests again
npm test
```

### Timeout Errors

If tests timeout:

- Check server is starting correctly
- Increase timeout in test code
- Ensure no firewall blocking localhost

### WebSocket Connection Failures

- Verify `ws` package is installed
- Check server process is running
- Ensure correct port is used

## Test Output

### Passing Tests

```
✔ Server Tests > Server health endpoint returns OK (100ms)
✔ Server Tests > WebSocket connection as wrapper creates session (150ms)
✔ Integration Tests > Complete workflow (500ms)

Tests: 15 passed, 15 total
Time: 5.2s
```

### Failed Tests

```
✖ Server Tests > Invalid test
  AssertionError: Expected true to be false
    at Test.<anonymous> (tests/server.test.js:45:10)

Tests: 14 passed, 1 failed, 15 total
Time: 5.1s
```

## Performance

Tests are designed to be fast:

- **Unit tests**: < 100ms each
- **Integration tests**: < 1s each
- **Total suite**: < 10s

## Future Improvements

- [ ] Add client UI tests (blessed component testing)
- [ ] Add shim script tests (bash testing)
- [ ] Add performance benchmarks
- [ ] Add load testing for multiple sessions
- [ ] Add security tests
- [ ] Add browser-based client tests
- [ ] Increase coverage to 90%+

## Contributing

When adding features:

1. Write tests first (TDD approach)
2. Ensure all existing tests pass
3. Add tests for new functionality
4. Update this README if adding new test suites

## Resources

- [Node.js Test Runner](https://nodejs.org/api/test.html)
- [Node.js Assert](https://nodejs.org/api/assert.html)
- [WebSocket Testing](https://github.com/websockets/ws#usage-examples)
