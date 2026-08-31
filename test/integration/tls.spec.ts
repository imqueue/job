/*!
 * TLS on the broker connection, against a real redis
 *
 * I'm Queue Software Project
 * Copyright (C) 2025  imqueue.com <support@imqueue.com>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * If you want to use this code in a closed source (commercial) project, you can
 * purchase a proprietary commercial license. Please contact us at
 * <support@imqueue.com> to get commercial licensing options.
 */
/**
 * The unit specs replace `ioredis` wholesale and never open a socket, which is
 * fine for every option except `tls`: what it is for happens during a handshake
 * a mock does not perform. These specs therefore run unmocked, and skip
 * themselves - rather than fail - wherever `redis-server` and `openssl` are not
 * both available.
 */
import assert from 'node:assert/strict';
import { randomUUID as uuid } from 'node:crypto';
import { after, afterEach, describe, it } from 'node:test';
import type { TLSSocket } from 'node:tls';
import JobQueue, { JobQueuePublisher, JobQueueWorker } from '../../index.js';
import { startTlsBroker, type TlsBroker } from './tlsBroker.js';

const started = await startTlsBroker(false);
const skip = typeof started === 'string' ? started : undefined;
const broker = started as TlsBroker;

/** Silences the queue; a failing assertion says more than its log would */
const quiet = {
    log: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
};

/**
 * The TLS socket underneath a started queue's writer connection.
 *
 * A job queue names its broker through `cluster`, so core hands back a
 * clustered queue and the connection lives on one of its per-server queues
 * rather than on the handle itself.
 */
const socketOf = (queue: any): TLSSocket | undefined => {
    const imq = queue.imq.imqs ? queue.imq.imqs[0] : queue.imq;

    return imq?.writer?.stream as TLSSocket | undefined;
};

/** Options addressing the broker, under a job name of this test's own */
const against = (tls?: any): any => ({
    name: `ITlsJob${uuid().replace(/-/g, '')}`,
    cluster: [{ host: '127.0.0.1', port: broker.port }],
    logger: quiet,
    ...(tls === undefined ? {} : { tls }),
});

const verified = {
    ca: (): any => broker.ca,
    name: (): string => broker.servername,
};

describe('job queue TLS against a real redis', { skip }, () => {
    after(() => broker.stop());

    afterEach(() => {
        delete process.env.IMQ_REDIS_TLS_CA_FILE;
        delete process.env.IMQ_REDIS_TLS_SERVERNAME;
    });

    describe('an encrypted broker connection', () => {
        it('should complete a verified handshake', async t => {
            const queue: any = new JobQueue(
                against({ ca: verified.ca(), servername: verified.name() }),
            );

            queue.onPop(() => undefined);
            t.after(() => queue.destroy().catch(() => undefined));

            await queue.start();

            const sock = socketOf(queue);

            assert.ok(sock, 'no writer socket was opened');
            assert.ok(sock.encrypted, 'the socket is not a TLS socket');
            assert.ok(sock.authorized, sock.authorizationError?.message);
            assert.match(String(sock.getProtocol()), /^TLSv1\.[23]$/);
        });

        it('should carry a job from a publisher to a worker', async t => {
            // the point of the package, over the transport this option adds:
            // a publisher and a worker that only ever meet through the broker
            const tls = { ca: verified.ca(), servername: verified.name() };
            const name = `ITlsPair${uuid().replace(/-/g, '')}`;
            const worker: any = new JobQueueWorker({ ...against(tls), name });
            const publisher: any = new JobQueuePublisher({
                ...against(tls),
                name,
            });

            t.after(() => worker.destroy().catch(() => undefined));
            t.after(() => publisher.destroy().catch(() => undefined));

            const handled = new Promise(resolve => worker.onPop(resolve));

            await worker.start();
            await publisher.start();
            await publisher.push({ send: 'an email' });

            assert.deepEqual(await handled, { send: 'an email' });
        });

        it('should present a client certificate when given one', async t => {
            const queue: any = new JobQueue(
                against({
                    ca: verified.ca(),
                    cert: broker.cert,
                    key: broker.key,
                    servername: verified.name(),
                }),
            );

            queue.onPop(() => undefined);
            t.after(() => queue.destroy().catch(() => undefined));

            await queue.start();

            const presented = socketOf(queue)?.getCertificate();

            assert.ok(presented && 'subject' in presented);
            assert.equal(presented.subject.CN, 'imq-integration-client');
        });
    });

    describe('a broker that will not be reached in the clear', () => {
        /**
         * Asserts a queue configured this way never reaches the broker.
         *
         * The lifecycle is driven inside the test rather than left to a hook:
         * a refused handshake is answered by an alert that arrives
         * asynchronously, and anything still in flight when the test ends is
         * reported by the runner as stray activity.
         */
        const refuses = async (tls?: any): Promise<void> => {
            const queue: any = new JobQueue(against(tls));

            queue.onPop(() => undefined);
            queue.imq.on('error', () => undefined);

            let reached = false;

            try {
                await queue.start();
                reached = !!socketOf(queue);
            } catch {
                // a refusal is the expected outcome
            }

            await queue.destroy().catch(() => undefined);
            await new Promise(resolve => setTimeout(resolve, 250));

            assert.equal(reached, false, 'the queue reached the broker');
        };

        it('should refuse a plaintext connection', async () => {
            // the broker runs with `--port 0`, so there is no plaintext
            // listener to fall back to and no way to reach it by accident
            await refuses(false);
        });

        it('should refuse a certificate it cannot verify', async () => {
            await refuses(true);
        });

        it('should refuse a name the certificate does not carry', async () => {
            await refuses({
                ca: verified.ca(),
                servername: 'not-the-broker.invalid',
            });
        });
    });

    describe('the environment configuration', () => {
        it('should encrypt a queue that asks for nothing in code', async t => {
            process.env.IMQ_REDIS_TLS_CA_FILE = broker.paths.ca;
            process.env.IMQ_REDIS_TLS_SERVERNAME = broker.servername;

            const queue: any = new JobQueue(against());

            queue.onPop(() => undefined);
            t.after(() => queue.destroy().catch(() => undefined));

            await queue.start();

            assert.ok(socketOf(queue)?.encrypted);
            assert.ok(socketOf(queue)?.authorized);
        });
    });
});
