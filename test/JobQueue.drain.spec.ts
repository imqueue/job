/*!
 * Graceful drain, end to end: a real child process, a real `SIGTERM`, and a job
 * handler still running when it arrives.
 *
 * These cannot be in-process tests — what is under test is what the process
 * does between receiving a signal and exiting, so each case spawns
 * `test/fixtures/drain-worker.js` and reads the JSON lines it reports.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(
    new URL('./fixtures/drain-worker.js', import.meta.url),
);
const MOCKS = fileURLToPath(new URL('./mocks/index.js', import.meta.url));

interface FixtureEvent {
    event: string;
    at: number;
    [key: string]: unknown;
}

interface FixtureRun {
    events: FixtureEvent[];
    stderr: string;
    code: number | null;
    /** Milliseconds from the first `SIGTERM` to process exit. */
    sinceSignal: number;
}

/**
 * Runs the drain fixture in a child process and collects what it reported.
 *
 * @param {Record<string, string>} env - fixture configuration
 * @return {Promise<FixtureRun>}
 */
function run(env: Record<string, string>): Promise<FixtureRun> {
    return new Promise<FixtureRun>((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ['--experimental-test-module-mocks', '--import', MOCKS, FIXTURE],
            { env: { ...process.env, ...env }, stdio: 'pipe' },
        );
        const events: FixtureEvent[] = [];
        let stdout = '';
        let stderr = '';

        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => (stdout += chunk));
        child.stderr.on('data', chunk => (stderr += chunk));
        child.on('error', reject);
        child.on('exit', code => {
            const exitAt = Date.now();

            for (const line of stdout.split('\n')) {
                if (line.startsWith('{')) {
                    events.push(JSON.parse(line) as FixtureEvent);
                }
            }

            const signalled = events.find(e => e.event === 'signal:sent');

            resolve({
                events,
                stderr,
                code,
                sinceSignal: signalled ? exitAt - signalled.at : NaN,
            });
        });
    });
}

/**
 * Whether the fixture reported the given event.
 *
 * @param {FixtureRun} result - a completed fixture run
 * @param {string} event - event name
 * @return {boolean}
 */
function saw(result: FixtureRun, event: string): boolean {
    return result.events.some(e => e.event === event);
}

describe('JobQueue graceful drain', () => {
    it("should keep today's behaviour when draining is off", async () => {
        // The regression guard: without the opt-in, a worker signalled mid job
        // still abandons it and exits at once
        const result = await run({
            IMQ_DRAIN_ENABLE: '0',
            HANDLER_MS: '2000',
            SIGNAL_AFTER_MS: '50',
        });

        assert.equal(result.code, 0, 'must still exit 0');
        assert.ok(saw(result, 'handler:start'), 'the job must have started');
        assert.ok(
            !saw(result, 'handler:end'),
            'the handler must NOT be awaited when draining is off',
        );
        assert.ok(
            result.sinceSignal < 1500,
            `must exit promptly, took ${result.sinceSignal}ms`,
        );
    });

    it('should finish the job in flight when draining is on', async () => {
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_TIMEOUT: '10000',
            HANDLER_MS: '2000',
            SIGNAL_AFTER_MS: '50',
        });

        assert.equal(result.code, 0, 'must exit 0');
        assert.ok(saw(result, 'handler:end'), 'the handler must complete');
        assert.ok(
            result.sinceSignal > 1200 && result.sinceSignal < 4000,
            'signal-to-exit should be about the remaining handler time, ' +
                `was ${result.sinceSignal}ms`,
        );
    });

    it('should complete a retry re-schedule during the drain', async () => {
        // the re-schedule travels over the writer, which stop() must leave up:
        // draining is the only reason this send is not lost
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_TIMEOUT: '10000',
            HANDLER_MS: '800',
            RETRY_MS: '1000',
            SIGNAL_AFTER_MS: '50',
        });

        assert.equal(result.code, 0, 'must exit 0');
        assert.ok(saw(result, 'handler:end'), 'the handler must complete');
        assert.ok(
            saw(result, 'send'),
            'the retry the handler asked for must reach the broker',
        );
    });

    it('should stay bounded by IMQ_DRAIN_TIMEOUT and never hang', async () => {
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_TIMEOUT: '500',
            HANDLER_MS: '8000',
            SIGNAL_AFTER_MS: '50',
        });

        assert.equal(result.code, 0, 'must exit 0 even when work is abandoned');
        assert.ok(
            !saw(result, 'handler:end'),
            'work exceeding the budget is abandoned, not awaited',
        );
        assert.ok(
            result.sinceSignal < 3000,
            `must exit within the budget, took ${result.sinceSignal}ms`,
        );
    });

    it('should re-queue a job the budget ran out on', async () => {
        // safe delivery released the worker key when the job reached the
        // handler, so nothing else would ever bring this job back
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_TIMEOUT: '500',
            HANDLER_MS: '8000',
            SIGNAL_AFTER_MS: '50',
        });

        const requeued = result.events.filter(e => e.event === 'send');

        assert.equal(
            requeued.length,
            1,
            'the abandoned job must be pushed back',
        );
        assert.deepEqual(requeued[0].job, { id: 'job-1' });
    });

    it('should not re-queue with IMQ_DRAIN_REQUEUE=0', async () => {
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_REQUEUE: '0',
            IMQ_DRAIN_TIMEOUT: '500',
            HANDLER_MS: '8000',
            SIGNAL_AFTER_MS: '50',
        });

        assert.equal(result.code, 0, 'must exit 0');
        assert.ok(
            !saw(result, 'send'),
            'a lost attempt is preferred to a duplicate when this is off',
        );
    });

    it('should exit immediately on a second signal during a drain', async () => {
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_TIMEOUT: '10000',
            HANDLER_MS: '8000',
            SIGNAL_AFTER_MS: '50',
            SECOND_SIGNAL_MS: '300',
        });

        assert.equal(result.code, 0, 'must exit 0');
        assert.ok(
            !saw(result, 'handler:end'),
            'the double interrupt must not wait for the handler',
        );
        assert.ok(
            result.sinceSignal < 2000,
            'must exit right after the second signal rather than at the ' +
                `budget, took ${result.sinceSignal}ms`,
        );
    });

    it('should survive a handler rejection mid-drain', async () => {
        const result = await run({
            IMQ_DRAIN_ENABLE: '1',
            IMQ_DRAIN_TIMEOUT: '10000',
            HANDLER_MS: '600',
            HANDLER_THROWS: '1',
            SIGNAL_AFTER_MS: '50',
        });

        assert.equal(result.code, 0, 'must exit 0');
        assert.ok(saw(result, 'handler:end'), 'the handler must have run');
        assert.ok(
            !/UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/.test(
                result.stderr,
            ),
            `tracking must not create an unhandled rejection: ${result.stderr}`,
        );
        assert.ok(
            result.sinceSignal < 4000,
            `a rejection must not stall the drain, took ${result.sinceSignal}ms`,
        );
    });
});
