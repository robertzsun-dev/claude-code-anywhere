/**
 * Server-side input detection module
 * Detects when Claude Code is waiting for user input
 *
 * Ported from client-side detection in public/index.html
 */

// Common patterns that indicate Claude is waiting for user input
const WAITING_PATTERNS = [
    // Direct prompts
    'press enter',
    'continue?',
    'proceed?',
    'yes/no',
    'y/n',
    '[y/n]',
    '(y/n)',

    // Questions
    'would you like',
    'do you want',
    'should i',
    'may i',
    'can i',
    'okay to',
    'ok to',

    // Confirmations
    'confirm:',
    'approve:',
    'allow me',
    'permission to',

    // Input requests
    'type your',
    'please enter',
    'input:',
    'enter to',
    'waiting for',

    // Tool/command requests
    'run this tool',
    'execute this',
    'request approval',
    'needs approval'
];

// Quick action patterns - what the user can respond with
const QUICK_ACTION_PATTERNS = {
    yesNo: ['y/n', '[y/n]', '(y/n)', 'yes/no', 'yes or no'],
    continue: ['press enter', 'enter to continue', 'press any key'],
    approve: ['approve', 'permission to', 'may i', 'can i', 'allow me']
};

class InputDetector {
    constructor(sessionId, options = {}) {
        this.sessionId = sessionId;
        this.buffer = '';
        this.bufferSize = options.bufferSize || 500;
        this.quietTimeout = options.quietTimeout || 3000;
        this.isWaiting = false;
        this.lastWaitingReason = null;
        this.quietTimer = null;
        this.onWaitingDetected = options.onWaitingDetected || (() => {});
        this.onWaitingCleared = options.onWaitingCleared || (() => {});
    }

    /**
     * Process new terminal output data
     * @param {string} data - Raw terminal output
     * @returns {Object} Detection result
     */
    processOutput(data) {
        // Add to buffer, keep last N chars
        this.buffer = (this.buffer + data).slice(-this.bufferSize);

        const result = this.detectPatterns(data);

        // Clear any existing quiet timer
        if (this.quietTimer) {
            clearTimeout(this.quietTimer);
            this.quietTimer = null;
        }

        // If we found a pattern, trigger immediately
        if (result.detected) {
            this.setWaiting(true, result.reason, result.quickActions);
            return result;
        }

        // Set up quiet timer - if no output for quietTimeout ms, check again
        this.quietTimer = setTimeout(() => {
            this.checkQuietPeriod();
        }, this.quietTimeout);

        return result;
    }

    /**
     * Check buffer after a period of no output
     */
    checkQuietPeriod() {
        if (this.buffer.trim().length < 20) {
            return;
        }

        const recent = this.buffer.slice(-200).toLowerCase();

        // Check for stalled prompt patterns
        if (recent.includes('?') ||
            recent.includes('(y/n)') ||
            recent.includes('[y/n]') ||
            recent.includes('approve')) {

            const quickActions = this.detectQuickActions(recent);
            this.setWaiting(true, 'Output paused with prompt pattern', quickActions);
        }
    }

    /**
     * Detect waiting patterns in text
     * @param {string} data - New data chunk
     * @returns {Object} Detection result
     */
    detectPatterns(data) {
        const text = data.toLowerCase();
        const fullText = this.buffer.toLowerCase();

        // Check waiting patterns
        const matchedPattern = WAITING_PATTERNS.find(pattern => fullText.includes(pattern));
        const hasWaitingPattern = !!matchedPattern;

        // Detect Claude Code specific patterns
        const hasToolUse = fullText.includes('<function_calls>') || fullText.includes('tool use');
        const hasQuestion = fullText.includes('?') && text.trim().endsWith('?');

        const detected = hasWaitingPattern || (hasToolUse && hasQuestion);

        if (detected) {
            const reason = this.buildReason(matchedPattern, hasToolUse, hasQuestion);
            const quickActions = this.detectQuickActions(fullText);

            return {
                detected: true,
                reason,
                matchedPattern,
                hasToolUse,
                hasQuestion,
                quickActions,
                context: this.buffer.slice(-300)
            };
        }

        return {
            detected: false,
            reason: null,
            quickActions: []
        };
    }

    /**
     * Build a human-readable reason for the waiting state
     */
    buildReason(matchedPattern, hasToolUse, hasQuestion) {
        if (matchedPattern) {
            if (matchedPattern.includes('permission') || matchedPattern.includes('approve') || matchedPattern.includes('allow')) {
                return 'Permission request';
            }
            if (matchedPattern.includes('y/n') || matchedPattern.includes('yes/no')) {
                return 'Yes/No question';
            }
            if (matchedPattern.includes('continue') || matchedPattern.includes('enter')) {
                return 'Waiting to continue';
            }
            return `Waiting for input (${matchedPattern})`;
        }
        if (hasToolUse && hasQuestion) {
            return 'Tool use confirmation';
        }
        return 'Waiting for input';
    }

    /**
     * Detect which quick actions are applicable
     * @param {string} text - Text to analyze
     * @returns {string[]} List of applicable quick actions
     */
    detectQuickActions(text) {
        const actions = [];

        // Check yes/no patterns
        if (QUICK_ACTION_PATTERNS.yesNo.some(p => text.includes(p))) {
            actions.push('yes', 'no');
        }

        // Check continue patterns
        if (QUICK_ACTION_PATTERNS.continue.some(p => text.includes(p))) {
            actions.push('continue');
        }

        // Check approve patterns
        if (QUICK_ACTION_PATTERNS.approve.some(p => text.includes(p))) {
            if (!actions.includes('yes')) {
                actions.push('yes', 'no');
            }
        }

        // Always allow custom input
        if (actions.length === 0) {
            actions.push('yes', 'no', 'continue');
        }

        return actions;
    }

    /**
     * Set the waiting state
     */
    setWaiting(waiting, reason = null, quickActions = []) {
        const wasWaiting = this.isWaiting;
        this.isWaiting = waiting;
        this.lastWaitingReason = reason;

        if (waiting && !wasWaiting) {
            this.onWaitingDetected({
                sessionId: this.sessionId,
                reason,
                quickActions,
                context: this.buffer.slice(-300),
                timestamp: new Date()
            });
        } else if (!waiting && wasWaiting) {
            this.onWaitingCleared({
                sessionId: this.sessionId,
                timestamp: new Date()
            });
        }
    }

    /**
     * Clear waiting state (called when user provides input)
     */
    clearWaiting() {
        this.setWaiting(false);
    }

    /**
     * Handle user input - clears waiting state
     */
    handleInput() {
        this.clearWaiting();
        // Also clear the buffer to avoid re-triggering
        this.buffer = '';
    }

    /**
     * Get current state
     */
    getState() {
        return {
            sessionId: this.sessionId,
            isWaiting: this.isWaiting,
            reason: this.lastWaitingReason,
            bufferLength: this.buffer.length
        };
    }

    /**
     * Clean up timers
     */
    destroy() {
        if (this.quietTimer) {
            clearTimeout(this.quietTimer);
            this.quietTimer = null;
        }
    }
}

export { InputDetector, WAITING_PATTERNS, QUICK_ACTION_PATTERNS };
