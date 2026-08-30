/*!
 * Drain end-to-end fixture: a job worker with one slow handler, driven by a
 * real process signal.
 *
 * Run as a child process by `test/JobQueue.drain.spec.ts`. Configuration
 * arrives through the environment so one fixture covers every mode:
 *
 * | variable            | meaning                                       |
 * |---------------------|-----------------------------------------------|
 * | `IMQ_DRAIN_ENABLE`  | the feature flag under test                   |
 * | `IMQ_DRAIN_TIMEOUT` | the drain budget                              |
 * | `IMQ_DRAIN_REQUEUE` | whether abandoned jobs are pushed back        |
 * | `HANDLER_MS`        | how long the handler takes                    |
 * | `HANDLER_THROWS`    | `1` to make the handler reject                |
 * | `RETRY_MS`          | retry delay the handler asks for, `0` no ask  |
 * | `SIGNAL_AFTER_MS`   | when to signal ourselves after delivery       |
 * | `SECOND_SIGNAL_MS`  | delay of a second signal, `0` for none        |
 *
 * Progress is reported on stdout, one JSON object per line, which the spec
 * parses. Redis is the same in-memory mock the in-process specs use.
 */
import '../mocks/index.js';
import JobQueue from '../../index.js';
import { logger } from '../mocks/index.js';

const HANDLER_MS = Number(process.env.HANDLER_MS || 300);
const HANDLER_THROWS = process.env.HANDLER_THROWS === '1';
const RETRY_MS = Number(process.env.RETRY_MS || 0);
const SIGNAL_AFTER_MS = Number(process.env.SIGNAL_AFTER_MS || 50);
const SECOND_SIGNAL_MS = Number(process.env.SECOND_SIGNAL_MS || 0);

/**
 * Emits one progress line on stdout.
 *
 * @param {string} event - event name
 * @param {Record<string, unknown>} extra - additional fields
 */
function report(event: string, extra: Record<string, unknown> = {}): void {
    process.stdout.write(
        `${JSON.stringify({ event, at: Date.now(), ...extra })}\n`,
    );
}

const queue: any = new JobQueue<{ id: string }>({
    name: 'DrainFixture',
    logger,
});

queue.onPop(async (job: { id: string }) => {
    report('handler:start', { id: job.id });

    await new Promise(resolve => setTimeout(resolve, HANDLER_MS));

    report('handler:end', { id: job.id });

    if (HANDLER_THROWS) {
        throw new Error('handler failed on purpose');
    }

    // a number here asks the queue to re-schedule the job, which it does over
    // the writer — the connection a drain must keep alive through its wait
    return RETRY_MS > 0 ? RETRY_MS : undefined;
});

await queue.start();

// Every send() is observed, so the spec can tell a retry re-schedule and a
// drain re-queue apart from each other and from silence.
const send = queue.imq.send.bind(queue.imq);

queue.imq.send = async (...args: any[]): Promise<string> => {
    report('send', { job: (args[1] as any)?.job });

    return send(...args);
};

// Deliver through the very path a popped job takes — the queue's 'message'
// listener, which is where in-flight tracking lives.
queue.imq.emit('message', { job: { id: 'job-1' } }, 'fixture-message-id');

setTimeout(() => {
    report('signal:sent');
    process.kill(process.pid, 'SIGTERM');

    if (SECOND_SIGNAL_MS > 0) {
        setTimeout(() => {
            report('signal:sent', { second: true });
            process.kill(process.pid, 'SIGTERM');
        }, SECOND_SIGNAL_MS);
    }
}, SIGNAL_AFTER_MS);

// Keep the loop alive independently of the queue, so the process never exits
// for a reason other than the one under test.
setInterval(() => undefined, 1000);
